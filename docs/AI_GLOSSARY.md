AI Glossary — TavernTable

- Biome: A thematic terrain palette and behavior set (e.g., forest, desert) used by the terrain painter.
- Brush: Tool for painting terrain tiles/elevations on the isometric grid.
- Coordinator: Orchestrator modules connecting UI, managers, and domain logic (State, Render, Input, Terrain coordinators).
- Creature: Domain entity representing a token with a sprite and stats.
- Elevation: Height value per grid tile; influences shading/visuals.
- GridRenderer: Manager that draws the isometric grid and updates tiles.
- Manager: Service-like modules managing a concern (tokens, terrain, interaction, grid, sprites).
- Palette: Color mappings for biomes and shading helpers.
- Sprite: PNG image used for creature tokens; loaded by SpriteManager.
- Token: A placed creature or object on the grid, controlled by TokenManager.
- UIController: Main UI entry controlling DOM, panels, and GameManager initialization.

// View Mode / Projection Refactor Terms
- Synchronous Reprojection: Immediate, single-pass recalculation of all display object positions and z-indexes when switching between isometric and top-down modes (`reprojectAll`). Replaces the former animated transition system.
- Top-Down Overlay (Square Overlay): Lightweight PIXI `Graphics` square generated per tile for top-down mode to represent tile footprint; toggled instead of re-rendering isometric diamond.
- Elevation Offset Cache: Stored per-tile vertical pixel offset (`__storedElevationOffset`) plus its originating base iso Y to preserve relative elevation when toggling modes; invalidated when biome version changes.
- Biome Version Key: Incrementing version (`__biomeVersion`) used to invalidate elevation/visual caches when biome-derived shading or elevation data changes.
- Legacy Transition System (Deprecated): Removed animated interpolation layer that previously tweened between modes; replaced by deterministic synchronous reprojection for simplicity and test stability.

// Terrain & Placeables Enhancements
- Placeable Removal Mode: UI toggle in the Terrain panel that converts left-clicks into removal actions for plant/tree placeables (ids starting with `tree-` or placeableType `plant`). Disables drag-based mass deletion and suppresses height editing or new placements while active. Replaces earlier tree-only terminology.
