// js/SpriteManager.js - Centralized sprite management

import CreatureFactory from './creatures/CreatureFactory.js';

class SpriteManager {
  constructor() {
    this.sprites = new Map();
    this.loaded = false;
    this.registeredSprites = []; // Track registered sprite names
  }

  // Get base path from config
  getBasePath() {
    return window.GameConfig ? window.GameConfig.sprites.basePath : 'assets/sprites/';
  }

  // Get sprite files from config
  getSpriteFiles() {
    // Wait a moment and retry if GameConfig isn't available yet
    if (!window.GameConfig) {
      console.warn('GameConfig not yet available, using minimal fallback');
      return {
        'dragon-sprite': 'dragon-sprite.png',
        'skeleton-sprite': 'skeleton-sprite.png'
      };
    }
    
    const files = window.GameConfig.sprites.files;
    console.log('Sprite files from config:', files);
    console.log('Total sprites from GameConfig:', Object.keys(files).length);
    return files;
  }

  // Register a sprite for loading
  addSprite(name, filename) {
    const fullPath = this.getBasePath() + filename;
    console.log(`Registering sprite: ${name} -> ${fullPath}`);
    
    // Test if the file exists by attempting to create an image
    const testImg = new Image();
    testImg.onload = () => {
      console.log(`✓ File exists: ${fullPath}`);
    };
    testImg.onerror = () => {
      console.error(`✗ File NOT found: ${fullPath}`);
    };
    testImg.src = fullPath;
    
    // Add the sprite to PIXI.Assets
    PIXI.Assets.add(name, fullPath);
    
    this.registeredSprites.push(name); // Track registered sprites
    console.log(`Successfully registered sprite: ${name}`);
  }

  // Load all registered sprites
  async loadSprites() {
    try {
      console.log('Loading sprites...', this.registeredSprites);
      
      // Track successful and failed loads
      const successfulLoads = [];
      const failedLoads = [];
      
      // Load each registered sprite individually for better error handling
      for (const spriteName of this.registeredSprites) {
        try {
          console.log(`Loading individual sprite: ${spriteName}`);
          const texture = await PIXI.Assets.load(spriteName);
          
          if (texture && texture.width && texture.height) {
            console.log(`✓ Successfully loaded ${spriteName}:`, texture.width, 'x', texture.height);
            successfulLoads.push(spriteName);
            
            // Store reference for quick verification
            this.sprites.set(spriteName, texture);
          } else {
            console.error(`✗ Invalid texture for ${spriteName}:`, texture);
            failedLoads.push(spriteName);
          }
        } catch (spriteError) {
          console.error(`✗ Failed to load sprite ${spriteName}:`, spriteError);
          failedLoads.push(spriteName);
        }
      }
      
      console.log(`Sprite loading complete: ${successfulLoads.length} successful, ${failedLoads.length} failed`);
      console.log('Successfully loaded:', successfulLoads);
      if (failedLoads.length > 0) {
        console.warn('Failed to load:', failedLoads);
      }
      
      this.loaded = true;
      return true;
    } catch (error) {
      console.error('Error loading sprites:', error);
      this.loaded = true; // Still set to true to allow fallback graphics
      return false;
    }
  }

  // Get a loaded sprite texture
  getSprite(name) {
    console.log(`Getting sprite: ${name}, loaded: ${this.loaded}`);
    console.log(`Registered sprites: [${this.registeredSprites.join(', ')}]`);
    
    if (!this.loaded) {
      console.warn('Sprites not yet loaded');
      return null;
    }
    
    // First try our stored reference
    if (this.sprites.has(name)) {
      const sprite = this.sprites.get(name);
      console.log(`✓ Retrieved sprite ${name} from stored reference:`, sprite.width, 'x', sprite.height);
      return sprite;
    }
    
    // Fallback to PIXI.Assets
    try {
      const sprite = PIXI.Assets.get(name);
      console.log(`Retrieved sprite ${name} from PIXI.Assets:`, sprite);
      if (sprite) {
        console.log(`Sprite ${name} dimensions:`, sprite.width, 'x', sprite.height);
        // Store for future reference
        this.sprites.set(name, sprite);
      } else {
        console.error(`✗ Sprite ${name} not found in PIXI.Assets`);
        console.log('Attempting to list available assets...');
        this.listAvailableSprites();
      }
      return sprite;
    } catch (error) {
      console.error(`Error retrieving sprite ${name}:`, error);
      return null;
    }
  }

  // Check if sprites are loaded
  isLoaded() {
    return this.loaded;
  }

  // Check if a specific sprite is available
  hasSpriteLoaded(name) {
    return this.sprites.has(name) || !!PIXI.Assets.get(name);
  }

  // Debug method to list all available sprites
  listAvailableSprites() {
    console.log('Registered sprites:', this.registeredSprites);
    console.log('Available PIXI Assets:');
    if (PIXI.Assets._resolver && PIXI.Assets._resolver._assetMap) {
      for (const [key, value] of PIXI.Assets._resolver._assetMap) {
        console.log(`  ${key} -> ${value.src}`);
      }
    }
    console.log('Sprites that can be retrieved:');
    for (const spriteName of this.registeredSprites) {
      const sprite = PIXI.Assets.get(spriteName);
      console.log(`  ${spriteName}: ${sprite ? 'Available' : 'Missing'}`);
    }
  }

