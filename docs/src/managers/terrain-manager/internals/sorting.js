import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../../utils/Logger.js';

/** Add a terrain tile to the container with isometric depth sorting. */
export function addTileWithDepthSorting(m, terrainTile) {
    try {
        const targetDepth = terrainTile.depthValue;
        const isShadow = terrainTile.isShadowTile;
        const children = m.terrainContainer.children;

        let insertIndex = 0;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.depthValue !== undefined) {
                const childDepth = child.depthValue;
                const childIsShadow = child.isShadowTile;
                if (childDepth < targetDepth) { insertIndex = i + 1; continue; }
                if (childDepth === targetDepth) {
                    if (isShadow && !childIsShadow) { insertIndex = i; break; }
                    insertIndex = i + 1; continue;
                }
                if (childDepth > targetDepth) { insertIndex = i; break; }
            } else {
                insertIndex = i + 1;
            }
        }
        m.terrainContainer.addChildAt(terrainTile, insertIndex);
        logger.log(LOG_LEVEL.TRACE, 'Terrain tile added with depth sorting', LOG_CATEGORY.RENDERING, {
            context: 'TerrainManager.addTileWithDepthSorting',
            coordinates: { x: terrainTile.gridX, y: terrainTile.gridY },
            depthValue: targetDepth,
            isShadow,
            insertIndex,
            totalChildren: m.terrainContainer.children.length
        });
    } catch (error) {
        logger.warn('Depth sorting failed, using fallback addChild', {
            coordinates: { x: terrainTile.gridX, y: terrainTile.gridY },
            error: error.message
        });
        m.terrainContainer.addChild(terrainTile);
    }
}

/** Re-sort all terrain tiles by depth to ensure proper rendering order. */
export function sortAllTerrainTilesByDepth(m) {
    try {
        const allChildren = [...m.terrainContainer.children];
        const byDepth = new Map();
        const others = [];

        const addToDepth = (depth, type, obj) => {
            const key = Number.isFinite(depth) ? depth : 0;
            if (!byDepth.has(key)) byDepth.set(key, { shadows: [], faces: [], tiles: [] });
            byDepth.get(key)[type].push(obj);
        };

        for (const child of allChildren) {
            if (child.isShadowTile) {
                addToDepth(child.depthValue || 0, 'shadows', child);
            } else if (child.isTerrainTile) {
                addToDepth(child.depthValue || 0, 'tiles', child);
            } else if (child.isOverlayFace) {
                addToDepth(child.depthValue || 0, 'faces', child);
            } else {
                others.push(child);
            }
        }

        const depths = [...byDepth.keys()].sort((a, b) => a - b);
        m.terrainContainer.removeChildren();
        for (const d of depths) {
            const bucket = byDepth.get(d);
            bucket.shadows.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
            bucket.faces.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
            bucket.tiles.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
            bucket.shadows.forEach(ch => m.terrainContainer.addChild(ch));
            bucket.faces.forEach(ch => m.terrainContainer.addChild(ch));
            bucket.tiles.forEach(ch => m.terrainContainer.addChild(ch));
        }
        others.forEach(child => m.terrainContainer.addChild(child));

        const aggregateCounts = [...byDepth.values()].reduce((acc, bucket) => {
            acc.tiles += bucket.tiles.length;
            acc.shadows += bucket.shadows.length;
            acc.faces += bucket.faces.length;
            return acc;
        }, { tiles: 0, shadows: 0, faces: 0 });

        logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles re-sorted by depth', LOG_CATEGORY.RENDERING, {
            context: 'TerrainManager.sortAllTerrainTilesByDepth',
            tilesCount: aggregateCounts.tiles,
            shadowTilesCount: aggregateCounts.shadows,
            facesCount: aggregateCounts.faces,
            otherChildrenCount: others.length,
            totalChildren: m.terrainContainer.children.length
        });
    } catch (error) {
        logger.warn('sortAllTerrainTilesByDepth encountered an error', { error: String(error?.message || error) });
    }
}
