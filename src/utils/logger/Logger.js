// ── Imports ─────────────────────────────────────────────────────
import { getNodeEnv, isJest } from '../env.js';
/**
 * Logger.js - Enterprise-Grade Logging System for TavernTable
 *
 * Main Logger class and singleton instance. Internal subsystems (LogEntry,
 * output handlers, PerformanceMonitor) live in ./internals/.
 *
 * @author TavernTable Development Team
 * @version 2.0.0
 */

import { LOG_LEVEL, LOG_CATEGORY } from './enums.js';
import {
  isValidLogLevel,
  resolveLevelOverride,
  emitConsoleFallback,
} from './internals/logUtils.js';
import { LoggerConfig } from './internals/LoggerConfig.js';
import { LogEntry } from './internals/LogEntry.js';
import {
  ConsoleOutputHandler,
  MemoryOutputHandler,
  RemoteOutputHandler,
} from './internals/handlers.js';
import { PerformanceMonitor } from './internals/PerformanceMonitor.js';

// Re-export enums required by downstream imports (kept minimal public surface)
export { LOG_LEVEL, LOG_CATEGORY };
export { PerformanceMonitor };

// ── Logger ─────────────────────────────────────────────────────
/**
 * Main Logger class - Central logging management system
 */
export class Logger {
  constructor(config = {}) {
    this.config = new LoggerConfig(config);
    this.outputHandlers = [];
    this.performanceMonitor = new PerformanceMonitor(this);
    this.contextStack = [];
    this.initialized = false;

    this.initialize();
  }

  initialize() {
    if (this.initialized) return;

    // Initialize output handlers
    this.outputHandlers.push(new ConsoleOutputHandler(this.config));
    this.memoryHandler = new MemoryOutputHandler(this.config);
    this.outputHandlers.push(this.memoryHandler);

    if (this.config.enableRemote) {
      this.remoteHandler = new RemoteOutputHandler(this.config);
      this.outputHandlers.push(this.remoteHandler);
    }

    this.initialized = true;
  }

  /**
   * Push context onto context stack
   * @param {Object} context - Context object
   */
  pushContext(context) {
    this.contextStack.push(context);
  }

  /**
   * Pop context from context stack
   */
  popContext() {
    return this.contextStack.pop();
  }

  /**
   * Get merged context from stack
   * @returns {Object} Merged context
   */
  getCurrentContext() {
    return this.contextStack.reduce(
      (merged, context) => ({
        ...merged,
        ...context,
      }),
      {}
    );
  }

  /**
   * Log a message at specified level
   * @param {number} level - Log level
   * @param {string} category - Log category
   * @param {string} message - Message to log
   * @param {Object} data - Additional data
   * @param {Object} context - Additional context
   */
  log(level, category, message, data = {}, context = {}) {
    // Backward-compatibility normalization: accept legacy argument orders
    // Supported patterns:
    // 1) log(level:number, category:string, message:string, ...)
    // 2) legacy: log(level:number, message:string, category:string, ...)
    // 3) legacy alt: log(message:string, level:number, category:string, ...)
    const validCategories = new Set(Object.values(LOG_CATEGORY));

    let normLevel = level;
    let normCategory = category;
    let normMessage = message;
    const normData = data;
    const normContext = context;

    // Pattern 3: (message, level, category)
    if (!isValidLogLevel(level) && isValidLogLevel(category) && typeof message === 'string') {
      normLevel = category;
      normCategory = validCategories.has(message) ? message : LOG_CATEGORY.SYSTEM;
      normMessage = typeof level === 'string' ? level : String(level ?? '');
    } else if (
      isValidLogLevel(level) &&
      typeof category === 'string' &&
      typeof message === 'string'
    ) {
      // Patterns 1 or 2: decide which string is category
      if (validCategories.has(category) && !validCategories.has(message)) {
        // Correct order already
        normLevel = level;
        normCategory = category;
        normMessage = message;
      } else if (!validCategories.has(category) && validCategories.has(message)) {
        // Swapped legacy order
        normLevel = level;
        normCategory = message;
        normMessage = category;
      } else {
        // Unknown strings; default to given order
        normLevel = level;
        normCategory = category;
        normMessage = message;
      }
    }

    // Ensure category/message sane defaults
    if (!validCategories.has(normCategory)) {
      normCategory = LOG_CATEGORY.SYSTEM;
    }
    if (typeof normMessage !== 'string') {
      normMessage = String(normMessage ?? '');
    }

    // Check if logging is enabled for this level
    if (!isValidLogLevel(normLevel) || !this.isLevelEnabled(normLevel)) return;

    // Merge context from stack
    const mergedContext = {
      ...this.getCurrentContext(),
      ...normContext,
    };

    // Create log entry
    const logEntry = new LogEntry(normLevel, normCategory, normMessage, normData, mergedContext);

    // Send to all output handlers
    for (const handler of this.outputHandlers) {
      try {
        handler.output(logEntry);
      } catch (error) {
        emitConsoleFallback(this.config, LOG_LEVEL.ERROR, 'Log output handler failed:', error);
      }
    }

    return logEntry.id;
  }

