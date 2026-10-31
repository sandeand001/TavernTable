import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../../utils/logger/Logger.js';
import { shouldIgnoreKeyTarget } from './keyboard.js';

export function handlePanKeyDown(c, event) {
  if (
    event.code !== 'Space' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    shouldIgnoreKeyTarget(event.target) ||
    c.gameManager.sceneAutosave?.ready === false
  )
    return false;
  c._facingGesture?.cancel();
  c.gameManager.cancelTokenDrag?.();
  c._pendingRadialContext = null;
  if (c.isRotating3D) c.stop3DRotation();
  c.isSpacePressed = true;
  c.gameManager.getEventCanvas().style.cursor = c.isDragging ? 'grabbing' : 'grab';
  return true;
}

export function releasePanKey(c) {
  c.isSpacePressed = false;
  if (c.isDragging) c.stopGridDragging();
  else if (!c.isRotating3D) c.gameManager.getEventCanvas().style.cursor = 'default';
}

// ── Drag Start ──────────────────────────────────────────────────

export function startGridDragging(c, event) {
  c._activeDragButton = event.button;
  c.isDragging = true;
  c.dragStartX = event.clientX;
  c.dragStartY = event.clientY;
  c.gameManager.getEventCanvas().style.cursor = 'grabbing';
  c._ensureGlobalDragListeners();

  logger.log(LOG_LEVEL.TRACE, 'Grid dragging started', LOG_CATEGORY.USER, {
    startPosition: { x: c.dragStartX, y: c.dragStartY },
  });

  event.preventDefault();
  event.stopPropagation();
}

// ── Drag Update ─────────────────────────────────────────────────

export function updateGridDragPosition(c, event) {
  const buttonMask = c._activeDragButton === 2 ? 2 : 1;
  if (typeof event.buttons === 'number' && !(event.buttons & buttonMask)) {
    c.stopGridDragging();
    return;
  }
  const deltaX = event.clientX - c.dragStartX;
  const deltaY = event.clientY - c.dragStartY;
  const rect = c.gameManager.getEventCanvas().getBoundingClientRect();
  const origin = { x: c.dragStartX - rect.left, y: c.dragStartY - rect.top };
  // Update start for next incremental delta
  c.dragStartX = event.clientX;
  c.dragStartY = event.clientY;
  c.gameManager.threeSceneManager?.panBy(deltaX, deltaY, origin);
}

// ── Drag End ────────────────────────────────────────────────────

export function stopGridDragging(c) {
  c.isDragging = false;
  c.gameManager.getEventCanvas().style.cursor = c.isSpacePressed ? 'grab' : 'default';
}
