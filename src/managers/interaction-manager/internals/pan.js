import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../../../utils/Logger.js';

export function startGridDragging(c, event) {
  c.isDragging = true;
  c.dragStartX = event.clientX;
  c.dragStartY = event.clientY;
  c.gridStartX = c.gameManager.gridContainer.x;
  c.gridStartY = c.gameManager.gridContainer.y;
  c.gameManager.app.view.style.cursor = 'grabbing';

  logger.log(LOG_LEVEL.TRACE, 'Grid dragging started', LOG_CATEGORY.USER, {
    startPosition: { x: c.dragStartX, y: c.dragStartY },
    gridPosition: { x: c.gridStartX, y: c.gridStartY },
    currentScale: c.gridScale
  });

  event.preventDefault();
  event.stopPropagation();
}

export function updateGridDragPosition(c, event) {
  const deltaX = event.clientX - c.dragStartX;
  const deltaY = event.clientY - c.dragStartY;
  c.gameManager.gridContainer.x = c.gridStartX + deltaX;
  c.gameManager.gridContainer.y = c.gridStartY + deltaY;
}

export function stopGridDragging(c) {
  c.isDragging = false;
  c.gameManager.app.view.style.cursor = c.isSpacePressed ? 'grab' : 'default';
}
