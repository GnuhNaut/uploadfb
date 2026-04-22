import dotenv from 'dotenv';
import { publishViaAPI } from './api.js';
import { publishViaPlaywright } from './playwright.js';

dotenv.config();

/**
 * Main function to publish generic content to Facebook based on settings
 * @param {string} text 
 * @param {string} filePath 
 */
export async function publishToFacebook(text, filePath) {
  const mode = (process.env.FB_MODE || 'api').toLowerCase();
  
  if (mode === 'playwright') {
    return publishViaPlaywright(text, filePath);
  } else {
    return publishViaAPI(text, filePath);
  }
}
