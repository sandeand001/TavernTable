import { LOG_LEVEL } from '../enums.js';
import { getNodeEnv } from '../../env.js';

/**
 * Log entry structure with comprehensive metadata
 */
export class LogEntry {
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
