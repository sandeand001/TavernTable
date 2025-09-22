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

Cleanup Notes (2025-09-19):
- Logger surface minimized: internal handler classes and wrapper HOFs removed; only enums + core Logger exposed.
- Terrain tool/shortcut/validation constants removed (unused); retain only TERRAIN_CONFIG.
