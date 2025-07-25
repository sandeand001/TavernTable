// js/config/GameConfig.js - Centralized game configuration

const GameConfig = {
  // Sprite configuration
  sprites: {
    basePath: 'assets/sprites/',
    files: {
      'beholder-sprite': 'beholder-sprite.png',
      'dragon-sprite': 'dragon-sprite.png',
      'goblin-sprite': 'goblin-sprite.png',
      'mindflayer-sprite': 'mindflayer-sprite.png',
      'minotaur-sprite': 'minotaur-sprite.png',
      'orc-sprite': 'orc-sprite.png',
      'owlbear-sprite': 'owlbear-sprite.png',
      'skeleton-sprite': 'skeleton-sprite.png',
      'troll-sprite': 'troll-sprite.png'
    }
  },

  // Creature configuration
  creatures: {
    // Default creature properties
    defaults: {
      scale: 0.7,
      hitAreaMultiplier: 1.2,
      animationSpeed: 300
    },
    
    // Creature-specific overrides
    overrides: {
      beholder: {
        scale: 0.08, // Large creature
        animationSpeed: 400,
        usesSprite: true
      },
      dragon: {
        scale: 0.125, // Larger scale for dragons (4 grid squares)
        animationSpeed: 400,
        usesSprite: true
      },
      goblin: {
        scale: 0.05, // Small creature
        animationSpeed: 400,
        usesSprite: true
      },
      mindflayer: {
        scale: 0.06, // Medium creature
        animationSpeed: 400,
        usesSprite: true
      },
      minotaur: {
        scale: 0.08, // Large creature
        animationSpeed: 400,
        usesSprite: true
      },
      orc: {
        scale: 0.06, // Medium creature
        animationSpeed: 400,
        usesSprite: true
      },
      owlbear: {
        scale: 0.08, // Large creature
        animationSpeed: 400,
        usesSprite: true
      },
      skeleton: {
        scale: 0.12, // Appropriate scale for 341x512 frames
        animationSpeed: 400,
        usesSprite: true
      },
      troll: {
        scale: 0.08, // Large creature
        animationSpeed: 400,
        usesSprite: true
      }
    }
  },

  // Grid configuration
  grid: {
    tileWidth: 64,
    tileHeight: 32,
    rows: 10,
    cols: 10
  },

  // Animation configuration
  animations: {
    hover: {
      scaleMultiplier: 1.1,
      duration: 200
    },
    breathing: {
      scaleVariation: 0.02,
      duration: 2000
    }
  }
};

// Make config globally available
window.GameConfig = GameConfig;
