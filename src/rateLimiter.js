import dotenv from 'dotenv';
import { countPostsInLastHours, recordPost } from './db.js';

dotenv.config();

const MAX_POSTS_PER_DAY = parseInt(process.env.RATE_LIMIT_POSTS_PER_DAY || '6', 10);

/**
 * Checks if we can post right now.
 * @returns {boolean}
 */
export function canPost() {
  const currentCount = countPostsInLastHours(24);
  console.log(`[RateLimiter] Current posts in last 24 hours: ${currentCount}/${MAX_POSTS_PER_DAY}`);
  return currentCount < MAX_POSTS_PER_DAY;
}

/**
 * Records that a post was made.
 */
export function logPost() {
  recordPost();
  console.log(`[RateLimiter] Logged new post. Total in last 24 hours is now: ${countPostsInLastHours(24)}`);
}
