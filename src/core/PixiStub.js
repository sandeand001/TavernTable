/**
 * PixiStub.js — Lightweight drop-in replacement for PIXI.js.
 *
 * Provides the minimum API surface used by the TavernTable codebase so the
 * CDN dependency on pixi.js-legacy can be removed.  All visual rendering is
 * handled by Three.js; this stub only satisfies the container/display-object
 * data-structure layer and the canvas‐element event surface that
 * InteractionManager, TerrainCoordinator, et al. still reference.
 *
 * Intended as a transitional shim: individual files will be updated to remove
 * PIXI references entirely, and this file deleted once the migration is done.
 */

// ── EventEmitter mixin ──────────────────────────────────────────────
const EventEmitterMixin = {
  on(event, fn) {
    if (!this._listeners) this._listeners = {};
    (this._listeners[event] ||= []).push(fn);
    return this;
  },

  off(event, fn) {
    const list = this._listeners?.[event];
    if (!list) return this;
    this._listeners[event] = list.filter((f) => f !== fn);
    return this;
  },

  emit(event, ...args) {
    const list = this._listeners?.[event];
    if (list) for (const fn of list) fn(...args);
    return this;
  },
};

function applyEmitter(obj) {
  obj._listeners = {};
  obj.on = EventEmitterMixin.on;
  obj.off = EventEmitterMixin.off;
  obj.emit = EventEmitterMixin.emit;
}

// ── Point helper ────────────────────────────────────────────────────
class Point {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x, y) {
    this.x = x;
    this.y = y ?? x;
  }
}

// ── Container ───────────────────────────────────────────────────────
class Container {
  constructor() {
    this.children = [];
    this.parent = null;
    this.position = new Point();
    this.scale = new Point(1, 1);
    this.pivot = new Point();
    this.visible = true;
    this.renderable = true;
    this.alpha = 1;
    this.interactive = false;
    this.interactiveChildren = true;
    this.buttonMode = false;
    this.sortableChildren = false;
    this.zIndex = 0;
    this.tint = 0xffffff;
    applyEmitter(this);
  }

  get x() {
    return this.position.x;
  }
  set x(v) {
    this.position.x = v;
  }
  get y() {
    return this.position.y;
  }
  set y(v) {
    this.position.y = v;
  }

  addChild(child) {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addChildAt(child, index) {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
    return child;
  }

  removeChildren() {
    for (const c of this.children) c.parent = null;
    const removed = this.children.splice(0);
    return removed;
  }

  sortChildren() {
    if (this.sortableChildren) {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }
  }

  getLocalBounds() {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  destroy() {
    if (this.parent) this.parent.removeChild(this);
    this.children.length = 0;
  }
}

// ── Graphics ────────────────────────────────────────────────────────
class Graphics extends Container {
  clear() {
    return this;
  }
  lineStyle() {
    return this;
  }
  beginFill() {
    return this;
  }
  endFill() {
    return this;
  }
  moveTo() {
    return this;
  }
  lineTo() {
    return this;
  }
  closePath() {
    return this;
  }
  drawCircle() {
    return this;
  }
  drawRect() {
    return this;
  }
  drawPolygon() {
    return this;
  }
}

// ── Texture ─────────────────────────────────────────────────────────
class Texture {
  constructor() {
    this.width = 0;
    this.height = 0;
  }
  static from() {
    return new Texture();
  }
}

// ── Sprite ──────────────────────────────────────────────────────────
class Sprite extends Container {
  constructor(texture) {
    super();
    this.texture = texture || new Texture();
    this.anchor = new Point(0, 0);
    this.width = 0;
    this.height = 0;
  }
  static from() {
    return new Sprite(Texture.from());
  }
}

// ── Application ─────────────────────────────────────────────────────
class Application {
  constructor(options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = options.width || window.innerWidth;
    canvas.height = options.height || window.innerHeight;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    // Transparent — Three.js canvas behind is the visible surface
    canvas.style.background = 'transparent';

    this.canvas = canvas;
    this.view = canvas;
    this.stage = new Container();
    this.stage.interactive = false;
    this.stage.interactiveChildren = true;
    this.screen = { width: canvas.width, height: canvas.height };

    this.renderer = {
      type: 1, // WEBGL
      resize: (w, h) => {
        canvas.width = w;
        canvas.height = h;
        this.screen.width = w;
        this.screen.height = h;
      },
      render: () => {},
    };

    this.ticker = {
      add: () => {},
      remove: () => {},
    };
  }
}

// ── PIXI global namespace ───────────────────────────────────────────
const PIXI = {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
  RENDERER_TYPE: { UNKNOWN: 0, WEBGL: 1, CANVAS: 2 },
  utils: {
    isWebGLSupported: () => true,
  },
};

window.PIXI = PIXI;

export default PIXI;
export { Application, Container, Graphics, Sprite, Texture };
