/**
 * DefeatedDollTest.js - Test and demonstration of 3D animated doll creature
 * 
 * Creates an animated doll creature using the Defeated.fbx model and demonstrates
 * the integration between Three.js 3D models and the existing PIXI.js creature system.
 * 
 * @module DefeatedDollTest
 * @author TavernTable
 * @since 1.2.0
 */

import CreatureToken from '../entities/creatures/CreatureToken.js';
import threeAnimationManager from '../core/ThreeAnimationManager.js';

/**
 * Test class for the defeated doll creature
 */
class DefeatedDollTest {
  constructor() {
    this.testContainer = null;
    this.dollCreature = null;
    this.isRunning = false;
  }

  /**
   * Initialize and run the defeated doll test
   */
  async runTest() {
    try {
      console.log('🎬 Starting Defeated Doll Test...');
      
      // Wait for PIXI to be ready
      if (!window.app || !window.app.stage) {
        console.log('⏳ Waiting for PIXI app to be ready...');
        await this.waitForPixi();
      }
      
      // Create test container
      this.testContainer = new PIXI.Container();
      this.testContainer.x = 400; // Center on screen
      this.testContainer.y = 300;
      window.app.stage.addChild(this.testContainer);
      
      // Test ThreeAnimationManager initialization
      console.log('🔧 Testing ThreeAnimationManager...');
      await this.testThreeManager();
      
      // Create defeated doll creature
      console.log('🪆 Creating defeated doll creature...');
      await this.createDefeatedDoll();
      
      // Start animation loop
      this.startAnimationLoop();
      
      // Add test controls
      this.addTestControls();
      
      console.log('✅ Defeated Doll Test completed successfully!');
      
    } catch (error) {
      console.error('❌ Defeated Doll Test failed:', error);
      this.displayError(error);
    }
  }

  /**
   * Wait for PIXI app to be ready
   */
  async waitForPixi() {
    return new Promise((resolve) => {
      const checkPixi = () => {
        if (window.app && window.app.stage) {
          resolve();
        } else {
          setTimeout(checkPixi, 100);
        }
      };
      checkPixi();
    });
  }

  /**
   * Test ThreeAnimationManager functionality
   */
  async testThreeManager() {
    console.log('🔍 ThreeAnimationManager status:');
    console.log(`  - Manager available: ${!!threeAnimationManager}`);
    console.log(`  - Initialized: ${threeAnimationManager.isInitialized}`);
    console.log(`  - Available models: ${threeAnimationManager.getAvailableModels().join(', ')}`);
    console.log(`  - Has defeated-doll: ${threeAnimationManager.hasModel('defeated-doll')}`);
    
    // Initialize if not already done
    if (!threeAnimationManager.isInitialized) {
      console.log('🔧 Initializing ThreeAnimationManager...');
      await threeAnimationManager.init();
    }
    
    console.log('✅ ThreeAnimationManager test passed');
  }

  /**
   * Create the defeated doll creature
   */
  async createDefeatedDoll() {
    try {
      // Create defeated doll creature token
      // This will attempt 3D model creation first
      this.dollCreature = new CreatureToken('defeated-doll', 0, 0, true);
      
      if (this.dollCreature.sprite) {
        this.testContainer.addChild(this.dollCreature.sprite);
        console.log('✅ Defeated doll creature added to stage');
        console.log(`  - Is 3D: ${this.dollCreature.is3D || false}`);
        console.log(`  - Is Animated: ${this.dollCreature.isAnimated || false}`);
        console.log(`  - Sprite type: ${this.dollCreature.sprite.constructor.name}`);
      } else {
        throw new Error('Failed to create doll creature sprite');
      }
      
    } catch (error) {
      console.error('Failed to create defeated doll:', error);
      throw error;
    }
  }

  /**
   * Start the animation loop
   */
  startAnimationLoop() {
    this.isRunning = true;
    
    const animate = () => {
      if (!this.isRunning) return;
      
      try {
        // Update 3D animations if doll is 3D
        if (this.dollCreature && this.dollCreature.is3D && this.dollCreature.update3DAnimation) {
          this.dollCreature.update3DAnimation();
        }
        
        // Continue animation loop
        requestAnimationFrame(animate);
        
      } catch (error) {
        console.warn('Animation loop error:', error);
      }
    };
    
    animate();
    console.log('🎬 Animation loop started');
  }

