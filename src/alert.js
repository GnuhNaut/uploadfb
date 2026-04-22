import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.TG_ALERT_BOT_TOKEN;
const CHAT_ID = process.env.TG_ALERT_CHAT_ID;

/**
 * Send an alert message to Telegram
 * @param {string} message 
 */
export async function sendAlert(message) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[Alert] Alert BOT_TOKEN or CHAT_ID not configured, skipping alert:', message);
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: `🚨 *FB Auto-Poster Alert*\n\n${message}`,
      parse_mode: 'Markdown'
    });
    console.log('[Alert] Sent alert to Telegram successfully.');
  } catch (error) {
    console.error('[Alert] Failed to send alert to Telegram:', error.response?.data || error.message);
  }
}
