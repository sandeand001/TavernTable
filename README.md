# TavernTable
### 🎲 Modern Web-Based D&D Tactical Combat Simulator

A sophisticated browser-based tactical combat grid for tabletop RPGs, featuring an advanced isometric battlefield with interactive creature tokens, animated dice rolling system, and comprehensive game management tools.

![TavernTable Preview](assets/preview.png) *Dynamic isometric grid with creature tokens and dice system*

## ✨ Key Features

### 🗺️ **Advanced Combat Grid System**
- **Isometric battlefield view** with precise tactical positioning
- **Dynamic grid resizing** (10×10 to 50×50 cells) for encounters of any scale
- **Professional zoom controls** (0.25× to 4.0×) with smooth pan navigation
- **Real-time coordinate validation** ensures tokens stay within battle boundaries
- **Grid opacity controls** for optimal token visibility

### 🐉 **Comprehensive Creature Token Management**
- **9 Distinct Creature Types** with unique sprite artwork:
  - 🐲 **Dragon** - Legendary scaled beast (Large size)
  - 💀 **Skeleton** - Undead warrior minion
  - 👹 **Goblin** - Small cunning humanoid
  - 👁️ **Beholder** - Aberrant floating eye beast
  - 🏔️ **Giant** - Massive towering humanoid
  - ⚔️ **Orc** - Brutal savage warrior
  - 🦅 **Owlbear** - Ferocious hybrid predator
  - 🧌 **Troll** - Regenerating cave monster
- **Intuitive drag-and-drop placement** with automatic grid snapping
- **Smart collision detection** prevents token overlap
- **Removal mode** for quick battlefield cleanup
- **Robust sprite fallback system** (colored shapes when images unavailable)

### 🎲 **Professional Dice Rolling System**
- **Complete RPG dice collection**: D4, D6, D8, D10, D12, D20, D100
- **Animated rolling display** with smooth number transitions during roll animation
- **Multi-dice rolling** (1-10 dice per roll) for complex damage calculations
- **Intelligent result highlighting** (critical hits/misses with color coding)
- **Comprehensive dice log** with timestamps and color-coded results
- **Roll history tracking** for session review

### � **Modern User Interface**
- **Organized tabbed sidebar** with four specialized panels:
  - 📜 **Dice Log** - Complete roll history with filtering
  - 🐾 **Creatures** - Token selection and placement tools
  - 🌄 **Terrain** - Grid configuration and environment controls
  - ⚙️ **Settings** - Application preferences and customization
- **Full keyboard navigation** with accessibility support
- **Responsive design** optimized for desktop and tablet use
- **Screen reader compatibility** with semantic markup

## 🚀 Quick Start Guide

### 🌐 **Web Browser Setup (Recommended)**
```bash
# Choose your preferred local server method:

# Python 3 (most common)
python -m http.server 3000

# Node.js with npx
npx http-server -p 3000

# PHP built-in server
php -S localhost:3000

# Python 2 (legacy systems)
python -m SimpleHTTPServer 3000
```

1. **Clone/download** the repository
2. **Navigate** to the TavernTable directory
3. **Start local server** using any method above
4. **Open** http://localhost:3000 in your browser
5. **Begin your tactical encounter!**

### 🎯 **VS Code Integration**
1. Install **"Live Server"** extension
2. Right-click `index.html` → **"Open with Live Server"**
3. Automatic browser launch with hot-reload capability

## 🎮 Tactical Combat Workflow

### 🎲 **Rolling Dice Like a Pro**
1. **Select dice type** from the professional dice panel
2. **Set quantity** (1-10 dice) for damage rolls or group checks
3. **Execute roll** with smooth animated number display
4. **Review results** in the color-coded dice log
5. **Track critical outcomes** with automatic highlighting

### 🗺️ **Battlefield Management**
1. **Choose creature type** from the organized token panel
2. **Click grid cell** for precise token placement
3. **Drag tokens** for tactical repositioning during combat
4. **Remove tokens** using dedicated removal mode
5. **Adjust view** with zoom/pan for optimal battlefield oversight

### ⚙️ **Grid Customization**
1. **Resize battlefield** using width/height controls (10-50 cells)
2. **Zoom control** with mouse wheel or dedicated buttons
3. **Pan battlefield** by dragging for large encounter management
4. **Reset view** to return to optimal viewing angle
5. **Adjust transparency** for token visibility optimization

## �️ Technical Architecture

### 💻 **Modern Web Technologies**
- **ES6 Modules** - Clean dependency management and code organization
- **PIXI.js v7.x** - Hardware-accelerated 2D rendering engine
- **Vanilla JavaScript** - Lightweight, dependency-free dice system with smooth animations
- **Semantic HTML5** - Accessibility-first markup with ARIA support

### �️ **Enterprise-Grade Error Handling**
- **Comprehensive validation system** with input sanitization
- **6 Error categories** (Initialization, Rendering, Input, Sprites, Validation, Network)
- **4 Severity levels** (Info, Warning, Error, Critical)
- **User-friendly notifications** with graceful error recovery
- **Debugging support** with structured console logging

