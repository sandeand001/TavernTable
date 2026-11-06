import { GameErrors } from '../../utils/error/ErrorHandler.js';

export class TerrainInputHandlers {
  constructor(gameManager, domPorts = {}) {
    this.gameManager = gameManager;
    this.engine = gameManager.terrainEngine;
    this.domPorts = {
      getTerrainHeightDisplay: () => document.getElementById('terrain-height-display'),
      getScaleMarks: () => document.querySelectorAll('.scale-mark'),
      ...domPorts,
    };
    this._canvas = null;
    this._events = [];
    this._placeableStroke = null;
    this._unsubs = [
      this.engine.onEditorChanged((state) => {
        if (!state.active) this.resetHeightIndicator();
        window.dispatchEvent(
          new CustomEvent('taverntable:terrainEditorChanged', {
            detail: { ...state, engine: this.engine },
          })
        );
      }),
      this.engine.onActivationChanged(({ active }) => {
        if (this._canvas) this._canvas.style.cursor = active ? 'crosshair' : 'default';
      }),
      this.engine.onBrushMoved(({ gridX, gridY, cells }) => {
        if (this.engine.isActive && this.engine.isValidGridPosition(gridX, gridY)) {
          this.updateHeightIndicator(gridX, gridY);
        } else if (!cells.length) {
          this.resetHeightIndicator();
        }
      }),
    ];
  }

  setup() {
    const canvas = this.gameManager.getEventCanvas();
    if (!canvas) throw new Error('Terrain input requires the game canvas');
    if (canvas === this._canvas && this._events.length) return;
    this._detachEvents();
    this._canvas = canvas;
    canvas.style.cursor = this.engine.isActive ? 'crosshair' : 'default';
    for (const [target, type, handler, capture = false] of [
      [canvas, 'mousedown', (event) => this.handleMouseDown(event)],
      [canvas, 'mousemove', (event) => this.handleMouseMove(event)],
      [canvas, 'mouseup', (event) => this.handleMouseUp(event)],
      [canvas, 'mouseleave', () => this.handleMouseLeave()],
      [window, 'mouseup', (event) => this.handleMouseUp(event), true],
      [window, 'blur', () => this.cancelStroke(), true],
      [document, 'keydown', (event) => this.handleKeyDown(event)],
    ]) {
      target.addEventListener(type, handler, capture);
      this._events.push(() => target.removeEventListener(type, handler, capture));
    }
  }

  dispose() {
    this.cancelStroke();
    this._detachEvents();
    for (const unsubscribe of this._unsubs) unsubscribe();
    this._unsubs = [];
  }

  _detachEvents() {
    for (const dispose of this._events) dispose();
    this._events = [];
    this._canvas = null;
  }

  _available() {
    const gm = this.gameManager;
    return (
      gm.getViewMode?.() !== 'topdown' &&
      !this.engine.constructionTool &&
      !gm.interactionManager?.isDragging &&
      !gm.interactionManager?.isSpacePressed
    );
  }

  getGridCoordinatesFromEvent(event) {
    const gm = this.gameManager;
    let cell = null;
    if (gm.is3DModeActive?.() && gm.pickingService?.pickGroundSync) {
      const picked = gm.pickingService.pickGroundSync(
        event.clientX,
        event.clientY,
        gm.threeSceneManager.canvas
      );
      if (picked?.grid) {
        cell = { gridX: Math.round(picked.grid.gx), gridY: Math.round(picked.grid.gy) };
      }
    } else if (gm.interactionManager?.getGridCoordinatesFromClick) {
      cell = gm.interactionManager.getGridCoordinatesFromClick(event);
    }
    return cell && this.engine.isValidGridPosition(cell.gridX, cell.gridY) ? cell : null;
  }

  handleMouseDown(event) {
    try {
      if (event.button !== 0 || !this._available()) return;
      const e = this.engine;
      const selected = e.getSelectedPlaceable();
      if (!e.isActive && !selected) return;
      const cell = this.getGridCoordinatesFromEvent(event);
      if (!cell) return;
      if (e.isPlaceableRemovalMode()) {
        this._changePlaceables(cell, null);
      } else if (selected) {
        this._changePlaceables(cell, selected);
        this._placeableStroke = { id: selected, key: `${cell.gridX},${cell.gridY}` };
      } else {
        e.beginBrushStroke(cell.gridX, cell.gridY);
      }
      event.preventDefault();
      event.stopPropagation();
    } catch (error) {
      this._failed(error, 'pointer-down');
    }
  }

