import { clearAllTerrainTiles } from '../../src/managers/terrain-manager/internals/container.js';
import { TerrainPixiUtils } from '../../src/utils/TerrainPixiUtils.js';

describe('TerrainManager clearAllTerrainTiles placeable preservation', () => {
    let originalSafeRemove;
    let originalBatchCleanup;

    beforeAll(() => {
        // keep originals if needed
        originalSafeRemove = TerrainPixiUtils.safeRemoveFromContainer;
        originalBatchCleanup = TerrainPixiUtils.batchCleanupTerrainTiles;
    });

    afterAll(() => {
        TerrainPixiUtils.safeRemoveFromContainer = originalSafeRemove;
        TerrainPixiUtils.batchCleanupTerrainTiles = originalBatchCleanup;
    });

    test('preserves placeables across clearAllTerrainTiles', () => {
        // Mock safeRemoveFromContainer to actually remove from our fake container
        TerrainPixiUtils.safeRemoveFromContainer = (child, container) => {
            if (!container || !container.children) return false;
            const idx = container.children.indexOf(child);
            if (idx >= 0) {
                container.children.splice(idx, 1);
                child.parent = null;
                return true;
            }
            return false;
        };

        // Mock batch cleanup to be a no-op successful response
        TerrainPixiUtils.batchCleanupTerrainTiles = (terrainTiles, container, context) => ({ total: terrainTiles.size, successful: terrainTiles.size, failed: 0, errors: [] });

        // Create fake manager
        const terrainContainer = {
            children: [],
            addChild(child) { this.children.push(child); child.parent = this; },
            removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parent = null; },
            visible: true
        };

        const sprite = { gridX: 0, gridY: 0, placeableId: 'test', parent: null };
        // Put sprite into container initially
        terrainContainer.addChild(sprite);

        const m = {
            terrainContainer,
            terrainTiles: new Map([['0,0', { isTerrainTile: true }]]),
            placeables: new Map([['0,0', [sprite]]]),
            updateQueue: new Set(),
            isUpdating: false
        };

        // Pre-conditions
        expect(m.placeables.size).toBe(1);
        expect(terrainContainer.children.includes(sprite)).toBe(true);

        // Act
        clearAllTerrainTiles(m);

        // After clear, placeables map should still contain the sprite and it should be reattached
        expect(m.placeables.has('0,0')).toBe(true);
        const arr = m.placeables.get('0,0');
        expect(Array.isArray(arr)).toBe(true);
        expect(arr.length).toBe(1);
        expect(arr[0]).toBe(sprite);
        // sprite should be in the container children again
        expect(terrainContainer.children.includes(sprite)).toBe(true);
    });
});
