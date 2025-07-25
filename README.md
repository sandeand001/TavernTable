# TavernTable

A web-based isometric grid D&D tabletop game for managing creature tokens and dice rolling.

## Features

- **Isometric Grid System**: Beautiful diamond-shaped grid for tactical gameplay
- **Creature Token Management**: Place, move, and remove 9 different creature types
- **Sprite System**: High-quality PNG sprites with color-coded fallback graphics
- **3D Dice Rolling**: Interactive dice rolling with 3D visualization
- **Token Interactions**: 
  - Click to place tokens
  - Drag to move tokens
  - Remove tokens with remove mode
  - Adjustable facing direction
- **Responsive Design**: Works on different screen sizes

## Creature Types

- Dragon 🐉
- Skeleton 💀  
- Goblin 🧌
- Beholder 👁️
- Mind Flayer 🐙
- Minotaur 🐂
- Orc 🧟
- Owlbear 🐻
- Troll 🧟‍♂️

## Getting Started

1. Clone this repository
2. Start a local HTTP server in the project directory:
   ```bash
   python -m http.server 8000
   ```
3. Open `http://localhost:8000` in your browser
4. Start placing tokens and rolling dice!

## Project Structure

```
├── index.html              # Main application
├── assets/                 # Sprites and resources
│   └── sprites/           # Creature PNG files
├── css/                   # Stylesheets  
├── js/                    # Core JavaScript files
│   ├── config/           # Game configuration
│   ├── creatures/        # Creature token system
│   ├── GameManager.js    # Main game logic
│   ├── SpriteManager.js  # Sprite loading/management
│   ├── DragController.js # Token dragging
│   └── dice*.js         # Dice rolling system
└── archive/              # Development files (optional)
```

## Technologies Used

- **PIXI.js**: 2D graphics rendering and sprite management
- **Three.js**: 3D dice visualization
- **Vanilla JavaScript**: No frameworks, pure ES6+
- **HTML5 Canvas**: For rendering the game grid and tokens

## Development

This project uses a clean modular architecture:

- `GameManager`: Handles game initialization, grid setup, and token placement
- `SpriteManager`: Loads and manages PNG sprites with fallback support  
- `CreatureToken`: Unified class for all creature types
- `CreatureFactory`: Factory pattern for creating creatures
- `DragController`: Handles token dragging interactions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the MIT License.