  handleMouseMove(event) {
    try {
      const e = this.engine;
      if (e.constructionTool) return;
      if (!this._available()) {
        this.cancelStroke();
        return;
      }
      const cell = this.getGridCoordinatesFromEvent(event);
      if (!cell) {
        e.clearBrushPreview();
        return;
      }
      if (e.isActive) this.updateHeightIndicator(cell.gridX, cell.gridY);
      if (e.hasPendingStroke) {
        if (!(event.buttons & 1) || !e.isActive) this.cancelStroke();
        else e.updateBrushStroke(cell.gridX, cell.gridY);
        return;
      }
      const selected = e.getSelectedPlaceable();
      if (this._placeableStroke) {
        if (!(event.buttons & 1) || selected !== this._placeableStroke.id) {
          this._placeableStroke = null;
        } else {
          const key = `${cell.gridX},${cell.gridY}`;
          if (key !== this._placeableStroke.key) {
            this._changePlaceables(cell, selected);
            this._placeableStroke.key = key;
          }
        }
      }
      if (e.isActive || (selected && e.isPlaceablesPanelVisible())) {
        e.moveBrushTo(cell.gridX, cell.gridY);
      } else e.clearBrushPreview();
    } catch (error) {
      this._failed(error, 'pointer-move');
    }
  }

  handleMouseUp(event) {
    try {
      if (event.button !== 0) return;
      this._placeableStroke = null;
      if (!this.engine.hasPendingStroke) return;
      const canvas = this.gameManager.getEventCanvas();
      const onCanvas = event.target === canvas || canvas.contains?.(event.target) === true;
      const cell =
        onCanvas && this._available() && this.engine.isActive
          ? this.getGridCoordinatesFromEvent(event)
          : null;
      if (!cell) {
        this.cancelStroke();
        return;
      }
      this.engine.updateBrushStroke(cell.gridX, cell.gridY);
      this.engine.commitBrushStroke();
      this.updateHeightIndicator(cell.gridX, cell.gridY);
    } catch (error) {
      this._failed(error, 'pointer-up');
    }
  }

  handleMouseLeave() {
    this.cancelStroke();
    this.resetHeightIndicator();
  }

  cancelStroke() {
    this._placeableStroke = null;
    this.engine.cancelBrushStroke();
  }

  handleKeyDown(event) {
    try {
      if (!this.engine.isActive || this.gameManager.getViewMode?.() === 'topdown') return;
      const target = event.target;
      if (
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) ||
        target?.closest?.('[role="dialog"], dialog')
      )
        return;
      if (['Escape', 'Space'].includes(event.code)) {
        const pending = this.engine.hasPendingStroke;
        this.cancelStroke();
        if (pending && event.code === 'Escape') event.preventDefault();
        return;
      }
      const modified = event.ctrlKey || event.metaKey;
      if (modified && ['KeyZ', 'KeyY'].includes(event.code) && !event.altKey) {
        const redo = event.code === 'KeyY' || event.shiftKey;
        if (redo) this.engine.redo();
        else this.engine.undo();
        event.preventDefault();
        return;
      }
      if (modified || event.altKey) return;
      if (event.code === 'KeyR') this.engine.setTool('raise');
      else if (event.code === 'KeyL') this.engine.setTool('lower');
      else if (event.code === 'BracketLeft' && this.engine.tool !== 'wall') {
        this.engine.decreaseBrush();
      } else if (event.code === 'BracketRight' && this.engine.tool !== 'wall') {
        this.engine.increaseBrush();
      } else return;
      event.preventDefault();
    } catch (error) {
      this._failed(error, 'keyboard');
    }
  }

  _changePlaceables({ gridX, gridY }, id) {
    for (const { x, y } of this.engine.getPlaceableBrushFootprint(gridX, gridY)) {
      this.engine.emitPlaceableChanged(x, y, id);
    }
  }

  updateHeightIndicator(x, y) {
    if (!this.engine.isValidGridPosition(x, y)) return;
    const height = this.engine.getHeightAt(x, y);
    const display = this.domPorts.getTerrainHeightDisplay();
    if (display) {
      display.textContent = String(height);
      display.style.color = height === 0 ? '#6b7280' : height > 0 ? '#10b981' : '#8b5cf6';
    }
    for (const mark of this.domPorts.getScaleMarks()) {
      mark.classList.toggle('current', Number(mark.getAttribute('data-height')) === height);
    }
  }

  resetHeightIndicator() {
    const display = this.domPorts.getTerrainHeightDisplay();
    if (display) {
      display.textContent = '0';
      display.style.color = '#6b7280';
    }
    for (const mark of this.domPorts.getScaleMarks()) {
      mark.classList.toggle('current', Number(mark.getAttribute('data-height')) === 0);
    }
  }

  _failed(error, operation) {
    this.cancelStroke();
    GameErrors.input(error, { component: 'TerrainInputHandlers', operation });
  }
}
