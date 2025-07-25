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

## Development & Code Quality

### Prerequisites
- Modern web browser with ES6 module support
- Node.js (optional, for development tools)

### Development Tools
```bash
# Install development dependencies
npm install

# Run code quality checks
npm run lint          # Run both JavaScript and CSS linting
npm run lint:js       # JavaScript linting only
npm run lint:css      # CSS linting only
npm run lint:fix      # Auto-fix linting issues where possible

# Start local development server
npm run serve         # Start Python HTTP server on port 3000
```

### Code Standards
- **ESLint**: Enforces JavaScript code quality and ES6 best practices
- **Stylelint**: Ensures CSS follows modern standards
- **JSDoc**: Comprehensive documentation for all functions and classes
- **ES6 Modules**: Clean import/export structure throughout codebase
- **Zero Linting Errors**: All code passes strict linting requirements

### Project Structure
```
js/
├── GameManager.js      # Core game logic and PIXI.js management
├── UIController.js     # User interface interactions (extracted from inline)
├── SpriteManager.js    # Centralized sprite and asset management  
├── DragController.js   # Token dragging functionality
├── dice.js            # Dice rolling system with animations
└── creatures/         # Creature system with factory pattern
    ├── CreatureFactory.js
    ├── CreatureToken.js
    └── index.js
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the MIT License.
