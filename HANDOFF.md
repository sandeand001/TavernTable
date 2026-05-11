# TavernTable Refactor — Session Handoff

## Project context
- **Repo:** `C:\Users\Andre\OneDrive\Desktop\Code\Taverntable\Taverntable` — personal Three.js isometric tabletop game. **NOT a git repo** (all edits are direct, no commits, no rollback).
- **User preferences:** Aggressive deletion over preservation. PIXI was already replaced by no-op stubs and rendering is now Three.js-only. Personal app — breakage during refactor is acceptable.
- **Tests:** Jest. Baseline = **186 passing / 3 failing**. The 3 failures are all in `tests/unit/scene/Token3DAdapter.test.js` (`_finishFallPhase` / fall-phase logic), are pre-existing, and **out of scope — do not touch them.**
- **Locked design:** `docs/adr/ADR-0001-terrain-engine-event-seam.md` — TerrainEngine owns all terrain state, fires events outward, has zero PIXI/Three.js imports. TerrainEngineSceneAdapter is the wiring layer to ThreeSceneManager. Don't re-litigate.
- **Run app:** `npm start` (= `python -m http.server 3000`), open `http://localhost:3000`.

## Big picture: what was done across recent sessions

### Phase 1 — TerrainEngine deep module (DONE)
- Built `src/terrain/TerrainEngine.js` (588 lines, 16 events: `tileChanged`, `heightChanged`, `brushMoved`, `brushCommitted`, `activationChanged`, `placeableChanged`, `biomeChanged`, `resized`, etc.). Zero PIXI/Three imports, owns all terrain state.
- Built `src/scene/terrain/TerrainEngineSceneAdapter.js` — subscribes to engine events, calls `threeSceneManager.requestTerrainRebuild()` / `setTerrainBrushPreview()`.
- 16/16 dedicated tests pass (`tests/unit/terrain/TerrainEngine.test.js`).
- Wired into `src/core/GameManager.js` (around line 105: `this.terrainEngine = new TerrainEngine(cols, rows)`, `this.terrainEngineSceneAdapter` exposed).
- **Do NOT modify** `TerrainEngine.js`, `TerrainEngineSceneAdapter.js`, or the ADR.

### Phase 2 — PIXI removal (DONE — 100% removed from src/)
Deleted in prior subagents:
- `src/utils/stubs/PixiStub.js` (the no-op shim)
- `src/coordinators/RenderCoordinator.js`
- `src/managers/GridRenderer.js` + `src/managers/grid-renderer/**`
- `src/managers/TerrainManager.js` + `src/managers/terrain-manager/**`
- `src/terrain/painting/BiomeCanvasPainter.js`
- `src/terrain/TerrainFacesRenderer.js`
- `src/coordinators/terrain-coordinator/ElevationVisualsController.js`
- `<script src="...PixiStub.js">` removed from `index.html`
- `<script src="./src/managers/GridRenderer.js">` removed from `index.html` (just fixed at end of this session — was causing 404)
- `global.PIXI` mock removed from `tests/setup.js`
- `src/managers/token-manager/internals/interactions.js` (was 100% PIXI sprite events)

### Phase 3 — Three.js camera migration (DONE)
Migrated pan/zoom/picking from the deleted PIXI `gridContainer` to the orthographic camera on ThreeSceneManager:
- `src/managers/interaction-manager/internals/pan.js` — pan via `camera.position` + frustum-width pixel-to-world conversion
- `src/managers/interaction-manager/internals/zoom.js` — wheel zoom via `setZoom()`/frustum, mouse-anchor-stable
- `src/managers/InteractionManager.js` — picking via `pickingService.pickGroundSync(clientX, clientY, canvas)` returns `{world, grid, token}`
- `src/coordinators/terrain-coordinator/internals/brush/inputs.js` — 2D fallback deleted, force PickingService
- `src/coordinators/StateCoordinator.js` — resetZoom/centerGrid via `threeSceneManager.reframe()` / `setZoom(1.0)`
- `src/core/GameManager.js` — dead `gridRenderer.redrawGrid()` and `renderCoordinator.centerGrid()` calls removed
- `src/systems/dice/dice3d.js` — `renderCoordinator?.camera` swapped for `threeSceneManager?.camera`
- All `gridContainer.children` iteration loops in BiomeShadingController, ActivationHelpers, ElevationScaleController, TileLifecycleController, baseGridUpdates.js, activation/apply.js, activation/generation.js, SidebarController.js — deleted (were dead 2D sprite loops).
- ~10 test fixtures updated to remove `gridContainer`/`gridRenderer` mocks.
- **Verified zero references** to `gameManager.gridContainer`, `.gridRenderer`, `.renderCoordinator` in src/ (including optional-chained guards).

