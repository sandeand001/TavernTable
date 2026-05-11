import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../../utils/logger/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/error/ErrorHandler.js';

// ── Wheel Zoom ──────────────────────────────────────────────────

export function handleZoomWheel(c, event) {
  const rect = c.gameManager.getEventCanvas().getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const zoomDirection = event.deltaY > 0 ? -1 : 1;
  const zoomFactor = 1 + c.zoomSpeed * zoomDirection;

  const tsm = c.gameManager.threeSceneManager;
  if (!tsm) return;

  const prevZoom = tsm.getZoom();
  tsm.zoomAtScreenPoint(zoomFactor, mouseX, mouseY);

  logger.log(LOG_LEVEL.DEBUG, 'Zoom applied', LOG_CATEGORY.USER, {
    zoomDirection,
    zoomFactor,
    previousZoom: prevZoom,
    newZoom: tsm.getZoom(),
    mousePosition: { x: mouseX, y: mouseY },
  });
}

// ── Zoom Application ────────────────────────────────────────────

export function applyZoom(c, factor, mouseX, mouseY) {
  c.gameManager.threeSceneManager?.zoomAtScreenPoint(factor, mouseX, mouseY);
}

// ── Zoom Reset ──────────────────────────────────────────────────

export function resetZoom(c) {
  try {
    const tsm = c.gameManager.threeSceneManager;
    if (!tsm) return;
    tsm._zoom = 1.0;
    tsm._targetZoom = 1.0;
    tsm.reframe?.();
    tsm.resetCameraTarget?.();
    logger.log(LOG_LEVEL.DEBUG, 'Zoom reset to default', LOG_CATEGORY.USER, { newZoom: 1.0 });
  } catch (error) {
    const errorHandler = new ErrorHandler();
    errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.RENDERING, {
      stage: 'resetZoom',
    });
  }
}
