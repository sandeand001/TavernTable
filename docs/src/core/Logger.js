// Logger.js - Utility for logging
export const LOG_CATEGORY = {
  SYSTEM: 'system',
  USER: 'user',
  ERROR: 'error',
};
export function logger(category, message) {
  console.log(`[${category}] ${message}`);
}
