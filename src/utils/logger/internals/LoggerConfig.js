import { LOG_LEVEL } from '../enums.js';
import { normalizeLevelInput, isValidLogLevel } from './logUtils.js';

/**
 * Configuration class for logger behavior
 */
export class LoggerConfig {
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
    this.consoleLevel = normalizedConsoleLevel ?? Math.max(this.level, LOG_LEVEL.WARN);
  }
}
