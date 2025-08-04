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

import { GameErrors } from '../utils/ErrorHandler.js';
import { TypeValidators } from '../utils/Validation.js';

/**
 * Handle drag start event for creature tokens
 * @param {Object} event - PIXI interaction event
 */
function onDragStart(event) {
  try {
    // Validate event object
    if (!TypeValidators.isObject(event, ['data'])) {
      GameErrors.showSystemError('Invalid drag start event');
      return;
    }
    
    // Only handle left mouse button for token dragging
    if (event.data.originalEvent && event.data.originalEvent.button !== 0) {
      return; // Let right-clicks pass through for grid dragging
    }
    
    this.data = event.data;
    this.dragging = true;
    this.alpha = 0.7;
    
    // Stop event propagation to prevent grid dragging
    event.stopPropagation();
    
  } catch (error) {
    GameErrors.handleError(error, 'Failed to start token drag');
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
    
    this.dragging = false;
    this.data = null;
    this.alpha = 1.0;
    
    // Snap to grid if the function is available
    if (window.snapToGrid) {
      window.snapToGrid(this);
    }
    
  } catch (error) {
    GameErrors.handleError(error, 'Failed to end token drag');
  }
}

/**
 * Handle drag move event for creature tokens
 * @param {Object} event - PIXI interaction event
 */
function onDragMove(event) {
  try {
    if (this.dragging && this.data) {
      const newPosition = this.data.getLocalPosition(this.parent);
      this.x = newPosition.x;
      this.y = newPosition.y;
    }
  } catch (error) {
    GameErrors.handleError(error, 'Failed to move token during drag');
  }
}

// ES6 module exports
export { onDragStart, onDragEnd, onDragMove };

// Legacy global exports for backward compatibility
window.onDragStart = onDragStart;
window.onDragEnd = onDragEnd;
window.onDragMove = onDragMove;
