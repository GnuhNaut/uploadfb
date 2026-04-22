import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import dotenv from 'dotenv';
import { isMessageProcessed, markMessageProcessed } from './db.js';
import { publishToFacebook } from './facebook/index.js';
import { getTempFilePath, cleanupMedia } from './media.js';
import { canPost, logPost } from './rateLimiter.js';
import { sendAlert } from './alert.js';

dotenv.config();

const apiId = parseInt(process.env.TG_API_ID || 0);
const apiHash = process.env.TG_API_HASH;
const stringSession = new StringSession(process.env.TG_SESSION || "");

const monitorChannels = process.env.TG_MONITOR_CHANNELS 
  ? process.env.TG_MONITOR_CHANNELS.split(',').map(c => c.trim())
  : [];

export let client;

/**
 * Initializes and starts the Telegram Client
 */
export async function startTelegramClient() {
  if (!apiId || !apiHash) {
    throw new Error('Telegram API configuration missing (TG_API_ID, TG_API_HASH)');
  }

  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log('[Telegram] Connecting...');
  await client.connect();
  console.log('[Telegram] Connected successfully!');

  // Setup Listener
  if (monitorChannels.length > 0) {
    console.log(`[Telegram] Listening to channels: ${monitorChannels.join(', ')}`);
    client.addEventHandler(handleNewMessage, new NewMessage({ incoming: true }));
  } else {
    console.warn('[Telegram] No channels configured in TG_MONITOR_CHANNELS.');
  }

  // Print session if it was newly generated
  if (client.session && !process.env.TG_SESSION) {
    console.log('[Telegram] Generated new session string. Please save this inside your .env file as TG_SESSION:');
    console.log(client.session.save());
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
    return; // Ignore messages where chat info is unavailable
  }

  // Check if channel is in our whitelist
  const isMatch = monitorChannels.includes(chat.username) || monitorChannels.includes(chat.id?.toString());
  if (!isMatch) return;

  const channelId = chat.id.toString();
  const messageId = message.id.toString();

  // 1. Check Database
  if (isMessageProcessed(channelId, messageId)) {
    console.log(`[Telegram] Message ${messageId} from ${channelId} already processed. Skipping.`);
    return;
  }

  // Determine if it has media / text
  const text = message.message || "";
  const hasMedia = !!message.media;

  if (!text && !hasMedia) return;

  console.log(`\n[Telegram] New message detected (${messageId}) from ${channelId}`);
  let downloadedFilePath = null;

  try {
    // 2. Check Rate Limit
    if (!canPost()) {
      console.log(`[RateLimiter] Rate limit reached. Skipping message ${messageId}.`);
      return;
    }

    // 3. Process Media
    if (hasMedia) {
      console.log(`[Media] Downloading media for message ${messageId}...`);
      const buffer = await client.downloadMedia(message);
      if (buffer) {
        // Find extension, rough estimation based on mime
        const mime = message.media?.document?.mimeType || 'unknown';
        const ext = mime.includes('mp4') || mime.includes('video') ? '.mp4' : 
                   (mime === 'image/jpeg' ? '.jpg' : '.bin');
        downloadedFilePath = getTempFilePath(`${messageId}${ext}`);
        
        await import('fs-extra').then(f => f.outputFile(downloadedFilePath, buffer));
        console.log(`[Media] Saved to ${downloadedFilePath}`);
      }
    }

    // 4. Publish to Facebook
    console.log(`[FB] Publishing...`);
    await publishToFacebook(text, downloadedFilePath);
    
    // 5. Success -> Update DB & Rate Limiter
    markMessageProcessed(channelId, messageId, 'success');
    logPost();

  } catch (error) {
    // 6. Fail -> Log error
    const reqErrorMsg = `Failed to process/post message ${messageId}.\nError: ${error.message}`;
    console.error(`[Error] ${reqErrorMsg}`);
    markMessageProcessed(channelId, messageId, 'failed');
    await sendAlert(reqErrorMsg);
  } finally {
    // 7. Cleanup
    if (downloadedFilePath) {
      await cleanupMedia(downloadedFilePath);
    }
  }
}
