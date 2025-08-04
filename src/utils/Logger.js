/**
 * Logger.js - Centralized logging utility with configurable levels
 * 
 * Provides controlled logging with different levels to replace scattered console.log statements
 * Follows production-ready logging practices with environment-based configuration
 */

/**
 * Logging levels in order of severity
 */
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

/**
 * Logger class for centralized, configurable logging
 */
class Logger {
  constructor(level = 'INFO') {
    this.setLevel(level);
    this.context = '';
  }

  /**
   * Set the current logging level
   * @param {string} level - Logging level ('ERROR', 'WARN', 'INFO', 'DEBUG')
   */
  setLevel(level) {
    const upperLevel = level.toUpperCase();
    if (upperLevel in LOG_LEVELS) {
      this.currentLevel = LOG_LEVELS[upperLevel];
    } else {
      console.warn(`Invalid log level: ${level}. Using INFO.`);
      this.currentLevel = LOG_LEVELS.INFO;
    }
  }

  /**
   * Set context for subsequent log messages
   * @param {string} context - Context identifier (e.g., 'GameManager', 'TokenManager')
   */
  setContext(context) {
    this.context = context;
  }

  /**
   * Format log message with timestamp and context
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} data - Optional data object
   * @returns {Array} Formatted message parts for console
   */
  formatMessage(level, message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    const contextStr = this.context ? `[${this.context}]` : '';
    const baseMessage = `[${timestamp}] ${level} ${contextStr} ${message}`;
    
    return data ? [baseMessage, data] : [baseMessage];
  }

  /**
   * Log error message
   * @param {string} message - Error message
   * @param {Object} data - Optional error data
   */
  error(message, data = null) {
    if (this.currentLevel >= LOG_LEVELS.ERROR) {
      const formatted = this.formatMessage('ERROR', message, data);
      console.error(...formatted);
    }
  }

  /**
   * Log warning message
   * @param {string} message - Warning message
   * @param {Object} data - Optional warning data
   */
  warn(message, data = null) {
    if (this.currentLevel >= LOG_LEVELS.WARN) {
      const formatted = this.formatMessage('WARN', message, data);
      console.warn(...formatted);
    }
  }

  /**
   * Log info message
   * @param {string} message - Info message
   * @param {Object} data - Optional info data
   */
  info(message, data = null) {
    if (this.currentLevel >= LOG_LEVELS.INFO) {
      const formatted = this.formatMessage('INFO', message, data);
      console.log(...formatted);
    }
  }

  /**
   * Log debug message
   * @param {string} message - Debug message
   * @param {Object} data - Optional debug data
   */
  debug(message, data = null) {
    if (this.currentLevel >= LOG_LEVELS.DEBUG) {
      const formatted = this.formatMessage('DEBUG', message, data);
      console.log(...formatted);
    }
  }
}

// Create default logger instance - can be configured based on environment
const logger = new Logger(
  // Browser-compatible environment detection
  // In production, this should be 'ERROR' or 'WARN'
  // For development, 'INFO' or 'DEBUG' is appropriate
  (typeof window !== 'undefined' && window.location?.hostname === 'localhost') ? 'INFO' : 'WARN'
);

export default logger;
