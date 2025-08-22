// Error telemetry manager extracted with no behavior changes.
export class ErrorTelemetryManager {
    constructor(config) {
        this.config = config;
        this.pendingErrors = [];
        this.sendTimeout = null;
    }

    async report(errorEntry) {
        if (!this.config.enableTelemetry || !this.config.telemetryEndpoint) {
            return;
        }

        this.pendingErrors.push(errorEntry.toJSON());

        // Batch send errors to reduce network requests
        if (this.sendTimeout) {
            clearTimeout(this.sendTimeout);
        }

        this.sendTimeout = setTimeout(() => {
            this.sendBatch();
        }, 2000);
        if (typeof this.sendTimeout?.unref === 'function') this.sendTimeout.unref();
    }

    async sendBatch() {
        if (this.pendingErrors.length === 0) return;

        const errors = [...this.pendingErrors];
        this.pendingErrors = [];

        try {
            await fetch(this.config.telemetryEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    errors,
                    metadata: {
                        userAgent: navigator.userAgent,
                        timestamp: new Date().toISOString(),
                        environment: this.config.environment
                    }
                })
            });
        } catch (error) {
            // Failed to send telemetry - add back to pending (with limit)
            if (this.pendingErrors.length < 50) {
                this.pendingErrors.unshift(...errors);
            }
        }
    }
}
