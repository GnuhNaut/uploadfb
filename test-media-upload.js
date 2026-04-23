import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import dotenv from 'dotenv';
import { publishToFacebook } from './src/facebook/index.js';
import { getTempFilePath, cleanupMedia, initMediaDir } from './src/media.js';
import fs from 'fs-extra';

dotenv.config();

const apiId = parseInt(process.env.TG_API_ID || 0);
const apiHash = process.env.TG_API_HASH;
const stringSession = new StringSession(process.env.TG_SESSION || "");
const monitorChannels = process.env.TG_MONITOR_CHANNELS 
  ? process.env.TG_MONITOR_CHANNELS.split(',').map(c => c.trim())
  : [];

(async () => {
  if (!apiId || !apiHash || !process.env.TG_SESSION) {
    console.error('❌ Missing TG_API_ID, TG_API_HASH, or TG_SESSION in .env');
    process.exit(1);
  }

  if (monitorChannels.length === 0) {
    console.error('❌ Missing TG_MONITOR_CHANNELS in .env');
    process.exit(1);
  }

  // Lấy channel đầu tiên trong danh sách biến môi trường
  const channel = monitorChannels[0];
  console.log(`[Test] Target Channel: ${channel}`);

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log('[Test] Connecting to Telegram...');
  await client.connect();
  console.log('[Test] Connected successfully!');

  try {
    console.log(`[Test] Fetching latest messages from ${channel}...`);
    // Lấy 20 tin nhắn gần nhất để phòng trường hợp tin mới nhất chỉ là text
    const messages = await client.getMessages(channel, { limit: 20 });
    
    // Tìm tin nhắn gần nhất CÓ chứa media
    const mediaMsg = messages.find(m => !!m.media);
    
    if (!mediaMsg) {
      console.log('❌ No media found in the last 20 messages.');
      await client.disconnect();
      return;
    }

    console.log(`[Test] Found media in message ID: ${mediaMsg.id}`);
    
    // Tạo thư mục tạm
    await initMediaDir();

    console.log('[Test] Downloading media...');
    const buffer = await client.downloadMedia(mediaMsg);
    
    if (!buffer) {
      console.log('❌ Failed to download media (buffer empty).');
      await client.disconnect();
      return;
    }

    // Dự đoán định dạng file
    const mime = mediaMsg.media?.document?.mimeType || 'unknown';
    const ext = mime.includes('mp4') || mime.includes('video') ? '.mp4' : 
               (mime === 'image/jpeg' ? '.jpg' : '.bin');
               
    const downloadedFilePath = getTempFilePath(`test_${mediaMsg.id}${ext}`);
    await fs.outputFile(downloadedFilePath, buffer);
    console.log(`[Test] Media saved to ${downloadedFilePath}`);

    console.log('[Test] Uploading to Facebook Page (Media ONLY, NO TEXT)...');
    
    // Gửi chuỗi rỗng "" ở đối số text để lọc chữ
    await publishToFacebook("", downloadedFilePath);
    
    console.log('✅ Upload test successfully completed!');
    
    // Xóa file temp sau khi upload
    await cleanupMedia(downloadedFilePath);

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await client.disconnect();
    console.log('[Test] Disconnected.');
    process.exit(0);
  }
})();
