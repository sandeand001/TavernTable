// src/systems/DragController.js - Token drag and drop functionality
/**
 * Token Drag Controller
 * 
 * Provides drag-and-drop functionality for creature tokens on the game grid.
 * Handles mouse/pointer events to enable smooth token movement with automatic
 * grid snapping when tokens are released.
 * 
 * Key Features:
 * - Left-click only dragging (preserves right-click for grid interactions)
 * - Visual feedback with alpha transparency during drag
 * - Automatic grid snapping via GameManager.snapToGrid()
 * - Event propagation control to prevent conflicts
 * - Comprehensive error handling and validation
 * 
 * Usage: Functions are exposed globally for token sprite event attachment
 * 
 * @module DragController
 * @author TavernTable
 * @since 1.0.0
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { TypeValidators } from '../utils/Validation.js';

/**
 * Handle drag start event for creature tokens
 * @param {Object} event - PIXI interaction event
 */
function onDragStart(event) {
    try {
        // Validate event object
        if (!TypeValidators.isObject(event, ['data'])) {
            new ErrorHandler().handle(
                new Error('Invalid drag start event structure'),
                ERROR_SEVERITY.MEDIUM,
                ERROR_CATEGORY.INPUT,
                {
                    context: 'onDragStart',
                    stage: 'event_validation',
                    eventObject: event ? typeof event : 'undefined',
                    hasData: !!(event?.data)
                }
            );
            return;
        }

        // Only handle left mouse button for token dragging
        if (event.data.originalEvent && event.data.originalEvent.button !== 0) {
            return; // Let right-clicks pass through for grid dragging
        }

        this.data = event.data;
        this.dragging = true;
        this.alpha = 0.7;

        logger.log(LOG_LEVEL.TRACE, 'Token drag started', LOG_CATEGORY.USER, {
            tokenId: this?.id || 'unknown',
            tokenType: this?.tokenType || 'unknown',
            startPosition: { x: this.x, y: this.y },
            buttonPressed: event?.data?.originalEvent?.button,
            alpha: this.alpha
        });

        // Stop event propagation to prevent grid dragging
        event.stopPropagation();

    } catch (error) {
        new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
            context: 'onDragStart',
            stage: 'drag_initialization',
            tokenId: this?.id || 'unknown',
            buttonPressed: event?.data?.originalEvent?.button,
            hasData: !!(event?.data)
        });
    }
}

/**
 * Handle drag end event for creature tokens
 * @param {Object} event - PIXI interaction event
 */
function onDragEnd(event) {
    try {
        // Only handle left mouse button
        if (event && event.data && event.data.originalEvent && event.data.originalEvent.button !== 0) {
            return;
        }

        // Capture pointer-local coordinates before clearing state for precise snap target
        let localX = null, localY = null;
        try {
            if (event && event.data && this.parent) {
                const p = event.data.getLocalPosition(this.parent);
                localX = p.x;
                localY = p.y;
            }
        } catch (_) { /* ignore getLocalPosition errors */ }

        this.dragging = false;
        this.alpha = 1.0;

        // Snap to grid if the function is available (pass pointer coords)
        if (window.snapToGrid) {
            window.snapToGrid(this, localX, localY);
        }
        // Clear data at the end to avoid losing pointer during snap
        this.data = null;

        logger.log(LOG_LEVEL.TRACE, 'Token drag completed', LOG_CATEGORY.USER, {
            tokenId: this?.id || 'unknown',
            finalPosition: { x: this.x, y: this.y },
            snapToGridUsed: !!window.snapToGrid,
            alpha: this.alpha,
            draggingState: this.dragging
        });

    } catch (error) {
        new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
            context: 'onDragEnd',
            stage: 'drag_completion',
            tokenId: this?.id || 'unknown',
            buttonPressed: event?.data?.originalEvent?.button,
            snapToGridAvailable: !!window.snapToGrid,
            finalAlpha: this?.alpha,
            draggingState: this?.dragging
        });
    }
}

/**
 * Handle drag move event for creature tokens
 */
function onDragMove() {
    try {
        if (this.dragging && this.data) {
            const newPosition = this.data.getLocalPosition(this.parent);
            this.x = newPosition.x;
            this.y = newPosition.y;
        }
    } catch (error) {
        new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.RENDERING, {
            context: 'onDragMove',
            stage: 'position_update',
            tokenId: this?.id || 'unknown',
            draggingState: this?.dragging,
            hasData: !!(this?.data),
            currentPosition: { x: this?.x, y: this?.y },
            targetPosition: this?.data ? 'calculated' : 'unavailable'
        });
    }
}

// ES6 module exports
export { onDragStart, onDragEnd, onDragMove };

// Legacy global exports for backward compatibility
window.onDragStart = onDragStart;
window.onDragEnd = onDragEnd;
window.onDragMove = onDragMove;
