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
 * @param {string | string[]} filePaths 
 */
export async function publishViaAPI(text, filePaths) {
  if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
    throw new Error('Graph API credentials (FB_PAGE_ACCESS_TOKEN, FB_PAGE_ID) missing!');
  }

  // Handle Array of paths
  let isAlbum = false;
  let singleFilePath = null;

  if (Array.isArray(filePaths)) {
    if (filePaths.length > 1) {
      isAlbum = true;
    } else if (filePaths.length === 1) {
      singleFilePath = filePaths[0];
    }
  } else if (filePaths) {
    singleFilePath = filePaths;
  }

  // ALO Luồng đăng Album (Chỉ dùng cho ảnh)
  if (isAlbum) {
    console.log(`[FB-API] Uploading Album (${filePaths.length} media)...`);
    const attachedMedia = [];
    
    // Tải ảnh dưới dạng bản nháp (published=false)
    for (const p of filePaths) {
      if (!await fs.pathExists(p)) throw new Error(`File not found: ${p}`);
      
      const pData = new FormData();
      pData.append('access_token', PAGE_ACCESS_TOKEN);
      pData.append('published', 'false');
      pData.append('source', fs.createReadStream(p));
      
      try {
        const pRes = await axios.post(`https://graph.facebook.com/v19.0/${PAGE_ID}/photos`, pData, {
          headers: pData.getHeaders(),
          maxContentLength: Infinity, maxBodyLength: Infinity
        });
        attachedMedia.push({ "media_fbid": pRes.data.id });
      } catch (err) {
        console.error(`[FB-API] Error uploading unpublished media:`, err.response?.data || err.message);
        throw new Error("Lấy draft ảnh thất bại: " + (err.response?.data?.error?.message || err.message));
      }
    }
    
    // Gộp tất cả ảnh lại thành 1 Post trên Feed
    const fData = new FormData();
    fData.append('access_token', PAGE_ACCESS_TOKEN);
    if (text) fData.append('message', text);
    
    // Convert array of objects to proper string for Facebook API
    // Actually facebook accepts attached_media[0]={"media_fbid":"id"} etc..
    // But axios with FormData requires iterating or JSON stringification
    for (let i = 0; i < attachedMedia.length; i++) {
        fData.append(`attached_media[${i}]`, JSON.stringify(attachedMedia[i]));
    }
    
    try {
      const fRes = await axios.post(`https://graph.facebook.com/v19.0/${PAGE_ID}/feed`, fData, {
        headers: fData.getHeaders()
      });
      console.log(`[FB-API] Successfully published Album Post ID: ${fRes.data.id}`);
      return fRes.data.id;
    } catch (err) {
      console.error(`[FB-API] Error publishing Album:`, err.response?.data || err.message);
      throw new Error(err.response?.data?.error?.message || err.message);
    }
  }

  // ALO Luồng đăng đơn lẻ (1 ảnh hoặc 1 video)
  const isVideo = singleFilePath && singleFilePath.match(/\.(mp4|mov|mkv|webm)$/i);
  const endpoint = isVideo 
    ? `https://graph.facebook.com/v19.0/${PAGE_ID}/videos`
    : (singleFilePath ? `https://graph.facebook.com/v19.0/${PAGE_ID}/photos` : `https://graph.facebook.com/v19.0/${PAGE_ID}/feed`);

  const formData = new FormData();
  formData.append('access_token', PAGE_ACCESS_TOKEN);
  
  if (text) {
    if (singleFilePath && !isVideo) {
      formData.append('caption', text);
    } else if (isVideo) {
      formData.append('description', text);
    } else {
      formData.append('message', text);
    }
  }

  if (singleFilePath) {
    if (!await fs.pathExists(singleFilePath)) {
      throw new Error(`File to upload not found: ${singleFilePath}`);
    }
    formData.append('source', fs.createReadStream(singleFilePath));
  }

  try {
    const response = await axios.post(endpoint, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    console.log(`[FB-API] Successfully published to Page. Post ID: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.error(`[FB-API] Error publishing:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || error.message);
  }
}
