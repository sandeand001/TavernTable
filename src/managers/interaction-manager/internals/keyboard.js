// Keyboard input handlers for token rotation and movement.
// Extracted from InteractionManager.js (Phase 8).
// Follows the same (context, event) pattern as pan.js, zoom.js, picking.js.

// ── Key Code Constants ──────────────────────────────────────────

export const MOVE_FORWARD_CODES = new Set(['ArrowUp', 'KeyW']);
export const MOVE_BACKWARD_CODES = new Set(['ArrowDown', 'KeyS']);
export const ROTATE_LEFT_CODES = new Set(['ArrowLeft', 'KeyA']);
export const ROTATE_RIGHT_CODES = new Set(['ArrowRight', 'KeyD']);

// ── Input Filtering ─────────────────────────────────────────────

export function shouldIgnoreKeyTarget(target) {
  if (!target) return false;
  try {
    if (target.isContentEditable) return true;
    const tag = (target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true;
    }
  } catch (_) {
    /* ignore target introspection errors */
  }
  return false;
}

// ── Token Rotation Handlers ─────────────────────────────────────

export function handleTokenRotationKeyDown(c, event) {
  try {
    if (!event || (!ROTATE_LEFT_CODES.has(event.code) && !ROTATE_RIGHT_CODES.has(event.code))) {
      return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (shouldIgnoreKeyTarget(event.target)) {
      return false;
    }

    const gm = c.gameManager;
    if (!gm?.tokenManager) return false;
    const adapter = gm.token3DAdapter;
    const selectedToken = adapter?.getSelectedToken?.();
    if (!selectedToken) return false;

    if (event.repeat) {
      return true;
    }

    const direction = ROTATE_RIGHT_CODES.has(event.code) ? 1 : -1;
    if (adapter?.beginRotation) {
      adapter.beginRotation(selectedToken, direction, event.code);
      return true;
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function handleTokenRotationKeyUp(c, event) {
  try {
    if (!event || (!ROTATE_LEFT_CODES.has(event.code) && !ROTATE_RIGHT_CODES.has(event.code))) {
      return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    const adapter = c.gameManager?.token3DAdapter;
    if (!adapter?.endRotation) return false;
    const selectedToken = adapter.getSelectedToken?.();
    if (!selectedToken) return false;
    const direction = ROTATE_RIGHT_CODES.has(event.code) ? 1 : -1;
    adapter.endRotation(selectedToken, direction, event.code);
    return true;
  } catch (_) {
    return false;
  }
}

// ── Token Movement Handlers ─────────────────────────────────────

export function handleTokenMovementKeyDown(c, event) {
  try {
    if (!event || (!MOVE_FORWARD_CODES.has(event.code) && !MOVE_BACKWARD_CODES.has(event.code))) {
      return false;
    }
    if (event.repeat) {
      return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (shouldIgnoreKeyTarget(event.target)) {
      return false;
    }

    const adapter = c.gameManager?.token3DAdapter;
    if (!adapter?.beginForwardMovement) return false;
    if (typeof adapter.setShiftModifier === 'function') {
      adapter.setShiftModifier(!!event.shiftKey);
    }
    const selectedToken = adapter.getSelectedToken?.();
    if (!selectedToken) return false;
    const direction = MOVE_BACKWARD_CODES.has(event.code) ? -1 : 1;
    if (direction > 0 && adapter.beginForwardMovement) {
      adapter.beginForwardMovement(selectedToken, event.code);
      return true;
    }
    if (direction < 0 && adapter.beginBackwardMovement) {
      adapter.beginBackwardMovement(selectedToken, event.code);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

export function handleTokenMovementKeyUp(c, event) {
  try {
    if (!event || (!MOVE_FORWARD_CODES.has(event.code) && !MOVE_BACKWARD_CODES.has(event.code))) {
      return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    const adapter = c.gameManager?.token3DAdapter;
    if (!adapter) return false;
    const selectedToken = adapter.getSelectedToken?.();
    if (!selectedToken) return false;
    if (MOVE_FORWARD_CODES.has(event.code) && adapter.endForwardMovement) {
      adapter.endForwardMovement(selectedToken, event.code);
      return true;
    }
    if (MOVE_BACKWARD_CODES.has(event.code) && adapter.endBackwardMovement) {
      adapter.endBackwardMovement(selectedToken, event.code);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}