  // Register all game sprites
  registerGameSprites() {
    // Ensure GameConfig is available
    if (!window.GameConfig) {
      console.error('❌ GameConfig not available! Cannot register all sprites.');
      console.log('Available global objects:', Object.keys(window).filter(k => k.includes('Game') || k.includes('Config')));
      
      // Register minimal sprites as fallback
      this.addSprite('dragon-sprite', 'dragon-sprite.png');
      this.addSprite('skeleton-sprite', 'skeleton-sprite.png');
      console.log('Registered 2 fallback sprites');
      return;
    }
    
    console.log('✅ GameConfig available, registering all sprites...');
    const spriteFiles = this.getSpriteFiles();
    
    // Register all sprites from config
    for (const [spriteName, filename] of Object.entries(spriteFiles)) {
      this.addSprite(spriteName, filename);
    }
    
    console.log(`✅ Registered ${Object.keys(spriteFiles).length} sprites from GameConfig`);
  }

  // Initialize the sprite manager
  async initialize() {
    console.log('Initializing Sprite Manager...');
    
    // Double-check GameConfig availability
    console.log('GameConfig check:', !!window.GameConfig);
    if (window.GameConfig) {
      console.log('GameConfig sprites config:', window.GameConfig.sprites);
      console.log('GameConfig files count:', Object.keys(window.GameConfig.sprites.files || {}).length);
    }
    
    this.registerGameSprites();
    return await this.loadSprites();
  }

  // Test function to manually create a sprite from a specific file
  testSprite(creatureType) {
    const spriteKey = `${creatureType}-sprite`;
    console.log(`Testing sprite creation for ${creatureType} with key: ${spriteKey}`);
    
    const texture = this.getSprite(spriteKey);
    if (texture) {
      console.log(`✓ Successfully got texture for ${creatureType}`);
      const testSprite = new PIXI.Sprite(texture);
      testSprite.anchor.set(0.5, 0.5);
      testSprite.scale.set(0.1, 0.1);
      testSprite.x = 100;
      testSprite.y = 100;
      window.app.stage.addChild(testSprite);
      console.log(`✓ Test sprite for ${creatureType} added to stage`);
      return testSprite;
    } else {
      console.error(`✗ Failed to get texture for ${creatureType}`);
      return null;
    }
  }
}

// Create global sprite manager instance
window.spriteManager = new SpriteManager();

// Global debug function to trace sprite creation
window.debugSpriteCreation = function(creatureType) {
  console.log(`🔍 === DEBUG SPRITE CREATION FOR: ${creatureType} ===`);
  
  // 1. Check GameConfig availability
  console.log(`1. GameConfig available: ${!!window.GameConfig}`);
  if (window.GameConfig) {
    console.log('   - Sprites config:', window.GameConfig.sprites);
    console.log('   - Files count:', Object.keys(window.GameConfig.sprites.files).length);
    console.log(`   - Contains ${creatureType}-sprite:`, !!window.GameConfig.sprites.files[`${creatureType}-sprite`]);
  }
  
  // 2. Check SpriteManager state
  console.log(`2. SpriteManager loaded: ${window.spriteManager.isLoaded()}`);
  console.log('   - Registered sprites:', window.spriteManager.registeredSprites);
  console.log('   - Stored sprites:', Array.from(window.spriteManager.sprites.keys()));
  
  // 3. Check specific sprite
  const spriteKey = `${creatureType}-sprite`;
  console.log(`3. Sprite key: "${spriteKey}"`);
  console.log('   - Has sprite loaded:', window.spriteManager.hasSpriteLoaded(spriteKey));
  console.log('   - Can get sprite:', !!window.spriteManager.getSprite(spriteKey));
  
  // 4. Test creation
  try {
    console.log('4. Testing creature creation...');
    const creature = CreatureFactory.createCreature(creatureType, 100, 100);
    console.log('   - Creature created:', !!creature);
    console.log('   - Sprite type:', creature.sprite.constructor.name);
    console.log('   - Is PNG sprite:', creature.sprite instanceof PIXI.Sprite);
  } catch (error) {
    console.error('   - Creation failed:', error);
  }
  
  console.log(`🔍 === END DEBUG FOR: ${creatureType} ===`);
};

// Global function to inspect PIXI Assets
window.inspectPixiAssets = function() {
  console.log('🔍 === PIXI ASSETS INSPECTION ===');
  
  try {
    // Check PIXI.Assets cache
    if (PIXI.Assets.cache && PIXI.Assets.cache.data) {
      console.log('PIXI.Assets.cache.data:', PIXI.Assets.cache.data);
      const cacheKeys = Object.keys(PIXI.Assets.cache.data);
      console.log('Cache keys:', cacheKeys);
      
      cacheKeys.forEach(key => {
        const asset = PIXI.Assets.cache.data[key];
        console.log(`  ${key}:`, asset ? `${asset.width}x${asset.height}` : 'null');
      });
    }
    
    // Check resolver
    if (PIXI.Assets._resolver && PIXI.Assets._resolver._assetMap) {
      console.log('PIXI.Assets._resolver._assetMap:');
      for (const [key, value] of PIXI.Assets._resolver._assetMap) {
        console.log(`  ${key} -> ${value.src}`);
      }
    }
    
    // Try to get each expected sprite
    const expectedSprites = ['dragon-sprite', 'skeleton-sprite', 'goblin-sprite', 'beholder-sprite'];
    expectedSprites.forEach(sprite => {
      try {
        const asset = PIXI.Assets.get(sprite);
        console.log(`PIXI.Assets.get('${sprite}'):`, !!asset, asset ? `${asset.width}x${asset.height}` : 'null');
      } catch (error) {
        console.error(`Error getting ${sprite}:`, error);
      }
    });
    
  } catch (error) {
    console.error('Error inspecting PIXI Assets:', error);
  }
  
  console.log('🔍 === END PIXI INSPECTION ===');
};
