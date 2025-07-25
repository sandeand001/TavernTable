// js/creatures/CreatureToken.js - Base class for all creature tokens

class CreatureToken {
  constructor(type, x = 0, y = 0, facingRight = true) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.facingRight = facingRight;
    this.sprite = null;
    
    this.createSprite();
  }

  createSprite() {
    // Try to create sprite from PNG file first
    this.createCreatureSprite();
    
    // Apply facing direction after sprite creation
    this.applyFacing();
  }

  createCreatureSprite() {
    // Check if sprite manager is ready
    if (!window.spriteManager || !window.spriteManager.isLoaded()) {
      this.createFallbackGraphics();
      return;
    }
    
    const spriteKey = `${this.type}-sprite`;
    
    // Check if this specific sprite is available
    if (!window.spriteManager.hasSpriteLoaded(spriteKey)) {
      this.createFallbackGraphics();
      return;
    }
    
    const texture = window.spriteManager.getSprite(spriteKey);
    if (!texture) {
      this.createFallbackGraphics();
      return;
    }
    
    this.sprite = new PIXI.Sprite(texture);
    this.sprite.anchor.set(0.5, 0.5);
    
    // Set scale based on creature type
    const scale = this.getCreatureScale();
    this.sprite.scale.set(scale, scale);
  }

  createFallbackGraphics() {
    // Try to use the old drawing method if available, otherwise use colored circle
    if (typeof this.drawCreature === 'function') {
      this.sprite = new PIXI.Graphics();
      this.sprite.scale.set(0.7, 0.7);
      this.drawCreature();
    } else {
      this.createFallbackSprite();
    }
  }

  getCreatureScale() {
    // Check if we have GameConfig with creature overrides
    if (window.GameConfig && window.GameConfig.creatures && window.GameConfig.creatures.overrides) {
      const override = window.GameConfig.creatures.overrides[this.type];
      if (override && override.scale) {
        console.log(`Using GameConfig scale for ${this.type}: ${override.scale}`);
        return override.scale;
      }
    }
    
    // Fallback to hardcoded scales if GameConfig not available
    const scaleMap = {
      'dragon': 0.125,     // Large creature - 2x2 grid coverage
      'skeleton': 0.12,    // Medium creature - single grid coverage  
      'beholder': 0.08,    // Medium-large creature
      'goblin': 0.05,      // Small creature
      'mindflayer': 0.06,  // Medium creature
      'minotaur': 0.08,    // Large creature
      'orc': 0.06,         // Medium creature
      'owlbear': 0.08,     // Large creature
      'troll': 0.08        // Large creature
    };
    
    const scale = scaleMap[this.type] || 0.06;
    console.log(`Using fallback scale for ${this.type}: ${scale}`);
    return scale;
  }

  createFallbackSprite() {
    // Color-coded fallback circles for different creature types
    const colorMap = {
      'dragon': 0xFF0000,      // Red
      'skeleton': 0xFFFFFF,    // White
      'beholder': 0x800080,    // Purple
      'goblin': 0x00FF00,      // Green
      'mindflayer': 0x4B0082,  // Indigo
      'minotaur': 0x8B4513,    // Brown
      'orc': 0x808080,         // Gray
      'owlbear': 0xA52A2A,     // Dark Red
      'troll': 0x228B22        // Forest Green
    };
    
    const color = colorMap[this.type] || 0x808080; // Default to gray
    
    this.sprite = new PIXI.Graphics();
    this.sprite.beginFill(color);
    this.sprite.drawCircle(0, 0, 20);
    this.sprite.endFill();
  }

  applyFacing() {
    if (!this.sprite) return;
    
    const absScaleX = Math.abs(this.sprite.scale.x);
    const absScaleY = Math.abs(this.sprite.scale.y);
    
    if (this.sprite instanceof PIXI.Sprite) {
      // For PNG sprites, use skew to avoid vertical flipping
      this.sprite.scale.x = absScaleX;
      this.sprite.scale.y = absScaleY;
      this.sprite.skew.y = this.facingRight ? 0 : Math.PI;
    } else {
      // For Graphics objects, simple scale works fine
      this.sprite.scale.x = this.facingRight ? absScaleX : -absScaleX;
      this.sprite.scale.y = absScaleY;
    }
  }

  setFacing(facingRight) {
    this.facingRight = facingRight;
    this.applyFacing();
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    if (this.sprite) {
      this.sprite.x = x;
      this.sprite.y = y;
    }
  }

  addToStage(stage) {
    if (this.sprite) {
      stage.addChild(this.sprite);
    }
  }

  removeFromStage() {
    if (this.sprite && this.sprite.parent) {
      this.sprite.parent.removeChild(this.sprite);
    }
  }

  // Method to recreate sprite (useful for upgrading from fallback to PNG)
  recreateSprite() {
    console.log(`Recreating sprite for ${this.type}`);
    
    // Remove existing sprite
    if (this.sprite && this.sprite.parent) {
      const parent = this.sprite.parent;
      const x = this.sprite.x;
      const y = this.sprite.y;
      
      parent.removeChild(this.sprite);
      
      // Create new sprite
      this.createSprite();
      
      // Restore position
      if (this.sprite) {
        this.sprite.x = x;
        this.sprite.y = y;
        parent.addChild(this.sprite);
      }
    } else {
      // Just recreate if no parent
      this.createSprite();
    }
  }
}

export default CreatureToken;
