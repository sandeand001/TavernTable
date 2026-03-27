# TavernTable

> **Status: Active Development** — TavernTable is being transitioned from a 2D/Pixi.js engine to a fully 3D Three.js renderer. Some legacy 2D code remains in the codebase and is being incrementally removed. See [Legacy / Roadmap](#legacy--roadmap) below.

An interactive, browser-based virtual tabletop for D&D and other tabletop RPGs. TavernTable renders an isometric grid with 3D terrain, placeable flora, procedural biomes, and a physics-based d20 — all running client-side with zero build step.

<!--
TODO: Add a screenshot here once available
![TavernTable Screenshot](docs/screenshot.png)
-->

## Features

### Isometric Grid
- Configurable grid from 5×5 up to 50×50 tiles (default 25×25)
- Diamond-tile isometric projection (64×32 px tiles)
- Smooth zoom (0.35×–3.0×) and pan controls
- Switchable camera: **Isometric** (35.26° classic) or **Top-Down** (overhead)

### Tokens
- **Mannequin** — the current token model, a humanoid figure with an extensive FBX animation library (60+ animations including idle, walk, run, climb, jump, combat stances, and more)
- Click to place, drag to reposition
- Removal mode for clearing tokens
- Animated via Three.js; intended to serve as the base for all future character tokens

### Terrain System
- **Elevation** from -10 to +10 height levels with visual depth
- Raise/Lower brush tools with configurable brush size (1×1 to 5×5)
- Adjustable elevation perception slider
- **Placeable 3D flora**: trees (birch, cherry blossom, common, dead, giant pine, pine, twisted, tall thick), bushes, ferns, flowers, grass, mushrooms, clovers, pebbles, rocks, and tropical plants
- Placeable removal mode

### 50+ Procedural Biomes
Biomes across 10 environment groups — each with unique color palettes and auto-generated flora:

| Group | Biomes |
|---|---|
| **Common** | Grassland, Hills, Temperate Forest, Conifer Forest, Savanna, Steppe |
| **Desert** | Hot Desert, Cold Desert, Sand Dunes, Oasis, Salt Flats, Thornscrub |
| **Arctic** | Tundra, Glacier, Frozen Lake, Pack Ice |
| **Mountain** | Mountain, Alpine, Scree Slope, Cedar Highlands, Geyser Basin |
| **Wetlands** | Swamp, Wetlands, Floodplain, Blood Marsh, Mangrove |
| **Aquatic** | Coast, River/Lake, Ocean, Coral Reef |
| **Forest Variants** | Dead Forest, Petrified Forest, Bamboo Thicket, Orchard, Mystic Grove, Feywild Bloom, Shadowfell Forest |
| **Underground** | Cavern, Fungal Grove, Crystal Fields, Crystal Spires, Eldritch Rift |
| **Volcanic** | Volcanic, Obsidian Plain, Ash Wastes, Lava Fields |
| **Exotic** | Wasteland, Ruined Urban, Graveyard, Astral Plateau, Arcane Ley Nexus |

### 3D Dice (Work in Progress)
- **d20** — the only functional die, rendered as a gold GLB model with ricochet physics (up to 4 bounces), deterministic face mapping, and critical hit/fail tinting (green for nat 20, red for nat 1)
- Dice roll history log with clear function
- UI buttons for d4–d100 exist but only the d20 has a 3D implementation; remaining dice are planned

### 3D Rendering
- Three.js orthographic scene with dynamic lighting
- **Day/night sun cycle** via time-of-day slider (full 24h range)
- Ambient + hemisphere + directional lighting with shadow maps
- Optional wireframe grid overlay
- Live FPS and frame-time stats display

### Accessibility
- Semantic HTML with ARIA labels on all interactive elements
- Keyboard-navigable controls
- Screen-reader-friendly dice results (`aria-live` regions)

## Tech Stack

| Layer | Technology |
|---|---|
| 3D Rendering | [Three.js](https://threejs.org/) v0.170 |
| Language | Vanilla JavaScript (ES Modules) |
| Module Loading | Native `<script type="importmap">` — no bundler |
| Testing | [Jest](https://jestjs.io/) 30 + jsdom |
| Linting | ESLint 8 + Stylelint 16 + Prettier 3 |
| Git Hooks | Husky + lint-staged |
| Dev Server | Python `http.server` (static files) |

**No build step.** The app runs directly in the browser via native ES module imports with an import map pointing to CDN-hosted Three.js.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (for tooling and tests)
- [Python 3](https://www.python.org/) (for the dev server)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/<your-username>/taverntable.git
cd taverntable

# Install dev dependencies
npm install

# Start the dev server
npm start
# → http://localhost:3000
```

### Open in Browser
Navigate to `http://localhost:3000`. No build needed — the app loads directly.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start dev server on port 3000 |
| `npm test` | Run full Jest test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Lint JS (ESLint) and CSS (Stylelint) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run lint:layers` | Enforce architecture layering rules |
| `npm run format` | Auto-format with Prettier |

## Architecture

TavernTable uses a **coordinator pattern** to keep the codebase modular without a framework:

```
src/
├── config/
│   ├── biome/              # BiomeConstants, BiomePalettes (2D/3D/Harmonized), PaletteDesign
│   └── terrain/            # TerrainConstants, TerrainPlaceables, FloraProfiles
├── coordinators/
│   ├── terrain-coordinator/ # TerrainCoordinator + controller files + internals/
│   ├── InputCoordinator.js
│   ├── RenderCoordinator.js
│   └── StateCoordinator.js
├── core/                   # GameManager — central bootstrap and lifecycle
├── entities/creatures/     # CreatureToken, CreatureFactory
├── managers/
│   ├── grid-renderer/      # GridRenderer + internals/
│   ├── interaction-manager/ # InteractionManager + internals/ (keyboard, pan, picking, rotation, zoom)
│   ├── terrain-manager/    # TerrainManager + internals/ (tiles, placeables, sorting, updates)
│   └── token-manager/      # TokenManager + internals/ (placement, selection, facing, creatures)
├── scene/
│   ├── camera/             # CameraRig, CameraSystem
│   ├── grid/               # GridOverlay
│   ├── lighting/           # LightingSystem
│   ├── picking/            # PickingService, SpatialCoordinator
│   ├── terrain/            # TerrainMeshBuilder, TerrainRebuilder, PlaceableMeshPool, overlays
│   ├── token-adapter/      # MannequinConfig, AnimationController, MeshFactory, SelectionEffects
│   ├── ThreeSceneManager.js
│   └── Token3DAdapter.js
├── systems/
│   ├── dice/               # DicePhysics, DiceState, DiceModelManager, DiceAnimationScheduler
│   └── DragController.js
├── terrain/
│   ├── brush/              # TerrainBrushController, TerrainBrushHighlighter, BrushCommon
│   ├── generation/         # BiomeElevationGenerator, NoisePrimitives
│   ├── painting/           # BiomeCanvasPainter + biome-painter/ (motifs, fields, etc.)
│   └── TerrainDataStore.js
├── ui/
│   ├── components/         # RadialMenu
│   ├── controls/           # Hybrid3DControls, HybridRenderToggle, SettingsViewToggle
│   ├── UIController.js
│   └── SidebarController.js
└── utils/
    ├── canvas/             # CanvasShapeUtils
    ├── color/              # ColorUtils
    ├── coordinates/        # CoordinateUtils, ProjectionUtils
    ├── error/              # notification, telemetry
    ├── geometry/           # GeometryUtils, DepthUtils
    ├── terrain/            # TerrainHeightUtils, TerrainValidation, ContainerUtils
    ├── ErrorHandler.js
    ├── Logger.js
    └── Validation.js
```

### Key Design Decisions
- **Enforced layering**: A pre-commit hook (`lint:layers`) ensures non-UI code never imports UI modules
- **No framework**: Vanilla JS with a clear coordinator/manager/system hierarchy
- **No bundler**: Import maps resolve bare specifiers to CDN — keeps iteration instant
- **60% coverage floor**: Jest coverage thresholds enforced on branches, functions, lines, and statements

## Testing

70+ unit tests across the full stack:

```bash
npm test
```

Tests cover terrain mesh building, token placement and dragging, coordinate math, biome generation, dice rolling, camera modes, UI controllers, elevation systems, placeable persistence, and more.

Coverage reports are generated to `coverage/` when running `npm run test:coverage`.

## Project Structure

```
Taverntable/
├── index.html              # Single-page app entry point
├── package.json            # Dependencies and scripts
├── jest.config.js          # Test configuration
├── CONVENTIONS.md          # Code organization specification
├── ROADMAP.md              # Refactor progress tracker
├── assets/
│   ├── animated-sprites/   # Mannequin FBX animations (60+)
│   ├── Items/              # 3D models (d20-gold.glb)
│   ├── sprites/            # Mannequin FBX model, legacy defeated-doll sprite
│   └── terrain/
│       └── 3d Assets/      # glTF/FBX flora models (trees, bushes, rocks, flowers, etc.)
├── src/                    # Application source (ES modules, see Architecture above)
├── tests/                  # Jest unit tests (70 suites, 185 tests)
└── tools/                  # Dev utilities (layering checker, cycle scanner, unused export finder)
```

## Legacy / Roadmap

TavernTable originally used Pixi.js for 2D isometric rendering. The codebase has been through a major refactor (Phases 1–10) that removed dead creature types, legacy 2D assets, orphaned code, and reorganized the directory structure. The remaining migration work:

| Area | Remaining Work | Status |
|---|---|---|
| **PIXI.js renderer** | RenderCoordinator still creates a `PIXI.Application`; grid, terrain tiles, and containers use PIXI graphics | Phase 11 — full Three.js migration |
| **CreatureToken** | Uses `PIXI.Graphics` as a position handle in the container tree | Phase 11 — replace with Three.js Object3D |
| **Dice (d4–d12, d100)** | UI buttons exist but only the d20 has a 3D implementation | Planned |

## License

MIT
