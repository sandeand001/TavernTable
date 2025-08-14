/**
 * AnimatedSpriteManager.js - Manages animated sprite sheets for creature tokens
 * 
 * Handles PIXI.js AnimatedSprite creation from sprite sheets, providing smooth
 * looping animations for creature tokens. Integrates with existing SpriteManager
 * while maintaining backward compatibility.
 * 
 * @module AnimatedSpriteManager
 * @author TavernTable
 * @since 1.1.0
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';

/**
 * Configuration for animated sprites
 * Define sprite sheet layouts and animation properties
 */
const ANIMATED_SPRITE_CONFIG = {
  'dragon': {
    texture: 'assets/animated-sprites/dragon-animation.png',
    frameWidth: 512,  // Fixed: 1024 ÷ 2 = 512px (was 256)
    frameHeight: 341, // Fixed: 1024 ÷ 3 = 341px (was 384)
    totalFrames: 6,
    columns: 2,  // 2 columns
    rows: 3,     // 3 rows
    animationSpeed: 0.08, // ~5 FPS (slowed down from 0.133)
    loop: true,
    autoPlay: true,
    // Custom anchor point for dragon's front feet positioning
    anchorX: 0.35, // Adjust based on dragon's front feet position
    anchorY: 0.85, // Bottom of the sprite for ground alignment
    // Frame reading order: left-to-right, top-to-bottom
    // 2×3 grid: Frame 1→2 (row 1), Frame 3→4 (row 2), Frame 5→6 (row 3)
    frameOrder: [0, 1, 2, 3, 4, 5], // Frame 1→2→3→4→5→6
    // Baseline alignment configuration
    baselineAlignment: {
      enabled: false, // Temporarily disabled to eliminate frame shifting
      referenceY: 283, // Fixed: Proportional to new frame height (341 * 0.83 ≈ 283)
      frontFeetX: 90,  // Approximate X position of front feet for detection
      detectionHeight: 20 // Height range to search for feet baseline
    }
  }
  // Easy to add more animated creatures here:
  // 'phoenix': { texture: '...', frameWidth: 128, ... },
  // 'elemental': { texture: '...', frameWidth: 192, ... }
};

/**
 * Manages animated sprite creation and lifecycle
 */
class AnimatedSpriteManager {
  constructor() {
    this.loadedTextures = new Map();
    this.animatedSprites = new Map();
    this.isInitialized = false;
    
    logger.pushContext({ component: 'AnimatedSpriteManager' });
  }

  /**
   * Initialize the animated sprite manager
   * Preloads animated textures for better performance
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info('Initializing AnimatedSpriteManager...');
      
      // Preload all animated sprite textures
      const loadPromises = Object.entries(ANIMATED_SPRITE_CONFIG).map(
        ([key, config]) => this.preloadTexture(key, config)
      );
      
      await Promise.all(loadPromises);
      
      this.isInitialized = true;
      logger.log(LOG_LEVEL.INFO, 'AnimatedSpriteManager initialized successfully', LOG_CATEGORY.SYSTEM, {
        context: 'AnimatedSpriteManager.initialize',
        stage: 'initialization_complete',
        configuredSprites: Object.keys(ANIMATED_SPRITE_CONFIG),
        texturesLoaded: loadPromises.length,
        isInitialized: this.isInitialized
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.HIGH, ERROR_CATEGORY.RENDERING, {
        context: 'AnimatedSpriteManager.initialize',
        stage: 'animation_manager_initialization',
        configuredSprites: Object.keys(ANIMATED_SPRITE_CONFIG),
        pixiAvailable: typeof PIXI !== 'undefined',
        loaderAvailable: !!(PIXI.Loader || PIXI.Assets),
        isInitialized: this.isInitialized
      });
      throw error;
    }
  }

  /**
   * Preload a texture for animated sprite use
   * @private
   * @param {string} key - Sprite identifier
   * @param {Object} config - Sprite configuration
   * @returns {Promise<void>}
   */
  async preloadTexture(key, config) {
    try {
      logger.debug(`Preloading animated texture: ${key}`);
      
      // Load the base texture
      const baseTexture = await PIXI.Texture.fromURL(config.texture);
      
      // Verify texture loaded correctly
      if (!baseTexture || !baseTexture.valid) {
        throw new Error(`Failed to load base texture for ${key}`);
      }
      
      // Validate sprite sheet dimensions match configuration
      const expectedWidth = config.columns * config.frameWidth;
      const expectedHeight = config.rows * config.frameHeight;
      
      if (baseTexture.width < expectedWidth || baseTexture.height < expectedHeight) {
        throw new Error(
          `Sprite sheet dimensions insufficient for ${key}: ` +
          `Image: ${baseTexture.width}x${baseTexture.height}px, ` +
          `Required: ${expectedWidth}x${expectedHeight}px ` +
          `(${config.columns}×${config.rows} grid of ${config.frameWidth}×${config.frameHeight}px frames)`
        );
      }
      
      // Create frame textures from sprite sheet
      const frames = this.createFramesFromSpriteSheet(baseTexture, config);
      
      if (frames.length === 0) {
        throw new Error(`No frames created for ${key}`);
      }
      
      this.loadedTextures.set(key, {
        baseTexture,
        frames,
        config
      });
      
      logger.debug(`Successfully loaded animated texture: ${key} (${frames.length} frames)`);
    } catch (error) {
      console.error(`❌ Failed to load animated texture: ${key}`, error);
      logger.warn(`Failed to load animated texture: ${key}`, error);
      // Don't throw - allow fallback to static sprites
    }
  }

