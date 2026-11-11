import {
  STRUCTURE_TYPES,
  createStructure,
  structureMinimumHeight,
  structureMinimumDiameter,
  isRockFormation,
  isRoundStructure,
  structureHeightChanges,
} from '../terrain/ConstructionBlueprints.js';
import {
  unlinkBuildingInteriors,
  getConstructionCeiling,
} from '../campaigns/CampaignConstruction.js';
import { isBuildingJoinConnection } from '../terrain/BuildingSnaps.js';
import { ConstructionPreview } from '../scene/terrain/ConstructionPreview.js';
import { ConstructionGizmos } from '../scene/terrain/ConstructionGizmos.js';
import { UndergroundConstructionView } from '../scene/terrain/UndergroundConstructionView.js';
import { ConstructionIdentification } from '../scene/terrain/ConstructionIdentification.js';
import { cellarConnectionCandidates } from '../terrain/CellarConnections.js';
import { WALL_STAIR_FIELDS, wallStairFootprint } from '../terrain/WallStairs.js';
import {
  stretchStructure,
  stretchStructureHeight,
  stretchBuildingFeature,
  changeBuildingFootprint,
  slideWallStairs,
} from '../terrain/ConstructionHandles.js';
import {
  ROOF_TYPES,
  buildingStoreys,
  buildingDimensions,
  buildingWindows,
  buildingFeetToLocal,
  buildingLocalToFeet,
  buildingWallPoint,
  buildingForHeight,
  buildingFeatureLimits,
  windowVerticalOverlap,
  buildingLevels,
  buildingLevelElevation,
  buildingLevelHeight,
  explicitBuilding,
  changeBuildingLevelHeight,
  removeBuildingLevel,
  addBuildingLevel,
  structureDisplayName,
} from '../terrain/BuildingModel.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/error/ErrorHandler.js';

