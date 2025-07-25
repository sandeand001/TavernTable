/**
 * UIController.js
 * Handles UI interactions and initialization for TavernTable
 * 
 * This module manages all user interface interactions that were previously
 * defined inline in the HTML. It provides clean separation between the
 * game logic and UI control, making the code more maintainable and testable.
 * 
 * Key Features:
 * - Collapsible panel management
 * - Grid resizing controls  
 * - Zoom reset functionality
 * - Game initialization coordination
 * - Global function exposure for HTML compatibility
 */

import GameManager from '../core/GameManager.js';

/**
 * Toggle the visibility of the creature tokens panel
 * Manages the collapsible state and arrow indicator
 */
function toggleCreatureTokens() {
  const content = document.getElementById('creature-content');
  const arrow = document.getElementById('creature-arrow');
  
  if (content) {
    if (content.style.display === 'none') {
      content.style.display = 'block';
      if (arrow) arrow.textContent = '▼';
    } else {
      content.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
    }
  }
}

/**
 * Resize the game grid based on user input
 * Validates input values and delegates to GameManager for actual resizing
 */
function resizeGrid() {
  const widthInput = document.getElementById('grid-width');
  const heightInput = document.getElementById('grid-height');
  
  if (!window.gameManager) {
    alert('Game is still loading. Please wait a moment and try again.');
    return;
  }
  
  if (!window.gameManager.resizeGrid) {
    console.error('resizeGrid method not found on gameManager');
    alert('Grid resize feature is not available.');
    return;
  }
  
  if (widthInput && heightInput) {
    const newWidth = parseInt(widthInput.value);
    const newHeight = parseInt(heightInput.value);
    
    if (newWidth >= 5 && newWidth <= 50 && newHeight >= 5 && newHeight <= 50) {
      try {
        window.gameManager.resizeGrid(newWidth, newHeight);
      } catch (error) {
        console.error('Error resizing grid:', error);
        alert('Error resizing grid. Check console for details.');
      }
    } else {
      alert('Grid size must be between 5x5 and 50x50');
    }
  }
}

/**
 * Reset the grid zoom to default scale and center the view
 * Provides user-friendly zoom reset functionality
 */
function resetZoom() {
  if (window.gameManager && window.gameManager.resetZoom) {
    window.gameManager.resetZoom();
  } else {
    console.warn('Game not ready or zoom reset not available');
  }
}

/**
 * Initialize the application when the page loads
 */
async function initializeApplication() {
  // Ensure gameManager exists
  if (!window.gameManager) {
    console.error('GameManager not found');
    return;
  }
  
  try {
    await window.gameManager.initialize();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// Initialize the game manager and set up event listeners
const gameManager = new GameManager();
window.gameManager = gameManager;

// Make functions available globally for HTML onclick handlers
window.toggleCreatureTokens = toggleCreatureTokens;
window.resizeGrid = resizeGrid;
window.resetZoom = resetZoom;

// Start the application when the page loads
window.addEventListener('load', initializeApplication);
