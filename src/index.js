import dotenv from 'dotenv';
import { initMediaDir, cleanupAllMedia } from './media.js';
import { startTelegramClient } from './telegram.js';

dotenv.config();

async function main() {
  console.log('====================================');
  console.log(' starting Auto-Poster Service ');
  console.log('====================================');

  try {
    // 1. Initialize Temp Directory
    await initMediaDir();
    // Clear out any old temp media on boot
    await cleanupAllMedia();

    // 2. Start Telegram client and listeners
    await startTelegramClient();

    console.log('[System] Service is now up and running.');

    // Keep Node process running gracefully
    process.on('SIGINT', () => {
      console.log('Caught SIGINT, shutting down...');
      process.exit(0);
    });

  } catch (error) {
    console.error('[System Fatal Error]:', error);
    process.exit(1);
  }
}

main();