  /**
   * Create individual frame textures from a sprite sheet with baseline normalization
   * @private
   * @param {PIXI.Texture} baseTexture - Source sprite sheet texture
   * @param {Object} config - Sprite sheet configuration
   * @returns {PIXI.Texture[]} Array of normalized frame textures
   */
  createFramesFromSpriteSheet(baseTexture, config) {
    const { frameWidth, frameHeight, columns, rows, totalFrames, baselineAlignment } = config;
    
    // Log sprite sheet info for debugging
    logger.debug('Creating frames from sprite sheet:');
    logger.debug(`  - Sheet size: ${baseTexture.width}x${baseTexture.height}px`);
    logger.debug(`  - Frame size: ${frameWidth}x${frameHeight}px`);
    logger.debug(`  - Grid layout: ${columns}x${rows} (${totalFrames} total frames)`);
    logger.debug(`  - Expected sheet size: ${columns * frameWidth}x${rows * frameHeight}px`);
    
    // Extract raw frames first
    const rawFrames = this.extractRawFrames(baseTexture, config);
    
    // Apply baseline normalization if enabled
    if (baselineAlignment && baselineAlignment.enabled) {
      return this.normalizeFrameBaselines(rawFrames);
    } else {
      return rawFrames;
    }
  }

  /**
   * Extract raw frame textures without normalization
   * @private
   * @param {PIXI.Texture} baseTexture - Source sprite sheet texture
   * @param {Object} config - Sprite sheet configuration
   * @returns {PIXI.Texture[]} Array of raw frame textures
   */
  extractRawFrames(baseTexture, config) {
    const frames = [];
    const { frameWidth, frameHeight, columns, rows, totalFrames } = config;
    
    let frameCount = 0;
    
    // Read frames left-to-right, top-to-bottom as specified
    for (let row = 0; row < rows && frameCount < totalFrames; row++) {
      for (let col = 0; col < columns && frameCount < totalFrames; col++) {
        const x = col * frameWidth;
        const y = row * frameHeight;
        
        // Create rectangle for this frame
        const rectangle = new PIXI.Rectangle(x, y, frameWidth, frameHeight);
        
        // Create texture from rectangle
        const frameTexture = new PIXI.Texture(baseTexture, rectangle);
        frames.push(frameTexture);
        
        logger.debug(`  Frame ${frameCount + 1}: Position (${x}, ${y}) Size ${frameWidth}x${frameHeight}`);
        frameCount++;
      }
    }
    
    logger.debug(`Successfully extracted ${frames.length} raw frames from sprite sheet`);
    return frames;
  }