### Phase 4 — Two runtime bugs fixed late in the session
**Bug A — biome generation never placed flora**: `src/coordinators/terrain-coordinator/internals/flora.js` had `if (!c?.terrainManager) return true;` (terrainManager was deleted). All `tm.placeTerrainItem(x,y,id)` calls were dead.
- Rewritten to call `gameManager.placeableMeshPool.addPlaceable(...)`.
- Updated 4 flora tests (`FloraDeterminism`, `OrchardLayout`, `DeadForestFloraComposition`, `SwampFloraDensity`) to use `placeableMeshPool` stub instead of `terrainManager` stub.

**Bug B — placeholder green squares instead of real tree models**:
- Discovery: `src/core/ModelAssetCache.js` (`class ModelAssetCache`, default export only, has `_registry` mapping `modelKey` → OBJ paths like `'common-broadleaf-1' → 'assets/terrain/3d Assets/OBJ/CommonTree_1.obj'`, and `async getModel(key)`) was **completely orphaned** — never instantiated, never imported anywhere in src/. The PIXI cleanup deleted its only consumer (was inside the deleted TerrainManager).
- `PlaceableMeshPool._createGroup` was building a `PlaneGeometry` + colored `MeshBasicMaterial` fallback (the green squares).
- **Fix applied:**
  1. `src/core/game-manager/internals/instancing.js` — instantiates `gm.modelAssetCache = new ModelAssetCache()` before creating the pool.
  2. `src/scene/terrain/PlaceableMeshPool.js` — `_createGroup` now: if `placeable.modelKey` set, `await gameManager.modelAssetCache.getModel(modelKey)`, traverses returned Object3D for first Mesh, uses its geometry+material for the InstancedMesh. Falls back to colored placeholder on error/missing key. Updated `_deriveKey` to prefer `modelKey`. Updated `_resolveWorldScale` for `'model'` profile (identity scale — OBJ models are pre-normalized by `ModelPostProcessing._autoScaleModel`).
  3. `src/coordinators/terrain-coordinator/internals/flora.js` — imports `TERRAIN_PLACEABLES`; on each `addPlaceable`, looks up `def.modelKey` and passes `{ type: 'plant', variantKey: modelKey, modelKey, placeableId: id, gridX, gridY }`.

**Bug C — wrong token-drag implementation (REVERTED)**: A prior subagent wrongly added right-click-drag-to-move on tokens. User clarified this was wrong — the existing animation system (walking/running/climbing animations via `Token3DAdapter.navigateToGrid` → `Navigation.js`, `MovementPhases.js`, `ClimbPhases.js`, `FallPhases.js`, `AnimationController.js`) is the correct UX. It's already wired in `InteractionManager.js` line ~361: select token (left-click) → click destination (left-click) → animated path.
- Reverted: removed `_draggingToken`, `_updateTokenDrag`, `_stopTokenDrag`, `setTokenGridPosition`. `_startRightButtonDrag` simplified to camera-rotation only.

