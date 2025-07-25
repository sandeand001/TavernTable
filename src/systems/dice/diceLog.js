// js/diceLog.js - Dice Roll Logging System

class DiceLogger {
  constructor() {
    this.logContainer = null;
    this.maxEntries = 20;
  }

  init() {
    if (document.getElementById('dice-log')) return; // Already exists
    
    this.logContainer = document.createElement('div');
    this.logContainer.id = 'dice-log';
    this.logContainer.style.position = 'fixed';
    this.logContainer.style.right = '20px';
    this.logContainer.style.top = '20px';
    this.logContainer.style.width = '250px';
    this.logContainer.style.maxHeight = '400px';
    this.logContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    this.logContainer.style.border = '2px solid #333';
    this.logContainer.style.borderRadius = '10px';
    this.logContainer.style.padding = '15px';
    this.logContainer.style.color = 'white';
    this.logContainer.style.fontSize = '14px';
    this.logContainer.style.overflowY = 'auto';
    this.logContainer.style.zIndex = '1000';
    this.logContainer.style.fontFamily = 'monospace';
    
    const title = document.createElement('div');
    title.textContent = '🎲 Dice Roll Log';
    title.style.fontWeight = 'bold';
    title.style.borderBottom = '1px solid #555';
    title.style.paddingBottom = '10px';
    title.style.marginBottom = '10px';
    title.style.textAlign = 'center';
    
    const logContent = document.createElement('div');
    logContent.id = 'dice-log-content';
    
    this.logContainer.appendChild(title);
    this.logContainer.appendChild(logContent);
    document.body.appendChild(this.logContainer);
  }

  addEntry(diceType, diceCount, results, total) {
    const logContent = document.getElementById('dice-log-content');
    if (!logContent) return;
    
    const logEntry = document.createElement('div');
    logEntry.style.marginBottom = '8px';
    logEntry.style.padding = '5px';
    logEntry.style.borderRadius = '5px';
    logEntry.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    
    const timestamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    let resultText;
    let resultColor = '#fff';
    
    if (diceCount === 1) {
      resultText = `${timestamp} - d${diceType}: ${results[0]}`;
      // Color coding for single die
      if (results[0] === diceType) {
        resultColor = '#4CAF50'; // Green for max
      } else if (results[0] === 1) {
        resultColor = '#f44336'; // Red for min
      }
    } else {
      resultText = `${timestamp} - ${diceCount}d${diceType}: [${results.join(', ')}] = ${total}`;
      // Color coding for multiple dice
      const maxPossible = diceCount * diceType;
      const minPossible = diceCount;
      
      if (total === maxPossible) {
        resultColor = '#4CAF50'; // Green for max total
      } else if (total === minPossible) {
        resultColor = '#f44336'; // Red for min total
      }
    }
    
    logEntry.textContent = resultText;
    logEntry.style.color = resultColor;
    
    // Add to bottom of log (most recent at bottom)
    logContent.appendChild(logEntry);
    
    // Keep only last maxEntries entries (remove from top)
    while (logContent.children.length > this.maxEntries) {
      logContent.removeChild(logContent.firstChild);
    }
    
    // Scroll to bottom to show latest entry
    logContent.scrollTop = logContent.scrollHeight;
  }

  clear() {
    const logContent = document.getElementById('dice-log-content');
    if (logContent) {
      logContent.innerHTML = '';
    }
  }

  hide() {
    if (this.logContainer) {
      this.logContainer.style.display = 'none';
    }
  }

  show() {
    if (this.logContainer) {
      this.logContainer.style.display = 'block';
    }
  }

  toggle() {
    if (this.logContainer) {
      const isVisible = this.logContainer.style.display !== 'none';
      this.logContainer.style.display = isVisible ? 'none' : 'block';
    }
  }
}

// Create singleton instance
const diceLogger = new DiceLogger();

// Export for use in other modules
window.diceLogger = diceLogger;
window.DiceLogger = DiceLogger;