  /**
   * Normalize frame baselines by applying vertical offsets to align front feet
   * @private
   * @param {PIXI.Texture[]} rawFrames - Array of raw frame textures
   * @param {Object} config - Sprite sheet configuration
   * @returns {PIXI.Texture[]} Array of baseline-normalized frame textures
   */
  normalizeFrameBaselines(rawFrames) {
    // For the container-based approach, we don't need to modify the textures
    // Instead, we apply dynamic offsets in the container system
    return rawFrames;
  }

  /**
   * Calculate predefined baseline offsets for dragon animation frames
   * These offsets align the dragon's front feet to a consistent baseline
   * Adjusted for 341px frame height (down from 384px original)
   * @private
   * @returns {number[]} Array of vertical offsets for each frame
   */
  calculateDragonBaselineOffsets() {
    // Refined offsets based on proportional scaling and reduced magnitude
    // Values scaled from original 384px frame height to 341px frame height
    // Reduced magnitude to minimize visible shifting between frames
    return [
      0,    // Frame 1: Neutral stance - reference position
      1,    // Frame 2: Slight lean forward - minimal adjust down
      2,    // Frame 3: Deep breath preparation - small adjust down  
      1.5,  // Frame 4: Fire breath peak - small adjust down
      0.5,  // Frame 5: Recovery breath - very slight adjust down
      -0.5  // Frame 6: Return to neutral - very slight adjust up
    ];
  }

  /**
   * Check if an animated sprite is available for the given creature type
   * @param {string} creatureType - Type of creature to check
   * @returns {boolean} True if animated version is available
   */
  hasAnimatedSprite(creatureType) {
    return this.isInitialized && 
           Object.prototype.hasOwnProperty.call(ANIMATED_SPRITE_CONFIG, creatureType) &&
           this.loadedTextures.has(creatureType);
  }