  isLevelEnabled(level) {
    if (!isValidLogLevel(level)) return false;
    if (!isValidLogLevel(this.config.level)) return false;
    if (this.config.level === LOG_LEVEL.OFF) return false;
    return level >= this.config.level;
  }

  isTraceEnabled() {
    return this.isLevelEnabled(LOG_LEVEL.TRACE);
  }

  isDebugEnabled() {
    return this.isLevelEnabled(LOG_LEVEL.DEBUG);
  }

  isInfoEnabled() {
    return this.isLevelEnabled(LOG_LEVEL.INFO);
  }

  isWarnEnabled() {
    return this.isLevelEnabled(LOG_LEVEL.WARN);
  }

  isErrorEnabled() {
    return this.isLevelEnabled(LOG_LEVEL.ERROR);
  }

  isFatalEnabled() {
    return this.isLevelEnabled(LOG_LEVEL.FATAL);
  }

  /**
   * Log trace message (most detailed)
   * @param {string} message - Message to log
   * @param {Object} data - Additional data
   * @param {string} category - Log category
   * @param {Object} context - Additional context
   * @returns {string} Log entry ID
   */
  trace(message, data = {}, category = LOG_CATEGORY.SYSTEM, context = {}) {
    return this.log(LOG_LEVEL.TRACE, category, message, data, context);
  }

  /**
   * Log debug message
   * @param {string} message - Message to log
   * @param {Object} data - Additional data
   * @param {string} category - Log category
   * @param {Object} context - Additional context
   * @returns {string} Log entry ID
   */
  debug(message, data = {}, category = LOG_CATEGORY.SYSTEM, context = {}) {
    return this.log(LOG_LEVEL.DEBUG, category, message, data, context);
  }

  /**
   * Log info message
   * @param {string} message - Message to log
   * @param {Object} data - Additional data
   * @param {string} category - Log category
   * @param {Object} context - Additional context
   * @returns {string} Log entry ID
   */
  info(message, data = {}, category = LOG_CATEGORY.SYSTEM, context = {}) {
    return this.log(LOG_LEVEL.INFO, category, message, data, context);
  }

  /**
   * Log warning message
   * @param {string} message - Message to log
   * @param {Object} data - Additional data
   * @param {string} category - Log category
   * @param {Object} context - Additional context
   * @returns {string} Log entry ID
   */
  warn(message, data = {}, category = LOG_CATEGORY.SYSTEM, context = {}) {
    return this.log(LOG_LEVEL.WARN, category, message, data, context);
  }

  /**
   * Log error message
   * @param {string} message - Message to log
   * @param {Object} data - Additional data
   * @param {string} category - Log category
   * @param {Object} context - Additional context
   * @returns {string} Log entry ID
   */
  error(message, data = {}, category = LOG_CATEGORY.SYSTEM, context = {}) {
    return this.log(LOG_LEVEL.ERROR, category, message, data, context);
  }