export class TerrainConstructionPanel {
  constructor({ root, gameManager }) {
    this.root = root;
    this.gameManager = gameManager;
    this.engine = gameManager.terrainEngine;
    this.preview = new ConstructionPreview(gameManager);
    this.gizmos = new ConstructionGizmos(gameManager);
    this.underground = new UndergroundConstructionView(gameManager);
    this.identification = new ConstructionIdentification(gameManager, (spec) =>
      this._perform(() => {
        this._requireIdle();
        this._select(spec);
      })
    );
    this.hasPlacementPoint = false;
    this.cellarPositioned = false;
    this.featureTool = null;
    this.selectedFeature = null;
    this.selectedId = null;
    this.draft = null;
    this.snapPreview = null;
    this.pointer = null;
    this.pendingFrame = null;
    this.disposers = [];
    root.innerHTML = `
      <div class="section-subtitle">Build</div>
      <label class="construction-underground-toggle"><input type="checkbox" data-underground-view> Show underground</label>
      <small class="small-text" data-underground-help hidden>Ground and buildings are wireframe only in this edit view. Click a cellar outline to select it; choose its Level to edit that floor.</small>
      <div class="construction-palette" role="group" aria-label="Structure types">
        ${STRUCTURE_TYPES.map(
          (
            type
          ) => `<button type="button" class="construction-card" data-build-kind="${type.kind}" aria-pressed="false">
          <img src="assets/images/construction/${type.kind}.svg" alt="" width="90" height="64">
          <span>${type.label}</span></button>`
        ).join('')}
        <button type="button" class="construction-card" data-build-castle-wall aria-pressed="false">
          <img src="assets/images/construction/castle-wall.svg" alt="" width="90" height="64"><span>Castle wall</span>
        </button>
      </div>
      <button type="button" class="terrain-tool-btn" data-build-select aria-pressed="false">Select / resize</button>
      <p class="small-text" data-build-help>Choose a structure. Drag walls and tunnels; click to place other shapes.</p>
      <form class="construction-size-form" aria-label="Structure size" hidden>
        <label data-size="heightFeet"><span data-height-label>Height (ft)</span><input name="heightFeet" type="number" min="5" max="100" step="1" class="grid-input" required></label>
        <label data-size="diameterFeet">Diameter (ft)<input name="diameterFeet" type="number" min="15" max="500" step="5" class="grid-input" required></label>
        <label data-size="lengthFeet">Length (ft)<input name="lengthFeet" type="number" min="5" max="1000" step="any" class="grid-input" required></label>
        <label data-size="widthFeet">Width (ft)<input name="widthFeet" type="number" min="10" max="500" step="5" class="grid-input" required></label>
        <label data-size="style">Wall style<select name="style" class="grid-input"><option value="plain">Plain wall</option><option value="battlement">Battlements</option></select></label>
        <label data-size="opening"><input name="opening" type="checkbox"> Door opening</label>
        <label data-size="wallStairs"><input name="wallStairs" type="checkbox"> Parallel wall stairs</label>
        <div class="construction-levels" data-wall-stair-controls hidden>
          <label>Stair layout<select name="wallStairLayout" class="grid-input">
            <option value="auto">Automatic (switchbacks above 10 ft)</option>
            <option value="straight">Straight</option><option value="switchback">Switchback</option>
          </select></label>
          <label>Stair position along wall (ft)<input name="wallStairOffsetFeet" type="number" min="0" step="0.5" class="grid-input"></label>
          <div class="construction-actions">
            <button type="button" class="terrain-tool-btn" data-stair-flip-direction>Flip ascent direction</button>
            <button type="button" class="terrain-tool-btn" data-stair-flip-side>Swap wall side</button>
          </div>
          <small class="small-text" data-stair-layout-status>Drag the blue stair handle to move it along the wall. Apply commits button/field previews.</small>
        </div>
        <label data-size="ruined"><input name="ruined" type="checkbox"> Ruined</label>
        <button type="button" class="terrain-tool-btn" data-build-rotate>Rotate 90°</button>
        <button type="button" class="terrain-tool-btn" data-building-upgrade hidden>Preview upgrade to storeys</button>
        <div class="construction-building" data-building-options hidden>
          <div class="section-subtitle" data-base-title>Building base</div>
          <div class="construction-palette" role="group" aria-label="Building base" data-building-base-controls>
            <button type="button" class="construction-card" data-building-base="building" aria-pressed="false">
              <img src="assets/images/construction/building.svg" alt="" width="90" height="64"><span>Square / rectangular</span>
            </button>
            <button type="button" class="construction-card" data-building-base="turret" aria-pressed="false">
              <img src="assets/images/construction/turret.svg" alt="" width="90" height="64"><span>Round</span>
            </button>
          </div>
          <div class="section-subtitle" data-roof-title>Roof</div>
          <div class="construction-palette" role="group" aria-label="Roof type" data-building-roof-controls>
            ${ROOF_TYPES.map(
              (
                roof
              ) => `<button type="button" class="construction-card" data-building-roof="${roof}" aria-pressed="false">
              <img src="assets/images/construction/roof-${roof}.svg" alt="" width="90" height="64"><span>${roof === 'gable' ? 'Gabled' : roof === 'none' ? 'Open / none' : roof === 'battlement' ? 'Battlements' : roof[0].toUpperCase() + roof.slice(1)}</span></button>`
            ).join('')}
          </div>
          <label data-roof-rise>Roof rise (ft)<input name="roofRiseFeet" type="number" min="1" max="30" step="1" class="grid-input"></label>
          <label title="New buildings use sparse, varied window sizes and facade patterns. New turrets put automatic windows on their entrance side; manual windows can use any wall. Saved layouts keep their original pattern."><input name="autoWindows" type="checkbox" checked> Automatic windows</label>
          <label><input name="stairs" type="checkbox" checked> Automatic stairs</label>
          <div class="construction-levels" data-level-controls>
            <div class="section-subtitle">Floors and room height</div>
            <label>Level<select name="editFloor" class="grid-input"></select></label>
            <label data-room-height>Room height (ft)<input name="roomHeightFeet" type="number" min="10" max="100" step="5" class="grid-input"></label>
            <div class="construction-actions">
              <button type="button" class="terrain-tool-btn" data-level-height>Preview height</button>
              <button type="button" class="terrain-tool-btn" data-level-add>Add level</button>
              <button type="button" class="terrain-tool-btn" data-level-remove>Remove whole floor</button>
              <button type="button" class="terrain-tool-btn" data-floor-cut aria-pressed="false">Draw floor opening</button>
            </div>
            <label data-floor-opening-choice>Floor opening<select name="floorOpening" class="grid-input"></select></label>
            <button type="button" class="terrain-tool-btn" data-floor-fill>Fill selected opening</button>
            <small class="small-text" data-level-help>Heights and whole-floor removal are previews until Apply. Drawn openings commit on release.</small>
          </div>
          <div class="construction-levels" data-cellar-controls hidden>
            <div class="section-subtitle">Cellar access (optional)</div>
            <label>Access<select name="cellarAccess" class="grid-input"><option value="none">Unlinked</option><option value="stairs">Stairs</option><option value="ladder">Ladder</option></select></label>
            <label>Connect to<select name="cellarTarget" class="grid-input"></select></label>
            <small class="small-text" data-cellar-target-help>Move the cellar preview near a building, or place it first. Only buildings that fit this access point are listed.</small>
            <div class="construction-feature-size">
              <label>Access X from centre (ft)<input name="cellarAccessX" type="number" step="2.5" class="grid-input"></label>
              <label>Access Z from centre (ft)<input name="cellarAccessZ" type="number" step="2.5" class="grid-input"></label>
            </div>
            <button type="button" class="terrain-tool-btn" data-cellar-place-access aria-pressed="false">Place access on map</button>
            <small class="small-text">Show underground reveals buried rooms. Drag the centre handle to move the cellar; side handles resize it. The hatch and stairs must fit the connected ground-floor map.</small>
          </div>
          <div data-building-feature-controls hidden>
            <label>Feature floor<select name="featureFloor" class="grid-input"></select></label>
            <div class="construction-actions">
              <button type="button" class="terrain-tool-btn" data-building-feature="window" aria-pressed="false">Window</button>
              <button type="button" class="terrain-tool-btn" data-building-feature="balcony" aria-pressed="false">Balcony</button>
              <button type="button" class="terrain-tool-btn" data-feature-remove hidden>Remove feature</button>
            </div>
            <div class="construction-feature-size" data-feature-fields hidden role="group" aria-label="Selected feature size">
              <div class="section-subtitle" data-feature-title>Selected feature</div>
              <label data-feature-size="widthFeet"><span data-feature-width-label>Width (ft)</span><input name="featureWidthFeet" data-feature-value="widthFeet" type="number" step="0.1" class="grid-input"></label>
              <label data-feature-size="heightFeet">Window height (ft)<input name="featureHeightFeet" data-feature-value="heightFeet" type="number" step="0.1" class="grid-input"></label>
              <label data-feature-size="sillFeet">Window sill (ft)<input name="featureSillFeet" data-feature-value="sillFeet" type="number" step="0.1" class="grid-input"></label>
              <label data-feature-size="depthFeet">Balcony depth (ft)<input name="featureDepthFeet" data-feature-value="depthFeet" type="number" step="0.5" class="grid-input"></label>
              <small class="small-text" data-feature-hint>Drag the blue handles, or edit dimensions and Apply.</small>
              <button type="button" class="terrain-tool-btn" data-feature-apply>Apply feature size</button>
            </div>
          </div>
        </div>
        <div data-building-join-controls hidden>
          <label>Connect interiors to<select name="joinTarget" class="grid-input"></select></label>
          <button type="button" class="terrain-tool-btn" data-building-join-preview>Preview connected interiors</button>
          <button type="button" class="terrain-tool-btn" data-building-join-remove hidden>Disconnect interiors for editing</button>
          <small class="small-text">Move within 10 feet of a compatible building face, preview, then Apply. Both shared walls open; Cancel changes nothing.</small>
        </div>
        <div class="construction-actions" data-edit-actions hidden>
          <button type="submit" class="terrain-tool-btn">Apply size</button>
          <button type="button" class="terrain-tool-btn" data-build-cancel>Cancel</button>
          <button type="button" class="terrain-tool-btn" data-build-remove>Remove</button>
        </div>
      </form>
      <label class="construction-cutaway"><input type="checkbox" data-build-cutaway> Show interiors (hide roofs)</label>
      <label data-cellar-edit-label hidden>Edit cellar<select data-cellar-edit class="grid-input"><option value="">Choose an existing cellar</option></select></label>
      <small data-construction-status class="small-text" role="status" aria-live="polite"></small>`;
    this.form = root.querySelector('form');
    this.status = root.querySelector('[data-construction-status]');
    this.help = root.querySelector('[data-build-help]');
    this.floorTool = null;
    this._listen(root.querySelector('[data-building-join-preview]'), 'click', () =>
      this._perform(() => this._previewBuildingJoin())
    );
    this._listen(this.form.elements.namedItem('joinTarget'), 'change', () =>
      this._perform(() => this._queuePreview())
    );
    this._listen(root.querySelector('[data-building-join-remove]'), 'click', () =>
      this._perform(() => {
        this._requireIdle();
        this._cancelSnapPreview();
        const changed = unlinkBuildingInteriors(this.gameManager, this.selectedId);
        this._select(
          this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId)
        );
        this.status.textContent = changed
          ? 'Interiors disconnected. Edit this member normally; Undo restores the connection.'
          : 'This building has no connected interiors.';
      })
    );
    this._listen(root.querySelector('[data-underground-view]'), 'change', (event) =>
      this._perform(() => {
        if (event.target.checked && !['select', 'cellar'].includes(this.engine.constructionTool))
          this._choose('select');
        this._render();
        this._queuePreview();
      })
    );
    for (const [selector, key, values] of [
      ['[data-stair-flip-direction]', 'wallStairDirection', ['forward', 'reverse']],
      ['[data-stair-flip-side]', 'wallStairSide', ['near', 'far']],
    ])
      this._listen(root.querySelector(selector), 'click', () =>
        this._perform(() => {
          this._readDraft();
          this.draft = createStructure({
            ...this.draft,
            [key]: (this.draft[key] ?? values[0]) === values[0] ? values[1] : values[0],
          });
          this._fill();
          this._render();
          this._queuePreview();
          this.status.textContent = 'Stair placement preview. Apply to update the wall.';
        })
      );
    for (const button of root.querySelectorAll('[data-build-kind]'))
      this._listen(button, 'click', () =>
        this._perform(() => this._choose(button.dataset.buildKind))
      );
    this._listen(root.querySelector('[data-build-select]'), 'click', () =>
      this._perform(() => this._choose('select'))
    );
    this._listen(root.querySelector('[data-build-castle-wall]'), 'click', () =>
      this._perform(() => {
        this._choose('wall');
        this.draft = createStructure({
          ...this.draft,
          style: 'battlement',
          widthFeet: 15,
          lengthFeet: 60,
          wallStairs: true,
        });
        this._fill();
        this._render();
      })
    );
    this._listen(this.form, 'input', (event) =>
      this._perform(() => {
        if (event.target.name === 'joinTarget') return;
        if (
          event.target.matches('[name="editFloor"],[name="roomHeightFeet"],[name="floorOpening"]')
        )
          return;
        if (event.target.matches('[name^="cellar"]')) {
          this._readCellarAccess(event.target.name === 'cellarAccess');
          return;
        }
        if (event.target.matches('[data-feature-value]')) this._readFeatureDraft();
        else this._readDraft();
      })
    );
    this._listen(this.form, 'submit', (event) => {
      event.preventDefault();
      this._perform(() => {
        this._requireIdle();
        if (this.snapPreview) {
          this._commitDraft();
          return;
        }
        if (this.selectedFeature) this._readFeatureDraft();
        const room = this.form.elements.namedItem('roomHeightFeet');
        if (
          this.draft?.building &&
          !room.disabled &&
          Number(room.value) !== buildingLevelHeight(this.draft, this._editFloorId())
        )
          this._setLevelDraft(
            changeBuildingLevelHeight(this.draft, this._editFloorId(), Number(room.value))
          );
        this._readDraft();
        const fields = Object.fromEntries(
          [
            'kind',
            ...(this.draft.kind === 'wall' ? WALL_STAIR_FIELDS : []),
            'heightFeet',
            'diameterFeet',
            'lengthFeet',
            'widthFeet',
            'angleRadians',
            'style',
            'opening',
            'ruined',
            ...(this.draft.building ? ['building'] : []),
          ].map((key) => [key, this.draft[key]])
        );
        const changed = this.engine.resizeStructure(this.selectedId, fields);
        this._select(
          this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId)
        );
        this._syncCutaway();
        this.status.textContent =
          changed === false
            ? 'No size changes to apply.'
            : 'Structure resized. Undo restores its previous size.';
      });
    });
    for (const button of root.querySelectorAll('[data-building-roof]'))
      this._listen(button, 'click', () =>
        this._perform(() => {
          this._readDraft();
          this.draft = createStructure({
            ...this.draft,
            building: {
              ...this.draft.building,
              version: Math.max(2, this.draft.building.version),
              roof: button.dataset.buildingRoof,
            },
          });
          this._render();
          this._queuePreview();
        })
      );
    for (const button of root.querySelectorAll('[data-building-base]'))
      this._listen(button, 'click', () =>
        this._perform(() => {
          this._readDraft();
          const previous = this.draft.kind;
          this.draft = changeBuildingFootprint(this.draft, button.dataset.buildingBase);
          if (
            previous !== this.draft.kind &&
            this.draft.kind === 'turret' &&
            ['gable', 'hipped'].includes(this.draft.building.roof)
          )
            this.draft = createStructure({
              ...this.draft,
              building: { ...this.draft.building, roof: 'conical' },
            });
          this.featureTool = null;
          this.selectedFeature = null;
          if (!this.selectedId) this.engine.setConstructionTool(this.draft.kind);
          this._fill();
          this._render();
          this._queuePreview();
          this.status.textContent = this.selectedId
            ? 'Base preview. Apply to change the footprint and matching roof.'
            : 'Choose a position for the building.';
        })
      );
    this._listen(root.querySelector('[data-feature-apply]'), 'click', () =>
      this._perform(() => {
        this._readFeatureDraft();
        this._readDraft();
        this._commitDraft();
      })
    );
    this._listen(this.form.elements.namedItem('editFloor'), 'change', () =>
      this._perform(() => {
        this.selectedFeature = null;
        this.featureTool = null;
        this._render();
        this._queuePreview();
      })
    );
    this._listen(root.querySelector('[data-level-height]'), 'click', () =>
      this._perform(() => {
        this._setLevelDraft(
          changeBuildingLevelHeight(
            this.draft,
            this._editFloorId(),
            Number(this.form.elements.namedItem('roomHeightFeet').value)
          )
        );
        this.status.textContent = 'Room-height preview. Apply to move higher levels and the roof.';
      })
    );
    this._listen(root.querySelector('[data-level-add]'), 'click', () =>
      this._perform(() => {
        this._setLevelDraft(addBuildingLevel(this.draft));
        this.status.textContent =
          this.draft.kind === 'cellar'
            ? 'Deeper cellar-level preview. Apply to excavate.'
            : 'New upper-floor preview. Apply to build.';
      })
    );
    this._listen(root.querySelector('[data-level-remove]'), 'click', () =>
      this._perform(() => {
        this._setLevelDraft(removeBuildingLevel(this.draft, this._editFloorId()));
        this.status.textContent =
          'Whole-floor removal preview. Higher levels stay at their elevations. Apply to remove.';
      })
    );
    this._listen(root.querySelector('[data-floor-cut]'), 'click', () =>
      this._perform(() => {
        if (!this.selectedId) throw new Error('Place the structure before drawing floor openings');
        this.floorTool = this.floorTool === 'cut' ? null : 'cut';
        this.featureTool = null;
        this.selectedFeature = null;
        this._render();
        this._queuePreview();
      })
    );
    this._listen(root.querySelector('[data-floor-fill]'), 'click', () =>
      this._perform(() => {
        const id = this.form.elements.namedItem('floorOpening').value,
          building = explicitBuilding(this.draft);
        const level = building.levels.find((entry) => entry.id === this._editFloorId());
        if (!level || !level.openings.some((hole) => hole.id === id))
          throw new Error('Choose an existing opening to fill');
        level.openings = level.openings.filter((hole) => hole.id !== id);
        this.draft = createStructure({ ...this.draft, building });
        this._commitDraft();
      })
    );
    this._listen(root.querySelector('[data-cellar-place-access]'), 'click', () =>
      this._perform(() => {
        if (!this.selectedId)
          throw new Error('Place the cellar before positioning its access on the map');
        if (this.draft.building.access.kind === 'none')
          throw new Error('Choose stairs or a ladder before placing cellar access');
        this.floorTool = this.floorTool === 'cellar-access' ? null : 'cellar-access';
        this.featureTool = null;
        this.selectedFeature = null;
        this._render();
        this._queuePreview();
      })
    );
    this._listen(root.querySelector('[data-cellar-edit]'), 'change', (event) =>
      this._perform(() => {
        if (!event.target.value) return;
        this._select(
          this.engine.geometry.getStructures().find((spec) => spec.id === event.target.value)
        );
      })
    );
    this._listen(root.querySelector('[data-building-upgrade]'), 'click', () =>
      this._perform(() => {
        const floors = Math.max(1, Math.ceil(this.draft.heightFeet / 10));
        this.draft = createStructure({
          ...this.draft,
          heightFeet: floors * 10,
          ...(floors > 1
            ? this.draft.kind === 'turret'
              ? { diameterFeet: Math.max(25, this.draft.diameterFeet) }
              : {
                  lengthFeet: Math.max(20, this.draft.lengthFeet),
                  widthFeet: Math.max(15, this.draft.widthFeet),
                }
            : {}),
          building: {},
        });
        this._fill();
        this._render();
        this._queuePreview();
        this.status.textContent =
          'Upgrade preview. Apply to add connected storeys, stairs and windows.';
      })
    );
    for (const button of root.querySelectorAll('[data-building-feature]'))
      this._listen(button, 'click', () =>
        this._perform(() => {
          this._readDraft();
          if (
            !this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId)
              ?.building
          )
            throw new Error('Apply the building upgrade before editing its wall features');
          this.featureTool =
            this.featureTool === button.dataset.buildingFeature
              ? null
              : button.dataset.buildingFeature;
          this.selectedFeature = null;
          this.floorTool = null;
          if (this.featureTool === 'balcony') {
            if (buildingStoreys(this.draft) < 2)
              throw new Error('Add an upper storey before placing a balcony');
            const field = this.form.elements.namedItem('featureFloor');
            if (Number(field.value) === 0) field.value = '1';
          }
          this.gizmos.clear();
          this._render();
          this._queuePreview();
        })
      );
    this._listen(root.querySelector('[data-feature-remove]'), 'click', () =>
      this._perform(() => this._removeFeature())
    );
    this._listen(this.form.elements.namedItem('featureFloor'), 'change', () =>
      this._perform(() => {
        if (!this.selectedFeature) return;
        const floor = Number(this.form.elements.namedItem('featureFloor').value);
        if (this.selectedFeature.kind === 'window') {
          const window = buildingWindows(this.draft).find((w) => w.id === this.selectedFeature.id);
          this._setFeature(
            {
              ...window,
              floor,
              heightFeet: Math.min(
                window.heightFeet,
                this.draft.heightFeet -
                  buildingLevelElevation(this.draft, floor) -
                  window.sillFeet -
                  1
              ),
            },
            'window'
          );
        } else {
          const balcony = this.draft.building.balconies.find(
            (b) => b.id === this.selectedFeature.id
          );
          this._setFeature({ ...balcony, floor }, 'balcony');
        }
        this._fillFeatureFields();
        this._queuePreview();
      })
    );
    this._listen(root.querySelector('[data-build-cancel]'), 'click', () =>
      this._perform(() => {
        if (this.selectedId)
          this._select(
            this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId)
          );
        else this.cancel();
      })
    );
    this._listen(root.querySelector('[data-build-remove]'), 'click', () =>
      this._perform(() => {
        this._requireIdle();
        this.engine.removeStructure(this.selectedId);
        this.selectedId = null;
        this.draft = null;
        this.preview.clear();
        this._render();
        this.status.textContent = 'Structure removed. Undo restores it.';
      })
    );
    this._listen(root.querySelector('[data-build-rotate]'), 'click', () =>
      this._perform(() => {
        this._readDraft();
        this.draft = createStructure({
          ...this.draft,
          angleRadians: this.draft.angleRadians + Math.PI / 2,
        });
        if (this.selectedId) this._queuePreview();
      })
    );
    this._listen(root.querySelector('[data-build-cutaway]'), 'change', (event) =>
      this._perform(() => {
        this.engine.setVisibleLayers(
          event.target.checked
            ? [
                ...new Set([
                  'ground',
                  ...this.engine.geometry.save().volumes.map((v) => v.layerId),
                ]),
              ].filter((layer) => layer !== 'roof')
            : null
        );
      })
    );
    this.canvas = gameManager.getEventCanvas?.() || gameManager.threeSceneManager?.canvas;
    if (this.canvas) {
      for (const [type, handler] of [
        ['pointerdown', (event) => this._pointerDown(event)],
        ['pointermove', (event) => this._pointerMove(event)],
        ['pointerup', (event) => this._pointerUp(event)],
        ['pointercancel', () => this.cancel()],
        [
          'mouseleave',
          () => {
            if (!this.pointer && !this.selectedId) {
              this.preview.clear();
              this.hasPlacementPoint = false;
              this._syncUnderground();
            }
          },
        ],
      ])
        this._listen(this.canvas, type, (event) => this._perform(() => handler(event)), true);
    }
    this._listen(document, 'keydown', (event) => {
      if (
        event.code === 'Escape' &&
        this.engine.constructionTool &&
        !event.target?.isContentEditable &&
        !event.target?.matches?.('input,select,textarea')
      ) {
        if (this.selectedId)
          this._select(
            this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId)
          );
        else this.cancel();
        event.preventDefault();
      }
    });
    this._listen(window, 'taverntable:mapPanStarted', (event) => {
      if (
        event.detail?.gameManager === this.gameManager &&
        this.engine.isActive &&
        this.engine.constructionTool &&
        this.pointer
      )
        this.cancel();
    });
    this._listen(window, 'blur', () => this.cancel());
    this.disposers.push(
      this.engine.onEditorChanged(() => {
        if (!this.engine.isActive || !this.engine.constructionTool) {
          this.cancel();
        }
        if (
          this.engine.constructionTool &&
          this.engine.constructionTool !== 'select' &&
          this.draft?.kind !== this.engine.constructionTool
        )
          this._choose(this.engine.constructionTool);
        this._render();
      })
    );
    this.disposers.push(
      this.engine.onChanged(({ kind }) => {
        if (
          this.selectedId &&
          !this.engine.geometry.getStructures().some((spec) => spec.id === this.selectedId)
        ) {
          this.selectedId = null;
          this.draft = null;
          this.preview.clear();
          this.gizmos.clear();
        } else if (this.selectedId && kind === 'geometry' && !this.pointer) {
          this.draft = this.engine.geometry
            .getStructures()
            .find((spec) => spec.id === this.selectedId);
          this._fill();
          this._queuePreview();
        }
        this._render();
      })
    );
    this._render();
  }

  _listen(target, type, handler, capture = false) {
    target.addEventListener(type, handler, capture);
    this.disposers.push(() => target.removeEventListener(type, handler, capture));
  }

  _choose(kind) {
    this.cancel();
    this.selectedId = null;
    this.featureTool = null;
    this.selectedFeature = null;
    this.floorTool = null;
    this.hasPlacementPoint = false;
    this.cellarPositioned = false;
    if (kind === 'cellar') this.root.querySelector('[data-underground-view]').checked = true;
    this.draft =
      kind === 'select' ? null : createStructure({ id: 'preview', kind, xFeet: 0, zFeet: 0 });
    if (this.engine.constructionTool !== kind) this.engine.setConstructionTool(kind);
    this._render();
    this._fill();
  }

  _select(spec) {
    if (!spec)
      throw new Error('This is legacy geometry. Use Build to place an editable structure.');
    this.cancel();
    this.selectedId = spec.id;
    this.draft = JSON.parse(JSON.stringify(spec));
    this.featureTool = null;
    this.selectedFeature = null;
    this.floorTool = null;
    this.hasPlacementPoint = true;
    this.cellarPositioned = spec.kind === 'cellar';
    if (spec.kind === 'cellar') this.root.querySelector('[data-underground-view]').checked = true;
    this.engine.setConstructionTool('select');
    this._fill();
    this._queuePreview();
    this._render();
    this.status.textContent = `${structureDisplayName(spec)} selected. Drag a blue handle to stretch it.`;
  }

  _beginFloorCut(event) {
    const level = buildingLevels(this.draft).find((entry) => entry.id === this._editFloorId());
    if (!level || level.roofDeck)
      throw new Error('Choose an interior floor before cutting an opening');
    const point = this.gizmos.point(event, this.canvas, {
      heightFeet: this.draft.baseFeet + level.elevationFeet,
    });
    if (!point) throw new Error('Turn the camera toward the selected floor plane');
    const { length, width } = buildingDimensions(this.draft);
    const local = buildingFeetToLocal(this.draft, point);
    const start = {
      x: Math.round((local.x + length / 2) / 5) * 5,
      z: Math.round((local.z + width / 2) / 5) * 5,
    };
    if (start.x < 0 || start.z < 0 || start.x > length || start.z > width)
      throw new Error('Start the opening inside the selected floor outline');
    const existing = new Set((level.openings || []).map((hole) => hole.id));
    let serial = 1;
    while (existing.has(`opening-${serial}`)) serial++;
    this.pointer = {
      mode: 'floor-cut',
      original: JSON.parse(JSON.stringify(this.draft)),
      selectedFeature: null,
      floor: level.id,
      start,
      holeId: `opening-${serial}`,
      id: event.pointerId,
      valid: false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  _moveFloorCut(event) {
    const drag = this.pointer,
      level = buildingLevels(drag.original).find((entry) => entry.id === drag.floor);
    const point = this.gizmos.point(event, this.canvas, {
      heightFeet: drag.original.baseFeet + level.elevationFeet,
    });
    if (!point) throw new Error('The selected floor plane is not reachable from this camera angle');
    const { length, width } = buildingDimensions(drag.original),
      local = buildingFeetToLocal(drag.original, point);
    const end = {
      x: Math.max(
        0,
        Math.min(Math.floor(length / 5) * 5, Math.round((local.x + length / 2) / 5) * 5)
      ),
      z: Math.max(
        0,
        Math.min(Math.floor(width / 5) * 5, Math.round((local.z + width / 2) / 5) * 5)
      ),
    };
    const hole = {
      id: drag.holeId,
      xFeet: Math.min(drag.start.x, end.x),
      zFeet: Math.min(drag.start.z, end.z),
      lengthFeet: Math.abs(end.x - drag.start.x),
      widthFeet: Math.abs(end.z - drag.start.z),
    };
    drag.valid = hole.lengthFeet >= 5 && hole.widthFeet >= 5;
    if (!drag.valid) return;
    const building = explicitBuilding(drag.original);
    building.levels.find((entry) => entry.id === drag.floor).openings.push(hole);
    this.draft = createStructure({ ...drag.original, building });
    this._queuePreview();
    this.status.textContent = `${hole.lengthFeet} x ${hole.widthFeet} ft opening. Release to cut the selected floor.`;
  }

  _renderLevelControls() {
    const spec = this.draft,
      building = spec?.building;
    if (!building) return;
    const levels = buildingLevels(spec),
      select = this.form.elements.namedItem('editFloor');
    const previous = select.value;
    const label = (level) =>
      level.roofDeck
        ? 'Battlement deck'
        : `${spec.kind === 'cellar' ? 'Cellar' : 'Floor'} ${level.id + 1} (${level.elevationFeet} ft)`;
    const signature = JSON.stringify(levels.map((level) => [level.id, level.elevationFeet]));
    if (select.dataset.levels !== signature) {
      select.replaceChildren(...levels.map((level) => new Option(label(level), String(level.id))));
      select.dataset.levels = signature;
      if (levels.some((level) => String(level.id) === previous)) select.value = previous;
    }
    const id = Number(select.value),
      level = levels.find((entry) => entry.id === id);
    const isDeck = !!level?.roofDeck;
    const height = this.form.elements.namedItem('roomHeightFeet');
    height.disabled = isDeck;
    this.root.querySelector('[data-room-height]').hidden = isDeck;
    if (!isDeck) height.value = String(buildingLevelHeight(spec, id));
    this.root.querySelector('[data-level-height]').disabled = isDeck;
    this.root.querySelector('[data-level-remove]').disabled = isDeck || id === levels[0].id;
    this.root.querySelector('[data-floor-cut]').disabled = !this.selectedId || isDeck;
    this.root
      .querySelector('[data-floor-cut]')
      .setAttribute('aria-pressed', String(this.floorTool === 'cut'));
    const holes = level?.openings || [],
      field = this.form.elements.namedItem('floorOpening'),
      old = field.value;
    field.replaceChildren(
      ...holes.map(
        (hole) => new Option(`${hole.id} · ${hole.lengthFeet} x ${hole.widthFeet} ft`, hole.id)
      )
    );
    if (holes.some((hole) => hole.id === old)) field.value = old;
    this.root.querySelector('[data-floor-opening-choice]').hidden = !holes.length;
    this.root.querySelector('[data-floor-fill]').hidden = !holes.length;
    this.root.querySelector('[data-level-help]').textContent =
      spec.kind === 'cellar'
        ? 'Cellars may extend beyond buildings. Heights and full-floor edits are previews until Apply.'
        : 'Room height moves levels above and the roof. Removing a slab leaves higher levels in place. Apply to commit.';
    const cellar = spec.kind === 'cellar';
    this.root.querySelector('[data-cellar-controls]').hidden = !cellar;
    for (const selector of [
      '[data-base-title]',
      '[data-building-base-controls]',
      '[data-roof-title]',
      '[data-building-roof-controls]',
    ])
      this.root.querySelector(selector).hidden = cellar;
    this.form.elements.namedItem('autoWindows').closest('label').hidden = cellar;
    if (cellar) {
      this._syncCellarTargets();
      for (const fieldName of ['cellarTarget', 'cellarAccessX', 'cellarAccessZ'])
        this.form.elements.namedItem(fieldName).disabled = building.access.kind === 'none';
      const button = this.root.querySelector('[data-cellar-place-access]');
      button.disabled = !this.selectedId || building.access.kind === 'none';
      button.setAttribute('aria-pressed', String(this.floorTool === 'cellar-access'));
    }
  }

  _editFloorId() {
    return Number(this.form.elements.namedItem('editFloor').value);
  }

  _syncCellarTargets() {
    if (this.draft?.kind !== 'cellar') return;
    const target = this.form.elements.namedItem('cellarTarget'),
      chosen = this.draft.building.access.structureId || '';
    const structures = this.engine.geometry.getStructures();
    const candidates = this.cellarPositioned
      ? cellarConnectionCandidates(this.draft, structures)
      : [];
    const valid = !chosen || candidates.some((entry) => entry.id === chosen);
    const signature = JSON.stringify([
      chosen,
      valid,
      candidates.map((entry) => [entry.id, structureDisplayName(entry)]),
    ]);
    if (target.dataset.choices !== signature) {
      target.replaceChildren(
        new Option('Exterior surface', ''),
        ...candidates.map((entry) => new Option(structureDisplayName(entry), entry.id))
      );
      if (chosen && !valid) {
        const previous = structures.find((entry) => entry.id === chosen);
        const unavailable = new Option(
          `${previous ? structureDisplayName(previous) : chosen} — unavailable here`,
          chosen
        );
        unavailable.disabled = true;
        target.append(unavailable);
      }
      target.value = chosen;
      target.dataset.choices = signature;
    }
    this.root.querySelector('[data-cellar-target-help]').textContent = !this.cellarPositioned
      ? 'Move the cellar preview near a building, or place it first. Nearby choices appear once the access point is positioned.'
      : !valid
        ? 'This access no longer fits the chosen building. Move the access or select a nearby target; Apply will not silently change the link.'
        : candidates.length
          ? 'Only buildings that contain this hatch and landing are listed. The chosen building is highlighted in gold on the map.'
          : 'No building fits this access point. Move the access/cellar closer, or connect to the exterior surface.';
  }

  _setLevelDraft(spec) {
    this.draft = createStructure(spec);
    this.featureTool = null;
    this.selectedFeature = null;
    this.floorTool = null;
    this._fill();
    this._render();
    this._queuePreview();
  }

  _readCellarAccess(changedKind = false) {
    if (this.draft?.kind !== 'cellar') return;
    const previous = this.draft.building.access;
    const kind = this.form.elements.namedItem('cellarAccess').value;
    const access = {
      kind,
      structureId: this.form.elements.namedItem('cellarTarget').value || null,
      xFeet: Number(this.form.elements.namedItem('cellarAccessX').value || 0),
      zFeet: Number(this.form.elements.namedItem('cellarAccessZ').value || 0),
    };
    if (changedKind && previous.kind === 'none' && kind === 'stairs') {
      access.xFeet = -7.5;
      access.zFeet = 2.5;
    }
    this.draft = createStructure({ ...this.draft, building: { ...this.draft.building, access } });
    this._fill();
    this._render();
    this._queuePreview();
  }

  _selectedFeatureData() {
    if (!this.selectedFeature || !this.draft?.building) return null;
    const features =
      this.selectedFeature.kind === 'window'
        ? buildingWindows(this.draft)
        : this.draft.building.balconies;
    return features.find((feature) => feature.id === this.selectedFeature.id) || null;
  }

  _fillFeatureFields() {
    const feature = this._selectedFeatureData(),
      wrapper = this.root.querySelector('[data-feature-fields]');
    wrapper.hidden = !feature;
    const kind = this.selectedFeature?.kind;
    const limits = feature
      ? buildingFeatureLimits(
          {
            ...this.draft,
            building: { ...this.draft.building, version: Math.max(2, this.draft.building.version) },
          },
          kind,
          feature
        )
      : null;
    for (const input of wrapper.querySelectorAll('[data-feature-value]')) {
      const key = input.dataset.featureValue;
      const visible =
        !!feature &&
        (key === 'widthFeet' || (kind === 'window' ? key !== 'depthFeet' : key === 'depthFeet'));
      input.disabled = !visible;
      input.closest('label').hidden = !visible;
      if (!visible) continue;
      input.value = String(feature[key]);
      const suffix = key[0].toUpperCase() + key.slice(1);
      input.min = String(limits[`min${suffix}`]);
      input.max = String(limits[`max${suffix}`]);
    }
    if (feature) {
      this.root.querySelector('[data-feature-title]').textContent =
        kind === 'window' ? 'Selected window' : 'Selected balcony';
      this.root.querySelector('[data-feature-width-label]').textContent =
        kind === 'window' ? 'Window width (ft)' : 'Balcony width (ft)';
      this.root.querySelector('[data-feature-hint]').textContent =
        kind === 'window'
          ? 'Drag edges/corners to resize; drag the centre to move. Tall windows keep floor slabs. Shift gives finer sizing.'
          : 'Drag deck edges/corners to resize; drag the centre along the wall. Shift gives finer sizing.';
    }
  }

  _readFeatureDraft() {
    const feature = this._selectedFeatureData();
    if (!feature) throw new Error('Select a window or balcony before editing its size');
    const next = { ...feature },
      kind = this.selectedFeature.kind;
    for (const input of this.root.querySelectorAll('[data-feature-value]'))
      if (!input.disabled) next[input.dataset.featureValue] = Number(input.value || NaN);
    const limits = buildingFeatureLimits(
      { ...this.draft, building: { ...this.draft.building, version: 2 } },
      kind,
      next
    );
    const margin = (next.widthFeet / 2 + limits.margin) / limits.span;
    next.u = this.draft.kind === 'turret' ? 0.5 : Math.max(margin, Math.min(1 - margin, next.u));
    this._setFeature(next, kind);
    this._queuePreview();
  }

  _fill() {
    if (!this.draft) return;
    for (const key of ['heightFeet', 'diameterFeet', 'lengthFeet', 'widthFeet', 'style'])
      this.form.elements.namedItem(key).value = String(
        key === 'heightFeet' && this.draft.building && this.draft.building.version < 3
          ? buildingStoreys(this.draft)
          : this.draft[key]
      );
    this.form.elements.namedItem('opening').checked = this.draft.opening;
    this.form.elements.namedItem('ruined').checked = this.draft.ruined;
    this.form.elements.namedItem('wallStairs').checked = !!this.draft.wallStairs;
    this.form.elements.namedItem('wallStairLayout').value = this.draft.wallStairLayout ?? 'auto';
    this.form.elements.namedItem('wallStairOffsetFeet').value = String(
      this.draft.wallStairOffsetFeet ?? 0
    );
    if (this.draft.building) {
      this.form.elements.namedItem('roofRiseFeet').value = String(this.draft.building.roofRiseFeet);
      this.form.elements.namedItem('autoWindows').checked = this.draft.building.autoWindows;
      this.form.elements.namedItem('stairs').checked = this.draft.building.stairs;
    }
    if (this.draft.kind === 'cellar') {
      const access = this.draft.building.access;
      this.form.elements.namedItem('cellarAccess').value = access.kind;
      this.form.elements.namedItem('cellarAccessX').value = String(access.xFeet);
      this.form.elements.namedItem('cellarAccessZ').value = String(access.zFeet);
    }
    this._fillFeatureFields();
  }

  _readDraft() {
    if (!this.draft) return;
    const changes = {};
    for (const key of ['heightFeet', 'diameterFeet', 'lengthFeet', 'widthFeet'])
      changes[key] = Number(this.form.elements.namedItem(key).value || NaN);
    if (this.draft.building) {
      if (this.draft.building.version < 3) changes.heightFeet *= 10;
      changes.building = {
        ...this.draft.building,
        roofRiseFeet: Number(this.form.elements.namedItem('roofRiseFeet').value || NaN),
        autoWindows: this.form.elements.namedItem('autoWindows').checked,
        stairs: this.form.elements.namedItem('stairs').checked,
      };
      changes.building = buildingForHeight(changes.building, changes.heightFeet);
    }
    changes.style = this.form.elements.namedItem('style').value;
    changes.opening = this.form.elements.namedItem('opening').checked;
    changes.ruined = this.form.elements.namedItem('ruined').checked;
    if (this.draft.kind === 'wall') {
      changes.wallStairs =
        changes.style === 'battlement' && this.form.elements.namedItem('wallStairs').checked;
      if (changes.wallStairs) {
        changes.wallStairVersion = 2;
        changes.wallStairLayout = this.form.elements.namedItem('wallStairLayout').value;
        changes.wallStairOffsetFeet = Number(
          this.form.elements.namedItem('wallStairOffsetFeet').value || 0
        );
      }
    }
    if (this.draft.kind === 'wall' && changes.style !== this.draft.style) {
      changes.widthFeet = changes.style === 'battlement' ? 10 : 2;
      this.form.elements.namedItem('widthFeet').value = String(changes.widthFeet);
    }
    this.draft = createStructure(
      {
        ...this.draft,
        ...changes,
        ...structureHeightChanges(this.draft, changes.heightFeet),
      },
      { legacy: !this.draft.building }
    );
    this._render();
    if (this.selectedId) this._queuePreview();
  }

  _point(event) {
    const pick = this.gameManager.pickingService?.pickGroundSync(
      event.clientX,
      event.clientY,
      this.canvas
    );
    if (!pick) return null;
    const unit = this.gameManager.spatial.tileWorldSize / 5;
    const p = pick.surface?.point;
    if (this.draft?.kind === 'cellar' && !this.selectedId) {
      const target = this.engine.geometry
        .getStructures()
        .find((spec) => spec.id === this.draft.building.access.structureId);
      const gx = pick.grid?.gx ?? Math.floor((p?.x ?? 0) / unit / 5),
        gy = pick.grid?.gy ?? Math.floor((p?.z ?? 0) / unit / 5);
      const height =
        target?.baseFeet ??
        (this.engine.getHeightAt(
          Math.max(0, Math.min(this.gameManager.cols - 1, gx)),
          Math.max(0, Math.min(this.gameManager.rows - 1, gy))
        ) *
          this.gameManager.spatial.elevationUnit) /
          unit;
      const point = this.gizmos.point(event, this.canvas, { heightFeet: height });
      if (point)
        return {
          xFeet: Math.round(point.x * 2) / 2,
          zFeet: Math.round(point.z * 2) / 2,
          baseFeet: height,
        };
    }
    if (p) {
      const point = {
        xFeet: Math.round((p.x / unit) * 2) / 2,
        zFeet: Math.round((p.z / unit) * 2) / 2,
        baseFeet: Math.round((p.y / unit) * 1e6) / 1e6,
      };
      if (this.draft?.kind === 'stalactite' && !this.selectedId) {
        const ceiling = getConstructionCeiling(
          this.gameManager,
          this.engine.geometry,
          point.xFeet,
          point.zFeet,
          point.baseFeet
        );
        if (!Number.isFinite(ceiling))
          throw new Error(
            'Stalactites need a real ceiling or overhang. Elevation-only caverns do not have one yet.'
          );
        if (ceiling - point.baseFeet < this.draft.heightFeet)
          throw new Error('Reduce the stalactite height to fit below this ceiling');
        point.baseFeet = ceiling - this.draft.heightFeet;
      }
      return point;
    }
    const { gx, gy } = pick.grid || {};
    if (this.draft?.kind === 'stalactite' && !this.selectedId)
      throw new Error('Choose a visible floor below a real ceiling to anchor this stalactite');
    return Number.isFinite(gx) && Number.isFinite(gy)
      ? {
          xFeet: (gx + 0.5) * 5,
          zFeet: (gy + 0.5) * 5,
          baseFeet:
            (this.engine.getHeightAt(gx, gy) * this.gameManager.spatial.elevationUnit) / unit,
        }
      : null;
  }

  _pointerDown(event) {
    if (
      event.button !== 0 ||
      !this.engine.isActive ||
      !this.engine.constructionTool ||
      this.gameManager.interactionManager?.isSpacePressed
    )
      return;
    this._requireIdle();
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.engine.constructionTool === 'select') {
      if (this.floorTool === 'cut') {
        this._beginFloorCut(event);
        return;
      }
      if (this.floorTool === 'cellar-access') {
        const point = this.gizmos.point(event, this.canvas, { heightFeet: this.draft.baseFeet });
        if (!point) throw new Error('View the ground plane to place cellar access');
        const local = buildingFeetToLocal(this.draft, point);
        const access = {
          ...this.draft.building.access,
          xFeet: Math.round(local.x / 2.5) * 2.5,
          zFeet: Math.round(local.z / 2.5) * 2.5,
        };
        this.draft = createStructure({
          ...this.draft,
          building: { ...this.draft.building, access },
        });
        this._commitDraft();
        return;
      }
      const handle = this.gizmos.pick(event, this.canvas);
      if (
        this.selectedId &&
        ['stairs-position', 'cellar-position', 'structure-position'].includes(handle)
      ) {
        this._readDraft();
        const original = JSON.parse(JSON.stringify(this.draft));
        const point = this.gizmos.point(event, this.canvas, {
          heightFeet: this._resizePlaneHeight(original),
        });
        if (!point)
          throw new Error('View the selected stair or cellar plane from above to move it');
        this.pointer = {
          mode: handle,
          handle,
          original,
          start: point,
          id: event.pointerId,
          selectedFeature: null,
          startClient: { x: event.clientX, y: event.clientY },
          moved: false,
        };
        this.canvas.setPointerCapture?.(event.pointerId);
        return;
      }
      if (handle?.startsWith('feature-') && this.selectedFeature) {
        this._beginFeatureResize(
          event,
          this._selectedFeatureData(),
          this.selectedFeature.kind,
          handle
        );
        return;
      }
      if (this.featureTool) {
        this._beginFeature(event);
        return;
      }
      if (handle && this.selectedId) {
        this._readDraft();
        const original = JSON.parse(JSON.stringify(this.draft));
        const point = this.gizmos.point(event, this.canvas, {
          heightFeet: this._resizePlaneHeight(original),
          vertical: handle === 'height',
          center: {
            x: original.xFeet,
            y:
              original.kind === 'stalactite'
                ? original.baseFeet
                : original.baseFeet + original.heightFeet,
            z: original.zFeet,
          },
        });
        if (!point) throw new Error('The resize handle is not reachable from this camera angle');
        const dimensions = buildingDimensions(original),
          round = isRoundStructure(original);
        const length = round ? original.diameterFeet : dimensions.length,
          width = round ? original.diameterFeet : dimensions.width;
        const handlePoint = buildingLocalToFeet(original, {
          x: handle.includes('west') ? -length / 2 : handle.includes('east') ? length / 2 : 0,
          y: 0,
          z: handle.includes('north') ? -width / 2 : handle.includes('south') ? width / 2 : 0,
        });
        this.pointer = {
          mode: 'resize',
          handle,
          original,
          start: point,
          id: event.pointerId,
          offset: { x: point.x - handlePoint.x, z: point.z - handlePoint.z },
          selectedFeature: this.selectedFeature,
          startClient: { x: event.clientX, y: event.clientY },
          moved: false,
        };
        this.canvas.setPointerCapture?.(event.pointerId);
        return;
      }
      if (this.root.querySelector('[data-underground-view]').checked) {
        const ray = this.gizmos.ray(event, this.canvas),
          hit = ray && this.underground.pick(ray);
        if (hit) {
          this._select(hit.spec);
          this.form.elements.namedItem('editFloor').value = String(hit.levelId);
          this._render();
          this._queuePreview();
          return;
        }
      }
      const pick = this.gameManager.pickingService?.pickGroundSync(
        event.clientX,
        event.clientY,
        this.canvas
      );
      const unit = this.gameManager.spatial.tileWorldSize / 5;
      const p = pick?.surface?.point;
      let spec =
        p && this.engine.geometry.structureAt({ x: p.x / unit, y: p.y / unit, z: p.z / unit });
      if (!spec && p)
        spec = this.engine.geometry.getStructures().find((entry) => {
          if (entry.kind !== 'cellar') return false;
          const local = buildingFeetToLocal(entry, { x: p.x / unit, y: p.y / unit, z: p.z / unit });
          return (
            Math.abs(local.x) <= entry.lengthFeet / 2 && Math.abs(local.z) <= entry.widthFeet / 2
          );
        });
      this._select(spec);
      return;
    }
    this._readDraft();
    const point = this._point(event);
    if (!point) throw new Error('Choose a position on the map');
    this.pointer = { start: point, last: point, id: event.pointerId };
    this.canvas.setPointerCapture?.(event.pointerId);
    this._placement(point);
  }

  _placement(point) {
    this.hasPlacementPoint = true;
    if (this.draft.kind === 'cellar') this.cellarPositioned = true;
    const start = this.pointer?.start || point;
    const line = ['wall', 'tunnel'].includes(this.draft.kind);
    const dx = point.xFeet - start.xFeet,
      dz = point.zFeet - start.zFeet;
    const length = Math.hypot(dx, dz);
    const minimum =
      this.draft.kind === 'wall' && this.draft.wallStairs
        ? wallStairFootprint(this.draft).lengthFeet + (this.draft.wallStairOffsetFeet ?? 0)
        : 5;
    const effective = Math.max(minimum, length),
      scale = length >= 0.5 ? effective / length : 1;
    this.draft = createStructure({
      ...this.draft,
      xFeet: line ? start.xFeet + (dx * scale) / 2 : point.xFeet,
      zFeet: line ? start.zFeet + (dz * scale) / 2 : point.zFeet,
      baseFeet: start.baseFeet,
      ...(line && length >= 0.5 ? { lengthFeet: effective, angleRadians: Math.atan2(dz, dx) } : {}),
    });
    if (this.draft.kind === 'cellar') {
      const gx = Math.max(0, Math.min(this.gameManager.cols - 1, Math.floor(point.xFeet / 5)));
      const gy = Math.max(0, Math.min(this.gameManager.rows - 1, Math.floor(point.zFeet / 5)));
      const unit = this.gameManager.spatial.tileWorldSize / 5;
      this.draft = createStructure({
        ...this.draft,
        baseFeet: (this.engine.getHeightAt(gx, gy) * this.gameManager.spatial.elevationUnit) / unit,
      });
    }
    if (line) {
      this.form.elements.namedItem('lengthFeet').value = String(this.draft.lengthFeet);
      this.status.textContent = `${this.draft.lengthFeet.toFixed(1)} ft long. Release to build.`;
    }
    this._queuePreview();
  }

  _pointerMove(event) {
    if (['stairs-position', 'cellar-position', 'structure-position'].includes(this.pointer?.mode)) {
      if (this._dragged(event)) this._positionTo(event);
      return;
    }
    if (this.pointer?.mode === 'floor-cut') {
      this._moveFloorCut(event);
      return;
    }
    if (this.pointer?.mode === 'resize') {
      if (this._dragged(event)) this._resizeTo(event);
      return;
    }
    if (this.pointer?.mode === 'feature-resize') {
      if (this._dragged(event)) this._resizeFeatureTo(event);
      return;
    }
    if (this.pointer?.mode === 'balcony') {
      if (this._dragged(event)) this._moveFeature(event);
      return;
    }
    if (!this.engine.isActive || !this.draft || this.selectedId || !this.engine.constructionTool)
      return;
    if (this.gameManager.interactionManager?.isSpacePressed || (event.buttons && !this.pointer))
      return;
    const point = this._point(event);
    if (!point) {
      if (!this.pointer) this.preview.clear();
      return;
    }
    if (this.pointer) this.pointer.last = point;
    this._placement(point);
  }

  _pointerUp(event) {
    if (event.button !== 0 || !this.pointer) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.pointer.mode) {
      const drag = this.pointer,
        moved = this._dragged(event);
      if (drag.mode === 'floor-cut') {
        this._moveFloorCut(event);
        if (!drag.valid) throw new Error('Drag an opening at least one five-foot square');
      } else if (moved) {
        if (drag.mode === 'resize') this._resizeTo(event);
        else if (['stairs-position', 'cellar-position', 'structure-position'].includes(drag.mode))
          this._positionTo(event);
        else if (drag.mode === 'feature-resize') this._resizeFeatureTo(event);
        else this._moveFeature(event);
      }
      this.canvas.releasePointerCapture?.(event.pointerId);
      this.pointer = null;
      if (drag.mode !== 'floor-cut' && !moved && !drag.isNew) {
        this.draft = drag.original;
        this._fill();
        this._render();
        this._queuePreview();
        return;
      }
      this._commitDraft();
      return;
    }
    const point = this._point(event);
    if (!point) {
      this.cancel();
      this.status.textContent = 'Placement canceled. Release on the map to build.';
      return;
    }
    this._placement(point);
    this.pointer = null;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this._requireIdle();
    const ids = new Set(this.engine.geometry.getStructures().map((spec) => spec.id));
    let index = 1;
    while (ids.has(`structure-${index}`)) index++;
    const spec = createStructure({ ...this.draft, id: `structure-${index}` });
    this.engine.placeStructure(spec);
    this._syncCutaway();
    this.cancel();
    this.status.textContent = 'Structure placed. Choose Select / resize to edit it.';
  }

  _cancelSnapPreview() {
    if (this.snapPreview) this.engine.cancelStructureSnap(this.snapPreview);
    this.snapPreview = null;
  }

  _previewBuildingJoin() {
    this._requireIdle();
    if (!this.selectedId || this.draft?.kind !== 'building')
      throw new Error('Select a rectangular building before connecting its interiors');
    const targetId = this.form.elements.namedItem('joinTarget').value;
    if (!targetId) throw new Error('Choose another building to connect');
    this._cancelSnapPreview();
    this.snapPreview = this.engine.previewStructureSnap(
      this.selectedId,
      {
        xFeet: this.draft.xFeet,
        zFeet: this.draft.zFeet,
        angleRadians: this.draft.angleRadians,
      },
      { targetId }
    );
    this.draft = JSON.parse(JSON.stringify(this.snapPreview.structure));
    this._fill();
    this._render();
    this._queuePreview(true);
    this.status.textContent =
      'Connected interior preview. Apply to commit both walls and floors, or Cancel.';
  }

  _queuePreview(retainSnap = false) {
    if (!retainSnap) this._cancelSnapPreview();
    if (this.pendingFrame !== null) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      this._perform(() => {
        if (this.draft && this.engine.isActive && this.engine.constructionTool) {
          if (this.snapPreview) this.preview.showSnap(this.snapPreview);
          else this.preview.show(this.draft, { wireframe: !!this.selectedId });
          const feature = this._selectedFeatureData();
          if (this.floorTool === 'cut') {
            const level = buildingLevels(this.draft).find(
              (entry) => entry.id === this._editFloorId()
            );
            if (level) this.gizmos.showFloor(this.draft, level);
          } else if (feature)
            this.gizmos.showFeature(this.draft, feature, this.selectedFeature.kind);
          else if (
            this.selectedId &&
            !this.featureTool &&
            (!['building', 'turret'].includes(this.draft.kind) || this.draft.building)
          )
            this.gizmos.show(this.draft, {
              levelId: this.draft.kind === 'cellar' ? this._editFloorId() : null,
            });
          else this.gizmos.clear();
          this._syncCellarTargets();
          this._syncUnderground();
          this._syncIdentification();
        }
      });
    });
  }

  _resizeTo(event) {
    const drag = this.pointer,
      original = drag.original;
    const point = this.gizmos.point(event, this.canvas, {
      heightFeet: this._resizePlaneHeight(original),
      vertical: drag.handle === 'height',
      center: {
        x: original.xFeet,
        y:
          original.kind === 'stalactite'
            ? original.baseFeet
            : original.baseFeet + original.heightFeet,
        z: original.zFeet,
      },
    });
    if (!point) return;
    this.draft =
      drag.handle === 'height'
        ? stretchStructureHeight(original, point.y - drag.start.y)
        : stretchStructure(
            original,
            drag.handle,
            { x: point.x - drag.offset.x, z: point.z - drag.offset.z },
            { fine: event.shiftKey }
          );
    this._fill();
    this._render();
    this._queuePreview();
    this.status.textContent = this.draft.building
      ? `${buildingStoreys(this.draft)} storeys · ${this.draft.heightFeet} ft. Release to apply.`
      : 'Release to apply. Shift enables fine sizing.';
  }

  _resizePlaneHeight(spec) {
    return (
      spec.baseFeet +
      (spec.kind === 'cellar'
        ? buildingLevelElevation(spec, this._editFloorId())
        : spec.kind === 'stalactite'
          ? spec.heightFeet
          : 0)
    );
  }

  _positionTo(event) {
    const drag = this.pointer,
      original = drag.original;
    const point = this.gizmos.point(event, this.canvas, {
      heightFeet: this._resizePlaneHeight(original),
    });
    if (!point) throw new Error('The movement plane is not reachable from this camera angle');
    if (drag.mode === 'stairs-position') {
      const start = buildingFeetToLocal(original, drag.start),
        end = buildingFeetToLocal(original, point);
      this.draft = slideWallStairs(original, end.x - start.x, { fine: event.shiftKey });
    } else {
      const step = event.shiftKey ? 0.5 : 5;
      this.draft = createStructure(
        {
          ...original,
          xFeet: original.xFeet + Math.round((point.x - drag.start.x) / step) * step,
          zFeet: original.zFeet + Math.round((point.z - drag.start.z) / step) * step,
        },
        { legacy: true }
      );
    }
    this._fill();
    this._render();
    this._queuePreview();
    this.status.textContent =
      drag.mode === 'stairs-position'
        ? 'Stair position preview. Release to apply.'
        : 'Structure position preview. Release to apply.';
  }

  _commitDraft() {
    this._requireIdle();
    const fields = Object.fromEntries(
      [
        'kind',
        ...(this.draft.kind === 'wall' ? WALL_STAIR_FIELDS : []),
        'xFeet',
        'zFeet',
        'heightFeet',
        'diameterFeet',
        'lengthFeet',
        'widthFeet',
        'angleRadians',
        'style',
        'opening',
        'ruined',
        ...(this.draft.building ? ['building'] : []),
      ].map((key) => [key, this.draft[key]])
    );
    const feature = this.selectedFeature;
    const featureTool = this.featureTool;
    const floorTool = this.floorTool;
    const changed = this.snapPreview
      ? this.engine.commitStructureSnap(this.snapPreview)
      : this.engine.resizeStructure(this.selectedId, fields);
    this._select(this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId));
    this.featureTool = featureTool;
    this.floorTool = floorTool;
    this.selectedFeature = feature;
    this._syncCutaway();
    this._render();
    this.status.textContent =
      changed === false
        ? 'No shape changes to apply.'
        : 'Building edit applied. Undo restores the previous shape and floors.';
  }

  _localWall(event) {
    const hit = this.gameManager.pickingService?.pickGroundSync(
      event.clientX,
      event.clientY,
      this.canvas
    );
    const p = hit?.surface?.point,
      n = hit?.surface?.normal;
    if (!p || !n || Math.abs(n.y) > 0.45)
      throw new Error('Choose a vertical wall on the selected building');
    const unit = this.gameManager.spatial.tileWorldSize / 5;
    const physical = { x: p.x / unit, y: p.y / unit, z: p.z / unit };
    if (this.engine.geometry.structureAt(physical)?.id !== this.selectedId)
      throw new Error('Choose a wall belonging to the selected building');
    const local = buildingFeetToLocal(this.draft, physical);
    const c = Math.cos(this.draft.angleRadians),
      s = Math.sin(this.draft.angleRadians);
    const normal = { x: n.x * c + n.z * s, z: -n.x * s + n.z * c };
    const side =
      Math.abs(normal.x) > Math.abs(normal.z)
        ? normal.x > 0
          ? 'east'
          : 'west'
        : normal.z > 0
          ? 'south'
          : 'north';
    const { length, width } = buildingDimensions(this.draft);
    const u = ['north', 'south'].includes(side) ? local.x / length + 0.5 : local.z / width + 0.5;
    if (u < 0 || u > 1) throw new Error('Choose a wall belonging to the selected building');
    return { side, u, elevationFeet: local.y };
  }

  _dragged(event) {
    const drag = this.pointer;
    if (!drag.startClient) return true;
    const threshold =
      drag.handle?.startsWith('feature-') && drag.handle !== 'feature-move' ? 0.5 : 2;
    drag.moved ||=
      Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) >=
      threshold;
    return drag.moved;
  }

  _featurePlanePoint(event, feature, kind, spec = this.draft) {
    const center = buildingLocalToFeet(
      spec,
      buildingWallPoint(
        spec,
        feature.side,
        feature.u,
        0,
        buildingLevelElevation(spec, feature.floor)
      )
    );
    if (kind === 'balcony') return this.gizmos.point(event, this.canvas, { heightFeet: center.y });
    const outward = buildingLocalToFeet(
      spec,
      buildingWallPoint(
        spec,
        feature.side,
        feature.u,
        1,
        buildingLevelElevation(spec, feature.floor)
      )
    );
    return this.gizmos.point(event, this.canvas, {
      center,
      normalFeet: { x: outward.x - center.x, y: 0, z: outward.z - center.z },
    });
  }

  _beginFeatureResize(
    event,
    feature,
    kind,
    handle,
    { isNew = false, original = null, previousFeature = this.selectedFeature } = {}
  ) {
    if (!feature) throw new Error('Select an existing window or balcony first');
    const start = this._featurePlanePoint(event, feature, kind);
    if (!start && handle !== 'feature-move')
      throw new Error('Turn the camera toward this wall to drag its resize handles');
    this.pointer = {
      mode: 'feature-resize',
      kind,
      handle,
      feature: { ...feature },
      start,
      isNew,
      original: original || JSON.parse(JSON.stringify(this.draft)),
      selectedFeature: previousFeature,
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
      id: event.pointerId,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  _resizeFeatureTo(event) {
    const drag = this.pointer;
    if (!drag.start)
      throw new Error('Turn the camera toward this wall to drag; dimension fields also work');
    const point = this._featurePlanePoint(event, drag.feature, drag.kind, drag.original);
    if (!point) throw new Error('The feature drag plane is not reachable from this camera angle');
    const start = buildingFeetToLocal(drag.original, drag.start),
      end = buildingFeetToLocal(drag.original, point);
    const along = ['north', 'south'].includes(drag.feature.side) ? 'x' : 'z',
      thin = along === 'x' ? 'z' : 'x';
    const sign = ['east', 'south'].includes(drag.feature.side) ? 1 : -1;
    const feature = stretchBuildingFeature(
      drag.original,
      drag.feature,
      drag.kind,
      drag.handle,
      {
        alongFeet: end[along] - start[along],
        elevationFeet: end.y - start.y,
        depthFeet: (end[thin] - start[thin]) * sign,
      },
      { fine: event.shiftKey }
    );
    this._setFeature(feature, drag.kind);
    this._fillFeatureFields();
    this._queuePreview();
    this.status.textContent =
      drag.kind === 'window'
        ? `${feature.widthFeet.toFixed(1)} x ${feature.heightFeet.toFixed(1)} ft window. Release to apply.`
        : `${feature.widthFeet.toFixed(1)} x ${feature.depthFeet.toFixed(1)} ft balcony. Release to apply.`;
  }

  _beginFeature(event) {
    if (!this.draft?.building) throw new Error('Select a building with connected storeys first');
    let existing = this.gizmos.pickFeature(event, this.canvas, this.draft, this.featureTool);
    const hit = existing
      ? null
      : this.gameManager.pickingService?.pickConnectionSync?.(
          event.clientX,
          event.clientY,
          this.canvas
        );
    const managed = hit?.connection.building;
    const owned =
      managed?.structureId === this.selectedId &&
      managed.ownerMapId === this.gameManager.campaignMapId;
    if (owned) {
      if (this.featureTool === 'window' && managed.kind === 'window')
        existing = buildingWindows(this.draft).find((w) => `window-${w.id}` === managed.featureId);
      else if (this.featureTool === 'balcony' && managed.kind === 'balcony')
        existing = this.draft.building.balconies.find(
          (b) => `balcony-${b.id}` === managed.featureId
        );
    }
    if (this.featureTool === 'window' && owned && managed.kind === 'entry')
      throw new Error('Choose a wall beside the entrance door');
    const wall = existing || this._localWall(event);
    const floor = existing?.floor ?? Number(this.form.elements.namedItem('featureFloor').value);
    if (!existing && this.featureTool === 'window')
      existing = buildingWindows(this.draft).find(
        (window) =>
          buildingLevelElevation(this.draft, window.floor) <=
            buildingLevelElevation(this.draft, floor) &&
          buildingLevelElevation(this.draft, window.floor) + window.sillFeet + window.heightFeet >
            buildingLevelElevation(this.draft, floor) &&
          window.side === wall.side &&
          (wall.elevationFeet === undefined ||
            (wall.elevationFeet >=
              buildingLevelElevation(this.draft, window.floor) + window.sillFeet - 0.5 &&
              wall.elevationFeet <=
                buildingLevelElevation(this.draft, window.floor) +
                  window.sillFeet +
                  window.heightFeet +
                  0.5)) &&
          Math.abs(window.u - wall.u) *
            (['north', 'south'].includes(wall.side)
              ? buildingDimensions(this.draft).length
              : buildingDimensions(this.draft).width) <=
            window.widthFeet / 2
      );
    if (this.featureTool === 'balcony' && floor === 0)
      throw new Error('Choose an upper storey for the balcony');
    const kind = this.featureTool;
    if (existing) {
      this.selectedFeature = { kind, id: existing.id };
      this.form.elements.namedItem('featureFloor').value = String(existing.floor);
      this._beginFeatureResize(event, existing, kind, 'feature-move');
      this._render();
      this._queuePreview();
      this.status.textContent =
        kind === 'window'
          ? 'Window selected. Drag a blue edge/corner to resize, or the centre to move.'
          : 'Balcony selected. Drag blue deck handles to resize, or the centre along the wall.';
      return;
    }
    const all = [...this.draft.building.windows, ...this.draft.building.balconies];
    let index = 1;
    while (all.some((feature) => feature.id === `manual-${kind}-${index}`)) index++;
    const feature = existing
      ? { ...existing }
      : kind === 'window'
        ? {
            id: `manual-window-${index}`,
            floor,
            side: wall.side,
            u: wall.u,
            widthFeet: 5,
            heightFeet: 5,
            sillFeet: 2,
          }
        : {
            id: `manual-balcony-${index}`,
            floor,
            side: wall.side,
            u: wall.u,
            widthFeet: 5,
            depthFeet: 5,
          };
    const { length, width } = buildingDimensions(this.draft);
    const span = ['north', 'south'].includes(feature.side) ? length : width;
    feature.u =
      this.draft.kind === 'turret'
        ? 0.5
        : Math.max(
            (feature.widthFeet / 2 + 1) / span,
            Math.min(1 - (feature.widthFeet / 2 + 1) / span, feature.u)
          );
    this.form.elements.namedItem('featureFloor').value = String(floor);
    const original = JSON.parse(JSON.stringify(this.draft)),
      selectedFeature = this.selectedFeature;
    this._setFeature(feature, kind);
    this.selectedFeature = { kind, id: feature.id };
    if (kind === 'window') {
      this._beginFeatureResize(event, feature, kind, 'feature-move', {
        isNew: true,
        original,
        previousFeature: selectedFeature,
      });
      this._render();
      this._queuePreview();
      this.status.textContent = 'Release to add the window, then use its resize handles.';
      return;
    }
    this.pointer = {
      mode: kind,
      feature: { ...feature },
      original,
      selectedFeature,
      id: event.pointerId,
      isNew: true,
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
    this._render();
    this._queuePreview();
    this.status.textContent =
      kind === 'window'
        ? 'Drag along the wall to position the window. Release to apply.'
        : 'Drag sideways for width and outwards for depth. Release to apply.';
  }

  _moveFeature(event) {
    const drag = this.pointer,
      feature = { ...drag.feature };
    const { length, width } = buildingDimensions(drag.original);
    const span = ['north', 'south'].includes(feature.side) ? length : width;
    const sidePoint = buildingWallPoint(
      drag.original,
      feature.side,
      feature.u,
      0,
      buildingLevelElevation(drag.original, feature.floor)
    );
    const point = this._featurePlanePoint(event, feature, 'balcony', drag.original);
    if (!point)
      throw new Error('View the balcony from above to drag its depth, or use the size fields');
    const local = buildingFeetToLocal(drag.original, point);
    const along = ['north', 'south'].includes(feature.side) ? local.x : local.z;
    const step = event.shiftKey ? 0.5 : 2.5;
    const snap = (value) => Math.round(value / step) * step;
    const startAlong = (feature.u - 0.5) * span;
    feature.widthFeet = Math.min(span - 2, Math.max(5, snap(2 * Math.abs(along - startAlong))));
    const axis = ['north', 'south'].includes(feature.side) ? 'z' : 'x';
    const sign = ['east', 'south'].includes(feature.side) ? 1 : -1;
    const depth = (local[axis] - sidePoint[axis]) * sign;
    feature.depthFeet = Math.min(30, Math.max(2.5, snap(depth)));
    feature.u = Math.max(
      (feature.widthFeet / 2 + 1) / span,
      Math.min(1 - (feature.widthFeet / 2 + 1) / span, feature.u)
    );
    this._setFeature(feature, drag.mode);
    this._fillFeatureFields();
    this._queuePreview();
  }

  _setFeature(feature, kind) {
    const key = kind === 'window' ? 'windows' : 'balconies';
    const list = this.draft.building[key].filter((entry) => entry.id !== feature.id);
    list.push(feature);
    this.draft = createStructure({
      ...this.draft,
      building: {
        ...this.draft.building,
        version: Math.max(2, this.draft.building.version),
        [key]: list,
      },
    });
  }

  _removeFeature() {
    if (!this.selectedFeature) throw new Error('Click a window or balcony first');
    const { kind, id } = this.selectedFeature;
    const key = kind === 'window' ? 'windows' : 'balconies';
    const building = {
      ...this.draft.building,
      [key]: this.draft.building[key].filter((feature) => feature.id !== id),
    };
    if (kind === 'window') {
      const current = buildingWindows(this.draft).find((window) => window.id === id);
      if (!current) throw new Error('Choose an existing window to remove');
      const defaults = buildingWindows({
        ...this.draft,
        building: {
          ...this.draft.building,
          windows: [],
          removedWindows: [],
          balconies: [],
        },
      });
      const span = ['north', 'south'].includes(current.side)
        ? buildingDimensions(this.draft).length
        : buildingDimensions(this.draft).width;
      const replaced = defaults
        .filter(
          (window) =>
            windowVerticalOverlap(window, current, this.draft) &&
            window.side === current.side &&
            Math.abs(window.u - current.u) * span < (window.widthFeet + current.widthFeet) / 2
        )
        .map((window) => window.id);
      building.removedWindows = [...new Set([...building.removedWindows, id, ...replaced])];
    }
    this.draft = createStructure({ ...this.draft, building });
    this.selectedFeature = null;
    this._commitDraft();
  }

  _syncCutaway() {
    if (!this.root.querySelector('[data-build-cutaway]').checked) return;
    const layers = [
      ...new Set(['ground', ...this.engine.geometry.save().volumes.map((v) => v.layerId)]),
    ].filter((layer) => layer !== 'roof');
    if (JSON.stringify(layers) !== JSON.stringify(this.engine.visibleLayers))
      this.engine.setVisibleLayers(layers);
  }

  cancel() {
    const pending = !!this.pointer;
    const drag = this.pointer;
    const snap = this.snapPreview;
    this._cancelSnapPreview();
    if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = null;
    if (this.pointer && this.canvas?.hasPointerCapture?.(this.pointer.id))
      this.canvas.releasePointerCapture(this.pointer.id);
    this.pointer = null;
    this.preview.clear();
    this.gizmos.clear();
    this.hasPlacementPoint = !!this.selectedId;
    this.underground.update({
      enabled: this.root.querySelector('[data-underground-view]').checked,
    });
    if (drag?.mode) {
      this.draft = drag.original;
      this.selectedFeature = drag.selectedFeature;
      this._fill();
      this._render();
    } else if (snap && this.selectedId) {
      this.draft = this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId);
      this._fill();
      this._render();
    }
    if (pending && this.status) this.status.textContent = 'Placement canceled.';
  }

  _syncUnderground() {
    this.underground.update({
      enabled: this.root.querySelector('[data-underground-view]').checked,
      candidate: this.hasPlacementPoint ? this.draft : null,
      selectedId: this.selectedId,
      levelId: this.draft?.kind === 'cellar' ? this._editFloorId() : null,
    });
  }

  _syncIdentification() {
    const target =
      this.draft?.kind === 'cellar' && this.draft.building.access.kind !== 'none'
        ? this.draft.building.access.structureId
        : null;
    this.identification.update({
      selectedId: this.selectedId,
      targetId: target,
      underground: this.root.querySelector('[data-underground-view]').checked,
      candidate: this.selectedId ? this.draft : null,
    });
  }

  _requireIdle() {
    const gm = this.gameManager;
    if (
      gm.sceneAutosave?.ready === false ||
      gm.campaignViewBusy ||
      gm.placedTokens?.some((token) => gm.token3DAdapter?.isMovementInProgress(token)) ||
      gm.characterServices?.combat?.pending ||
      gm.characterServices?.combat?.committing ||
      gm.characterServices?.library?.isSaving ||
      gm.characterServices?.library?.pendingScenes > 0 ||
      gm.sceneAutosave?.writing
    )
      throw new Error('Finish the current action before building or resizing');
  }

  _render() {
    if (this.selectedFeature && !this._selectedFeatureData()) this.selectedFeature = null;
    const tool = this.engine.constructionTool;
    for (const button of this.root.querySelectorAll('[data-build-kind]'))
      button.setAttribute(
        'aria-pressed',
        String(tool === button.dataset.buildKind && !this.selectedId)
      );
    this.root
      .querySelector('[data-build-select]')
      .setAttribute('aria-pressed', String(tool === 'select'));
    this.form.hidden = !this.draft;
    const stairs = !!(this.draft?.kind === 'wall' && this.draft.wallStairs);
    this.root.querySelector('[data-wall-stair-controls]').hidden = !stairs;
    for (const input of this.root.querySelectorAll(
      '[data-wall-stair-controls] input,[data-wall-stair-controls] select'
    ))
      input.disabled = !stairs;
    if (stairs) {
      const layout = wallStairFootprint(this.draft);
      this.form.elements.namedItem('wallStairOffsetFeet').max = String(
        this.draft.lengthFeet - layout.lengthFeet
      );
      this.root.querySelector('[data-stair-layout-status]').textContent =
        `${layout.mode === 'switchback' ? 'Switchback' : 'Straight'} · ${layout.lengthFeet} ft along wall · ` +
        `${this.draft.wallStairSide === 'far' ? 'far' : 'near'} side · ${this.draft.wallStairDirection === 'reverse' ? 'reverse' : 'forward'} ascent. Drag the stair handle; Apply commits fields/buttons.`;
    }
    this.root.querySelector('[data-underground-help]').hidden =
      !this.root.querySelector('[data-underground-view]').checked;
    const cellars = this.engine.geometry.getStructures().filter((spec) => spec.kind === 'cellar');
    const editCellar = this.root.querySelector('[data-cellar-edit]');
    editCellar.replaceChildren(
      new Option('Choose an existing cellar', ''),
      ...cellars.map(
        (spec) =>
          new Option(
            `${structureDisplayName(spec)} · ${spec.lengthFeet} x ${spec.widthFeet} ft`,
            spec.id
          )
      )
    );
    editCellar.value = this.draft?.kind === 'cellar' && this.selectedId ? this.selectedId : '';
    this.root.querySelector('[data-cellar-edit-label]').hidden = !cellars.length;
    this.root
      .querySelector('[data-build-castle-wall]')
      .setAttribute(
        'aria-pressed',
        String(this.engine.constructionTool === 'wall' && this.draft?.style === 'battlement')
      );
    this.root.querySelector('[data-edit-actions]').hidden = !this.selectedId;
    const joinable = !!this.selectedId && this.draft?.kind === 'building';
    this.root.querySelector('[data-building-join-controls]').hidden = !joinable;
    const joinTarget = this.form.elements.namedItem('joinTarget'),
      selectedTarget = joinTarget.value;
    const targets = this.engine.geometry
      .getStructures()
      .filter((spec) => spec.id !== this.selectedId && spec.kind === 'building' && spec.building);
    joinTarget.replaceChildren(
      new Option('Choose a building', ''),
      ...targets.map((spec) => new Option(structureDisplayName(spec), spec.id))
    );
    joinTarget.value = targets.some((spec) => spec.id === selectedTarget) ? selectedTarget : '';
    joinTarget.disabled = !joinable;
    const world = this.gameManager.campaignWorld;
    this.root.querySelector('[data-building-join-remove]').hidden = !(
      joinable &&
      world
        ?.getConnections()
        .some(
          (connection) =>
            isBuildingJoinConnection(connection, this.gameManager.campaignMapId) &&
            connection.ends.some(
              (end) => world.getMap(end.mapId).building?.structureId === this.selectedId
            )
        )
    );
    const building = this.draft?.building;
    this.root.querySelector('[data-building-options]').hidden = !building;
    this.root.querySelector('[data-building-upgrade]').hidden = !(
      this.selectedId &&
      ['building', 'turret'].includes(this.draft?.kind) &&
      !building
    );
    this.root.querySelector('[data-building-feature-controls]').hidden =
      !this.selectedId || this.draft?.kind === 'cellar';
    this.root.querySelector('[data-feature-remove]').hidden = !this.selectedFeature;
    for (const button of this.root.querySelectorAll('[data-building-feature]'))
      button.setAttribute(
        'aria-pressed',
        String(this.featureTool === button.dataset.buildingFeature)
      );
    if (building) {
      const levels = buildingLevels(this.draft, { includeDeck: false }),
        field = this.form.elements.namedItem('featureFloor');
      const signature = JSON.stringify(levels.map((level) => [level.id, level.elevationFeet]));
      if (field.dataset.levels !== signature) {
        const current = Number(field.value) || 0;
        field.replaceChildren(
          ...levels.map(
            (level) =>
              new Option(`Floor ${level.id + 1} (${level.elevationFeet} ft)`, String(level.id))
          )
        );
        field.dataset.levels = signature;
        if (levels.some((level) => level.id === current)) field.value = String(current);
      }
      this.root.querySelector('[data-roof-rise]').hidden = ['none', 'flat', 'battlement'].includes(
        building.roof
      );
      for (const button of this.root.querySelectorAll('[data-building-roof]'))
        button.setAttribute('aria-pressed', String(building.roof === button.dataset.buildingRoof));
      for (const button of this.root.querySelectorAll('[data-building-base]'))
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.buildingBase === this.draft.kind)
        );
    }
    if (this.draft) {
      const height = this.form.elements.namedItem('heightFeet');
      const diameter = this.form.elements.namedItem('diameterFeet');
      diameter.min = String(structureMinimumDiameter(this.draft));
      diameter.step = isRockFormation(this.draft) ? '0.5' : '5';
      const custom = building?.version === 3;
      height.min = building ? (custom ? '10' : '1') : String(structureMinimumHeight(this.draft));
      height.max = building ? '10' : '100';
      height.step = custom ? '5' : this.draft.wallStairs ? '0.5' : '1';
      if (custom) height.max = '100';
      this.root.querySelector('[data-height-label]').textContent = building
        ? custom
          ? this.draft.kind === 'cellar'
            ? 'Cellar depth (ft)'
            : 'Building height (ft)'
          : 'Storeys (10 ft each)'
        : 'Height (ft)';
      const round = isRoundStructure(this.draft);
      for (const [key, visible] of Object.entries({
        diameterFeet: round,
        lengthFeet: !round,
        widthFeet: ['building', 'tunnel', 'cellar'].includes(this.draft.kind),
        style: this.draft.kind === 'wall',
        opening: this.draft.kind === 'wall',
        wallStairs: this.draft.kind === 'wall' && this.draft.style === 'battlement',
        ruined: ['wall', 'turret', 'building', 'dome'].includes(this.draft.kind),
      })) {
        const label = this.root.querySelector(`[data-size="${key}"]`);
        label.hidden = !visible;
        label.querySelector('input,select').disabled = !visible;
      }
      this._renderLevelControls();
    }
    this._fillFeatureFields();
    this.help.textContent =
      tool === 'select'
        ? this.floorTool === 'cut'
          ? 'Drag a rectangular opening on the highlighted floor plane. Release to cut; Escape cancels.'
          : this.floorTool === 'cellar-access'
            ? 'Click the surface or building ground plane to place this cellar access.'
            : this.selectedFeature
              ? 'Drag blue edges/corners to resize the selected feature; drag its centre to move. Shift enables fine sizing.'
              : this.featureTool === 'window'
                ? 'Click a wall or existing window. Drag to move; Remove feature deletes it.'
                : this.featureTool === 'balcony'
                  ? 'Choose an upper floor, click its wall, then drag the balcony.'
                  : 'Drag the centre handle to move; sides/corners resize and the top handle changes height. Shift enables fine sizing.'
        : ['wall', 'tunnel'].includes(tool)
          ? 'Drag to set length and direction. Release to build. Escape cancels.'
          : tool
            ? 'Click the map to place. Rotate changes the entrance direction.'
            : 'Choose a structure. Drag walls and tunnels; click to place other shapes.';
    const visible = this.engine.visibleLayers;
    this.root.querySelector('[data-build-cutaway]').checked =
      visible !== null && !visible.includes('roof');
    this._syncUnderground();
    this._syncIdentification();
  }

  _perform(operation) {
    try {
      operation();
    } catch (error) {
      this.cancel();
      if (this.selectedId) {
        this.draft =
          this.engine.geometry.getStructures().find((spec) => spec.id === this.selectedId) || null;
        this.hasPlacementPoint = !!this.draft;
        this._fill();
        this._render();
      }
      this.status.textContent = error.message;
      new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
        context: 'TerrainConstructionPanel',
      });
    }
  }

  dispose() {
    this.cancel();
    for (const dispose of this.disposers) dispose();
    this.preview.dispose();
    this.gizmos.dispose();
    this.underground.dispose();
    this.identification.dispose();
    this.root.replaceChildren();
  }
}
