// Quick test to check defeated-doll configuration
console.log('🔍 Testing defeated-doll configuration...');

// Check if ANIMATED_MODEL_CONFIG has defeated-doll
const ANIMATED_MODEL_CONFIG = {
  'defeated-doll': {
    model: 'assets/animated-sprites/Defeated.fbx',
    scale: { x: 1, y: 1, z: 1 },
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    animations: {
      idle: { name: 'idle', speed: 1.0, loop: true },
      defeat: { name: 'defeat', speed: 0.8, loop: false },
      revive: { name: 'revive', speed: 1.2, loop: false }
    },
    defaultAnimation: 'idle',
    camera: {
      position: { x: 0, y: 2, z: 5 },
      lookAt: { x: 0, y: 1, z: 0 },
    },
    lighting: {
      ambient: { color: 0x404040, intensity: 0.4 },
      directional: { 
        color: 0xffffff, 
        intensity: 0.8, 
        position: { x: 1, y: 1, z: 1 } 
      }
    },
    renderTarget: {
      width: 512,
      height: 512,
      antialias: true
    }
  }
};

console.log('defeated-doll config exists:', ANIMATED_MODEL_CONFIG.hasOwnProperty('defeated-doll'));
console.log('Config:', ANIMATED_MODEL_CONFIG['defeated-doll']);
