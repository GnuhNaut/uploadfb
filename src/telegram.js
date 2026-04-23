import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import dotenv from 'dotenv';
import { isMessageProcessed, markMessageProcessed } from './db.js';
import { publishToFacebook } from './facebook/index.js';
import { getTempFilePath, cleanupOldMedia } from './media.js';
import { sendAlert } from './alert.js';

dotenv.config();

// Fallback to previous API ID / Hash if not in env
const apiId = parseInt(process.env.TG_API_ID || "15602605");
const apiHash = process.env.TG_API_HASH || "8a0af2c18a8c3aeebd26f0a277e7e9c0";
const botToken = process.env.TG_BOT_TOKEN;
const adminGroupId = process.env.TG_ADMIN_GROUP_ID ? process.env.TG_ADMIN_GROUP_ID.trim() : null;

// Global buffer cho các message đến sát nhau
const albumBuffer = new Map();

export let client;

/**
 * Initializes and starts the Telegram Client as a Bot
 */
export async function startTelegramClient() {
  if (!botToken) {
    throw new Error('TG_BOT_TOKEN is missing in .env');
  }

  // Using empty StringSession for bot
  client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log('[Telegram] Connecting as Bot...');
  await client.start({
    botAuthToken: botToken,
  });
  console.log('[Telegram] Bot connected successfully!');

  // Setup Listener
  if (adminGroupId) {
    console.log(`[Telegram] Listening to admin group: ${adminGroupId}`);
    client.addEventHandler(handleNewMessage, new NewMessage({ incoming: true }));
  } else {
    console.warn('[Telegram] No group configured in TG_ADMIN_GROUP_ID.');
  }

  return client;
}

/**
 * Handle incoming NewMessage event
 */
async function handleNewMessage(event) {
  const message = event.message;
  let chat;
  
  try {
    chat = await message.getChat();
  } catch (error) {
    return;
  }

  const channelId = chat.id.toString();
  
  // Normalize IDs to handle Bot API vs MTProto differences (-100 prefix)
  const normChannelId = channelId.replace(/^-100|^-/, '');
  const normAdminId = adminGroupId ? adminGroupId.replace(/^-100|^-/, '') : null;
  console.log(`[Debug] Nhận tin nhắn từ Group ID: ${channelId} (chuẩn hóa: ${normChannelId})`);
  
  // Check if channel is our admin group
  if (normAdminId && normChannelId !== normAdminId && chat.username !== adminGroupId) {
    console.log(`[Debug] Đã bỏ qua tin vì ID chuẩn hóa ${normChannelId} không khớp với ${normAdminId}`);
    return;
  }

  // 1. Khởi tạo Buffer chung theo Group (Chat)
  if (!albumBuffer.has(channelId)) {
    albumBuffer.set(channelId, {
      timer: setTimeout(() => processChatBuffer(channelId, chat), 4000),
      messages: []
    });
  }
  albumBuffer.get(channelId).messages.push(message);
}

// Xử lý toàn bộ các tin nhắn đến cùng 1 lúc trong 4 giây
async function processChatBuffer(channelId, chat) {
  const group = albumBuffer.get(channelId);
  if (!group) return;
  albumBuffer.delete(channelId);
  
  const messages = group.messages;
  await processMessages(messages, chat, channelId);
}

async function processMessages(messages, chat, channelId) {
  const mainMessageId = messages[0].id.toString();

  // 1. Check Database
  if (isMessageProcessed(channelId, mainMessageId)) {
    return;
  }

  // 2. Trích xuất nội dung chữ (Caption)
  // Quét qua các tin nhắn, ƯU TIÊN LẤY TEXT DO BẠN TỰ GÕ (KHÔNG phải forward).
  // Vì text forward thường dính rác/quảng cáo của channel khác.
  const myTexts = messages.filter(m => !m.fwdFrom).map(m => m.message).filter(Boolean);
  const text = myTexts.join("\n\n") || "";

  const hasMedia = messages.some(m => !!m.media);

  if (!text && !hasMedia) return;

  console.log(`\n[Telegram] Đang xử lý ${messages.length} tin nhắn (MessageID: ${mainMessageId})`);
  let downloadedFilePaths = [];

  try {
    // 3. Process Media
    if (hasMedia) {
      for (const m of messages) {
        if (m.media) {
          console.log(`[Media] Downloading media for message ${m.id}...`);
          const buffer = await client.downloadMedia(m);
          if (buffer) {
            const mime = m.media?.document?.mimeType || 'unknown';
            const ext = mime.includes('mp4') || mime.includes('video') ? '.mp4' : 
                       (mime.includes('image') || mime.includes('jpeg') ? '.jpg' : '.bin');
            const path = getTempFilePath(`${Date.now()}_${m.id}${ext}`);
            
            await import('fs-extra').then(f => f.outputFile(path, buffer));
            downloadedFilePaths.push(path);
          }
        }
      }
      console.log(`[Media] Saved ${downloadedFilePaths.length} files.`);
    }

    // 4. Publish to Facebook
    console.log(`[FB] Publishing...`);
    const fbPostId = await publishToFacebook(text, downloadedFilePaths.length > 0 ? downloadedFilePaths : null);
    
    // 5. Success -> Update DB
    markMessageProcessed(channelId, mainMessageId, 'success');

    // 6. Send Reply
    const pageId = process.env.FB_PAGE_ID;
    
    // Thường FB trả về PAGEID_POSTID, nên ta tách lấy đoạn POSTID đằng sau
    const actualPostId = fbPostId.includes('_') ? fbPostId.split('_')[1] : fbPostId;
    const isVideo = downloadedFilePaths.length === 1 && downloadedFilePaths[0].match(/\.(mp4|mov|mkv|webm)$/i);
    
    // Facebook cho phép link dạng `facebook.com/POSTID` rất ngắn và dễ truy cập
    const fbLink = isVideo 
      ? `https://www.facebook.com/${pageId}/videos/${actualPostId}`
      : `https://www.facebook.com/${actualPostId}`;
    
    console.log(`[Telegram] Sending success reply...`);
    await client.sendMessage(chat.id, { 
      message: `✅ Đã upload thành công!\nLink: ${fbLink}`,
      replyTo: messages[messages.length - 1].id 
    });

  } catch (error) {
    // 7. Fail -> Log error
    const reqErrorMsg = `Failed to process/post message ${mainMessageId}.\nError: ${error.message}`;
    console.error(`[Error] ${reqErrorMsg}`);
    markMessageProcessed(channelId, mainMessageId, 'failed');
    await client.sendMessage(chat.id, { message: `❌ Lỗi khi upload:\n${error.message}`, replyTo: messages[messages.length - 1].id });
  } finally {
    // 8. Cleanup Old Media
    await cleanupOldMedia();
  }
}
