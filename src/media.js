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
 * Clean up files in the temp directory, keeping only the 5 most recent
 */
export async function cleanupOldMedia() {
  try {
    const files = await fs.readdir(tempDir);
    if (files.length <= 5) return;

    // Get files with stats
    const filesWithStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        return { filePath, ctime: stats.ctime.getTime() };
      })
    );

    // Sort by creation time descending (newest first)
    filesWithStats.sort((a, b) => b.ctime - a.ctime);

    // Keep first 5, delete the rest
    const filesToDelete = filesWithStats.slice(5);
    for (const fileObj of filesToDelete) {
      await fs.remove(fileObj.filePath);
      console.log(`[Media] Cleaned up old file: ${fileObj.filePath}`);
    }
  } catch (error) {
    console.error(`[Media] Error cleaning up old media:`, error.message);
  }
}

/**
 * Helper to get temp file path
 */
export function getTempFilePath(filename) {
  return path.join(tempDir, filename);
}

export { tempDir };