### � **Browser Compatibility**
- **Modern browsers**: Chrome 61+, Firefox 60+, Safari 11+, Edge 79+
- **ES6 module support** required
- **WebGL acceleration** recommended for optimal performance
- **Local HTTP server** mandatory (security restrictions prevent file:// usage)

## 🔧 Advanced Configuration

### 📂 **Project Structure**
```
TavernTable/
├── � index.html                    # Application entry point
├── 🎨 assets/
│   └── sprites/                     # Creature token artwork
├── 🧠 src/
│   ├── ⚙️ config/                   # Game constants and configuration
│   │   └── GameConstants.js         # Core settings and limits
│   ├── 🎮 core/                     # Main game logic
│   │   ├── GameManager.js           # Central game state controller
│   │   └── SpriteManager.js         # Asset loading and management
│   ├── 🐾 entities/                 # Game objects
│   │   └── creatures/               # Creature token system
│   ├── 🎛️ managers/                 # Specialized system managers
│   │   ├── TokenManager.js          # Token placement and tracking
│   │   ├── InteractionManager.js    # User input and events
│   │   └── GridRenderer.js          # Battlefield rendering
│   ├── 🎯 systems/                  # Game mechanics
│   │   ├── dice/                    # Animated dice rolling system
│   │   └── DragController.js        # Drag-and-drop interactions
│   ├── 🖥️ ui/                       # User interface
│   │   ├── UIController.js          # Main UI coordination
│   │   └── SidebarController.js     # Tabbed panel management
│   └── 🛠️ utils/                    # Core utilities
│       ├── ErrorHandler.js          # Centralized error management
│       ├── Validation.js            # Input validation and sanitization
│       ├── Logger.js                # Structured logging system
│       └── CoordinateUtils.js       # Grid coordinate mathematics
├── 📋 reports/                      # Documentation and templates
└── 📖 README.md
```

### 🎨 **Customization Options**

#### Adding New Creatures
1. **Place sprite** in `assets/sprites/[creature-name].png`
2. **Define constants** in `src/config/GameConstants.js`:
   ```javascript
   CREATURE_SCALES: {
     newCreature: 1.0  // Scale factor
   },
   FALLBACK_COLORS: {
     newCreature: 0xFF5733  // Hex color
   }
   ```
3. **Create factory** in `src/entities/creatures/index.js`:
   ```javascript
   export function createNewCreature() {
     return CreatureFactory.create('newCreature');
   }
   ```
4. **Add UI button** in `index.html` creature panel

#### Grid Appearance Modifications
```javascript
// src/config/GameConstants.js
export const GRID_CONFIG = {
  TILE_WIDTH: 64,        // Isometric tile width
  TILE_HEIGHT: 32,       // Isometric tile height
  DEFAULT_COLS: 20,      // Starting grid width
  DEFAULT_ROWS: 15,      // Starting grid height
  MIN_SIZE: 10,          // Minimum grid dimension
  MAX_SIZE: 50           // Maximum grid dimension
};
```
- **Single Die**: Select type (D4-D100) → click to roll
- **Multiple Dice**: Adjust count slider → roll multiple dice at once
- **Reading Results**: 
  - Individual rolls shown in brackets: `[3, 5, 1] = 9`
  - Color coding helps identify critical successes/failures
  - All results logged with timestamps

### Grid Controls
## 🔍 Debugging & Troubleshooting

### 🚨 **Common Issues & Solutions**

| Problem | Cause | Solution |
|---------|-------|----------|
| **Module not found errors** | Direct file:// access | ✅ Use HTTP server (required for ES6 modules) |
| **Sprites not loading** | Missing PNG files | ✅ Verify `assets/sprites/` contains all creature images |
| **Performance lag** | Large grid + multiple tokens | ✅ Reduce grid size or close browser tabs |
| **Zoom not working** | Mouse wheel conflicts | ✅ Use zoom buttons or check browser settings |
| **Tokens disappearing** | Grid resize boundary issue | ✅ Automatic validation removes out-of-bounds tokens |

### 🔬 **Debug Features**
Open browser console (`F12`) to access:
- **Sprite loading status** with detailed error reporting
- **Token placement coordinates** for precise positioning
- **Validation messages** with helpful error context
- **Performance metrics** for optimization analysis
- **Module loading progress** for debugging startup issues

### 📊 **Performance Optimization**
- **Grid size**: Smaller grids (10×10 to 25×25) for optimal performance
- **Token count**: Limit to 50-100 tokens for smooth interaction
- **Browser resources**: Close unnecessary tabs for better WebGL performance
- **Zoom level**: Stay within 0.5× to 2× range for best rendering

## 🤝 Contributing to TavernTable

### 🛠️ **Development Workflow**
1. **Fork repository** and create feature branch
2. **Set up development environment** with HTTP server
3. **Follow code standards**:
   - ES6+ modern JavaScript syntax
   - Comprehensive JSDoc documentation
   - 2-space indentation consistency
   - Descriptive variable/function naming
   - Error handling for all user interactions
4. **Test thoroughly** across multiple browsers
5. **Submit pull request** with detailed change description

### 📝 **Code Quality Standards**
- **Type safety**: Use validation utilities for all inputs
- **Error handling**: Implement graceful fallbacks
- **Documentation**: JSDoc comments for all public functions
- **Testing**: Manual testing across browser matrix
- **Accessibility**: Maintain WCAG 2.1 compliance

## 📄 License & Usage

This project is **open source** and free to use. Feel free to:
- ✅ Use in personal D&D campaigns
- ✅ Modify for custom game systems
- ✅ Distribute to your gaming group
- ✅ Contribute improvements back to the community

## 🎲 Ready for Epic Encounters!

TavernTable transforms your browser into a professional-grade tactical combat simulator. Whether orchestrating intricate dungeon encounters or managing epic boss battles, you now have the tools for cinematic tabletop combat.

**May your dice roll natural twenties and your tactics prove legendary!** 🏰⚔️

---

*Built with ❤️ for the tabletop RPG community*

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