  /**
   * Add test controls to the page
   */
  addTestControls() {
    // Create a simple test UI
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'doll-test-controls';
    controlsDiv.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 15px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 1000;
      min-width: 200px;
    `;
    
    // Create secure DOM elements instead of innerHTML to prevent XSS
    const title = document.createElement('h3');
    title.style.cssText = 'margin: 0 0 10px 0;';
    title.textContent = '🪆 Defeated Doll Test';
    
    const statusDiv = document.createElement('div');
    statusDiv.innerHTML = '<strong>Status:</strong> ';
    statusDiv.appendChild(document.createTextNode(this.dollCreature ? 'Created' : 'Failed'));
    
    const typeDiv = document.createElement('div');
    typeDiv.innerHTML = '<strong>Type:</strong> ';
    typeDiv.appendChild(document.createTextNode(this.dollCreature?.is3D ? '3D Model' : '2D Sprite'));
    
    const animatedDiv = document.createElement('div');
    animatedDiv.innerHTML = '<strong>Animated:</strong> ';
    animatedDiv.appendChild(document.createTextNode(this.dollCreature?.isAnimated ? 'Yes' : 'No'));
    
    const hr = document.createElement('hr');
    hr.style.cssText = 'margin: 10px 0;';
    
    const toggleButton = document.createElement('button');
    toggleButton.id = 'toggle-animation';
    toggleButton.style.cssText = 'margin: 5px 0; padding: 5px 10px;';
    toggleButton.textContent = 'Toggle Animation';
    
    const resetButton = document.createElement('button');
    resetButton.id = 'reset-position';
    resetButton.style.cssText = 'margin: 5px 0; padding: 5px 10px;';
    resetButton.textContent = 'Reset Position';
    
    const closeButton = document.createElement('button');
    closeButton.id = 'close-test';
    closeButton.style.cssText = 'margin: 5px 0; padding: 5px 10px;';
    closeButton.textContent = 'Close Test';
    
    controlsDiv.appendChild(title);
    controlsDiv.appendChild(statusDiv);
    controlsDiv.appendChild(typeDiv);
    controlsDiv.appendChild(animatedDiv);
    controlsDiv.appendChild(hr);
    controlsDiv.appendChild(toggleButton);
    controlsDiv.appendChild(resetButton);
    controlsDiv.appendChild(closeButton);
    
    document.body.appendChild(controlsDiv);
    
    // Add event listeners
    document.getElementById('toggle-animation').onclick = () => this.toggleAnimation();
    document.getElementById('reset-position').onclick = () => this.resetPosition();
    document.getElementById('close-test').onclick = () => this.closeTest();
    
    console.log('🎮 Test controls added');
  }

  /**
   * Toggle animation on/off
   */
  toggleAnimation() {
    this.isRunning = !this.isRunning;
    
    if (this.isRunning) {
      this.startAnimationLoop();
      console.log('▶️ Animation resumed');
    } else {
      console.log('⏸️ Animation paused');
    }
  }

  /**
   * Reset doll position to center
   */
  resetPosition() {
    if (this.testContainer) {
      this.testContainer.x = 400;
      this.testContainer.y = 300;
      console.log('🎯 Position reset to center');
    }
  }

  /**
   * Close the test and cleanup
   */
  closeTest() {
    this.isRunning = false;
    
    // Remove test container from stage
    if (this.testContainer && this.testContainer.parent) {
      this.testContainer.parent.removeChild(this.testContainer);
    }
    
    // Remove controls
    const controls = document.getElementById('doll-test-controls');
    if (controls) {
      controls.remove();
    }
    
    console.log('🧹 Defeated Doll Test cleaned up');
  }

  /**
   * Display error message
   */
  displayError(error) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #ff4444;
      color: white;
      padding: 20px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      z-index: 2000;
      max-width: 400px;
    `;
    
    // Create secure DOM elements instead of innerHTML to prevent XSS
    const title = document.createElement('h3');
    title.textContent = '❌ Test Failed';
    
    const errorParagraph = document.createElement('p');
    const errorStrong = document.createElement('strong');
    errorStrong.textContent = 'Error:';
    errorParagraph.appendChild(errorStrong);
    errorParagraph.appendChild(document.createTextNode(' ' + (error.message || 'Unknown error')));
    
    const causesParagraph = document.createElement('p');
    const causesStrong = document.createElement('strong');
    causesStrong.textContent = 'Possible causes:';
    causesParagraph.appendChild(causesStrong);
    
    const causesList = document.createElement('ul');
    const causes = [
      'FBXLoader not loaded',
      'Defeated.fbx file missing or corrupted',
      'Three.js not properly initialized',
      'WebGL not supported'
    ];
    
    causes.forEach(cause => {
      const listItem = document.createElement('li');
      listItem.textContent = cause;
      causesList.appendChild(listItem);
    });
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => errorDiv.remove());
    
    errorDiv.appendChild(title);
    errorDiv.appendChild(errorParagraph);
    errorDiv.appendChild(causesParagraph);
    errorDiv.appendChild(causesList);
    errorDiv.appendChild(closeButton);
    
    document.body.appendChild(errorDiv);
  }
}

// Export for testing
export { DefeatedDollTest };

// Auto-run test function for easy testing
window.testDefeatedDoll = async function() {
  const test = new DefeatedDollTest();
  await test.runTest();
};

// Add instructions to console
console.log(`
🪆 Defeated Doll Test Available!

To test the animated doll creature, run:
  testDefeatedDoll()

This will:
1. Initialize the ThreeAnimationManager
2. Load the Defeated.fbx model
3. Create an animated doll creature token
4. Display test controls

Note: Make sure FBXLoader is included in index.html for 3D support.
`);
