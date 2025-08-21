
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
			// ...existing code...
		});
	} catch (error) {
		new ErrorHandler().handle(error, ERROR_SEVERITY.HIGH, ERROR_CATEGORY.INPUT, {
			context: 'onDragStart',
			stage: 'exception',
			error: error.message
		});
	}
}
// ...existing code...
