import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import pkg from 'input'; // Default export, so we use pkg
const { text } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const apiId = parseInt(process.env.TG_API_ID || 0);
const apiHash = process.env.TG_API_HASH;
const stringSession = new StringSession(''); // Empty string means new session

(async () => {
  if (!apiId || !apiHash) {
    console.error("Please set TG_API_ID and TG_API_HASH in your .env file before running this script.");
    process.exit(1);
  }

  console.log("Loading interactive Telegram login...");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await text('Please enter your phone number (+123456789): '),
    password: async () => await text('Please enter your 2FA password (leave empty if none): '),
    phoneCode: async () => await text('Please enter the code you received: '),
    onError: (err) => console.log(err),
  });

  console.log('You should now be connected.');
  const savedSession = client.session.save();
  console.log('\n======================================================');
  console.log('SAVE THIS STRING AS `TG_SESSION` IN YOUR `.env` FILE');
  console.log('======================================================\n');
  console.log(savedSession);
  console.log('\n======================================================');
  await client.disconnect();
})();
