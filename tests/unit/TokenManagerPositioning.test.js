import { snapTokenToGrid } from '../../src/managers/token-manager/internals/positioning.js';
import { CoordinateUtils } from '../../src/utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../src/utils/TerrainHeightUtils.js';

describe('snapTokenToGrid', () => {
    test('uses topmost picker and applies elevation offset', () => {
        const height = 2;
        const token = { x: 0, y: 0, zIndex: 0 };
        const placedEntry = { creature: { sprite: token }, gridX: 0, gridY: 0 };

        const c = {
            gameManager: {
                tileWidth: 64,
                tileHeight: 32,
                cols: 10,
                rows: 10,
                interactionManager: {
                    pickTopmostGridCellAt: jest.fn(() => ({ gridX: 2, gridY: 1 }))
                },
                terrainCoordinator: {
                    dataStore: {
                        get: jest.fn(() => height)
                    }
                }
            },
            placedTokens: [placedEntry]
        };

        const pointerLocalX = 100;
        const pointerLocalY = 80;

        snapTokenToGrid(c, token, pointerLocalX, pointerLocalY);

        const iso = CoordinateUtils.gridToIsometric(2, 1, c.gameManager.tileWidth, c.gameManager.tileHeight);
        const elev = TerrainHeightUtils.calculateElevationOffset(height);

        expect(token.x).toBe(iso.x);
        expect(token.y).toBe(iso.y + elev);
        // unified depth: (gx+gy)*10000 + gx*10 + TYPE_BIAS.token(=9)
        expect(token.zIndex).toBe((2 + 1) * 10000 + 2 * 10 + 9);

        expect(placedEntry.gridX).toBe(2);
        expect(placedEntry.gridY).toBe(1);
        expect(c.gameManager.interactionManager.pickTopmostGridCellAt).toHaveBeenCalledWith(pointerLocalX, pointerLocalY);
    });

    test('falls back to coarse mapping when no picker is available', () => {
        const height = -1;
        const token = { x: 0, y: 0, zIndex: 0 };
        const placedEntry = { creature: { sprite: token }, gridX: 0, gridY: 0 };

        const c = {
            gameManager: {
                tileWidth: 64,
                tileHeight: 32,
                cols: 20,
                rows: 20,
                interactionManager: null,
                terrainCoordinator: {
                    dataStore: {
                        get: jest.fn(() => height)
                    }
                }
            },
            placedTokens: [placedEntry]
        };

        const targetGX = 4, targetGY = 5;
        const point = CoordinateUtils.gridToIsometric(targetGX, targetGY, c.gameManager.tileWidth, c.gameManager.tileHeight);

        snapTokenToGrid(c, token, point.x, point.y);

        const iso = CoordinateUtils.gridToIsometric(targetGX, targetGY, c.gameManager.tileWidth, c.gameManager.tileHeight);
        const elev = TerrainHeightUtils.calculateElevationOffset(height);

        expect(token.x).toBe(iso.x);
        expect(token.y).toBe(iso.y + elev);
        // unified depth: (gx+gy)*10000 + gx*10 + TYPE_BIAS.token(=9)
        expect(token.zIndex).toBe((targetGX + targetGY) * 10000 + targetGX * 10 + 9);

        expect(placedEntry.gridX).toBe(targetGX);
        expect(placedEntry.gridY).toBe(targetGY);
    });
});
