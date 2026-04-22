import axios from 'axios';
import fs from 'fs-extra';
import FormData from 'form-data';
import dotenv from 'dotenv';
dotenv.config();

const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.FB_PAGE_ID;

/**
 * Upload to Facebook Page using Graph API
 * @param {string} text 
 * @param {string} filePath 
 */
export async function publishViaAPI(text, filePath) {
  if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
    throw new Error('Graph API credentials (FB_PAGE_ACCESS_TOKEN, FB_PAGE_ID) missing!');
  }

  const isVideo = filePath && filePath.match(/\.(mp4|mov|mkv|webm)$/i);
  const endpoint = isVideo 
    ? `https://graph.facebook.com/v19.0/${PAGE_ID}/videos`
    : (filePath ? `https://graph.facebook.com/v19.0/${PAGE_ID}/photos` : `https://graph.facebook.com/v19.0/${PAGE_ID}/feed`);

  const formData = new FormData();
  formData.append('access_token', PAGE_ACCESS_TOKEN);
  
  if (text) {
    if (filePath && !isVideo) {
      formData.append('caption', text);
    } else if (isVideo) {
      formData.append('description', text);
    } else {
      formData.append('message', text);
    }
  }

  if (filePath) {
    if (!await fs.pathExists(filePath)) {
      throw new Error(`File to upload not found: ${filePath}`);
    }
    formData.append('source', fs.createReadStream(filePath));
  }

  try {
    const response = await axios.post(endpoint, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    console.log(`[FB-API] Successfully published to Page. Post ID: ${response.data.id}`);
    return true;
  } catch (error) {
    console.error(`[FB-API] Error publishing:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || error.message);
  }
}
