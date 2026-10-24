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

- 63 Jest suites and 190 tests pass.
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
Asset scale calibration and model-load fallbacks still need browser checks.

The [March 2026 audit](./docs/archive/CONVENTIONS-AUDIT-2026-03-30.md) is retained
as historical context. Its file counts, paths, and findings are not a current
verification report.
