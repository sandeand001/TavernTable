import { createPlaceableSprite, placeItem, cyclePlaceableVariant } from '../../src/managers/terrain-manager/internals/placeables.js';
import { TERRAIN_PLACEABLES } from '../../src/config/TerrainPlaceables.js';

describe('Placeables tree variants', () => {
    const mockM = {
        gameManager: { tileWidth: 64, tileHeight: 32 },
        // Use a lightweight container object that records children for assertions
        terrainContainer: { children: [], addChild(obj) { this.children.push(obj); }, removeChild(obj) { const i = this.children.indexOf(obj); if (i >= 0) this.children.splice(i, 1); } },
        terrainCoordinator: { getTerrainHeight: () => 0 }
    };

    test('createPlaceableSprite picks variant and stores index', () => {
        const id = Object.keys(TERRAIN_PLACEABLES).find(k => k.startsWith('tree-'));
        expect(id).toBeDefined();
        const sprite = createPlaceableSprite(mockM, id, 2, 3);
        expect(sprite).toBeDefined();
        expect(typeof sprite.placeableVariantIndex).toBe('number');
    });

    test('placeItem and cyclePlaceableVariant updates variant', () => {
        const id = Object.keys(TERRAIN_PLACEABLES).find(k => k.startsWith('tree-'));
        const ok = placeItem(mockM, id, 4, 5);
        expect(ok).toBe(true);
        const before = mockM.terrainContainer.children.slice();
        const tileKey = '4,5';
        // ensure variant index exists on placed sprite
        const placed = before.find(p => p.placeableId === id && p.gridX === 4 && p.gridY === 5);
        expect(placed).toBeDefined();
        const oldIndex = placed.placeableVariantIndex;
        const changed = cyclePlaceableVariant(mockM, 4, 5, id);
        expect(changed).toBe(true);
        expect(placed.placeableVariantIndex).not.toBe(oldIndex);
    });
});
