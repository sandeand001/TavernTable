# TavernTable

A modern web-based D&D tabletop simulator featuring an isometric grid system, creature token management, and interactive dice rolling.

![TavernTable Screenshot](https://via.placeholder.com/800x400/2a2a2a/ffffff?text=TavernTable+Isometric+Grid)

## 🎯 Overview

TavernTable brings the tactical combat experience of tabletop RPGs to your browser. Perfect for dungeon masters and players who want a clean, intuitive digital battlemap.

**Key Highlights:**
- Zero installation required - runs in any modern browser
- High-quality creature sprites with intelligent fallbacks
- Modular architecture built with modern JavaScript

## ✨ Features

### 🗺️ Tactical Grid System
- **Isometric View**: Beautiful diamond-shaped grid for tactical positioning
- **Zoom & Pan**: Mouse wheel zoom and click-drag navigation
- **Dynamic Sizing**: Adjustable grid dimensions
- **Visual Feedback**: Clear grid intersections and snap-to-grid placement

### 🐉 Creature Management
- **9 Creature Types**: Dragons, skeletons, goblins, beholders, and more
- **Smart Placement**: Click grid intersections to place tokens
- **Drag & Drop**: Intuitive token movement with automatic grid snapping
- **Facing Control**: Toggle creature direction before placement
- **Easy Removal**: Dedicated remove mode for cleanup

### 🎲 Dice System
- **Complete RPG Set**: D4, D6, D8, D10, D12, D20, D100
- **Multiple Dice**: Roll up to 10 dice of the same type
- **Color Coding**: Green for max rolls, red for minimum, white for normal
- **Roll History**: Persistent log of all dice results with timestamps

### 🎨 Visual Excellence
- **High-Quality Sprites**: PNG artwork for each creature type
- **Fallback Graphics**: Colored shapes when sprites unavailable
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Clean Interface**: Uncluttered sidebar with organized controls

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome 88+, Firefox 78+, Safari 14+)
- Local HTTP server (required for ES6 module loading)

### Setup

1. **Download/Clone the project**
   ```bash
   git clone <your-repo-url>
   cd TavernTable
   ```

2. **Start a local server**
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Node.js (with http-server)
   npx http-server -p 8000
   
   # PHP
   php -S localhost:8000
   ```

3. **Open in browser**
   Navigate to `http://localhost:8000`

### First Steps
1. **Place Tokens**: Select a creature from the sidebar → click grid intersections
2. **Move Tokens**: Click "Move Tokens" button → drag creatures to new positions  
3. **Roll Dice**: Choose die type → set quantity → click to roll
4. **Explore**: Try zooming, panning, and resizing the grid

## 🎭 Available Creatures

| Creature | Size | Role | Special Notes |
|----------|------|------|---------------|
| 🐉 **Dragon** | Large (2x2) | Boss Enemy | Powerful winged beast |
| 💀 **Skeleton** | Medium | Undead | Classic undead warrior |
| 🧌 **Goblin** | Small | Minion | Agile and numerous |
| 👁️ **Beholder** | Large | Aberration | Multi-eyed floating terror |
| 🐙 **Mind Flayer** | Medium | Psionic | Tentacled brain eater |
| 🐂 **Minotaur** | Large | Brute | Bull-headed labyrinth guardian |
| 🧟 **Orc** | Medium | Warrior | Brutal tribal fighter |
| 🐻 **Owlbear** | Large | Beast | Ferocious owl-bear hybrid |
| 🧟‍♂️ **Troll** | Large | Giant | Regenerating mountain dweller |

## 📱 How to Use

### Token Operations
- **Placing**: Select creature type → click any grid intersection
- **Moving**: Switch to "Move Tokens" mode → drag tokens anywhere
- **Removing**: Use "Remove Tokens" mode → click tokens to delete
- **Facing**: Toggle facing direction before placing new tokens

### Dice Rolling
- **Single Die**: Select type (D4-D100) → click to roll
- **Multiple Dice**: Adjust count slider → roll multiple dice at once
- **Reading Results**: 
  - Individual rolls shown in brackets: `[3, 5, 1] = 9`
  - Color coding helps identify critical successes/failures
  - All results logged with timestamps

### Grid Controls
- **Zoom**: Mouse wheel or +/- buttons
- **Pan**: Click and drag empty grid space
- **Resize**: Use width/height controls in sidebar
- **Reset**: "Reset Zoom" button returns to default view

## 🏗️ Technical Architecture

### Project Structure
```
TavernTable/
├── index.html                    # Application entry point with accessibility features
├── README.md                     # Comprehensive documentation
├── assets/                       # Game resources
│   └── sprites/                  # Creature PNG files
├── src/                         # Source code (Clean ES6 modules)
│   ├── config/
│   │   └── GameConstants.js     # Centralized configuration and constants
│   ├── core/
│   │   ├── GameManager.js       # Main game controller with error handling
│   │   └── SpriteManager.js     # Asset loading and management
│   ├── entities/
│   │   └── creatures/           # Creature token system
│   │       ├── CreatureFactory.js  # Factory pattern for creation
│   │       ├── CreatureToken.js     # Base token class with validation
│   │       └── index.js             # Global creation functions
│   ├── systems/
│   │   ├── DragController.js    # Token drag-and-drop system
│   │   └── dice/                # Dice rolling mechanics
│   │       ├── dice.js              # Main rolling logic
│   │       └── diceLog.js           # Roll history management
│   ├── ui/
│   │   ├── UIController.js      # Interface management with validation
│   │   └── styles.css           # Application styling
│   └── utils/                   # Utility modules (NEW)
│       ├── ErrorHandler.js      # Centralized error management
│       └── Validation.js        # Input validation and sanitization
├── tools/                       # Development configurations
└── .github/                     # Project documentation
    └── copilot-instructions.md  # Coding standards and guidelines
```

