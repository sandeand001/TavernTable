// js/dice.js

// Dice rolling functionality with animation
let isRolling = false;

export function rollDice(sides) {
  if (isRolling) return; // Prevent multiple rolls during animation
  
  const diceCount = parseInt(document.getElementById('dice-count').value) || 1;
  const resultEl = document.getElementById('dice-result');
  
  if (!resultEl) {
    console.warn("dice-result element not found.");
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
    
    if (diceCount === 1) {
      resultEl.textContent = `Result: d${sides} → ${results[0]}`;
    } else {
      resultEl.textContent = `Result: ${diceCount}d${sides} → [${results.join(', ')}] = ${total}`;
    }
    
    // Add a brief highlight effect
    resultEl.style.color = '#4CAF50';
    resultEl.style.textShadow = '0 0 5px #4CAF50';
    
    setTimeout(() => {
      resultEl.style.color = 'white';
      resultEl.style.textShadow = 'none';
      isRolling = false;
    }, 1000);
  }
  
  // Start animation
  requestAnimationFrame(animateRoll);
}
