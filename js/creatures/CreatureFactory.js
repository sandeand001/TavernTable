// js/creatures/CreatureFactory.js - Factory for creating creature tokens

class CreatureFactory {
  static createCreature(type, x = 0, y = 0, facingRight = true) {
    // Validate creature type
    const validTypes = [
      'beholder', 'dragon', 'goblin', 'mindflayer', 'minotaur', 
      'orc', 'owlbear', 'skeleton', 'troll'
    ];
    
    if (!validTypes.includes(type.toLowerCase())) {
      console.warn(`Unknown creature type: ${type}`);
    }
    
    // Create CreatureToken directly
    return new CreatureToken(type, x, y, facingRight);
  }
}
