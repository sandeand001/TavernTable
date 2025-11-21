import { TOKEN_COMMANDS } from '../../config/TokenCommandConfig.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX_SIZE = 220;
const CENTER = VIEWBOX_SIZE / 2;
const OUTER_RADIUS = 100;
const INNER_RADIUS = 55;
const SUBMENU_INNER_RADIUS = OUTER_RADIUS + 12;
const SUBMENU_OUTER_RADIUS = SUBMENU_INNER_RADIUS + 46;
const GAP_DEGREES = 0;
const BASE_ACCENT = '#7ccdf9';
const SEGMENT_BASE_OFFSET = 0;
const SEGMENT_HOVER_OFFSET = 18;
const MENU_SIZE = 280; // keep in sync with CSS fallback
const MENU_SCALE = MENU_SIZE / VIEWBOX_SIZE;
const MENU_OFFSET = {
  x: Math.round(MENU_SIZE * 0.65),
  y: -Math.round(MENU_SIZE * 0.55),
};
const ICON_OUTSET = 10;
const ICON_HOVER_OUTSET = 22;
const LABEL_OUTSET = 38;
const LABEL_VISIBLE_OUTSET = 48;
const ICON_DISTANCE = (OUTER_RADIUS + ICON_OUTSET) * MENU_SCALE;
const ICON_HOVER_DISTANCE = (OUTER_RADIUS + ICON_HOVER_OUTSET) * MENU_SCALE;
const LABEL_DISTANCE = (OUTER_RADIUS + LABEL_OUTSET) * MENU_SCALE;
const LABEL_VISIBLE_DISTANCE = (OUTER_RADIUS + LABEL_VISIBLE_OUTSET) * MENU_SCALE;
const SUBMENU_ICON_OUTSET = 8;
const SUBMENU_ICON_HOVER_OUTSET = 18;
const SUBMENU_LABEL_OUTSET = 30;
const SUBMENU_LABEL_VISIBLE_OUTSET = 42;
const SUBMENU_ICON_DISTANCE = (SUBMENU_OUTER_RADIUS + SUBMENU_ICON_OUTSET) * MENU_SCALE;
const SUBMENU_ICON_HOVER_DISTANCE = (SUBMENU_OUTER_RADIUS + SUBMENU_ICON_HOVER_OUTSET) * MENU_SCALE;
const SUBMENU_LABEL_DISTANCE = (SUBMENU_OUTER_RADIUS + SUBMENU_LABEL_OUTSET) * MENU_SCALE;
const SUBMENU_LABEL_VISIBLE_DISTANCE =
  (SUBMENU_OUTER_RADIUS + SUBMENU_LABEL_VISIBLE_OUTSET) * MENU_SCALE;

