/**
 * RunDefeatedDollTest.js - Simple script to test the defeated doll creature
 * 
 * This script can be run from the browser console to quickly test
 * the 3D animated doll creature functionality.
 * 
 * Usage: Copy and paste this script into the browser console, or
 *        run `runDefeatedDollTest()` after the game loads.
 */

// Import the test module dynamically
async function runDefeatedDollTest() {
  try {
    console.log('🎬 Loading Defeated Doll Test...');
    
    // Import the test module
    const { DefeatedDollTest } = await import('./DefeatedDollTest.js');
    
    // Create and run the test
    const test = new DefeatedDollTest();
    await test.runTest();
    
  } catch (error) {
    console.error('❌ Failed to run Defeated Doll Test:', error);
    
    // Show detailed error information
    console.log(`
🔧 Troubleshooting Steps:

1. Check if FBXLoader is loaded:
   typeof THREE.FBXLoader !== 'undefined'
   
2. Check if Defeated.fbx exists:
   Check browser network tab for 404 errors
   
3. Check WebGL support:
   !!window.WebGLRenderingContext
   
4. Check Three.js version:
   THREE.REVISION
   
5. Try manual creation:
   const doll = new CreatureToken('defeated-doll', 0, 0);
    `);
  }
}

// Make it available globally
window.runDefeatedDollTest = runDefeatedDollTest;

// Alternative simple test without imports
window.quickDollTest = function() {
  try {
    console.log('🪆 Quick Doll Test - Creating defeated-doll creature...');
    
    // Wait for PIXI app
    if (!window.app || !window.app.stage) {
      console.error('❌ PIXI app not ready. Make sure the game is loaded.');
      return;
    }
    
    // Import CreatureToken dynamically
    import('../entities/creatures/CreatureToken.js').then((module) => {
      const CreatureToken = module.default;
      // Create a defeated doll creature
      const doll = new CreatureToken('defeated-doll', 400, 300);
      
      if (doll.sprite) {
        window.app.stage.addChild(doll.sprite);
        console.log('✅ Defeated doll added to stage!');
        console.log(`   - Type: ${doll.is3D ? '3D Model' : '2D Sprite'}`);
        console.log(`   - Animated: ${doll.isAnimated}`);
        
        // Store reference for later cleanup
        window.testDoll = doll;
        
        console.log('Use window.testDoll to access the creature');
      } else {
        console.error('❌ Failed to create doll sprite');
      }
    }).catch(error => {
      console.error('❌ Failed to import CreatureToken:', error);
    });
    
  } catch (error) {
    console.error('❌ Quick doll test failed:', error);
  }
};

console.log(`
🪆 Defeated Doll Test Scripts Loaded!

Available commands:
  runDefeatedDollTest() - Full test with UI controls
  quickDollTest()       - Simple creature creation test
  
If you see any errors, check that:
1. Three.js and FBXLoader are loaded
2. Defeated.fbx exists in assets/animated-sprites/
3. The game has finished loading
`);