  /**
   * Create an animated sprite for the specified creature type with baseline normalization
   * @param {string} creatureType - Type of creature (e.g., 'dragon')
   * @param {Object} options - Animation options (optional)
   * @returns {PIXI.Container|null} Container with baseline-aligned animated sprite or null if not available
   */
  createAnimatedSprite(creatureType, options = {}) {
    try {
      if (!this.hasAnimatedSprite(creatureType)) {
        logger.debug(`No animated sprite available for: ${creatureType}`);
        return null;
      }

      const textureData = this.loadedTextures.get(creatureType);
      const config = textureData.config;
      
      // Create PIXI AnimatedSprite from frame textures
      const animatedSprite = new PIXI.AnimatedSprite(textureData.frames);
      
      // Configure animation properties
      animatedSprite.animationSpeed = options.animationSpeed || config.animationSpeed;
      animatedSprite.loop = options.loop !== undefined ? options.loop : config.loop;
      
      // Set custom anchor point for proper positioning (defaults to center if not specified)
      const anchorX = config.anchorX !== undefined ? config.anchorX : 0.5;
      const anchorY = config.anchorY !== undefined ? config.anchorY : 0.5;
      animatedSprite.anchor.set(anchorX, anchorY);
      
      // Create baseline alignment system if explicitly enabled
      // Use strict boolean check to ensure false/undefined/null all disable baseline alignment
      const baselineEnabled = config.baselineAlignment && 
                             config.baselineAlignment.enabled === true;
      
      if (baselineEnabled) {
        const container = this.createBaselineAlignedContainer(animatedSprite, config);
        
        // Store reference for cleanup using container
        const spriteId = `${creatureType}_${Date.now()}_${Math.random()}`;
        this.animatedSprites.set(spriteId, container);
        
        // Auto-start animation if configured
        if (config.autoPlay && (options.autoPlay !== false)) {
          animatedSprite.play();
        }
        
        // Add cleanup handler when container is destroyed
        container.once('destroyed', () => {
          this.animatedSprites.delete(spriteId);
        });
        
        logger.debug(`Created baseline-aligned animated sprite for: ${creatureType}`);
        return container;
      } else {
        // Standard animated sprite without baseline alignment
        const spriteId = `${creatureType}_${Date.now()}_${Math.random()}`;
        this.animatedSprites.set(spriteId, animatedSprite);
        
        if (config.autoPlay && (options.autoPlay !== false)) {
          animatedSprite.play();
        }
        
        animatedSprite.once('destroyed', () => {
          this.animatedSprites.delete(spriteId);
        });
        
        logger.debug(`Created animated sprite for: ${creatureType}`);
        return animatedSprite;
      }
      
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
        context: 'AnimatedSpriteManager.createAnimatedSprite',
        stage: 'animated_sprite_creation',
        creatureType: creatureType,
        options: options || {},
        configAvailable: !!(ANIMATED_SPRITE_CONFIG[creatureType]),
        textureAvailable: !!(PIXI.utils?.TextureCache && PIXI.utils.TextureCache[ANIMATED_SPRITE_CONFIG[creatureType]?.texture]),
        isInitialized: this.isInitialized
      });
      return null;
    }
  }

  /**
   * Create a container with baseline-aligned animated sprite
   * @private
   * @param {PIXI.AnimatedSprite} animatedSprite - The animated sprite to align
   * @param {Object} config - Sprite configuration with baseline alignment settings
   * @returns {PIXI.Container} Container with baseline alignment behavior
   */
  createBaselineAlignedContainer(animatedSprite) {
    const container = new PIXI.Container();
    const baselineOffsets = this.calculateDragonBaselineOffsets();
    
    // Add the animated sprite to the container
    container.addChild(animatedSprite);
    
    // Set up baseline alignment update on frame change
    let currentFrame = -1;
    
    const updateBaseline = () => {
      if (animatedSprite.currentFrame !== currentFrame) {
        currentFrame = animatedSprite.currentFrame;
        const offset = baselineOffsets[currentFrame] || 0;
        
        // Apply vertical offset to maintain consistent front feet baseline
        animatedSprite.y = offset;
      }
    };
    
    // Update baseline alignment each frame
    container.updateBaseline = updateBaseline;
    
    // Set up automatic baseline updates
    const ticker = PIXI.Ticker.shared;
    ticker.add(updateBaseline);
    
    // Clean up ticker when container is destroyed
    container.once('destroyed', () => {
      ticker.remove(updateBaseline);
    });
    
    // Initial baseline alignment
    updateBaseline();
    
    return container;
  }

  /**
   * Get available animated creature types
   * @returns {string[]} Array of creature types with animations
   */
  getAvailableAnimatedTypes() {
    return Object.keys(ANIMATED_SPRITE_CONFIG).filter(
      type => this.loadedTextures.has(type)
    );
  }

  /**
   * Start all animations
   * Useful for resuming after pause
   */
  startAllAnimations() {
    this.animatedSprites.forEach(sprite => {
      if (sprite && !sprite.playing) {
        sprite.play();
      }
    });
  }

  /**
   * Stop all animations
   * Useful for pausing or performance optimization
   */
  stopAllAnimations() {
    this.animatedSprites.forEach(sprite => {
      if (sprite && sprite.playing) {
        sprite.stop();
      }
    });
  }

  /**
   * Get animation configuration for a creature type
   * @param {string} creatureType - Type of creature
   * @returns {Object|null} Animation configuration or null
   */
  getAnimationConfig(creatureType) {
    return ANIMATED_SPRITE_CONFIG[creatureType] || null;
  }

  /**
   * Update animation speed for all active sprites
   * @param {number} speedMultiplier - Speed multiplier (1.0 = normal)
   */
  updateAnimationSpeed(speedMultiplier) {
    this.animatedSprites.forEach(sprite => {
      if (sprite) {
        const originalSpeed = sprite.animationSpeed / (this.currentSpeedMultiplier || 1);
        sprite.animationSpeed = originalSpeed * speedMultiplier;
      }
    });
    this.currentSpeedMultiplier = speedMultiplier;
  }

  /**
   * Cleanup resources
   * Should be called when manager is no longer needed
   */
  destroy() {
    // Stop all animations
    this.stopAllAnimations();
    
    // Clear references
    this.animatedSprites.clear();
    this.loadedTextures.clear();
    
    this.isInitialized = false;
    logger.debug('AnimatedSpriteManager destroyed');
  }
}

// Create singleton instance
const animatedSpriteManager = new AnimatedSpriteManager();

// Make available globally for compatibility
window.animatedSpriteManager = animatedSpriteManager;

export default animatedSpriteManager;
