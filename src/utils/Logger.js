import { getNodeEnv, isJest } from './env.js';
/**
 * Logger.js - Enterprise-Grade Logging System for TavernTable
 *
 * Comprehensive logging solution with structured data, multiple outputs,
 * performance monitoring, and production-ready features.
 *
 * Features:
 * - Hierarchical log levels with fine-grained control
 * - Structured logging with metadata and context
 * - Multiple output targets (console, file, remote)
 * - Performance and memory monitoring
 * - Environment-specific configuration
 * - Log rotation and size management
 * - Correlation IDs for request tracing
 * - Sanitization for sensitive data
 * - Integration with error tracking systems
 *
 * @author TavernTable Development Team
 * @version 2.0.0
 */

import { LOG_LEVEL, LOG_CATEGORY } from './logger/enums.js';
// Re-export enums required by downstream imports (kept minimal public surface)
// Narrowed public logging surface: consumers only need level & category.
export { LOG_LEVEL, LOG_CATEGORY };

const LOG_LEVEL_VALUES = new Set(Object.values(LOG_LEVEL));
const LOG_LEVEL_NAME_LOOKUP = Object.keys(LOG_LEVEL).reduce((map, key) => {
  map[key] = LOG_LEVEL[key];
  map[key.toLowerCase()] = LOG_LEVEL[key];
  return map;
}, {});

const isValidLogLevel = (level) => LOG_LEVEL_VALUES.has(level);

