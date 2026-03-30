import { LOG_LEVEL, LOG_CATEGORY } from '../enums.js';
import { shouldEmitToConsole, emitConsoleFallback } from './logUtils.js';

// ── Console Output Handler ──────────────────────────────────────
/**
 * Console output handler with formatting
 */
export class ConsoleOutputHandler {
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

// ── Memory Output Handler ───────────────────────────────────────
/**
 * Memory output handler for log retention
 */
export class MemoryOutputHandler {
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

// ── Remote Output Handler ───────────────────────────────────────
/**
 * Remote output handler for centralized logging
 */
export class RemoteOutputHandler {
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
      emitConsoleFallback(
        this.config,
        LOG_LEVEL.ERROR,
        'Failed to send logs to remote endpoint:',
        error
      );
    }
  }

  destroy() {
    this.flush(); // Send remaining logs
    if (this.sendTimeout) {
      clearTimeout(this.sendTimeout);
    }
  }
}