function polarToCartesian(cx, cy, radius, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describeRingSegment(
  startDeg,
  endDeg,
  innerRadius = INNER_RADIUS,
  outerRadius = OUTER_RADIUS
) {
  const startOuter = polarToCartesian(CENTER, CENTER, outerRadius, endDeg);
  const endOuter = polarToCartesian(CENTER, CENTER, outerRadius, startDeg);
  const startInner = polarToCartesian(CENTER, CENTER, innerRadius, endDeg);
  const endInner = polarToCartesian(CENTER, CENTER, innerRadius, startDeg);
  const largeArcFlag = endDeg - startDeg <= 180 ? '0' : '1';

  return [
    'M',
    startOuter.x.toFixed(3),
    startOuter.y.toFixed(3),
    'A',
    outerRadius,
    outerRadius,
    '0',
    largeArcFlag,
    '0',
    endOuter.x.toFixed(3),
    endOuter.y.toFixed(3),
    'L',
    endInner.x.toFixed(3),
    endInner.y.toFixed(3),
    'A',
    innerRadius,
    innerRadius,
    '0',
    largeArcFlag,
    '1',
    startInner.x.toFixed(3),
    startInner.y.toFixed(3),
    'Z',
  ].join(' ');
}

function midpointAngle(startDeg, endDeg) {
  return startDeg + (endDeg - startDeg) / 2;
}

export class RadialMenu {
  constructor(options = {}) {
    this.actions =
      Array.isArray(options.actions) && options.actions.length ? options.actions : TOKEN_COMMANDS;
    this.root = document.createElement('div');
    this.root.className = 'radial-menu hidden';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Token radial commands');
    this.root.style.setProperty('--menu-size', `${MENU_SIZE}px`);
    this.root.style.setProperty('--icon-distance', `${ICON_DISTANCE.toFixed(2)}px`);
    this.root.style.setProperty('--icon-hover-distance', `${ICON_HOVER_DISTANCE.toFixed(2)}px`);
    this.root.style.setProperty('--label-distance', `${LABEL_DISTANCE.toFixed(2)}px`);
    this.root.style.setProperty(
      '--label-visible-distance',
      `${LABEL_VISIBLE_DISTANCE.toFixed(2)}px`
    );
    this.root.style.setProperty('--submenu-icon-distance', `${SUBMENU_ICON_DISTANCE.toFixed(2)}px`);
    this.root.style.setProperty(
      '--submenu-icon-hover-distance',
      `${SUBMENU_ICON_HOVER_DISTANCE.toFixed(2)}px`
    );
    this.root.style.setProperty(
      '--submenu-label-distance',
      `${SUBMENU_LABEL_DISTANCE.toFixed(2)}px`
    );
    this.root.style.setProperty(
      '--submenu-label-visible-distance',
      `${SUBMENU_LABEL_VISIBLE_DISTANCE.toFixed(2)}px`
    );
    this._segments = new Map();
    this._labels = new Map();
    this._icons = new Map();
    this._actionMeta = new Map();
    this._submenuSegments = new Map();
    this._submenuIcons = new Map();
    this._submenuLabels = new Map();
    this._activeSubmenu = null;
    this._listeners = new Set();
    this._context = null;
    this._raf = null;
    this._boundPointerHandler = (event) => this._handleGlobalPointer(event);
    this._boundKeyHandler = (event) => this._handleGlobalKey(event);
    this._projectVector = null;
    this._build();
  }

  attach(parent = document.body) {
    if (this.root.parentNode !== parent) {
      parent.appendChild(this.root);
    }
    return this;
  }

  onAction(listener) {
    if (typeof listener === 'function') {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }
    return () => {};
  }

  show(rawContext = {}) {
    this._context = {
      token: rawContext.token || null,
      tokenId: rawContext.tokenId || rawContext.token?.id || null,
      gridX: Number.isFinite(rawContext.gridX)
        ? rawContext.gridX
        : Number.isFinite(rawContext.token?.gridX)
          ? rawContext.token.gridX
          : null,
      gridY: Number.isFinite(rawContext.gridY)
        ? rawContext.gridY
        : Number.isFinite(rawContext.token?.gridY)
          ? rawContext.token.gridY
          : null,
      screenPosition: rawContext.screenPosition || {
        x: rawContext.screenX ?? 0,
        y: rawContext.screenY ?? 0,
      },
    };

    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    this._bindGlobalHandlers();
    this._startTrackingPosition();
    this._applyActiveState(rawContext.token?.quickCommand || null);
  }

  hide() {
    if (!this._context && this.root.classList.contains('hidden')) {
      return;
    }
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this._clearSubmenu();
    this._context = null;
    this._applyActiveState(null);
    this._stopTrackingPosition();
    this._removeGlobalHandlers();
  }

  setActiveCommand(commandId) {
    this._applyActiveState(commandId);
  }

  _build() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
    svg.classList.add('radial-svg');
    this.root.appendChild(svg);

    const iconLayer = document.createElement('div');
    iconLayer.className = 'radial-icon-layer';
    this.root.appendChild(iconLayer);

    const labelLayer = document.createElement('div');
    labelLayer.className = 'radial-label-layer';
    this.root.appendChild(labelLayer);

    const submenuIconLayer = document.createElement('div');
    submenuIconLayer.className = 'radial-submenu-icon-layer';
    submenuIconLayer.dataset.layer = 'submenu-icons';
    this.root.appendChild(submenuIconLayer);

    const submenuLabelLayer = document.createElement('div');
    submenuLabelLayer.className = 'radial-submenu-label-layer';
    submenuLabelLayer.dataset.layer = 'submenu-labels';
    this.root.appendChild(submenuLabelLayer);

    this._submenuIconLayer = submenuIconLayer;
    this._submenuLabelLayer = submenuLabelLayer;

    const centerButton = document.createElement('button');
    centerButton.type = 'button';
    centerButton.className = 'radial-center-button';
    centerButton.innerHTML = '<span>✕</span><small>Close</small>';
    centerButton.addEventListener('click', () => this.hide());
    this.root.appendChild(centerButton);

    const segmentSize = 360 / this.actions.length;

    this.actions.forEach((action, index) => {
      const start = -90 + index * segmentSize + GAP_DEGREES / 2;
      const end = -90 + (index + 1) * segmentSize - GAP_DEGREES / 2;
      const midAngle = midpointAngle(start, end);
      const actionMeta = { action, start, end, midAngle };

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', describeRingSegment(start, end));
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.dataset.actionId = action.id;
      path.dataset.index = String(index);
      path.style.setProperty('--accent', action.accent || BASE_ACCENT);
      const angleRad = ((midAngle - 90) * Math.PI) / 180;
      const baseOffsetX = (Math.cos(angleRad) * SEGMENT_BASE_OFFSET * MENU_SCALE).toFixed(3);
      const baseOffsetY = (Math.sin(angleRad) * SEGMENT_BASE_OFFSET * MENU_SCALE).toFixed(3);
      const hoverOffsetX = (Math.cos(angleRad) * SEGMENT_HOVER_OFFSET * MENU_SCALE).toFixed(3);
      const hoverOffsetY = (Math.sin(angleRad) * SEGMENT_HOVER_OFFSET * MENU_SCALE).toFixed(3);
      path.style.setProperty('--pop-x', `${baseOffsetX}px`);
      path.style.setProperty('--pop-y', `${baseOffsetY}px`);
      path.style.setProperty('--pop-hover-x', `${hoverOffsetX}px`);
      path.style.setProperty('--pop-hover-y', `${hoverOffsetY}px`);
      path.setAttribute('aria-label', action.label);
      path.addEventListener('mouseenter', () => this._setHover(action.id, true));
      path.addEventListener('mouseleave', () => this._setHover(action.id, false));
      path.addEventListener('focus', () => this._setHover(action.id, true));
      path.addEventListener('blur', () => this._setHover(action.id, false));
      path.addEventListener('click', (event) => {
        event.stopPropagation();
        this._handleSegmentClick(actionMeta);
      });
      path.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this._handleAction(action.id);
        }
      });
      svg.appendChild(path);

      const icon = document.createElement('div');
      icon.className = 'radial-action-node';
      icon.dataset.actionId = action.id;
      icon.textContent = action.icon || '•';
      icon.style.setProperty('--angle', `${midAngle}deg`);
      icon.style.setProperty('--accent', action.accent || BASE_ACCENT);
      iconLayer.appendChild(icon);

      const label = document.createElement('div');
      label.className = 'radial-sublabel';
      label.dataset.actionId = action.id;
      label.style.setProperty('--angle', `${midAngle}deg`);
      label.innerHTML = `
        <span class="radial-label-title">${action.label}</span>
        <span class="radial-label-hint">${action.description || ''}</span>
      `;
      labelLayer.appendChild(label);

      this._segments.set(action.id, path);
      this._icons.set(action.id, icon);
      this._labels.set(action.id, label);
      this._actionMeta.set(action.id, actionMeta);
    });

    this._submenuGroup = document.createElementNS(SVG_NS, 'g');
    this._submenuGroup.classList.add('radial-submenu-group');
    svg.appendChild(this._submenuGroup);
  }

  _startTrackingPosition() {
    this._stopTrackingPosition();
    const step = () => {
      if (!this._context) {
        this._raf = null;
        return;
      }
      this._updatePosition();
      this._raf = window.requestAnimationFrame(step);
    };
    this._raf = window.requestAnimationFrame(step);
  }

  _stopTrackingPosition() {
    if (this._raf) {
      window.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  _updatePosition() {
    const pos = this._getScreenPosition();
    if (!pos) return;
    const offsetX = MENU_OFFSET?.x ?? 0;
    const offsetY = MENU_OFFSET?.y ?? 0;
    this.root.style.left = `${Math.round(pos.x + offsetX)}px`;
    this.root.style.top = `${Math.round(pos.y + offsetY)}px`;
  }

  _getScreenPosition() {
    const token = this._context?.token;
    if (!token) {
      return this._context?.screenPosition || null;
    }

    try {
      const gm = window.gameManager;
      const threeMgr = gm?.threeSceneManager;
      const mesh = token.__threeMesh;
      if (mesh && threeMgr?.camera && threeMgr?.renderer && threeMgr?.three) {
        this._projectVector = this._projectVector || new threeMgr.three.Vector3();
        const vector = this._projectVector;
        mesh.getWorldPosition(vector);
        vector.project(threeMgr.camera);
        const dom = threeMgr.renderer.domElement;
        if (dom) {
          const rect = dom.getBoundingClientRect();
          return {
            x: rect.left + ((vector.x + 1) / 2) * rect.width,
            y: rect.top + ((-vector.y + 1) / 2) * rect.height,
          };
        }
      }
    } catch (_) {
      /* ignore projection errors */
    }
    return this._context?.screenPosition || null;
  }

  _handleAction(actionId) {
    if (!this._context) return;
    const payload = {
      actionId,
      token: this._context.token,
      tokenId: this._context.tokenId,
      gridX: this._context.gridX,
      gridY: this._context.gridY,
    };
    this._listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (_) {
        /* ignore listener errors */
      }
    });
  }

  _handleSegmentClick(meta) {
    const subActions = this._getSubActions(meta.action);
    this._toggleSubmenu(meta, subActions);
  }

  _getSubActions(action) {
    if (Array.isArray(action.subActions) && action.subActions.length > 0) {
      return action.subActions;
    }
    return [
      {
        id: action.id,
        label: action.label,
        icon: action.icon,
        description: action.description || '',
        accent: action.accent,
      },
    ];
  }

  _toggleSubmenu(meta, subActions) {
    if (this._activeSubmenu?.actionId === meta.action.id) {
      this._clearSubmenu();
      return;
    }
    this._renderSubmenu(meta, subActions);
  }

  _renderSubmenu(meta, providedSubActions) {
    this._clearSubmenu();
    const subActions =
      Array.isArray(providedSubActions) && providedSubActions.length
        ? providedSubActions
        : this._getSubActions(meta.action);
    if (!subActions.length || !this._submenuGroup) return;
    this._activeSubmenu = { actionId: meta.action.id };
    this._setSegmentRetracted(meta.action.id, true);
    const totalSpan = meta.end - meta.start;
    const segmentSize = totalSpan / subActions.length;
    subActions.forEach((subAction, index) => {
      const start = meta.start + index * segmentSize;
      const end = start + segmentSize;
      const midAngle = midpointAngle(start, end);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        describeRingSegment(start, end, SUBMENU_INNER_RADIUS, SUBMENU_OUTER_RADIUS)
      );
      path.classList.add('radial-submenu-path');
      path.dataset.subActionId = subAction.id;
      path.style.setProperty('--accent', subAction.accent || meta.action.accent || BASE_ACCENT);
      const angleRad = ((midAngle - 90) * Math.PI) / 180;
      const hoverOffsetX = (Math.cos(angleRad) * SEGMENT_HOVER_OFFSET * MENU_SCALE).toFixed(3);
      const hoverOffsetY = (Math.sin(angleRad) * SEGMENT_HOVER_OFFSET * MENU_SCALE).toFixed(3);
      path.style.setProperty('--pop-x', '0px');
      path.style.setProperty('--pop-y', '0px');
      path.style.setProperty('--pop-hover-x', `${hoverOffsetX}px`);
      path.style.setProperty('--pop-hover-y', `${hoverOffsetY}px`);
      path.addEventListener('mouseenter', () => this._setSubHover(subAction.id, true));
      path.addEventListener('mouseleave', () => this._setSubHover(subAction.id, false));
      path.addEventListener('focus', () => this._setSubHover(subAction.id, true));
      path.addEventListener('blur', () => this._setSubHover(subAction.id, false));
      path.addEventListener('click', (event) => {
        event.stopPropagation();
        this._handleAction(subAction.id);
        this.hide();
      });
      this._submenuGroup.appendChild(path);
      this._submenuSegments.set(subAction.id, path);

      if (this._submenuIconLayer) {
        const icon = document.createElement('div');
        icon.className = 'radial-submenu-icon';
        icon.dataset.subActionId = subAction.id;
        icon.style.setProperty('--angle', `${midAngle}deg`);
        icon.style.setProperty('--accent', subAction.accent || meta.action.accent || BASE_ACCENT);
        icon.textContent = subAction.icon || '•';
        this._submenuIconLayer.appendChild(icon);
        this._submenuIcons.set(subAction.id, icon);
      }

      if (this._submenuLabelLayer) {
        const label = document.createElement('div');
        label.className = 'radial-submenu-label';
        label.dataset.subActionId = subAction.id;
        label.style.setProperty('--angle', `${midAngle}deg`);
        label.innerHTML = `
          <span class="radial-label-title">${subAction.label}</span>
          <span class="radial-label-hint">${subAction.description || ''}</span>
        `;
        this._submenuLabelLayer.appendChild(label);
        this._submenuLabels.set(subAction.id, label);
      }
    });
  }

  _clearSubmenu() {
    const previousActiveId = this._activeSubmenu?.actionId;
    if (this._submenuGroup) {
      while (this._submenuGroup.firstChild) {
        this._submenuGroup.removeChild(this._submenuGroup.firstChild);
      }
    }
    if (this._submenuIconLayer) {
      this._submenuIconLayer.replaceChildren();
    }
    if (this._submenuLabelLayer) {
      this._submenuLabelLayer.replaceChildren();
    }
    this._submenuSegments.clear();
    this._submenuIcons.clear();
    this._submenuLabels.clear();
    this._activeSubmenu = null;
    if (previousActiveId) {
      this._setSegmentRetracted(previousActiveId, false);
    }
  }

  _setSubHover(subActionId, isHovering) {
    const segment = this._submenuSegments.get(subActionId);
    const icon = this._submenuIcons.get(subActionId);
    const label = this._submenuLabels.get(subActionId);
    if (segment) {
      if (isHovering) {
        segment.dataset.hover = 'true';
      } else {
        delete segment.dataset.hover;
      }
    }
    if (icon) {
      icon.dataset.hover = isHovering ? 'true' : 'false';
    }
    if (label) {
      label.dataset.visible = isHovering ? 'true' : 'false';
    }
  }

  _setHover(actionId, isHovering) {
    const label = this._labels.get(actionId);
    const icon = this._icons.get(actionId);
    const segment = this._segments.get(actionId);
    if (label) {
      label.dataset.visible = isHovering ? 'true' : 'false';
    }
    if (icon) {
      icon.dataset.hover = isHovering ? 'true' : 'false';
    }
    if (segment) {
      if (isHovering) {
        segment.dataset.hover = 'true';
      } else {
        delete segment.dataset.hover;
      }
    }
  }

  _setSegmentRetracted(actionId, isRetracted) {
    if (!actionId) return;
    const segment = this._segments.get(actionId);
    const icon = this._icons.get(actionId);
    if (segment) {
      if (isRetracted) {
        segment.dataset.submenuOpen = 'true';
      } else {
        delete segment.dataset.submenuOpen;
      }
    }
    if (icon) {
      if (isRetracted) {
        icon.dataset.submenuOpen = 'true';
      } else {
        delete icon.dataset.submenuOpen;
      }
    }
  }

  _applyActiveState(commandId) {
    this._segments.forEach((segment, id) => {
      if (!segment) return;
      if (id === commandId) {
        segment.dataset.active = 'true';
      } else {
        delete segment.dataset.active;
      }
    });
    this._icons.forEach((icon, id) => {
      if (!icon) return;
      if (id === commandId) {
        icon.dataset.active = 'true';
      } else {
        delete icon.dataset.active;
      }
    });
  }

  _bindGlobalHandlers() {
    document.addEventListener('pointerdown', this._boundPointerHandler, true);
    document.addEventListener('keydown', this._boundKeyHandler, true);
  }

  _removeGlobalHandlers() {
    document.removeEventListener('pointerdown', this._boundPointerHandler, true);
    document.removeEventListener('keydown', this._boundKeyHandler, true);
  }

  _handleGlobalPointer(event) {
    if (!this._context) return;
    if (this.root.contains(event.target)) {
      return;
    }
    if (event.button === 2) {
      // allow native right-click to retarget without immediately closing
      return;
    }
    this.hide();
  }

  _handleGlobalKey(event) {
    if (event.key === 'Escape') {
      this.hide();
    }
  }
}
