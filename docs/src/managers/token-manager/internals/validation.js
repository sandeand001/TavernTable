import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/ErrorHandler.js';

export function validateTokenPositions(c, cols, rows) {
    try {
        const outOfBounds = c.placedTokens.filter(token =>
            !CoordinateUtils.isValidGridPosition(token.gridX, token.gridY, cols, rows)
        );

        if (outOfBounds.length > 0) {
            const invalidPositions = outOfBounds.map(t => `(${t.gridX}, ${t.gridY})`).join(', ');
            throw new Error(`${outOfBounds.length} tokens are out of bounds: ${invalidPositions}`);
        }

        logger.debug(`All ${c.placedTokens.length} tokens are within grid bounds`, {
            tokenCount: c.placedTokens.length,
            gridSize: { cols, rows }
        }, LOG_CATEGORY.SYSTEM);
    } catch (error) {
        const errorHandler = new ErrorHandler();
        errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.VALIDATION, {
            stage: 'validateTokenPositions',
            gridSize: { cols, rows },
            tokenCount: c.placedTokens.length
        });
    }
}
