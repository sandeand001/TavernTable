/**
 * Diagnostic script to check if AnimatedSpriteManager is loading correctly
 * Add this script tag after all other modules to debug loading issues
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('🔍 TavernTable Module Diagnostic Tool');
  console.log('=====================================');
  
  // Check if key modules are loaded
  const moduleChecks = [
    { name: 'PIXI', object: window.PIXI },
    { name: 'gameManager', object: window.gameManager },
    { name: 'spriteManager', object: window.spriteManager },
    { name: 'animatedSpriteManager', object: window.animatedSpriteManager },
    { name: 'sidebarController', object: window.sidebarController },
    { name: 'tokenManager', object: window.tokenManager }
  ];
  
  moduleChecks.forEach(check => {
    const status = check.object ? '✅ LOADED' : '❌ MISSING';
    console.log(`${check.name}: ${status}`);
    
    if (check.name === 'animatedSpriteManager' && check.object) {
      console.log(`  - isInitialized: ${check.object.isInitialized}`);
      console.log(`  - available types: ${check.object.getAvailableAnimatedTypes()}`);
      console.log(`  - has dragon: ${check.object.hasAnimatedSprite('dragon')}`);
    }
  });
  
  // Check if dragon animation asset exists
  const testImage = new Image();
  testImage.onload = function() {
    console.log('✅ Dragon animation asset loaded successfully');
    console.log(`   - Dimensions: ${this.naturalWidth}x${this.naturalHeight}px`);
    console.log(`   - Expected: 512x1152px (2×256 x 3×384)`);
    
    // Validate expected dimensions for 2x3 grid
    const expectedWidth = 2 * 256; // 512px
    const expectedHeight = 3 * 384; // 1152px
    
    if (this.naturalWidth === expectedWidth && this.naturalHeight === expectedHeight) {
      console.log('✅ Dragon sprite sheet dimensions are correct for 2×3 grid!');
    } else {
      console.warn('⚠️ Dragon sprite sheet dimensions don\'t match expected 2×3 grid size');
      console.log(`   - Found: ${this.naturalWidth}x${this.naturalHeight}px`);
      console.log(`   - Expected: ${expectedWidth}x${expectedHeight}px`);
      console.log(`   - Grid layout: 2 columns × 3 rows`);
    }
  };
  testImage.onerror = function() {
    console.log('❌ Failed to load dragon animation asset');
    console.log('   - Check that assets/animated-sprites/dragon-animation.png exists');
  };
  testImage.src = 'assets/animated-sprites/dragon-animation.png';
  
  // Check console for any errors
  const originalError = console.error;
  const originalWarn = console.warn;
  let errorCount = 0;
  let warnCount = 0;
  
  console.error = function(...args) {
    errorCount++;
    originalError.apply(console, ['🚨 ERROR:', ...args]);
  };
  
  console.warn = function(...args) {
    warnCount++;
    originalWarn.apply(console, ['⚠️ WARNING:', ...args]);
  };
  
  // Summary after 2 seconds
  setTimeout(() => {
    console.log('=====================================');
    console.log('🔍 Diagnostic Summary:');
    console.log(`   - Errors: ${errorCount}`);
    console.log(`   - Warnings: ${warnCount}`);
    console.log(`   - Ready to test animated dragon: ${window.animatedSpriteManager?.hasAnimatedSprite('dragon') ? '✅ YES' : '❌ NO'}`);
    console.log('=====================================');
  }, 2000);
});

// Add a test function to manually test animated sprite creation
window.testAnimatedDragon = function() {
  console.log('🧪 Testing baseline-aligned animated dragon creation...');
  
  if (!window.animatedSpriteManager) {
    console.error('❌ AnimatedSpriteManager not available');
    return null;
  }
  
  if (!window.animatedSpriteManager.isInitialized) {
    console.error('❌ AnimatedSpriteManager not initialized');
    console.log('💡 Try waiting a moment and running this again');
    return null;
  }
  
  console.log('📊 AnimatedSpriteManager Status:');
  console.log(`   - Initialized: ${window.animatedSpriteManager.isInitialized}`);
  console.log(`   - Has dragon config: ${window.animatedSpriteManager.hasAnimatedSprite('dragon')}`);
  
  const dragonContainer = window.animatedSpriteManager.createAnimatedSprite('dragon');
  if (dragonContainer) {
    console.log('✅ Baseline-aligned animated dragon created successfully!');
    
    // Get the actual animated sprite from the container
    const animatedSprite = dragonContainer.children[0];
    
    console.log(`   - Container type: ${dragonContainer.constructor.name}`);
    console.log(`   - Animated sprite type: ${animatedSprite.constructor.name}`);
    console.log(`   - Animation speed: ${animatedSprite.animationSpeed}`);
    console.log(`   - Playing: ${animatedSprite.playing}`);
    console.log(`   - Total frames: ${animatedSprite.totalFrames}`);
    console.log(`   - Current frame: ${animatedSprite.currentFrame}`);
    console.log(`   - Loop: ${animatedSprite.loop}`);
    console.log(`   - Anchor: (${animatedSprite.anchor.x}, ${animatedSprite.anchor.y})`);
    console.log(`   - Sprite dimensions: ${animatedSprite.width}x${animatedSprite.height}px`);
    console.log(`   - Container dimensions: ${dragonContainer.width}x${dragonContainer.height}px`);
    console.log(`   - Baseline alignment: ENABLED`);
    
    // Enable debug mode for baseline tracking
    window.debug = window.debug || {};
    window.debug.dragonAnimation = true;
    console.log('🔍 Dragon animation debugging enabled');
    
    // Test placing it on screen temporarily
    if (window.gameManager && window.gameManager.app && window.gameManager.app.stage) {
      dragonContainer.x = 400;
      dragonContainer.y = 300;
      dragonContainer.scale.set(0.5); // Make it smaller for testing
      window.gameManager.app.stage.addChild(dragonContainer);
      
      console.log('🎬 Dragon container added to stage for testing (scaled to 50%)');
      console.log('💡 You should see an animated dragon with aligned front feet baseline');
      console.log('🦶 Watch console for baseline offset messages during animation');
      
      // Remove after 10 seconds to observe baseline alignment
      setTimeout(() => {
        if (dragonContainer.parent) {
          dragonContainer.parent.removeChild(dragonContainer);
          dragonContainer.destroy();
          window.debug.dragonAnimation = false;
          console.log('🧹 Test dragon removed from stage');
        }
      }, 10000);
    }
    
    return dragonContainer;
  } else {
    console.error('❌ Failed to create animated dragon');
    
    // Additional debugging
    const config = window.animatedSpriteManager.getAnimationConfig('dragon');
    if (config) {
      console.log('📋 Dragon configuration found:');
      console.log(config);
    } else {
      console.error('❌ No dragon configuration found');
    }
    
    return null;
  }
};

console.log('💡 Tip: Run testAnimatedDragon() in console to test animation creation');
