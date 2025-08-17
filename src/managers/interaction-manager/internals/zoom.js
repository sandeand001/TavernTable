import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../../../utils/Logger.js';

export function handleZoomWheel(c, event) {
  const rect = c.gameManager.app.view.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const zoomDirection = event.deltaY > 0 ? -1 : 1;
  const zoomFactor = 1 + (c.zoomSpeed * zoomDirection);
  const newScale = c.gridScale * zoomFactor;

  if (newScale < c.minScale || newScale > c.maxScale) {
    return;
  }

  applyZoom(c, newScale, mouseX, mouseY);
  logger.log(LOG_LEVEL.DEBUG, 'Zoom applied', LOG_CATEGORY.USER, {
    zoomDirection,
    zoomFactor,
    previousScale: c.gridScale / zoomFactor,
    newScale: c.gridScale,
    zoomPercentage: `${(c.gridScale * 100).toFixed(0)}%`,
    mousePosition: { x: mouseX, y: mouseY },
    bounds: { min: c.minScale, max: c.maxScale }
  });
}

export function applyZoom(c, newScale, mouseX, mouseY) {
  const localX = (mouseX - c.gameManager.gridContainer.x) / c.gridScale;
  const localY = (mouseY - c.gameManager.gridContainer.y) / c.gridScale;

  c.gridScale = newScale;
  c.gameManager.gridContainer.scale.set(c.gridScale);

  c.gameManager.gridContainer.x = mouseX - localX * c.gridScale;
  c.gameManager.gridContainer.y = mouseY - localY * c.gridScale;
}
