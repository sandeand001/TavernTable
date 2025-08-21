// Internal tool/brush helpers for TerrainCoordinator. Zero functional change.
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { Sanitizers } from '../../../utils/Validation.js';
import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';

export function setTerrainTool(c, tool) {
  let sanitizedTool;
  if (typeof Sanitizers?.enum === 'function') {
    sanitizedTool = Sanitizers.enum(tool, 'raise', ['raise', 'lower']);
    logger.debug('Used Sanitizers.enum for validation', {
      context: 'TerrainCoordinator.setTerrainTool',
      method: 'Sanitizers.enum'
    }, LOG_CATEGORY.SYSTEM);
  } else {
    const allowedTools = ['raise', 'lower'];
    sanitizedTool = allowedTools.includes(tool) ? tool : 'raise';
    logger.debug('Used fallback validation', {
      context: 'TerrainCoordinator.setTerrainTool',
      method: 'inline_validation',
      reason: 'Sanitizers.enum not available'
    }, LOG_CATEGORY.SYSTEM);
  }

  c.brush.setTool(sanitizedTool);

  logger.debug('Terrain tool changed', {
    context: 'TerrainCoordinator.setTerrainTool',
    newTool: c.brush.tool,
    previousTool: tool !== sanitizedTool ? tool : 'same',
    validationMethod: typeof Sanitizers?.enum === 'function' ? 'enum' : 'fallback'
  }, LOG_CATEGORY.USER);
}

export function getBrushSize(c) {
  return c.brush?.brushSize ?? TERRAIN_CONFIG.MIN_BRUSH_SIZE;
}

export function setBrushSize(c, value) {
  if (!Number.isFinite(value)) return;
  const clamped = Math.max(
    TERRAIN_CONFIG.MIN_BRUSH_SIZE,
    Math.min(TERRAIN_CONFIG.MAX_BRUSH_SIZE, Math.floor(value))
  );
  if (c.brush) c.brush.brushSize = clamped;
}

export function increaseBrushSize(c) {
  const before = c.brush.brushSize;
  c.brush.increaseBrush();
  if (c.brush.brushSize !== before) {
    logger.debug('Brush size increased', {
      context: 'TerrainCoordinator.increaseBrushSize',
      newSize: c.brush.brushSize
    }, LOG_CATEGORY.USER);
  }
}

export function decreaseBrushSize(c) {
  const before = c.brush.brushSize;
  c.brush.decreaseBrush();
  if (c.brush.brushSize !== before) {
    logger.debug('Brush size decreased', {
      context: 'TerrainCoordinator.decreaseBrushSize',
      newSize: c.brush.brushSize
    }, LOG_CATEGORY.USER);
  }
}
