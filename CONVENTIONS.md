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

| Directory       | Responsibility                                                                         |
| --------------- | -------------------------------------------------------------------------------------- |
| `config/`       | Pure data: constants, palettes, lookup tables. No logic.                               |
| `coordinators/` | Orchestration façades that wire managers + scene together.                             |
| `core/`         | Application bootstrap and cross-cutting singletons (`GameManager`, `ModelAssetCache`). |
| `entities/`     | Domain objects (tokens, creatures, items).                                             |
| `managers/`     | Token placement, selection, and input interaction state.                               |
| `scene/`        | Three.js rendering — scene graph, cameras, lighting, mesh pools, and adapters.         |
| `systems/`      | Self-contained subsystems (dice, drag).                                                |
| `terrain/`      | Terrain generation, painting, elevation, biome logic.                                  |
| `ui/`           | DOM/HTML controllers, sidebars, menus, CSS.                                            |
| `utils/`        | Generic helpers with **zero domain knowledge**.                                        |

### 1.2 Subdirectory Rules

| Scenario                               | Pattern                                                 | Example                                                                      |
| -------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A class grows beyond **~800 lines**    | Create `<module-name>/internals/` alongside the class   | `managers/InteractionManager.js` + `managers/interaction-manager/internals/` |
| A directory has **> 6 files**          | Group by sub-concern into subdirectories                | `scene/` → `scene/terrain/`, `scene/camera/`, `scene/token-adapter/`         |
| Pure data / config lives next to logic | Move it to `config/` or a scoped `config/` subdir       | `FloraProfiles.js` → `config/terrain/FloraProfiles.js`                       |
| A file is a thin re-export shim        | Delete it; update importers to point at the real module | deprecated `managers/BiomeCanvasPainter.js`                                  |
| A directory is empty                   | Delete it                                               | `core/model-cache/`, `scene/assets/`                                         |

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

These general extraction patterns do not override accepted
[architecture decisions](./docs/adr/). In particular, ADR-0001 calls for a deep
terrain module and a wiring-only coordinator, not another pass-through facade.

### 1.4 Naming Conventions

| Item                  | Convention                                                    | Example                                    |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Class files           | PascalCase matching the class name                            | `TokenManager.js`                          |
| Function-export files | camelCase or kebab-case describing the concern                | `pan.js`, `placeables-positioning.js`      |
| Config/data files     | PascalCase describing the data                                | `BiomePalettes.js`, `TerrainPlaceables.js` |
| Barrel re-exports     | `index.js`                                                    | `entities/creatures/index.js`              |
| Generated files       | `.generated.js` suffix                                        | `d20FaceCenters.generated.js`              |
| Test files            | `<SourceName>.test.js` in `tests/unit/` or `tests/integration/`, mirroring `src/` path | `tests/unit/managers/TokenManager.test.js` |

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

| Use a **class** when                              | Use **plain function exports** when               |
| ------------------------------------------------- | ------------------------------------------------- |
| The module owns persistent state                  | The module is stateless                           |
| There is a clear lifecycle (init → use → dispose) | Functions are called independently                |
| The module is injected or wired by a coordinator  | Logic is extracted from a class into `internals/` |

### 3.2 Export Style

| Pattern                          | When to use                                       |
| -------------------------------- | ------------------------------------------------- |
| `export default class Foo`       | One class per file                                |
| `export function foo()`          | Multiple named function exports                   |
| `export default { fn1, fn2 }`    | **Avoid** — prefer named exports for tree-shaking |
| `export { instance as default }` | Singletons only (`ErrorHandler`, `GameManager`)   |

### 3.3 Mixin Installer Pattern

When a large class is decomposed via **prototype mixin installers** (instead of
the `internals/` pattern), each extracted file exports a single `installXMethods`
function that receives the class prototype and assigns methods to it:

```js
// token-adapter/movement/ClimbPhases.js
export function installClimbMethods(prototype) {
  prototype._startClimb = function (state) {
    /* ... */
  };
  prototype._finishClimb = function (state) {
    /* ... */
  };
}
```

The parent class imports and calls these installers after the class definition:

```js
installClimbMethods(Token3DAdapter.prototype);
```

**Rules for mixin files:**

- Each file exports exactly **one** `installXMethods(prototype)` function.
- Mixin files may import from sibling config files (e.g., `MannequinConfig.js`).
- Mixin files must **not** import from the parent class file.

### 3.4 Import Hygiene

- Import only what you use. No wildcard (`*`) imports.
- Group imports in this order:
  1. Third-party libraries (`three`)
  2. Config / constants
  3. Same-domain siblings
  4. Cross-domain imports
- Separate groups with a blank line.

---

## 4. Responsibility Boundaries

### 4.1 No Overlapping Functionality

Every piece of functionality must live in **exactly one place**.

Before adding a new function, search for existing implementations:

- Coordinate conversion → [CoordinateUtils](./src/utils/coordinates/CoordinateUtils.js)
- Color manipulation → [ColorUtils](./src/utils/color/ColorUtils.js)
- Legacy container compatibility → [ContainerUtils](./src/utils/terrain/ContainerUtils.js)
- Validation → [Validation](./src/utils/Validation.js) (general) or
  [TerrainValidation](./src/utils/terrain/TerrainValidation.js) (terrain-specific)
- Error handling → [ErrorHandler](./src/utils/error/ErrorHandler.js)
- Logging → [Logger](./src/utils/logger/Logger.js)

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

## 5. Current Structure and Terrain Direction

See the [README](./README.md#project-layout) for the project layout and the
[backlog](./TODO.md) for unfinished work. Do not maintain a second exhaustive
file inventory here; it becomes misleading when files are moved or removed.

- [GameManager](./src/core/GameManager.js) coordinates application startup and
  currently constructs both the terrain engine and the legacy coordinator.
- [scene](./src/scene/) owns Three.js rendering, including terrain geometry,
  token animation, picking, and instanced placeables.
- [terrain](./src/terrain/) contains the engine, height storage, brush logic,
  generation, and flora helpers.
- [ui](./src/ui/) owns DOM controls and presentation.
- [config/token-adapter](./src/config/token-adapter/) contains mannequin models
  and movement configuration; it is separate from the rendering implementation.

The PIXI renderer and its GridRenderer, TerrainManager, and RenderCoordinator
modules have been removed. Remaining compatibility helpers and legacy test
fixtures do not imply that the old renderer is still supported.

[ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md) remains the accepted
terrain direction: one state-owning engine, outbound events, and external
rendering adapters. That migration is **not complete**. The live
[TerrainCoordinator](./src/coordinators/TerrainCoordinator.js) still has a
separate height store and a broad compatibility interface.

Complete the caller and event migration with integration tests before removing
those compatibility paths. A smaller coordinator or more extracted wrappers is
not evidence that the ownership problem is solved.

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
