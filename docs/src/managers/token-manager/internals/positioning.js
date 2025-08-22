import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/ErrorHandler.js';

export function snapTokenToGrid(c, token, pointerLocalX = null, pointerLocalY = null) {
    try {
        const localX = (pointerLocalX !== null && pointerLocalY !== null) ? pointerLocalX : token.x;
        const localY = (pointerLocalX !== null && pointerLocalY !== null) ? pointerLocalY : token.y;

        let target = null;
        try {
            const im = c.gameManager?.interactionManager;
            if (im && typeof im.pickTopmostGridCellAt === 'function') {
                target = im.pickTopmostGridCellAt(localX, localY);
            }
        } catch (_) { /* ignore and fallback */ }

        if (!target) {
            const coarse = CoordinateUtils.isometricToGrid(localX, localY, c.gameManager.tileWidth, c.gameManager.tileHeight);
            target = CoordinateUtils.clampToGrid(coarse.gridX, coarse.gridY, c.gameManager.cols, c.gameManager.rows);
        }

        const isoCoords = CoordinateUtils.gridToIsometric(target.gridX, target.gridY, c.gameManager.tileWidth, c.gameManager.tileHeight);

        let elevationOffset = 0;
        try {
            const height = c.gameManager?.terrainCoordinator?.dataStore?.get(target.gridX, target.gridY) ?? 0;
            elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
        } catch (_) { /* ignore */ }

        token.x = isoCoords.x;
        token.y = isoCoords.y + elevationOffset;
        const newDepth = target.gridX + target.gridY;
        token.zIndex = newDepth * 100 + 1;

        const tokenEntry = c.placedTokens.find(t => t.creature && t.creature.sprite === token);
        if (tokenEntry) {
            tokenEntry.gridX = target.gridX;
            tokenEntry.gridY = target.gridY;
            logger.debug(`Token snapped to grid (${target.gridX}, ${target.gridY})`, {
                coordinates: target,
                originalPosition: { localX, localY },
                newPosition: isoCoords
            }, LOG_CATEGORY.USER);
        }
    } catch (error) {
        const errorHandler = new ErrorHandler();
        errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
            stage: 'snapToGrid',
            tokenPosition: { x: token.x, y: token.y }
        });
    }
}
