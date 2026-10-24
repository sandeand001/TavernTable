# TavernTable maintenance handoff

Last verified: October 23, 2026.

## Start here

- This directory is the active Git repository. Run commands from the directory
  containing [package.json](./package.json).
- [README.md](./README.md) contains setup instructions and the verified baseline.
- [TODO.md](./TODO.md) is the current backlog.
- [CONVENTIONS.md](./CONVENTIONS.md) defines code organization.

## Cleanup scope

- The six obsolete sibling phase repositories were removed at the owner's
  request, including the assets inside those old copies.
- All 1,083 files in the active [assets directory](./assets/) were preserved
  byte-for-byte, including licenses.
- The pre-existing terrain-coordinator work was committed and pushed before
  cleanup: [checkpoint 6a3c434](https://github.com/sandeand001/TavernTable/commit/6a3c434aba1afb442732f28ced59d1e9246c94ed).
- This pass is housekeeping and test-baseline maintenance. The owner explicitly
  deferred the broader terrain ownership migration.

## Verified baseline

```powershell
npm run test:stable -- --watch=false
npm run lint:all
```

- 69 Jest suites and 231 tests pass.
- JavaScript lint has no errors and 40 existing unused-variable warnings.
- Stylesheet lint and the architecture-layer check pass.

The three previously recorded movement failures were caused by stale test
assumptions, not established gameplay regressions:

1. Landing root-motion sanitization intentionally keeps the landing elevation.
2. `W` requests the drunk gait; path navigation uses its own input key.
3. Mocking the fall finalizer prevented the expected transition to idle.

[Token3DAdapter.test.js](./tests/unit/scene/Token3DAdapter.test.js) now exercises
both normal-path and drunk animation loading and the real fall cleanup.
Movement production code was not changed. The manually reported movement issues
in the backlog remain open.

## Exotic asset appearances

- All nine rarity-exotic biomes have distinct palettes and deterministic opacity
  variants in [ExoticBiomeAppearance.js](./src/config/biome/ExoticBiomeAppearance.js).
  Astral keeps natural diffuse colors; Arcane uses fantasy hues.
- [Placeable appearance materials](./src/scene/terrain/materials/placeable-appearance.js)
  clone materials before styling, retain texture UVs/alpha, and isolate shader
  programs from ordinary materials. Dispose owned material arrays, not cached
  source materials or shared textures.
- Capture the generated biome and seed before asynchronous model loading.
  Instance groups include the appearance variant in their identity.
- Crystal Spires uses rocky decor; Lava Fields uses only rocks/pebbles. Rift and
  Shadowfell floors can support their fitting assets below zero. Blood Marsh
  allows shallow wet-ground placement while excluding its deep basin.
- Shadowfell must use its dedicated profile, not the earlier Dead Forest rule.
  Flower materials use the existing `Flowers.png` texture and cutout handling.
- Appearance updates apply when generating a biome. The density control is
  labeled Asset Density because it also affects plants and rocks.

This is model material styling, not procedural terrain painting or completion
of the terrain ownership migration.

## Important unfinished work

[ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md) is the accepted
terrain design, not a statement that the migration is finished.

- [GameManager](./src/core/GameManager.js) constructs both
  [TerrainEngine](./src/terrain/TerrainEngine.js) and
  [TerrainCoordinator](./src/coordinators/TerrainCoordinator.js).
- Both currently maintain height state. Most live editing still uses the
  coordinator's store, so engine-only state changes are not authoritative
  throughout the application.
- [TerrainEngineSceneAdapter](./src/scene/terrain/TerrainEngineSceneAdapter.js)
  exists, but event coverage and the callers' use of the engine need integration
  work.
- A future migration must cover game height queries, tools, resizing, brush input,
  biome/flora generation, and scene updates after reset/load. Verify behavior
  through that seam rather than declaring success from a smaller coordinator.

The 3D model pipeline uses [ModelAssetCache](./src/core/ModelAssetCache.js),
[ModelPostProcessing](./src/core/ModelPostProcessing.js), and
[PlaceableMeshPool](./src/scene/terrain/PlaceableMeshPool.js).

- Automatic flora weights must reference concrete `plant` entries with a
  `modelKey`, not virtual `plant-family` menu selectors.
- Match OBJ material names to their authored diffuse textures. TallThick leaves
  use `Leaves_TallThick_C.png`, and Pine bark uses `Bark_PineTree.png`; the generic
  `Leaves.png` atlas is not a universal foliage texture.
- Share in-flight instance-group creation per model/appearance key. Clear/reset/dispose
  must invalidate pending groups before they can publish stale scene meshes.

Asset scale calibration and model-load fallbacks still need browser checks.

The [March 2026 audit](./docs/archive/CONVENTIONS-AUDIT-2026-03-30.md) is retained
as historical context. Its file counts, paths, and findings are not a current
verification report.
