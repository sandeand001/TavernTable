# Taverntable — Code Conventions

This document defines the structural and organizational rules for every file and
directory under `src/`. Its purpose is to eliminate duplicate code, prevent
overlapping responsibility, and make the codebase navigable at a glance.

> **Rule of thumb**: If you have to search for where something lives, the
> structure is wrong.

---

## 1. Directory Layout

### 1.1 Top-Level `src/` Domains

Each top-level directory owns a single concern:

| Directory | Responsibility |
|-----------|---------------|
| `config/` | Pure data: constants, palettes, lookup tables. No logic. |
| `coordinators/` | Orchestration façades that wire managers + scene together. |
| `core/` | Application bootstrap and cross-cutting singletons (`GameManager`, `ModelAssetCache`). |
| `entities/` | Domain objects (tokens, creatures, items). |
| `managers/` | 2D/PIXI state owners — grid, terrain tiles, tokens, interaction. |
| `scene/` | 3D/Three.js rendering — scene graph, cameras, lighting, 3D adapters. |
| `systems/` | Self-contained subsystems (dice, drag). |
| `terrain/` | Terrain generation, painting, elevation, biome logic. |
| `ui/` | DOM/HTML controllers, sidebars, menus, CSS. |
| `utils/` | Generic helpers with **zero domain knowledge**. |

### 1.2 Subdirectory Rules

| Scenario | Pattern | Example |
|----------|---------|---------|
| A class grows beyond **~800 lines** | Create `<module-name>/internals/` alongside the class | `managers/InteractionManager.js` + `managers/interaction-manager/internals/` |
| A directory has **> 6 files** | Group by sub-concern into subdirectories | `scene/` → `scene/terrain/`, `scene/camera/`, `scene/token-adapter/` |
| Pure data / config lives next to logic | Move it to `config/` or a scoped `config/` subdir | `FloraProfiles.js` → `config/terrain/FloraProfiles.js` |
| A file is a thin re-export shim | Delete it; update importers to point at the real module | deprecated `managers/BiomeCanvasPainter.js` |
| A directory is empty | Delete it | `core/model-cache/`, `scene/assets/` |

### 1.3 `internals/` Folders

When a large class is decomposed, extracted helpers go into an `internals/`
folder named after the parent module:

```
managers/
  InteractionManager.js          ← class (façade, ≤ ~800 lines)
  interaction-manager/
    internals/
      pan.js                     ← extracted helper functions
      zoom.js
      picking.js
      keyboard.js
      rotation.js
```

**Rules for `internals/` files:**

- Each file exports **plain functions** (not classes).
- Functions that need access to the parent class receive `(context, ...)` as
  the first argument, where `context` is `this` from the parent class.
- The parent class imports these and delegates via thin wrapper methods.
- `internals/` files must **not** import from the parent class (no circular deps).

### 1.4 Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Class files | PascalCase matching the class name | `TokenManager.js` |
| Function-export files | camelCase or kebab-case describing the concern | `pan.js`, `placeables-positioning.js` |
| Config/data files | PascalCase describing the data | `BiomePalettes.js`, `TerrainPlaceables.js` |
| Barrel re-exports | `index.js` | `entities/creatures/index.js` |
| Generated files | `.generated.js` suffix | `d20FaceCenters.generated.js` |
| Test files | `<SourceName>.test.js` in `tests/unit/` mirroring `src/` path | `tests/unit/managers/TokenManager.test.js` |

---

## 2. In-File Organization

Every file follows the same top-to-bottom ordering convention. The goal is that
any developer can open a file and immediately find what they need.

### 2.1 Section Comment Format

Use horizontal-rule section comments to delimit groups:

```js
// ── Section Name ────────────────────────────────────────────
```

Every file with more than ~5 functions or methods **must** have section comments.

### 2.2 Module Files (Function Exports)

```
1. Imports
2. ── Constants / Config ──
3. ── Public API ──              (exported functions)
4. ── Private Helpers ──         (unexported functions)
```

### 2.3 Class Files

