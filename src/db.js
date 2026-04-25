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

// Add UNIQUE constraint to prevent duplicate message records.
// Using CREATE UNIQUE INDEX IF NOT EXISTS so it's safe to run on existing databases.
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_unique ON messages(channel_id, message_id);`);
} catch (e) {
  // If index creation fails due to existing duplicates, clean up first
  console.warn('[DB] Cleaning up duplicate records before creating unique index...');
  db.exec(`
    DELETE FROM messages WHERE id NOT IN (
      SELECT MIN(id) FROM messages GROUP BY channel_id, message_id
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_unique ON messages(channel_id, message_id);
  `);
}

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
 * Mark a message as processed (INSERT OR IGNORE to prevent duplicates)
 * @param {string} channelId 
 * @param {string} messageId 
 * @param {string} status 
 * @returns {boolean} true if inserted, false if already existed
 */
export function markMessageProcessed(channelId, messageId, status = 'processed') {
  const stmt = db.prepare('INSERT OR IGNORE INTO messages (channel_id, message_id, status) VALUES (?, ?, ?)');
  const result = stmt.run(channelId.toString(), messageId.toString(), status);
  return result.changes > 0;
}

/**
 * Update the status of an already-marked message
 * @param {string} channelId 
 * @param {string} messageId 
 * @param {string} newStatus 
 */
export function updateMessageStatus(channelId, messageId, newStatus) {
  const stmt = db.prepare('UPDATE messages SET status = ? WHERE channel_id = ? AND message_id = ?');
  stmt.run(newStatus, channelId.toString(), messageId.toString());
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
