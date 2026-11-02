import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';
import { CoordinateUtils } from '../../../utils/coordinates/CoordinateUtils.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/error/ErrorHandler.js';

// ── Position Validation ─────────────────────────────────────────

export function validateTokenPositions(c, cols, rows) {
  try {
    const tokens = c.placedTokens.filter(
      (token) => !c.gameManager?.campaignWorld || token.mapId === c.gameManager.campaignMapId
    );
    const outOfBounds = tokens.filter(
      (token) => !CoordinateUtils.isValidGridPosition(token.gridX, token.gridY, cols, rows)
    );

    if (outOfBounds.length > 0) {
      const invalidPositions = outOfBounds.map((t) => `(${t.gridX}, ${t.gridY})`).join(', ');
      throw new Error(`${outOfBounds.length} tokens are out of bounds: ${invalidPositions}`);
    }

    logger.debug(
      `All ${tokens.length} current-map tokens are within grid bounds`,
      {
        tokenCount: tokens.length,
        gridSize: { cols, rows },
      },
      LOG_CATEGORY.SYSTEM
    );
  } catch (error) {
    const errorHandler = new ErrorHandler();
    errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.VALIDATION, {
      stage: 'validateTokenPositions',
      gridSize: { cols, rows },
      tokenCount: c.placedTokens.length,
    });
  }
}