  /**
   * Log fatal message
   * @param {string} message - Message to log
   * @param {Object} data - Additional data
   * @param {string} category - Log category
   * @param {Object} context - Additional context
   * @returns {string} Log entry ID
   */
  fatal(message, data = {}, category = LOG_CATEGORY.SYSTEM, context = {}) {
    return this.log(LOG_LEVEL.FATAL, category, message, data, context);
  }

  /**
   * Create a child logger with additional context
   * @param {Object} context - Context to add to all log messages
   * @returns {Logger} Child logger instance
   */
  child(context = {}) {
    const childLogger = new Logger(this.config);
    childLogger.contextStack = [...this.contextStack, context];
    return childLogger;
  }

  /**
   * Get logs from memory handler
   * @param {Object} filters - Filter criteria
   * @returns {Array} Filtered log entries
   */
  getLogs(filters = {}) {
    return this.memoryHandler ? this.memoryHandler.getLogs(filters) : [];
  }

  /**
   * Get logging statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    return this.memoryHandler ? this.memoryHandler.getStatistics() : {};
  }

  /**
   * Clear all logs from memory
   */
  clearLogs() {
    if (this.memoryHandler) {
      this.memoryHandler.clear();
    }
  }

  /**
   * Update logger configuration
   * @param {Object} newConfig - Configuration updates
   */
  updateConfig(newConfig) {
    this.config = new LoggerConfig({ ...this.config, ...newConfig });

    // Reinitialize handlers if needed
    this.outputHandlers = [];
    this.initialize();
  }

  /**
   * Flush all pending logs (useful before page unload)
   */
  async flush() {
    const promises = [];

    for (const handler of this.outputHandlers) {
      if (handler.flush) {
        promises.push(handler.flush());
      }
    }

    await Promise.all(promises);
  }

  /**
   * Destroy logger and clean up resources
   */
  destroy() {
    for (const handler of this.outputHandlers) {
      if (handler.destroy) {
        handler.destroy();
      }
    }

    this.outputHandlers = [];
    this.initialized = false;
  }
}

// ── Singleton Instance ──────────────────────────────────────────
// Environment detection centralized via env helper
const environment = getNodeEnv();
const isProduction = environment === 'production';
const isDevelopment = environment === 'development';
const runningInJest = typeof isJest === 'function' ? isJest() : false;

const envLevelOverride = resolveLevelOverride({
  envKeys: ['TT_LOG_LEVEL', 'LOG_LEVEL'],
  globalKeys: ['__TT_LOG_LEVEL'],
});
const defaultLevel = runningInJest
  ? LOG_LEVEL.WARN
  : isProduction
    ? LOG_LEVEL.INFO
    : LOG_LEVEL.DEBUG;
const resolvedLevel = envLevelOverride ?? defaultLevel;

const envConsoleLevelOverride = resolveLevelOverride({
  envKeys: ['TT_CONSOLE_LOG_LEVEL', 'TT_CONSOLE_LEVEL', 'CONSOLE_LOG_LEVEL'],
  globalKeys: ['__TT_CONSOLE_LEVEL'],
});
const defaultConsoleLevel = runningInJest
  ? LOG_LEVEL.OFF
  : isProduction
    ? LOG_LEVEL.ERROR
    : LOG_LEVEL.WARN;
const resolvedConsoleLevel =
  envConsoleLevelOverride ?? Math.max(defaultConsoleLevel, resolvedLevel);

// Global logger instance with environment-specific configuration
export const logger = new Logger({
  // Quieter during tests to reduce noise and avoid any console-driven timeouts
  level: resolvedLevel,
  consoleLevel: resolvedConsoleLevel,
  environment: environment,
  enableConsole: !runningInJest,
  enableMemory: true,
  enableRemote: isProduction,
  enableStackTrace: isDevelopment && !runningInJest,
  enablePerformanceMetrics: true,
  maxMemoryLogs: 2000,
  applicationName: 'TavernTable',
});

// Export logger as default
export default logger;
