import { ActivationHelpers } from '../../src/coordinators/terrain-coordinator/ActivationHelpers.js';

function makeGridContainer() {
    return {
        children: [],
        removeChild(child) {
            this.children = this.children.filter(c => c !== child);
        },
        getChildIndex(child) { return this.children.indexOf(child); },
        addChild(child) { this.children.push(child); }
    };
}

describe('ActivationHelpers.disableTerrainMode', () => {
    test('applies base integration, clears overlays, resets UI, and repaints biome', () => {
        const gridContainer = makeGridContainer();

        // Create a fake base tile with overlays/faces
        const baseSideFaces = { destroyed: false, destroy: jest.fn() };
        const shadowTile = { destroyed: false, destroy: jest.fn() };
        const depressionOverlay = { destroyed: false, destroy: jest.fn() };

        const tile = {
            isGridTile: true,
            baseIsoY: 50,
            y: 123,
            alpha: 0.5,
            baseSideFaces,
            shadowTile,
            depressionOverlay,
            parent: gridContainer
        };

        gridContainer.children = [tile, baseSideFaces, shadowTile];

        // Coordinator stub with spies
        const c = {
            isTerrainModeActive: true,
            isDragging: true,
            lastModifiedCell: '0,0',
            gameManager: { gridContainer },
            applyTerrainToBaseGrid: jest.fn(),
            terrainManager: {
                hideAllTerrainTiles: jest.fn(),
                clearAllTerrainTiles: jest.fn()
            },
            resetHeightIndicator: jest.fn(),
            applyBiomePaletteToBaseGrid: jest.fn()
        };

        // Ensure biome is selected to trigger repaint path
        global.window = global.window || {};
        window.selectedBiome = 'forest';

        const helpers = new ActivationHelpers(c);
        helpers.disableTerrainMode();

        // Flags cleared
        expect(c.isTerrainModeActive).toBe(false);
        expect(c.isDragging).toBe(false);
        expect(c.lastModifiedCell).toBeNull();

        // Tile reset to baseline and overlays removed/destroyed
        expect(tile.alpha).toBe(1.0);
        expect(tile.y).toBe(tile.baseIsoY);
        expect(gridContainer.children.includes(shadowTile)).toBe(false);
        expect(gridContainer.children.includes(baseSideFaces)).toBe(false);
        expect(shadowTile.destroy).toHaveBeenCalled();
        expect(baseSideFaces.destroy).toHaveBeenCalled();

        // Base integration and overlay cleanup
        expect(c.applyTerrainToBaseGrid).toHaveBeenCalled();
        expect(c.terrainManager.hideAllTerrainTiles).toHaveBeenCalled();
        expect(c.terrainManager.clearAllTerrainTiles).toHaveBeenCalled();

        // UI reset
        expect(c.resetHeightIndicator).toHaveBeenCalled();

        // Biome repaint called when a biome is selected and terrain mode is off
        expect(c.applyBiomePaletteToBaseGrid).toHaveBeenCalled();
    });
});
