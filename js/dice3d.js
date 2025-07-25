// js/dice3d.js - Simple Text-Based Dice System

let isRolling = false;

function initDice3D() {
  // Initialize the dice rolling container
  const container = document.getElementById('dice-3d-container');
  if (container) {
    container.style.display = 'none';
    container.style.padding = '20px';
    container.style.textAlign = 'center';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    container.style.borderRadius = '10px';
    container.style.border = '2px solid #333';
  }
  
  // Initialize the dice log (requires diceLog.js to be loaded)
  if (window.diceLogger) {
    window.diceLogger.init();
  }
}

function rollDice(sides) {
  if (isRolling) return;
  
  const diceCount = parseInt(document.getElementById('dice-count').value) || 1;
  const resultEl = document.getElementById('dice-result');
  const container = document.getElementById('dice-3d-container');
  
  if (!resultEl || !container) return;

  console.log('Rolling dice:', sides, 'count:', diceCount);

  isRolling = true;
  container.style.display = 'block';
  
  // Create rolling animation with text
  const rollDuration = 1000; // 1 second (shortened from 2 seconds)
  const rollInterval = 80; // Update every 80ms (slightly faster)
  let currentTime = 0;
  
  resultEl.textContent = `🎲 Rolling ${diceCount}d${sides}...`;
  
  // Create a div to show the rolling numbers
  let rollingDiv = document.getElementById('rolling-numbers');
  if (!rollingDiv) {
    rollingDiv = document.createElement('div');
    rollingDiv.id = 'rolling-numbers';
    rollingDiv.style.fontSize = '48px';
    rollingDiv.style.fontWeight = 'bold';
    rollingDiv.style.color = '#fff';
    rollingDiv.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    rollingDiv.style.display = 'flex';
    rollingDiv.style.justifyContent = 'center';
    rollingDiv.style.alignItems = 'center';
    rollingDiv.style.height = '100px';
    rollingDiv.style.margin = '20px 0';
    container.appendChild(rollingDiv);
  }
  
  const rollAnimation = setInterval(() => {
    // Generate random numbers for each die
    const randomResults = [];
    for (let i = 0; i < diceCount; i++) {
      randomResults.push(Math.floor(Math.random() * sides) + 1);
    }
    
    // Display the rolling numbers
    if (diceCount === 1) {
      rollingDiv.textContent = randomResults[0];
    } else {
      rollingDiv.textContent = `[${randomResults.join(', ')}]`;
    }
    
    currentTime += rollInterval;
    
    // Stop rolling and show final result
    if (currentTime >= rollDuration) {
      clearInterval(rollAnimation);
      finalizeDiceRoll(sides, diceCount, resultEl, container, rollingDiv);
    }
  }, rollInterval);
}

function finalizeDiceRoll(sides, diceCount, resultEl, container, rollingDiv) {
  // Generate final results
  const results = [];
  for (let i = 0; i < diceCount; i++) {
    results.push(Math.floor(Math.random() * sides) + 1);
  }
  
  const total = results.reduce((sum, val) => sum + val, 0);
  
  // Determine color based on results
  let resultColor = '#fff'; // Default white
  
  if (diceCount === 1) {
    // Single die: check if max or min
    if (results[0] === sides) {
      resultColor = '#4CAF50'; // Green for max
    } else if (results[0] === 1) {
      resultColor = '#f44336'; // Red for min
    }
  } else {
    // Multiple dice: check if total is max or min possible
    const maxPossible = diceCount * sides;
    const minPossible = diceCount;
    
    if (total === maxPossible) {
      resultColor = '#4CAF50'; // Green for max total
    } else if (total === minPossible) {
      resultColor = '#f44336'; // Red for min total
    }
  }
  
  // Show final result with appropriate color
  if (diceCount === 1) {
    rollingDiv.textContent = results[0];
    resultEl.textContent = `Result: d${sides} → ${results[0]}`;
  } else {
    rollingDiv.textContent = `[${results.join(', ')}]`;
    resultEl.textContent = `Result: ${diceCount}d${sides} → [${results.join(', ')}] = ${total}`;
  }
  
  // Apply color styling
  rollingDiv.style.color = resultColor;
  if (resultColor === '#4CAF50') {
    rollingDiv.style.textShadow = '0 0 10px #4CAF50';
    resultEl.style.color = '#4CAF50';
    resultEl.style.textShadow = '0 0 5px #4CAF50';
  } else if (resultColor === '#f44336') {
    rollingDiv.style.textShadow = '0 0 10px #f44336';
    resultEl.style.color = '#f44336';
    resultEl.style.textShadow = '0 0 5px #f44336';
  } else {
    rollingDiv.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    resultEl.style.color = 'white';
    resultEl.style.textShadow = 'none';
  }
  
  // Add to log (requires diceLog.js to be loaded)
  if (window.diceLogger) {
    window.diceLogger.addEntry(sides, diceCount, results, total);
  }
  
  // Reset after delay
  setTimeout(() => {
    resultEl.style.color = 'white';
    resultEl.style.textShadow = 'none';
    rollingDiv.style.color = '#fff';
    rollingDiv.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    container.style.display = 'none';
    isRolling = false;
  }, 3000);
}

// Export functions for use in other modules
window.initDice3D = initDice3D;
window.rollDice = rollDice;
