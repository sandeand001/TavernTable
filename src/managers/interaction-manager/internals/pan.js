import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../../utils/logger/Logger.js';

// ── Drag Start ──────────────────────────────────────────────────

export function startGridDragging(c, event) {
  c.isDragging = true;
  c.dragStartX = event.clientX;
  c.dragStartY = event.clientY;
  c.gameManager.getEventCanvas().style.cursor = 'grabbing';

  logger.log(LOG_LEVEL.TRACE, 'Grid dragging started', LOG_CATEGORY.USER, {
    startPosition: { x: c.dragStartX, y: c.dragStartY },
  });

  event.preventDefault();
  event.stopPropagation();
}

// ── Drag Update ─────────────────────────────────────────────────

export function updateGridDragPosition(c, event) {
  const deltaX = event.clientX - c.dragStartX;
  const deltaY = event.clientY - c.dragStartY;
  // Update start for next incremental delta
  c.dragStartX = event.clientX;
  c.dragStartY = event.clientY;
  c.gameManager.threeSceneManager?.panBy(deltaX, deltaY);
}

// ── Drag End ────────────────────────────────────────────────────

export function stopGridDragging(c) {
  c.isDragging = false;
  c.gameManager.getEventCanvas().style.cursor = 'default';
}
