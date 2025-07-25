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
 * 
 * Usage: Functions are exposed globally for token sprite event attachment
 */

function onDragStart(event) {
  // Only handle left mouse button for token dragging
  if (event.data.originalEvent.button !== 0) {
    return; // Let right-clicks pass through for grid dragging
  }
  
  this.data = event.data;
  this.dragging = true;
  this.alpha = 0.7;
  
  // Stop event propagation to prevent grid dragging
  event.stopPropagation();
}

function onDragEnd(event) {
  // Only handle left mouse button
  if (event && event.data && event.data.originalEvent.button !== 0) {
    return;
  }
  
  this.dragging = false;
  this.data = null;
  this.alpha = 1.0;
  if (window.snapToGrid) {
    window.snapToGrid(this);
  }
}

function onDragMove() {
  if (this.dragging) {
    const newPosition = this.data.getLocalPosition(this.parent);
    this.x = newPosition.x;
    this.y = newPosition.y;
  }
}

// Make drag functions globally available for creatures
window.onDragStart = onDragStart;
window.onDragEnd = onDragEnd;
window.onDragMove = onDragMove;
