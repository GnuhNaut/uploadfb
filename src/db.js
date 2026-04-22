import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data.sqlite');

const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT,
    message_id TEXT,
    status TEXT DEFAULT 'processed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/**
 * Check if a message has already been processed
 * @param {string} channelId 
 * @param {string} messageId 
 * @returns {boolean}
 */
export function isMessageProcessed(channelId, messageId) {
  const stmt = db.prepare('SELECT 1 FROM messages WHERE channel_id = ? AND message_id = ? LIMIT 1');
  const result = stmt.get(channelId.toString(), messageId.toString());
  return !!result;
}

/**
 * Mark a message as processed
 * @param {string} channelId 
 * @param {string} messageId 
 * @param {string} status 
 */
export function markMessageProcessed(channelId, messageId, status = 'processed') {
  const stmt = db.prepare('INSERT INTO messages (channel_id, message_id, status) VALUES (?, ?, ?)');
  stmt.run(channelId.toString(), messageId.toString(), status);
}

/**
 * Record a successful post to Facebook for rate limiting
 */
export function recordPost() {
  const stmt = db.prepare('INSERT INTO posts DEFAULT VALUES');
  stmt.run();
}

/**
 * Count how many posts have been made in the last N hours
 * @param {number} hours 
 * @returns {number}
 */
export function countPostsInLastHours(hours = 1) {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count 
    FROM posts 
    WHERE published_at >= datetime('now', '-' || ? || ' hours')
  `);
  const result = stmt.get(hours);
  return result.count;
}

export default db;