### Design Patterns & Architecture
- **ES6 Modules**: Clean import/export structure for maintainability
- **Factory Pattern**: Consistent creature creation via `CreatureFactory`
- **Singleton Pattern**: Global managers for game state and assets
- **Observer Pattern**: Event-driven communication between systems
- **Error Handling**: Comprehensive try-catch with user-friendly messages
- **Input Validation**: Sanitization and type checking throughout
- **Centralized Configuration**: Constants management for magic numbers
- **Accessibility**: ARIA labels and screen reader support
- **Component Architecture**: Modular systems with clear responsibilities

### Key Technologies
- **PIXI.js**: Hardware-accelerated 2D rendering engine
- **Vanilla JavaScript**: Pure ES6+ without external frameworks
- **CSS3**: Modern styling with flexbox and grid layouts
- **HTML5**: Semantic markup and canvas integration

## 🛠️ Development

### Code Quality
- **ESLint**: Automated code style enforcement
- **JSDoc**: Comprehensive inline documentation
- **Modular Design**: Clear separation of concerns
- **Error Handling**: Graceful fallbacks for missing assets

### Adding New Features

#### New Creatures
1. Add sprite image to `assets/sprites/` (e.g., `phoenix-sprite.png`)
2. Update `src/config/GameConstants.js` with sprite mapping
3. Add creation function in `src/entities/creatures/index.js`
4. Add UI button in `index.html`
5. Test with both sprite and fallback graphics

#### New Game Systems
1. Create module in appropriate `src/systems/` subdirectory
2. Import and integrate in `GameManager.js`
3. Expose necessary functions globally if needed by HTML
4. Update documentation and README

### Browser Compatibility
- **Recommended**: Chrome 90+, Firefox 88+, Safari 14+
- **Required Features**: ES6 modules, PIXI.js support, modern CSS
- **Known Issues**: Touch devices have basic support (mouse-optimized)

## 🔧 Configuration

### Game Settings
Edit `src/config/GameConstants.js` to customize:
- Creature sprite paths and scaling
- Grid appearance and behavior
- Default game parameters
- Asset loading preferences

### Visual Customization
Modify `src/ui/style.css` for:
- Color schemes and themes
- Layout and spacing
- Control panel appearance
- Animation timing

## ❓ Troubleshooting

### Common Issues

**"Module not found" errors**
- Ensure you're using an HTTP server, not opening `file://` directly
- Check that all file paths use forward slashes
- Verify ES6 module support in your browser

**Sprites not loading**
- Check that PNG files exist in `assets/sprites/`
- Verify file names match `GameConstants.js` entries
- Fallback colored shapes should appear if sprites fail

**Performance issues**
- Try reducing grid size for better performance
- Close other browser tabs using significant resources
- Update to a modern browser version

### Debug Mode
Open browser console to see:
- Sprite loading status
- Token placement coordinates
- Error messages and warnings
- Performance timing information

## 🤝 Contributing

We welcome contributions! Please:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Follow** existing code style and patterns
4. **Test** across different browsers and screen sizes
5. **Document** any new features or changes
6. **Submit** a pull request with clear description

### Development Setup
```bash
git clone <your-fork>
cd TavernTable
python -m http.server 8000
# Open http://localhost:8000 and start developing
```


## � Recent Development Updates

### Code Quality Improvements (August 2025)
Our recent comprehensive cleanup follows strict coding standards for maintainability and reliability:

#### ✅ **Architectural Enhancements**
- **Centralized Configuration**: Consolidated all magic numbers and constants into `GameConstants.js`
- **Error Handling System**: Implemented comprehensive `ErrorHandler.js` with user-friendly notifications
- **Input Validation**: Added robust `Validation.js` utilities with type checking and sanitization
- **Modular Design**: Enhanced ES6 module structure with clear separation of concerns

#### ✅ **Code Standards Applied**
- **JSDoc Documentation**: Comprehensive inline documentation for all modules
- **Error Recovery**: Graceful fallbacks and user-friendly error messages throughout
- **Input Sanitization**: Protection against invalid data with helpful validation feedback
- **Accessibility**: ARIA labels and screen reader support in UI components

#### ✅ **Files Enhanced**
- `GameManager.js` - Main controller with centralized error handling
- `UIController.js` - Interface management with input validation
- `CreatureToken.js` - Token system with comprehensive error recovery
- `dice.js` & `diceLog.js` - Dice system with validation and constants
- `DragController.js` - Drag-and-drop with proper event handling
- `index.html` - Accessibility improvements and semantic structure

#### ✅ **Infrastructure**
- Removed duplicate directory structures for cleaner organization
- Eliminated legacy `GameConfig.js` in favor of modular `GameConstants.js`
- Updated all documentation to reflect new architecture
- Ensured backward compatibility while modernizing codebase

---

## �🙏 Acknowledgments

- **PIXI.js** team for the excellent 2D rendering library
- **D&D Community** for inspiration and feedback
- **Contributors** who help improve the project

---

**TavernTable** - Making digital D&D as engaging as the tabletop experience.

*Built with ❤️ for the tabletop gaming community*