### Final fixes at end of session (just done)
1. `src/core/game-manager/internals/instancing.js` line 8 — changed `import { ModelAssetCache }` to `import ModelAssetCache` (it's a default export).
2. `index.html` line 312 — removed dead `<script src="./src/managers/GridRenderer.js">` causing 404.

## Current state
- Tests: 186 passing / 3 pre-existing fall-phase failures
- App runs in browser. **User has not yet retested after the two final fixes** above — needs verification.
- Zero PIXI references in src/.
- 3D model loading wired (OBJ via ModelAssetCache → InstancedMesh in PlaceableMeshPool).
- Animation-based token movement is the only token-movement path.

## Known caveats
- **FBX models** (`tropical-palm-a`, `tropical-palm-b`, `tropical-bush-a`, etc. defined in `src/config/terrain/TerrainPlaceables.js`) go through the same `getModel` path; ModelAssetCache handles FBX internally but if FBXLoader isn't available in-browser, those fall back to the green placeholder.
- **Per-species scale** is identity (1,1,1) for `profile='model'` — relies on `ModelPostProcessing._autoScaleModel` having pre-normalized things. A `TODO` is left in `_resolveWorldScale` for per-species tuning once assets are calibrated in-browser.
- **TerrainCoordinator** at `src/coordinators/TerrainCoordinator.js` is still **715 lines / 81 methods**. ADR-0001 says it should collapse to ~30 lines of pure wiring. A prior subagent falsely claimed Phase 5 (this collapse) was done — verify with `(Get-Content TerrainCoordinator.js).Count` if you trust subagent reports.

## Pending todos (in SQL `todos` table)
| id | title | status |
|---|---|---|
| `terrain-coordinator-rewrite` | Collapse TerrainCoordinator (715→~30 lines) | pending |
| `terrain-mesh-sidefaces` | Add side-face geometry to TerrainMeshBuilder | pending |
| `terrain-mesh-elevation-shadows` | Add elevation shadow effects | pending |
| `terrain-materials-biome` | Add per-biome materials | pending |
| `future-biome-shaders` | Procedural biome shader painting | blocked (deferred) |

## Important files reference
- **State files (session):** `C:/Users/Andre/.copilot/session-state/7dc4a181-8243-4108-b311-c32dbaa84c0b/` — contains `plan.md`, `files/camera-survey.md` (20KB Three.js migration survey)
- **ADR (locked):** `docs/adr/ADR-0001-terrain-engine-event-seam.md`
- **Engine (don't modify):** `src/terrain/TerrainEngine.js`, `src/scene/terrain/TerrainEngineSceneAdapter.js`
- **Bloated coordinator (next):** `src/coordinators/TerrainCoordinator.js`
- **Movement system (works):** `src/scene/Token3DAdapter.js` + `src/scene/token-adapter/{movement, pathing}/**`
- **3D model pipeline:** `src/core/ModelAssetCache.js` (default export), `src/core/ModelPostProcessing.js`, `src/scene/terrain/PlaceableMeshPool.js`
- **Placeable defs:** `src/config/terrain/TerrainPlaceables.js` (each entry has `id → {modelKey, type, scaleMode, baselineOffsetPx}`)
- **Tests not to touch:** `tests/unit/scene/Token3DAdapter.test.js` (3 pre-existing fall-phase failures)

## Subagent reliability note
A prior subagent ran for 31023s and FALSELY claimed Phase 5 (TerrainCoordinator collapse) was done. **Always verify subagent claims** with concrete file checks (LOC count, method count grep, runtime smoke test).

## Run/verify commands
```powershell
# Tests
cd C:\Users\Andre\OneDrive\Desktop\Code\Taverntable\Taverntable
npx jest --no-coverage --silent 2>&1 | Select-Object -Last 15

# Run in browser
npm start  # then http://localhost:3000

# Verify zero PIXI refs in src
grep -rn "gameManager\.gridContainer\|gameManager\.gridRenderer\|gameManager\.renderCoordinator" src/

# Check coordinator size
(Get-Content src\coordinators\TerrainCoordinator.js).Count
```

## Skills available (already loaded)
`~/.copilot/skills/{diagnose,grill-me,improve-codebase-architecture,tdd}/SKILL.md` — Matt Pocock skills. Skills folder structure must be `<name>/SKILL.md`, not flat `<name>.md`.
