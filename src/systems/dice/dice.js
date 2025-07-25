// src/systems/dice/dice.js - Interactive dice rolling system
/**
 * Dice Rolling System
 * 
 * Provides animated dice rolling functionality with visual feedback and logging.
 * Supports standard RPG dice types (D4, D6, D8, D10, D12, D20, D100) with
 * multiple dice rolling capabilities.
 * 
 * Features:
 * - Animated rolling effect with random number display
 * - Color-coded results (green for max, red for min, white for normal)
 * - Automatic logging integration with diceLogger
 * - Support for multiple dice of the same type
 * - Prevention of concurrent rolls during animation
 * 
 * Integration: Automatically integrates with diceLogger when available
 */

// Dice rolling functionality with animation
let isRolling = false;

export function rollDice(sides) {
  if (isRolling) return; // Prevent multiple rolls during animation
  
  const diceCount = parseInt(document.getElementById('dice-count').value) || 1;
  const resultEl = document.getElementById('dice-result');
  
  if (!resultEl) {
    console.warn('dice-result element not found.');
    return;
  }

  isRolling = true;
  
  // Animation phase
  let animationFrame = 0;
  const animationDuration = 20; // frames
  
  function animateRoll() {
    animationFrame++;
    
    // Show random numbers during animation
    const tempResults = [];
    for (let i = 0; i < diceCount; i++) {
      tempResults.push(Math.floor(Math.random() * sides) + 1);
    }
    
    if (diceCount === 1) {
      resultEl.textContent = `Rolling... ${tempResults[0]}`;
    } else {
      const tempTotal = tempResults.reduce((sum, val) => sum + val, 0);
      resultEl.textContent = `Rolling... [${tempResults.join(', ')}] = ${tempTotal}`;
    }
    
    if (animationFrame < animationDuration) {
      requestAnimationFrame(animateRoll);
    } else {
      // Final result
      showFinalResult();
    }
  }
  
  function showFinalResult() {
    const results = [];
    for (let i = 0; i < diceCount; i++) {
      results.push(Math.floor(Math.random() * sides) + 1);
    }
    
    const total = results.reduce((sum, val) => sum + val, 0);
    
    // Determine result color based on roll quality
    let resultColor = '#ffffff'; // Default white
    if (diceCount === 1) {
      if (results[0] === sides) {
        resultColor = '#4CAF50'; // Green for max roll
      } else if (results[0] === 1) {
        resultColor = '#f44336'; // Red for min roll
      }
    } else {
      const maxPossible = diceCount * sides;
      const minPossible = diceCount;
      
      if (total === maxPossible) {
        resultColor = '#4CAF50'; // Green for max total
      } else if (total === minPossible) {
        resultColor = '#f44336'; // Red for min total
      }
    }
    
    if (diceCount === 1) {
      resultEl.textContent = `Result: d${sides} → ${results[0]}`;
    } else {
      resultEl.textContent = `Result: ${diceCount}d${sides} → [${results.join(', ')}] = ${total}`;
    }
    
    // Apply color coding
    resultEl.style.color = resultColor;
    resultEl.style.textShadow = `0 0 5px ${resultColor}`;
    
    // Log the result if dice logger is available
    if (window.diceLogger) {
      window.diceLogger.addEntry(sides, diceCount, results, total);
    }
    
    setTimeout(() => {
      resultEl.style.color = 'white';
      resultEl.style.textShadow = 'none';
      isRolling = false;
    }, 1000);
  }
  
  // Start animation
  requestAnimationFrame(animateRoll);
}

// Make rollDice available globally for HTML onclick handlers
window.rollDice = rollDice;

// Initialize dice logger when this module loads
document.addEventListener('DOMContentLoaded', function() {
  if (window.diceLogger) {
    window.diceLogger.init();
  }
});

// If DOM is already loaded, initialize immediately
if (document.readyState === 'loading') {
  // Do nothing, DOMContentLoaded will fire
} else {
  // DOM already loaded
  if (window.diceLogger) {
    window.diceLogger.init();
  }
}
