// 3D camera rotation via mouse drag — extracted from InteractionManager (Phase 9).
// Manages yaw/pitch drag state and applies angles via ThreeSceneManager.

// ── Constants ───────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

// ── Rotation Start ──────────────────────────────────────────────

/**
 * Begin 3D camera rotation (right mouse drag).
 * @param {InteractionManager} c - InteractionManager context
 * @param {MouseEvent} event
 * @param {object} threeMgr - ThreeSceneManager instance
 */
export function start3DRotation(c, event, threeMgr) {
  try {
    c.isRotating3D = true;
    c.rotateStartX = event.clientX;
    c.rotateStartY = event.clientY;
    // Capture starting yaw/pitch from manager private fields if accessible
    c.startYaw = threeMgr._isoYaw || 0;
    const startPitchRad = threeMgr._isoPitch != null ? threeMgr._isoPitch : 0.6;
    c.startPitchDeg = startPitchRad * RAD2DEG;
    c.gameManager.getEventCanvas().style.cursor = 'grabbing';
    event.preventDefault();
    event.stopPropagation();
  } catch (e) {
    c.isRotating3D = false;
  }
}

// ── Rotation Update ─────────────────────────────────────────────

/**
 * Update 3D rotation given current mouse position.
 * @param {InteractionManager} c - InteractionManager context
 * @param {MouseEvent} event
 */
export function update3DRotation(c, event) {
  try {
    if (!c.isRotating3D) return;
    const threeMgr = c.gameManager?.threeSceneManager;
    if (!threeMgr) return;
    const dx = event.clientX - c.rotateStartX;
    const dy = event.clientY - c.rotateStartY;
    // Horizontal drag adjusts yaw
    const yawDeltaDeg = dx * c.yawSensitivity;
    let newYaw = c.startYaw + yawDeltaDeg * DEG2RAD;
    // Normalize yaw into [0, 2PI)
    newYaw = ((newYaw % TAU) + TAU) % TAU;
    // Vertical drag adjusts pitch (dragging up now lowers pitch; dragging down increases pitch)
    const pitchDeltaDeg = dy * c.rotationSensitivity;
    let newPitchDeg = c.startPitchDeg + pitchDeltaDeg;
    if (newPitchDeg < 0) newPitchDeg = 0;
    if (newPitchDeg > 89.9) newPitchDeg = 89.9;
    // Apply new spherical orientation
    threeMgr.setIsoAngles({ yaw: newYaw, pitch: newPitchDeg * DEG2RAD });
    if (!threeMgr._isoMode) {
      // In free mode maintain orientation via general pitch setter
      threeMgr.setCameraPitchDegrees(newPitchDeg);
    }
  } catch (_) {
    /* ignore */
  }
}

// ── Rotation End ────────────────────────────────────────────────

/**
 * End 3D rotation.
 * @param {InteractionManager} c - InteractionManager context
 */
export function stop3DRotation(c) {
  c.isRotating3D = false;
  c._activeDragButton = null;
  c._removeGlobalDragListeners();
  c.gameManager.getEventCanvas().style.cursor = 'default';
}
