import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import dotenv from 'dotenv';
import { isMessageProcessed, markMessageProcessed, updateMessageStatus } from './db.js';
import { publishToFacebook } from './facebook/index.js';
import { getTempFilePath, cleanupOldMedia } from './media.js';
import { sendAlert } from './alert.js';

dotenv.config();

// Fallback to previous API ID / Hash if not in env
const apiId = parseInt(process.env.TG_API_ID || "15602605");
const apiHash = process.env.TG_API_HASH || "8a0af2c18a8c3aeebd26f0a277e7e9c0";
const botToken = process.env.TG_BOT_TOKEN;
const adminGroupId = process.env.TG_ADMIN_GROUP_ID ? process.env.TG_ADMIN_GROUP_ID.trim() : null;

// Global buffer cho các message đến sát nhau (album grouping)
const albumBuffer = new Map();

// Global lock: Set chứa các message ID đang được xử lý hoặc đã xử lý
// Ngăn race condition khi Telegram gửi duplicate events
const processingMessages = new Set();

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
  
  // Check if channel is our admin group
  if (normAdminId && normChannelId !== normAdminId && chat.username !== adminGroupId) {
    return;
  }

  const messageId = message.id;

  // === DEDUP CHECK 1: In-memory lock ===
  // Nếu message này đang được xử lý hoặc đã xử lý rồi → bỏ qua
  if (processingMessages.has(messageId)) {
    console.log(`[Dedup] Message ${messageId} đang/đã được xử lý, bỏ qua duplicate event.`);
    return;
  }

  // === DEDUP CHECK 2: Database check ===
  // Kiểm tra ngay từ đầu, tránh buffering tin đã xử lý
  if (isMessageProcessed(channelId, messageId.toString())) {
    console.log(`[Dedup] Message ${messageId} đã có trong DB, bỏ qua.`);
    processingMessages.add(messageId); // Thêm vào memory để lần sau không cần query DB
    return;
  }

  // Kiểm tra xem tin nhắn có grouped_id (album) hay không
  const groupedId = message.groupedId?.toString() || null;

  if (groupedId) {
    // === Xử lý ALBUM: gom các tin nhắn cùng groupedId ===
    const bufferKey = `${channelId}_album_${groupedId}`;
    
    if (!albumBuffer.has(bufferKey)) {
      albumBuffer.set(bufferKey, {
        timer: setTimeout(() => processChatBuffer(bufferKey, channelId, chat), 4000),
        messages: [],
        seenIds: new Set(), // Dedup set
      });
    }

    const group = albumBuffer.get(bufferKey);
    // Dedup: chỉ thêm nếu chưa thấy message ID này
    if (group.seenIds.has(messageId)) return;
    group.seenIds.add(messageId);
    group.messages.push(message);
  } else {
    // === Xử lý TIN NHẮN ĐƠN LẺ: không cần buffer, xử lý ngay ===
    // Đánh dấu ngay vào memory lock để không bị duplicate
    processingMessages.add(messageId);
    
    // Xử lý trực tiếp (không cần đợi 4 giây)
    console.log(`\n[Telegram] Xử lý tin nhắn đơn lẻ (MessageID: ${messageId})`);
    await processMessages([message], chat, channelId);
  }
}

/**
 * Xử lý toàn bộ các tin nhắn album đã gom trong 4 giây
 */
async function processChatBuffer(bufferKey, channelId, chat) {
  const group = albumBuffer.get(bufferKey);
  if (!group) return;
  albumBuffer.delete(bufferKey);
  
  const messages = group.messages;
  
  // Lock tất cả message IDs trong album
  for (const m of messages) {
    processingMessages.add(m.id);
  }

  console.log(`\n[Telegram] Xử lý album ${messages.length} tin nhắn (IDs: ${messages.map(m => m.id).join(', ')})`);
  await processMessages(messages, chat, channelId);
}

/**
 * Core processing: download media + upload to Facebook
 */
async function processMessages(messages, chat, channelId) {
  const mainMessageId = messages[0].id.toString();

  // === DEDUP CHECK 3: Final DB check trước khi upload ===
  // Double-check vì có thể message đã được xử lý bởi một instance khác
  if (isMessageProcessed(channelId, mainMessageId)) {
    console.log(`[Dedup] Message ${mainMessageId} đã xử lý (final check), bỏ qua.`);
    return;
  }

  // === MARK FIRST: Đánh dấu vào DB TRƯỚC khi upload ===
  // Nếu insert thất bại (trả về false) → message đã bị xử lý bởi concurrent request
  const wasInserted = markMessageProcessed(channelId, mainMessageId, 'uploading');
  if (!wasInserted) {
    console.log(`[Dedup] Message ${mainMessageId} đã bị claim bởi process khác, bỏ qua.`);
    return;
  }

  // Trích xuất nội dung chữ (Caption)
  // Quét qua các tin nhắn, ƯU TIÊN LẤY TEXT DO BẠN TỰ GÕ (KHÔNG phải forward).
  // Vì text forward thường dính rác/quảng cáo của channel khác.
  const myTexts = messages.filter(m => !m.fwdFrom).map(m => m.message).filter(Boolean);
  const text = myTexts.join("\n\n") || "";

  const hasMedia = messages.some(m => !!m.media);

  if (!text && !hasMedia) {
    updateMessageStatus(channelId, mainMessageId, 'skipped');
    return;
  }

  let downloadedFilePaths = [];

  try {
    // Process Media
    if (hasMedia) {
      for (const m of messages) {
        if (m.media) {
          console.log(`[Media] Downloading media for message ${m.id}...`);
          const buffer = await client.downloadMedia(m);
          if (buffer) {
            const mime = m.media?.document?.mimeType || 'unknown';
            const ext = mime.includes('mp4') || mime.includes('video') ? '.mp4' : 
                       (mime.includes('image') || mime.includes('jpeg') ? '.jpg' : '.jpg');
            const path = getTempFilePath(`${Date.now()}_${m.id}${ext}`);
            
            await import('fs-extra').then(f => f.outputFile(path, buffer));
            downloadedFilePaths.push(path);
          }
        }
      }
      console.log(`[Media] Saved ${downloadedFilePaths.length} files.`);
    }

    // Publish to Facebook
    console.log(`[FB] Publishing...`);
    const fbPostId = await publishToFacebook(text, downloadedFilePaths.length > 0 ? downloadedFilePaths : null);
    
    // Success -> Update status in DB
    updateMessageStatus(channelId, mainMessageId, 'success');

    // Send Reply
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
    // Fail -> Update status
    const reqErrorMsg = `Failed to process/post message ${mainMessageId}.\nError: ${error.message}`;
    console.error(`[Error] ${reqErrorMsg}`);
    updateMessageStatus(channelId, mainMessageId, 'failed');
    await client.sendMessage(chat.id, { message: `❌ Lỗi khi upload:\n${error.message}`, replyTo: messages[messages.length - 1].id });
  } finally {
    // Cleanup Old Media
    await cleanupOldMedia();
  }
}