const normalizeLevelInput = (value) => {
  if (typeof value === 'number' && isValidLogLevel(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();
    if (LOG_LEVEL_NAME_LOOKUP[upper] != null) return LOG_LEVEL_NAME_LOOKUP[upper];
    const lower = trimmed.toLowerCase();
    if (LOG_LEVEL_NAME_LOOKUP[lower] != null) return LOG_LEVEL_NAME_LOOKUP[lower];
  }
  return null;
};

const readFromProcessEnv = (keys = []) => {
  for (const key of keys) {
    try {
      const envValue = globalThis?.process?.env?.[key];
      if (typeof envValue === 'string' && envValue.trim()) return envValue;
    } catch (_) {
      /* ignore env access issues */
    }
  }
  return null;
};

const readFromGlobalFlags = (keys = []) => {
  for (const key of keys) {
    try {
      if (typeof window !== 'undefined' && window[key] != null) return window[key];
    } catch (_) {
      /* ignore window access */
    }
    try {
      if (typeof globalThis !== 'undefined' && key in globalThis && globalThis[key] != null) {
        return globalThis[key];
      }
    } catch (_) {
      /* ignore global access */
    }
  }
  return null;
};

const resolveLevelOverride = ({ envKeys = [], globalKeys = [] } = {}) => {
  const raw = readFromProcessEnv(envKeys) ?? readFromGlobalFlags(globalKeys);
  return normalizeLevelInput(raw);
};

const resolveConsoleThreshold = (config) => {
  if (config && isValidLogLevel(config.consoleLevel)) return config.consoleLevel;
  return LOG_LEVEL.WARN;
};

const shouldEmitToConsole = (config, level) => {
  if (!config?.enableConsole || !isValidLogLevel(level)) return false;
  const threshold = resolveConsoleThreshold(config);
  return level >= threshold;
};

const emitConsoleFallback = (config, level, ...args) => {
  if (!shouldEmitToConsole(config, level)) return;
  const method =
    level >= LOG_LEVEL.ERROR ? 'error' : level >= LOG_LEVEL.WARN ? 'warn' : 'log';
  try {
    if (typeof console?.[method] === 'function') {
      console[method](...args);
    }
  } catch (_) {
    /* ignore fallback console errors */
  }
};

/**
 * Configuration class for logger behavior
 */
// CLEANUP (2025-09-19): Pruned unused public logging surface. LoggerConfig and handler classes
// were only referenced internally; removed their exports to shrink API. withPerformanceLogging /
// withLoggingContext / GameLogger also unexported (no consumers). Enums kept for any external usage.
class LoggerConfig {
  constructor(options = {}) {
    const normalizedLevel = normalizeLevelInput(options.level);
    this.level = normalizedLevel ?? LOG_LEVEL.INFO;
    this.enableConsole = options.enableConsole ?? true;
    this.enableFile = options.enableFile ?? false;
    this.enableRemote = options.enableRemote ?? false;
    this.enableMemory = options.enableMemory ?? true;
    this.maxMemoryLogs = options.maxMemoryLogs || 1000;
    this.enableMetadata = options.enableMetadata ?? true;
    this.enableStackTrace = options.enableStackTrace ?? true;
    this.enablePerformanceMetrics = options.enablePerformanceMetrics ?? true;
    this.enableSanitization = options.enableSanitization ?? true;
    this.remoteEndpoint = options.remoteEndpoint || null;
    this.fileMaxSize = options.fileMaxSize || 10 * 1024 * 1024; // 10MB
    this.fileMaxFiles = options.fileMaxFiles || 5;
    this.environment = options.environment || 'development';
    this.applicationName = options.applicationName || 'TavernTable';
    this.correlationIdHeader = options.correlationIdHeader || 'x-correlation-id';
    const normalizedConsoleLevel = normalizeLevelInput(options.consoleLevel);
    this.consoleLevel =
      normalizedConsoleLevel ?? Math.max(this.level, LOG_LEVEL.WARN);
  }
}

/**
 * Log entry structure with comprehensive metadata
 */
class LogEntry {
  constructor(level, category, message, data = {}, context = {}) {
    this.id = this.generateId();
    this.timestamp = new Date().toISOString();
    this.level = level;
    this.category = category;
    this.message = message;
    this.data = this.sanitizeData(data);
    this.context = this.sanitizeData(context);
    this.metadata = this.collectMetadata();
    this.correlationId = this.getCorrelationId();
    this.sessionId = this.getSessionId();
    this.stackTrace = this.captureStackTrace();
  }

  // Removed unused helper wrappers (GameLogger, withPerformanceLogging, withLoggingContext) during cleanup.

  // CLEANUP NOTE (2025-09-19): These utility methods were accidentally pruned during
  // surface minimization. Tests exercise logger paths that rely on them. Restoring
  // lean implementations sufficient for current usage (ID generation, basic metadata
  // and light sanitization). Avoid coupling to a config object to keep LogEntry
  // standalone.

  generateId() {
    return `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  sanitizeData(value) {
    if (value == null) return value;
    if (typeof value !== 'object') return value;
    // Shallow clone with redaction of obvious sensitive keys
    const SENSITIVE_KEYS = ['password', 'pass', 'secret', 'token', 'auth', 'apiKey', 'apikey'];
    try {
      const clone = Array.isArray(value) ? [...value] : { ...value };
      for (const key of Object.keys(clone)) {
        if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
          clone[key] = '[REDACTED]';
        }
      }
      return clone;
    } catch (e) {
      return value; // Fallback: return original if cloning fails
    }
  }

  collectMetadata() {
    const runtime = typeof window === 'undefined' ? 'node' : 'browser';
    // Keep metadata minimal; previous version included memory & perf details.
    return {
      runtime,
      env: typeof getNodeEnv === 'function' ? getNodeEnv() : undefined,
    };
  }

  getPerformanceInfo() {
    if (typeof performance !== 'undefined') {
      return {
        timing: performance.now(),
        navigation: performance.getEntriesByType
          ? performance.getEntriesByType('navigation')[0]
          : null,
      };
    }
    return null;
  }

  getCorrelationId() {
    // Try to get correlation ID from various sources
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem('correlation-id') || this.generateCorrelationId();
    }
    return this.generateCorrelationId();
  }

  generateCorrelationId() {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getSessionId() {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      let sessionId = window.sessionStorage.getItem('logger-session-id');
      if (!sessionId) {
        sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        window.sessionStorage.setItem('logger-session-id', sessionId);
      }
      return sessionId;
    }
    return 'unknown_session';
  }

  captureStackTrace() {
    const stack = new Error().stack;
    if (stack) {
      return stack.split('\n').slice(3, 8).join('\n'); // Skip first 3 lines, take next 5
    }
    return null;
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      level: this.level,
      category: this.category,
      message: this.message,
      data: this.data,
      context: this.context,
      metadata: this.metadata,
      correlationId: this.correlationId,
      sessionId: this.sessionId,
      stackTrace: this.stackTrace,
    };
  }

  toString() {
    const levelName =
      Object.keys(LOG_LEVEL).find((key) => LOG_LEVEL[key] === this.level) || 'UNKNOWN';
    return `[${this.timestamp}] ${levelName} [${this.category}] ${this.message}`;
  }
}

/**
 * Console output handler with formatting
 */
class ConsoleOutputHandler {
  constructor(config) {
    this.config = config;
    this.colors = {
      [LOG_LEVEL.TRACE]: '\x1b[37m', // White
      [LOG_LEVEL.DEBUG]: '\x1b[36m', // Cyan
      [LOG_LEVEL.INFO]: '\x1b[32m', // Green
      [LOG_LEVEL.WARN]: '\x1b[33m', // Yellow
      [LOG_LEVEL.ERROR]: '\x1b[31m', // Red
      [LOG_LEVEL.FATAL]: '\x1b[35m', // Magenta
    };
    this.reset = '\x1b[0m';
  }

  output(logEntry) {
    if (!shouldEmitToConsole(this.config, logEntry.level)) return;

    const levelName =
      Object.keys(LOG_LEVEL).find((key) => LOG_LEVEL[key] === logEntry.level) || 'UNKNOWN';
    const color = this.colors[logEntry.level] || '';
    const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();

    const prefix = `${color}[${timestamp}] ${levelName} [${logEntry.category}]${this.reset}`;
    const message = `${prefix} ${logEntry.message}`;

    // Choose appropriate console method
    switch (logEntry.level) {
      case LOG_LEVEL.TRACE:
      case LOG_LEVEL.DEBUG:
        if (console.debug) {
          console.debug(message, logEntry.data);
        } else {
          console.log(message, logEntry.data);
        }
        break;
      case LOG_LEVEL.INFO:
        console.info(message, logEntry.data);
        break;
      case LOG_LEVEL.WARN:
        console.warn(message, logEntry.data);
        break;
      case LOG_LEVEL.ERROR:
      case LOG_LEVEL.FATAL:
        console.error(message, logEntry.data);
        if (this.config.enableStackTrace && logEntry.stackTrace) {
          console.error('Stack Trace:', logEntry.stackTrace);
        }
        break;
      default:
        console.log(message, logEntry.data);
    }
  }
}

/**
 * Memory output handler for log retention
 */
class MemoryOutputHandler {
  constructor(config) {
    this.config = config;
    this.logs = [];
    this.maxLogs = config.maxMemoryLogs || 1000;
  }

  output(logEntry) {
    if (!this.config.enableMemory) return;

    this.logs.push(logEntry);

    // Maintain size limit
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  getLogs(filters = {}) {
    let filteredLogs = [...this.logs];

    if (filters.level !== undefined) {
      filteredLogs = filteredLogs.filter((log) => log.level >= filters.level);
    }

    if (filters.category) {
      filteredLogs = filteredLogs.filter((log) => log.category === filters.category);
    }

    if (filters.since) {
      const since = new Date(filters.since);
      filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) >= since);
    }

    if (filters.limit) {
      filteredLogs = filteredLogs.slice(-filters.limit);
    }

    return filteredLogs;
  }

  clear() {
    this.logs = [];
  }

  getStatistics() {
    const stats = {
      total: this.logs.length,
      byLevel: {},
      byCategory: {},
      timeRange: {
        oldest: this.logs.length > 0 ? this.logs[0].timestamp : null,
        newest: this.logs.length > 0 ? this.logs[this.logs.length - 1].timestamp : null,
      },
    };

    // Count by level
    for (const level of Object.values(LOG_LEVEL)) {
      if (level === LOG_LEVEL.OFF) continue;
      stats.byLevel[level] = this.logs.filter((log) => log.level === level).length;
    }

    // Count by category
    for (const category of Object.values(LOG_CATEGORY)) {
      stats.byCategory[category] = this.logs.filter((log) => log.category === category).length;
    }

    return stats;
  }
}

/**
 * Remote output handler for centralized logging
 */
class RemoteOutputHandler {
  constructor(config) {
    this.config = config;
    this.buffer = [];
    this.sendTimeout = null;
    this.batchSize = 10;
    this.flushInterval = 5000; // 5 seconds
  }

  output(logEntry) {
    if (!this.config.enableRemote || !this.config.remoteEndpoint) return;

    this.buffer.push(logEntry.toJSON());

    // Send batch when buffer is full or after timeout
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  scheduleFlush() {
    if (this.sendTimeout) return;

    this.sendTimeout = setTimeout(() => {
      this.flush();
    }, this.flushInterval);
    // In Node/Jest, prevent this timer from keeping the process alive
    if (typeof this.sendTimeout?.unref === 'function') this.sendTimeout.unref();
  }

  async flush() {
    if (this.buffer.length === 0) return;

    const logs = [...this.buffer];
    this.buffer = [];

    if (this.sendTimeout) {
      clearTimeout(this.sendTimeout);
      this.sendTimeout = null;
    }

    try {
      await fetch(this.config.remoteEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          logs,
          metadata: {
            environment: this.config.environment,
            application: this.config.applicationName,
            timestamp: new Date().toISOString(),
          },
        }),
      });
    } catch (error) {
      // Failed to send - add back to buffer (with limit)
      if (this.buffer.length < 100) {
        this.buffer.unshift(...logs.slice(-50)); // Only keep recent logs
      }
      emitConsoleFallback(this.config, LOG_LEVEL.ERROR, 'Failed to send logs to remote endpoint:', error);
    }
  }

  destroy() {
    this.flush(); // Send remaining logs
    if (this.sendTimeout) {
      clearTimeout(this.sendTimeout);
    }
  }
}

/**
 * Performance monitor for tracking method execution times
 */
export class PerformanceMonitor {
  constructor(logger) {
    this.logger = logger;
    this.activeTimers = new Map();
  }

  startTimer(operationName, context = {}) {
    const timerId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const startTime = performance.now();

    this.activeTimers.set(timerId, {
      operationName,
      startTime,
      context,
    });

    return timerId;
  }

  endTimer(timerId, additionalContext = {}) {
    const timer = this.activeTimers.get(timerId);
    if (!timer) {
      this.logger.warn('Performance timer not found', { timerId });
      return;
    }

    const endTime = performance.now();
    const duration = endTime - timer.startTime;

    this.activeTimers.delete(timerId);

    this.logger.info(
      `Operation completed: ${timer.operationName}`,
      {
        operation: timer.operationName,
        duration: Math.round(duration * 100) / 100, // Round to 2 decimal places
        startTime: timer.startTime,
        endTime,
        ...timer.context,
        ...additionalContext,
      },
      LOG_CATEGORY.PERFORMANCE
    );

    return duration;
  }

  measureAsync(operationName, asyncFn, context = {}) {
    return async (...args) => {
      const timerId = this.startTimer(operationName, context);
      try {
        const result = await asyncFn(...args);
        this.endTimer(timerId, { success: true });
        return result;
      } catch (error) {
        this.endTimer(timerId, {
          success: false,
          error: error.message,
        });
        throw error;
      }
    };
  }

  measureSync(operationName, syncFn, context = {}) {
    return (...args) => {
      const timerId = this.startTimer(operationName, context);
      try {
        const result = syncFn(...args);
        this.endTimer(timerId, { success: true });
        return result;
      } catch (error) {
        this.endTimer(timerId, {
          success: false,
          error: error.message,
        });
        throw error;
      }
    };
  }
}

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
const resolvedConsoleLevel = envConsoleLevelOverride ?? Math.max(defaultConsoleLevel, resolvedLevel);

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
