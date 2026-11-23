import {
  getBiomeGenerationReviewDefaults,
  getBiomeGenerationFamily,
  isBiomeGenerationFieldAvailable,
  normalizeBiomeGenerationChoices,
} from '../../config/biome/BiomeGenerationFamilies.js';
import { escapeHtml } from '../characters/escapeHtml.js';
import { GRID_CONFIG } from '../../config/GameConstants.js';
import {
  CAVERN_BIOME_KEYS,
  DUNGEON_ROOM_COUNT,
  dungeonRoomCapacity,
} from '../../config/biome/BiomeConstants.js';

let activeReview = null;

const optionValue = (option) => option.value ?? option.key;

export function openBiomeGenerationReview({
  biomeKey,
  biomeName,
  generationRecipe = null,
  gridSize = { cols: GRID_CONFIG.DEFAULT_COLS, rows: GRID_CONFIG.DEFAULT_ROWS },
  cavernDefaults = { totalChambers: 1, outsideSides: [], outsideMode: 'separate' },
  structuresEnabled = true,
  protectedAssetsAvailable = false,
  protectedAssetsUnavailableReason = null,
}) {
  const family = getBiomeGenerationFamily(biomeKey);
  if (!family) throw new Error('Choose a supported biome family before generating');
  if (
    typeof protectedAssetsAvailable !== 'boolean' ||
    !gridSize ||
    !Number.isInteger(gridSize.cols) ||
    !Number.isInteger(gridSize.rows) ||
    gridSize.cols < GRID_CONFIG.MIN_COLS ||
    gridSize.cols > GRID_CONFIG.MAX_COLS ||
    gridSize.rows < GRID_CONFIG.MIN_ROWS ||
    gridSize.rows > GRID_CONFIG.MAX_ROWS
  )
    throw new Error('The active map has an invalid grid size');
  activeReview?.cancel();

  const previousFocus = document.activeElement;
  const defaults = getBiomeGenerationReviewDefaults(biomeKey, generationRecipe);
  const fields = family.fields.filter((field) => field.id !== 'footprint');
  const root = document.createElement('div');
  root.className = 'biome-generation-review-backdrop';
  root.dataset.biomeGenerationReview = '';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'biome-generation-review-title');
  root.innerHTML = `
    <section class="biome-generation-review">
      <header>
        <p class="campaign-eyebrow">Generation review</p>
        <h2 id="biome-generation-review-title">${escapeHtml(family.label)}</h2>
        <p>Review and adjust the map before generation. The selected variant becomes the biome saved with this map.</p>
      </header>
      <form>
        <div class="biome-generation-fields">
          <label class="biome-generation-field">
            <span>Grid width (squares)</span>
            <input type="number" name="gridCols" min="${GRID_CONFIG.MIN_COLS}" max="${GRID_CONFIG.MAX_COLS}" step="1" value="${gridSize.cols}" required>
            <small>Choose the number of columns.</small>
          </label>
          <label class="biome-generation-field">
            <span>Grid height (squares)</span>
            <input type="number" name="gridRows" min="${GRID_CONFIG.MIN_ROWS}" max="${GRID_CONFIG.MAX_ROWS}" step="1" value="${gridSize.rows}" required>
            <small>Choose the number of rows.</small>
          </label>
          ${fields
            .map((field) => {
              const fallback = defaults[field.id] ?? optionValue(field.options[0]);
              return `
                <label class="biome-generation-field" data-field="${field.id}">
                  <span>${escapeHtml(field.label)}</span>
                  <select name="${field.id}">
                    ${field.options
                      .map((option) => {
                        const value = optionValue(option);
                        return `<option value="${escapeHtml(value)}" ${
                          value === fallback ? 'selected' : ''
                        } ${
                          field.id === 'assetPack' &&
                          value === 'pure-poly' &&
                          !protectedAssetsAvailable
                            ? 'disabled'
                            : ''
                        }>${escapeHtml(option.label)}</option>`;
                      })
                      .join('')}
                  </select>
                  <small>${escapeHtml(
                    field.id === 'assetPack' && !protectedAssetsAvailable
                      ? protectedAssetsUnavailableReason
                        ? `Pure Poly scenery is unavailable: ${protectedAssetsUnavailableReason}. Choose built-in scenery or restore access.`
                        : 'Pure Poly scenery is unavailable until protected-asset access is configured.'
                      : field.description
                  )}</small>
                </label>`;
            })
            .join('')}
          <div class="biome-generation-field" data-field="cavernNetwork" hidden>
            <label>
                <span>Total chambers</span>
                <input type="number" name="totalChambers" min="1" max="128" step="1" value="${cavernDefaults.totalChambers}" required>
            </label>
            <small>Includes this map. Additional chambers start as separate blank grids.</small>
            <fieldset>
                <legend>Entrances leading outside</legend>
                ${['north', 'east', 'south', 'west']
                  .map(
                    (side) => `
                      <label class="biome-generation-checkbox">
                        <input type="checkbox" name="outsideSide" value="${side}" ${
                          cavernDefaults.outsideSides.includes(side) ? 'checked' : ''
                        }>
                        <span>${side[0].toUpperCase() + side.slice(1)}</span>
                      </label>`
                  )
                  .join('')}
            </fieldset>
            <label>
                <span>Outside destinations</span>
                <select name="outsideMode">
                  <option value="separate" ${cavernDefaults.outsideMode === 'separate' ? 'selected' : ''}>Separate outside maps</option>
                  <option value="shared" ${cavernDefaults.outsideMode === 'shared' ? 'selected' : ''}>One shared outside map</option>
                </select>
            </label>
            <small>Unselected entrances remain available for other chambers or later connections.</small>
          </div>
        </div>
        <output class="biome-generation-summary" aria-live="polite"></output>
        <footer>
          <button type="button" data-cancel>Cancel</button>
          <button type="submit" class="primary-button">Generate ${escapeHtml(
            biomeName || family.label
          )}</button>
        </footer>
      </form>
    </section>`;
  document.body.appendChild(root);

  let resolveReview;
  const pending = new Promise((resolve) => {
    resolveReview = resolve;
  });
  const form = root.querySelector('form');
  let roomCountEdited = false;
  let reliefEdited = false;
  let assetPackEdited = false;
  const updateAvailableFields = () => {
    const variant = form.elements.namedItem('variant')?.value;
    const packSelect = form.elements.namedItem('assetPack');
    if (packSelect && !assetPackEdited) {
      const saved = generationRecipe?.version === 1 && generationRecipe.biomeKey === variant;
      packSelect.value = saved
        ? getBiomeGenerationReviewDefaults(variant, generationRecipe).assetPack
        : protectedAssetsAvailable
          ? 'pure-poly'
          : 'standard';
    }
    const assetPack = form.elements.namedItem('assetPack')?.value || 'standard';
    for (const field of fields) {
      if (!field.variants) continue;
      const select = form.elements.namedItem(field.id);
      const available =
        isBiomeGenerationFieldAvailable(field, variant, assetPack) &&
        (field.id !== 'dungeonRoomCount' || structuresEnabled);
      select.disabled = !available;
      select.closest('[data-field]')?.toggleAttribute('hidden', !available);
    }
    packSelect?.setCustomValidity(
      !packSelect.disabled && packSelect.value === 'pure-poly' && !protectedAssetsAvailable
        ? 'Protected scenery is unavailable. Configure access or choose built-in scenery.'
        : ''
    );
    const roomCount = form.elements.namedItem('dungeonRoomCount');
    if (roomCount) {
      if (
        variant === 'dungeon' &&
        !roomCountEdited &&
        generationRecipe?.version === 1 &&
        generationRecipe.biomeKey === 'dungeon' &&
        generationRecipe.values?.dungeonRoomCount !== undefined
      ) {
        const saved = generationRecipe.values.dungeonRoomCount;
        if (
          !Number.isInteger(saved) ||
          saved < DUNGEON_ROOM_COUNT.min ||
          saved > DUNGEON_ROOM_COUNT.max
        )
          throw new Error('The saved Dungeon room count is invalid');
        roomCount.value = String(saved);
      }
      const cols = Number(form.elements.namedItem('gridCols').value);
      const rows = Number(form.elements.namedItem('gridRows').value);
      const maximum = dungeonRoomCapacity(cols, rows);
      const guidance = roomCount.closest('[data-field]').querySelector('small');
      const message =
        maximum === 0
          ? `Dungeon rooms need at least a ${DUNGEON_ROOM_COUNT.minimumGrid} x ${DUNGEON_ROOM_COUNT.minimumGrid} grid.`
          : `This grid fits up to ${maximum} rooms. Choose a larger grid or fewer rooms if needed.`;
      guidance.textContent = message;
      roomCount.setCustomValidity(
        variant === 'dungeon' &&
          structuresEnabled &&
          (maximum === 0 || Number(roomCount.value) > maximum)
          ? message
          : ''
      );
    }
    const network = root.querySelector('[data-field="cavernNetwork"]');
    const available = CAVERN_BIOME_KEYS.includes(variant);
    network.hidden = !available;
    for (const input of network.querySelectorAll('input,select')) input.disabled = !available;
  };
  const finish = (result) => {
    if (activeReview?.root !== root) return;
    activeReview = null;
    root.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    resolveReview(result);
  };
  const selectedSummary = () => {
    const data = new FormData(form);
    const values = Object.fromEntries(data);
    const assetPack = form.elements.namedItem('assetPack')?.value || 'standard';
    const choices = fields
      .filter((field) => isBiomeGenerationFieldAvailable(field, values.variant, assetPack))
      .map((field) => {
        const value = field.id === 'assetPack' ? assetPack : values[field.id];
        const option = field.options.find((entry) => optionValue(entry) === value);
        return `${field.label}: ${option?.label ?? value}`;
      })
      .join(' · ');
    const network = CAVERN_BIOME_KEYS.includes(values.variant)
      ? ` · Chambers: ${values.totalChambers} · Outside: ${data.getAll('outsideSide').join(', ') || 'none'}`
      : '';
    return `Grid: ${values.gridCols} × ${values.gridRows} · ${choices}${network}`;
  };
  const updateSummary = () => {
    updateAvailableFields();
    const variant = form.elements.namedItem('variant')?.value;
    const label = family.variants.find((entry) => entry.key === variant)?.label;
    form.querySelector('button[type="submit"]').textContent =
      `Generate ${label || biomeName || family.label}`;
    root.querySelector('.biome-generation-summary').textContent = selectedSummary();
  };
  activeReview = { root, cancel: () => finish(null) };
  const onChange = (event) => {
    if (event.target.name === 'dungeonRoomCount') roomCountEdited = true;
    if (event.target.name === 'relief') reliefEdited = true;
    if (event.target.name === 'assetPack') assetPackEdited = true;
    updateSummary();
  };
  form.addEventListener('change', onChange);
  form.addEventListener('input', onChange);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.checkValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    const options = normalizeBiomeGenerationChoices(family.key, values, generationRecipe);
    if (
      biomeKey === 'saltFlats' &&
      options.biomeKey === 'saltFlats' &&
      generationRecipe?.version === 1 &&
      generationRecipe.biomeKey === 'saltFlats' &&
      generationRecipe.values?.relief !== undefined &&
      !reliefEdited
    )
      options.relief = generationRecipe.values.relief;
    delete options.canvasScale;
    if (options.biomeKey === 'dungeon' && !structuresEnabled) delete options.dungeonRoomCount;
    if (CAVERN_BIOME_KEYS.includes(options.biomeKey)) {
      const data = new FormData(form);
      options.cavernNetwork = {
        totalChambers: Number(values.totalChambers),
        outsideSides: data.getAll('outsideSide'),
        outsideMode: values.outsideMode,
      };
    }
    finish({
      ...options,
      gridSize: { cols: Number(values.gridCols), rows: Number(values.gridRows) },
    });
  });
  root.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
  root.addEventListener('click', (event) => {
    if (event.target === root) finish(null);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(null);
    }
  });
  updateSummary();
  form.querySelector('select')?.focus();
  return pending;
}
