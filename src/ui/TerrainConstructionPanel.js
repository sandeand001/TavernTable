import { createLayeredExamples } from '../terrain/LayeredExamples.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/error/ErrorHandler.js';

export class TerrainConstructionPanel {
  constructor({ root, gameManager }) {
    this.root = root;
    this.gameManager = gameManager;
    this.engine = gameManager.terrainEngine;
    root.innerHTML = `
      <div class="section-subtitle">Construction prototype</div>
      <small class="small-text">Actual solid boxes and hollow cuts in feet. Shapes commit when
        applied and share Undo/Redo. Curves, domes, arches and drag handles come later.</small>
      <form class="terrain-volume-form" aria-label="Construct terrain volume">
        <label>Operation<select name="operation" class="grid-input">
          <option value="add">Add solid box</option>
          <option value="subtract">Carve hollow box</option>
        </select></label>
        <label>Layer<input name="layer" class="grid-input" value="upper" maxlength="60" required></label>
        <label>East (ft)<input name="x" class="grid-input" type="number" value="10" min="0" step="0.5" required></label>
        <label>South (ft)<input name="z" class="grid-input" type="number" value="10" min="0" step="0.5" required></label>
        <label>Bottom (ft)<input name="bottom" class="grid-input" type="number" value="0" step="0.5" required></label>
        <label>Width (ft)<input name="width" class="grid-input" type="number" value="10" min="0.5" step="0.5" required></label>
        <label>Depth (ft)<input name="depth" class="grid-input" type="number" value="10" min="0.5" step="0.5" required></label>
        <label>Height (ft)<input name="height" class="grid-input" type="number" value="10" min="0.5" step="0.5" required></label>
        <button type="submit" class="terrain-tool-btn">Apply volume</button>
      </form>
      <div class="setting-item">
        <label>View layers<select data-layer-view class="grid-input"></select></label>
      </div>
      <small class="small-text">Hiding layers changes the view only. Hidden floors and ceilings
        still support creatures and block movement. All layers restores the complete world.</small>
      <button type="button" class="terrain-tool-btn" data-proof-map>Add proof structures</button>
      <small class="small-text">Adds a bridge with stairs, a hollow cave, and a two-storey
        building with stairs, balcony and open shaft. Requires 25 by 25 squares of empty map.
        This adds geometry; it does not erase your terrain.</small>
      <small data-construction-status class="small-text" role="status" aria-live="polite"></small>`;
    this.form = root.querySelector('form');
    this.status = root.querySelector('[data-construction-status]');
    this.view = root.querySelector('[data-layer-view]');
    this.proof = root.querySelector('[data-proof-map]');
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this._perform(() => {
        this._requireIdle();
        const number = (name) => {
          const field = this.form.elements.namedItem(name);
          const value = field.value.trim() ? Number(field.value) : NaN;
          if (!Number.isFinite(value)) throw new Error(`Enter a finite ${name} in feet`);
          return value;
        };
        const x = number('x'),
          z = number('z'),
          bottom = number('bottom');
        const width = number('width'),
          depth = number('depth'),
          height = number('height');
        const ids = new Set(this.engine.geometry.save().volumes.map((volume) => volume.id));
        let index = 1;
        while (ids.has(`volume-${index}`)) index++;
        this.engine.addVolume(
          {
            id: `volume-${index}`,
            layerId: this.form.elements.namedItem('layer').value.trim(),
            bounds: {
              min: { x, y: bottom, z },
              max: { x: x + width, y: bottom + height, z: z + depth },
            },
          },
          this.form.elements.namedItem('operation').value
        );
        this.status.textContent = `Volume ${index} applied. Undo restores the previous geometry.`;
      });
    });
    this.view.addEventListener('change', () =>
      this._perform(() => {
        const selected = this.view.value;
        this.engine.setVisibleLayers(
          selected === '@cutaway'
            ? [
                ...new Set([
                  'ground',
                  ...this.engine.geometry.save().volumes.map((volume) => volume.layerId),
                ]),
              ].filter((layer) => layer !== 'roof')
            : selected
              ? [selected]
              : null
        );
      })
    );
    this.proof.addEventListener('click', () =>
      this._perform(() => {
        this._requireIdle();
        if (
          this.engine.geometry.hasVolumes ||
          this.engine.save().heights.some((row) => row.some((height) => height !== 0))
        ) {
          throw new Error(
            'Use a new blank map for the proof structures; existing terrain was not changed'
          );
        }
        this.engine.addVolumes(
          createLayeredExamples({
            widthFeet: this.engine.cols * 5,
            depthFeet: this.engine.rows * 5,
          })
        );
        this.status.textContent =
          'Proof structures added as one undoable edit. Hide roof/upper layers to inspect interiors.';
      })
    );
    this._unsubscribe = this.engine.onChanged(() => this._render());
    this._render();
  }

  _render() {
    const volumes = this.engine.geometry.save().volumes;
    const visible = this.engine.visibleLayers;
    const selection = visible === null ? '' : visible.length === 1 ? visible[0] : '@cutaway';
    const layers = new Set(['ground', ...volumes.map((volume) => volume.layerId)]);
    const options = [
      new Option('All layers', ''),
      new Option('Cutaway: hide roof layer', '@cutaway'),
      ...[...layers].sort().map((layer) => new Option(`${layer} only`, layer)),
    ];
    this.view.replaceChildren(...options);
    this.view.value = selection === '@cutaway' || layers.has(selection) ? selection : '';
    this.proof.disabled = volumes.some((volume) => volume.id.startsWith('proof-'));
  }

  _requireIdle() {
    const gm = this.gameManager;
    if (
      gm.sceneAutosave?.ready === false ||
      gm.placedTokens?.some((token) => gm.token3DAdapter?.isMovementInProgress(token)) ||
      gm.characterServices?.combat?.pending ||
      gm.characterServices?.library?.isSaving
    ) {
      throw new Error(
        'Finish the current map, movement or character action before changing geometry'
      );
    }
  }

  _perform(operation) {
    try {
      operation();
    } catch (error) {
      this.status.textContent = error.message;
      new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
        context: 'TerrainConstructionPanel',
      });
    }
  }

  dispose() {
    this._unsubscribe();
    this.root.replaceChildren();
  }
}
