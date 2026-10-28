import { normalizeAngle } from '../../token-manager/internals/orientation.js';

const HEADING_STEP = Math.PI / 4;
const DRAG_THRESHOLD_SQUARED = 36;

export class TokenFacingGesture {
  constructor(manager) {
    this.manager = manager;
    this.active = null;
    this.down = this.onDown.bind(this);
    this.move = this.onMove.bind(this);
    this.up = this.onUp.bind(this);
    this.blur = () => this.cancel();
    this.key = (event) => {
      if (event.key === 'Escape' && this.active) {
        event.preventDefault();
        this.cancel();
      }
    };
  }

  attach(view) {
    this.view = view;
    view.addEventListener('mousedown', this.down, true);
    return this;
  }

  detach() {
    this.cancel();
    this.view?.removeEventListener('mousedown', this.down, true);
  }

  canFace(token) {
    const gm = this.manager.gameManager;
    const adapter = gm.token3DAdapter;
    return (
      gm.placedTokens.includes(token) &&
      !adapter.isMovementInProgress(token) &&
      !adapter.isWallAttached(token) &&
      !adapter.isFacingLocked?.(token)
    );
  }

  onDown(event) {
    const gm = this.manager.gameManager;
    if (this.active && event.button !== 0) this.cancel();
    if (
      event.button !== 0 ||
      this.manager.isSpacePressed ||
      gm.isTerrainModeActive?.() ||
      gm.selectedTokenType === 'remove' ||
      !gm.is3DModeActive?.() ||
      !gm.threeSceneManager?.three ||
      !gm.threeSceneManager?.camera
    )
      return;
    const token = gm.pickingService?.pickGroundSync(event.clientX, event.clientY, this.view)?.token;
    if (!token || !this.canFace(token)) return;
    const state = {
      token,
      event,
      x: event.clientX,
      y: event.clientY,
      world: { ...token.world },
      facing: token.facingAngle || 0,
      dragged: false,
      cursor: this.view.style.cursor,
    };
    state.origin = this.project(event, state.world.y);
    if (!state.origin) return;
    this.active = state;
    document.addEventListener('mousemove', this.move, true);
    document.addEventListener('mouseup', this.up, true);
    document.addEventListener('keydown', this.key, true);
    window.addEventListener('blur', this.blur);
    event.stopImmediatePropagation();
  }

  onMove(event) {
    const state = this.active;
    if (!state) return;
    if (!this.canFace(state.token)) {
      this.cancel(false);
      return;
    }
    const distance = (event.clientX - state.x) ** 2 + (event.clientY - state.y) ** 2;
    if (!state.dragged && distance < DRAG_THRESHOLD_SQUARED) return;
    if (!state.dragged) {
      this.manager.gameManager.token3DAdapter.releaseManualActionForFacing?.(state.token);
      this.manager._selectTokenEntry(state.token);
    }
    state.dragged = true;
    this.view.style.cursor = 'crosshair';
    const gm = this.manager.gameManager;
    const point = this.project(event, state.world.y);
    if (!point) return;
    const dx = point.x - state.origin.x;
    const dz = point.z - state.origin.z;
    if (Math.hypot(dx, dz) < 1e-5) return;
    const target = Math.round(Math.atan2(dz, dx) / HEADING_STEP) * HEADING_STEP;
    gm.tokenManager.rotateToken(
      state.token,
      normalizeAngle(target - (state.token.facingAngle || 0))
    );
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  project(event, height) {
    const scene = this.manager.gameManager.threeSceneManager;
    const three = scene.three;
    const rect = this.view.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const ray = new three.Raycaster();
    ray.setFromCamera(
      new three.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      ),
      scene.camera
    );
    return ray.ray.intersectPlane(
      new three.Plane(new three.Vector3(0, 1, 0), -height),
      new three.Vector3()
    );
  }

  onUp(event) {
    if (event.button !== 0 || !this.active) return;
    const state = this.active;
    this.finish();
    event.stopImmediatePropagation();
    if (!state.dragged) this.manager.handleLeftClick(state.event);
  }

  cancel(restore = true) {
    const state = this.active;
    if (restore && state?.dragged && this.canFace(state.token)) {
      this.manager.gameManager.tokenManager.rotateToken(
        state.token,
        normalizeAngle(state.facing - state.token.facingAngle)
      );
    }
    this.finish();
  }

  finish() {
    if (this.active && this.view) this.view.style.cursor = this.active.cursor;
    this.active = null;
    document.removeEventListener('mousemove', this.move, true);
    document.removeEventListener('mouseup', this.up, true);
    document.removeEventListener('keydown', this.key, true);
    window.removeEventListener('blur', this.blur);
  }
}