```
1. Imports
2. ── Constants ──               (module-level constants)
3. Class declaration
   a. ── Constructor ──
   b. ── Lifecycle ──            (attach, init, dispose, destroy)
   c. ── Public API ──           (methods called by other modules)
   d. ── Event Handlers ──       (onX, handleX methods)
   e. ── Private Helpers ──      (internal methods, prefixed with _)
   f. ── Accessors ──            (getters, setters, backward-compat shims)
4. ── Mixin Installation ──     (prototype assignments, if any)
5. Export statement
```

### 2.4 Config / Data Files

```
1. Imports (if any)
2. ── Constants ──
3. ── Data Tables ──             (maps, arrays, lookup objects)
4. ── Derived Constants ──       (computed from data above)
5. Export statement
```

### 2.5 Ordering Within Sections

Within each section, methods should be ordered by **call hierarchy**:
higher-level methods first, lower-level helpers they call after.

---

## 3. Module Patterns

### 3.1 When to Use Classes vs Plain Functions

| Use a **class** when | Use **plain function exports** when |
|----------------------|-------------------------------------|
| The module owns persistent state | The module is stateless |
| There is a clear lifecycle (init → use → dispose) | Functions are called independently |
| The module is injected or wired by a coordinator | Logic is extracted from a class into `internals/` |

### 3.2 Export Style

| Pattern | When to use |
|---------|------------|
| `export default class Foo` | One class per file |
| `export function foo()` | Multiple named function exports |
| `export default { fn1, fn2 }` | **Avoid** — prefer named exports for tree-shaking |
| `export { instance as default }` | Singletons only (`ErrorHandler`, `GameManager`) |

### 3.3 Import Hygiene

- Import only what you use. No wildcard (`*`) imports.
- Group imports in this order:
  1. Third-party libraries (`three`, `pixi.js`)
  2. Config / constants
  3. Same-domain siblings
  4. Cross-domain imports
- Separate groups with a blank line.

---

## 4. Responsibility Boundaries

### 4.1 No Overlapping Functionality

Every piece of functionality must live in **exactly one place**.

Before adding a new function, search for existing implementations:
- Coordinate conversion → `utils/CoordinateUtils.js` or `utils/ProjectionUtils.js`
- Color manipulation → `utils/ColorUtils.js`
- Container/PIXI helpers → `utils/ContainerUtils.js`
- Validation → `utils/Validation.js` (general) or `utils/TerrainValidation.js` (terrain-specific)
- Error handling → `utils/ErrorHandler.js`
- Logging → `utils/Logger.js`

### 4.2 Config Stays in `config/`

If a constant, palette, lookup table, or profile definition is **not
co-located** with code that exclusively uses it, it belongs in `config/`.

Exceptions: enums tightly coupled to a single subsystem (e.g.,
`utils/error/enums.js`) may stay next to their consumer.

### 4.3 `utils/` Has No Domain Knowledge

Files in `utils/` must not import from `managers/`, `scene/`, `coordinators/`,
`terrain/`, or `entities/`. If a "utility" needs domain context, it belongs in
the domain directory instead.

---

## 5. Target Directory Structure

This is the intended structure after all reorganization is complete:

