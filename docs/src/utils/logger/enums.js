// Logger enums extracted with no behavior changes.

export const LOG_LEVEL = Object.freeze({
    TRACE: 0,    // Most detailed, typically only of interest during problem diagnosis
    DEBUG: 1,    // Detailed information on application flow, for debugging
    INFO: 2,     // General information about application operation
    WARN: 3,     // Potentially harmful situations that should be noted
    ERROR: 4,    // Error events but application may continue running
    FATAL: 5,    // Very severe errors that will likely abort the application
    OFF: 6       // No logging output
});

export const LOG_CATEGORY = Object.freeze({
    SYSTEM: 'system',           // System-level operations
    PERFORMANCE: 'performance', // Performance metrics and monitoring
    SECURITY: 'security',       // Security-related events
    USER: 'user',              // User interactions and behavior
    RENDERING: 'rendering',     // Graphics and display events
    UI: 'ui',                  // UI-specific events
    INTERACTION: 'interaction', // Input/interaction events
    API: 'api',                // API calls and responses
    DATABASE: 'database',       // Database operations
    CACHE: 'cache',            // Caching operations
    BUSINESS: 'business',       // Business logic operations
    INTEGRATION: 'integration', // Third-party integrations
    AUDIT: 'audit'             // Audit trail events
});

export const LOG_OUTPUT = Object.freeze({
    CONSOLE: 'console',
    FILE: 'file',
    REMOTE: 'remote',
    MEMORY: 'memory'
});
