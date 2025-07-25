/**
 * UIController.js
 * Handles UI interactions and initialization for TavernTable
 */

/**
 * Simple toggle function for creature tokens panel
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
 * Grid resize function - handles resizing the game grid
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
      console.log(`Resizing grid to ${newWidth}x${newHeight}`);
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
 * Zoom reset function - resets the grid zoom to default
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
  console.log('Starting game initialization...');
  
  // Ensure gameManager exists
  if (!window.gameManager) {
    console.error('GameManager not found');
    return;
  }
  
  try {
    await window.gameManager.initialize();
    console.log('Game initialization complete, starting dice...');
    
    // Check if initDice3D function exists before calling it
    if (typeof initDice3D === 'function') {
      initDice3D();
    } else {
      console.warn('initDice3D function not found');
    }
    
    console.log('All initialization complete');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// Initialize the game manager and set up event listeners
const gameManager = new GameManager();
window.gameManager = gameManager;

// Start the application when the page loads
window.addEventListener('load', initializeApplication);