```
src/
├── config/
│   ├── biome/                   ← BiomeConstants, BiomePalettes, BiomePalettes3D, BiomePalettes3DHarmonized, PaletteDesign
│   ├── terrain/                 ← TerrainConstants, TerrainPlaceables, FloraProfiles
│   ├── GameConstants.js
│   └── TokenCommandConfig.js
│
├── coordinators/
│   ├── InputCoordinator.js
│   ├── RenderCoordinator.js
│   ├── StateCoordinator.js
│   ├── TerrainCoordinator.js
│   └── terrain-coordinator/
│       ├── (6 controller files)
│       └── internals/           ← (grouped sub-concerns)
│           ├── activation/      ← apply.js, init.js, mode.js, reset.js, state.js
│           ├── brush/           ← brush.js, inputs.js, tools.js
│           ├── rendering/       ← biome.js, color.js, baseGridUpdates.js
│           ├── spatial/         ← coords.js, height.js, resize.js
│           ├── container.js
│           ├── deps.js
│           ├── flora.js
│           └── validation.js
│
├── core/
│   ├── GameManager.js
│   ├── ModelAssetCache.js
│   └── ModelPostProcessing.js
│
├── entities/
│   └── creatures/
│       ├── CreatureFactory.js
│       ├── CreatureToken.js
│       └── index.js
│
├── managers/
│   ├── GridRenderer.js
│   ├── InteractionManager.js
│   ├── TerrainManager.js
│   ├── TokenManager.js
│   ├── grid-renderer/internals/
│   ├── interaction-manager/internals/
│   ├── terrain-manager/internals/
│   └── token-manager/internals/
│
├── scene/
│   ├── camera/                  ← CameraRig.js, CameraSystem.js
│   ├── lighting/                ← LightingSystem.js
│   ├── grid/                    ← GridOverlay.js
│   ├── terrain/                 ← TerrainMeshBuilder.js, TerrainRebuilder.js, TerrainMaterialFactory.js, TerrainBrushOverlay3D.js, PlaceableMeshPool.js, PlaceablePoolLifecycle.js
│   │   └── brush/               ← OverlayMeshPool.js, OverlayOutlinePool.js
│   ├── token-adapter/           ← AnimationController.js, MannequinConfig.js, MeshFactory.js, SelectionEffects.js
│   ├── picking/                 ← PickingService.js, SpatialCoordinator.js
│   ├── ThreeSceneManager.js
│   └── Token3DAdapter.js
│
├── systems/
│   ├── DragController.js
│   └── dice/
│       ├── (dice subsystem files)
│       └── d20FaceCenters.generated.js
│
├── terrain/
│   ├── generation/              ← BiomeElevationGenerator.js, NoisePrimitives.js
│   ├── painting/                ← BiomeCanvasPainter.js + biome-painter/ contents
│   ├── brush/                   ← TerrainBrushController.js, TerrainBrushHighlighter.js, BrushCommon.js
│   ├── TerrainDataStore.js
│   └── TerrainFacesRenderer.js
│
├── ui/
│   ├── components/              ← RadialMenu.js
│   ├── controls/                ← Hybrid3DControls.js, HybridRenderToggle.js, SettingsViewToggle.js
│   ├── lib/                     ← elevationUtils.js, spriteKeys.js
│   ├── domHelpers.js
│   ├── SidebarController.js
│   ├── UIController.js
│   └── styles.css
│
└── utils/
    ├── canvas/                  ← CanvasShapeUtils.js
    ├── color/                   ← ColorUtils.js
    ├── coordinates/             ← CoordinateUtils.js, ProjectionUtils.js
    ├── error/                   ← ErrorHandler.js, enums.js, notification.js, telemetry.js
    ├── geometry/                ← GeometryUtils.js, DepthUtils.js
    ├── logger/                  ← Logger.js, enums.js
    ├── terrain/                 ← TerrainHeightUtils.js, TerrainValidation.js, ContainerUtils.js
    ├── env.js
    ├── SeededRNG.js
    └── Validation.js
```

---

## 6. Dead Code & Deprecation Policy

- **Dead code** (zero importers) must be deleted immediately, not commented out.
- **Deprecated shims** (re-export wrappers for moved files) may exist for one
  release cycle, then must be deleted and all importers updated.
- **Empty directories** must be deleted.
- **Stub files** (< 5 lines, no real logic) must be deleted or merged.

---

## 7. Applying These Conventions

When modifying any file:

1. Check if section comments exist. If not, add them.
2. Check method ordering matches §2.3. If not, reorder.
3. Check imports match §3.3. If not, reorder.
4. Check for duplicate logic across files. If found, consolidate into the
   canonical location (§4.1).

When creating a new file:

1. Determine which domain directory it belongs to (§1.1).
2. Check if the target directory exceeds 6 files. If so, create a subdirectory.
3. Apply section comments from the start.
4. Follow the export pattern from §3.2.
