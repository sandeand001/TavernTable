/**
 * Dragon Sprite Sheet Dimension Calculator
 * Determines correct frame dimensions for 1024x1024px sprite sheet
 */

const ACTUAL_IMAGE_SIZE = {
  width: 1024,
  height: 1024
};

const EXPECTED_LAYOUT = {
  columns: 2,
  rows: 3,
  totalFrames: 6
};

console.log('🐉 Dragon Sprite Sheet Analysis');
console.log('================================');
console.log(`Actual Image: ${ACTUAL_IMAGE_SIZE.width}x${ACTUAL_IMAGE_SIZE.height}px`);
console.log(`Expected Layout: ${EXPECTED_LAYOUT.columns} columns × ${EXPECTED_LAYOUT.rows} rows = ${EXPECTED_LAYOUT.totalFrames} frames`);
console.log('');

// Calculate correct frame dimensions
const correctFrameWidth = Math.floor(ACTUAL_IMAGE_SIZE.width / EXPECTED_LAYOUT.columns);
const correctFrameHeight = Math.floor(ACTUAL_IMAGE_SIZE.height / EXPECTED_LAYOUT.rows);

console.log('✅ Calculated Correct Dimensions:');
console.log(`Frame Width: ${ACTUAL_IMAGE_SIZE.width} ÷ ${EXPECTED_LAYOUT.columns} = ${correctFrameWidth}px`);
console.log(`Frame Height: ${ACTUAL_IMAGE_SIZE.height} ÷ ${EXPECTED_LAYOUT.rows} = ${correctFrameHeight}px`);
console.log('');

// Show the error in current configuration
const CURRENT_CONFIG = {
  frameWidth: 256,
  frameHeight: 384,
  columns: 2,
  rows: 3
};

console.log('❌ Current Configuration (INCORRECT):');
console.log(`frameWidth: ${CURRENT_CONFIG.frameWidth}px`);
console.log(`frameHeight: ${CURRENT_CONFIG.frameHeight}px`);
console.log(`Expected sheet size: ${CURRENT_CONFIG.columns * CURRENT_CONFIG.frameWidth}x${CURRENT_CONFIG.rows * CURRENT_CONFIG.frameHeight}px`);
console.log('');

console.log('🔧 Required Configuration Update:');
console.log(`frameWidth: ${CURRENT_CONFIG.frameWidth} → ${correctFrameWidth} (${correctFrameWidth - CURRENT_CONFIG.frameWidth > 0 ? '+' : ''}${correctFrameWidth - CURRENT_CONFIG.frameWidth}px)`);
console.log(`frameHeight: ${CURRENT_CONFIG.frameHeight} → ${correctFrameHeight} (${correctFrameHeight - CURRENT_CONFIG.frameHeight > 0 ? '+' : ''}${correctFrameHeight - CURRENT_CONFIG.frameHeight}px)`);
console.log('');

// Test frame extraction bounds
console.log('🧪 Frame Extraction Test:');
for (let row = 0; row < EXPECTED_LAYOUT.rows; row++) {
  for (let col = 0; col < EXPECTED_LAYOUT.columns; col++) {
    const frameNum = (row * EXPECTED_LAYOUT.columns) + col + 1;
    const x = col * correctFrameWidth;
    const y = row * correctFrameHeight;
    const right = x + correctFrameWidth;
    const bottom = y + correctFrameHeight;
    
    const withinBounds = (right <= ACTUAL_IMAGE_SIZE.width && bottom <= ACTUAL_IMAGE_SIZE.height);
    const status = withinBounds ? '✅' : '❌';
    
    console.log(`  Frame ${frameNum}: (${x}, ${y}) to (${right}, ${bottom}) ${status}`);
  }
}

// Export the correct configuration
export const CORRECTED_DRAGON_CONFIG = {
  texture: 'assets/animated-sprites/dragon-animation.png',
  frameWidth: correctFrameWidth,
  frameHeight: correctFrameHeight,
  totalFrames: 6,
  columns: 2,
  rows: 3,
  animationSpeed: 0.133,
  loop: true,
  autoPlay: true,
  anchorX: 0.35,
  anchorY: 0.85,
  frameOrder: [0, 1, 2, 3, 4, 5],
  baselineAlignment: {
    enabled: true,
    referenceY: Math.floor(correctFrameHeight * 0.83), // Adjust reference Y proportionally
    frontFeetX: 90,
    detectionHeight: 20
  }
};

console.log('📋 Corrected Configuration Object:');
console.log(JSON.stringify(CORRECTED_DRAGON_CONFIG, null, 2));
