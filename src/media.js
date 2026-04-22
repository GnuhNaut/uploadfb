import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, '..', 'temp');

/**
 * Ensure the temp directory exists
 */
export async function initMediaDir() {
  await fs.ensureDir(tempDir);
}

/**
 * Clean up files in the temp directory
 * @param {string} filePath 
 */
export async function cleanupMedia(filePath) {
  try {
    if (filePath && await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      console.log(`[Media] Cleaned up file: ${filePath}`);
    }
  } catch (error) {
    console.error(`[Media] Error cleaning up file ${filePath}:`, error.message);
  }
}

/**
 * Clean up all files in temp directory
 */
export async function cleanupAllMedia() {
  try {
    await fs.emptyDir(tempDir);
    console.log(`[Media] Cleaned up all temp files.`);
  } catch (error) {
    console.error(`[Media] Error cleaning up temp dir:`, error.message);
  }
}

/**
 * Helper to get temp file path
 */
export function getTempFilePath(filename) {
  return path.join(tempDir, filename);
}

export { tempDir };
