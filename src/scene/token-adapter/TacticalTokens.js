import { getTokenCharacterRecord } from '../../entities/creatures/TokenMovement.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import TacticalOverview from './TacticalOverview.js';

const ENTER_DOWN = Math.sin((80 * Math.PI) / 180);
const EXIT_DOWN = Math.sin((78 * Math.PI) / 180);
const TEXTURE_SIZE = 512;

// -- Public visuals and lifecycle --

function getTokenVisual(token) {
  if (this.isTacticalOverview() && !this._tacticalOverview?.contains(token)) return null;
  if (
    !this.isTacticalOverview() &&
    this.isTokenProjection(token) &&
    !this.isTokenProjectionVisible(token)
  )
    return null;
  const tactical = this._tacticalTokens.get(token)?.mesh;
  return tactical?.visible ? tactical : token?.__threeMesh || null;
}

function refreshTokenAppearance(token, character) {
  const visual = this._tacticalTokens.get(token);
  if (!visual) return;
  const record = character ?? getTokenCharacterRecord(token);
  visual.characterId = token.characterSheetId || null;
  const source = record?.portraitImage || token.publicPortraitImage || null;
  if (visual.source === source) return;
  if (visual.loadingImage) {
    visual.loadingImage.onload = null;
    visual.loadingImage.onerror = null;
  }
  visual.source = source;
  visual.image = null;
  visual.loadingImage = null;
  this._drawTacticalToken(token, visual);
  if (!source) return;
  const image = new Image();
  visual.loadingImage = image;
  image.onload = () => {
    if (this._tacticalTokens.get(token) !== visual || visual.loadingImage !== image) return;
    visual.image = image;
    visual.loadingImage = null;
    this._drawTacticalToken(token, visual);
  };
  image.onerror = () => {
    if (this._tacticalTokens.get(token) !== visual || visual.loadingImage !== image) return;
    visual.loadingImage = null;
    GameErrors.rendering(
      new Error(`Could not display the portrait for ${getTokenDisplayName(token)}`),
      {
        component: 'TacticalTokens',
        operation: 'loadPortrait',
        tokenId: token.id,
      }
    );
  };
  image.src = source;
}

function disposeTacticalTokens() {
  for (const token of this._tacticalTokens.keys()) this._discardTacticalToken(token);
  this._tacticalOverview?.dispose();
  this._tacticalOverview = null;
  this._tacticalView = false;
  this._tacticalDirection = null;
  this._tacticalTokenFailures = new WeakSet();
}

function isTacticalOverview() {
  const gm = this.gameManager;
  const role =
    gm.characterServices?.sessionRole ?? gm.characterServices?.library?.store?.identity?.role;
  return this._tacticalView && !!gm.campaignWorld && (role === undefined || role === 'dm');
}

// -- Camera-driven presentation --

function _syncTacticalTokens() {
  const manager = this.gameManager?.threeSceneManager;
  const { camera, three, scene } = manager || {};
  if (!camera?.isCamera || !three || !scene) return;
  this._tacticalDirection ||= new three.Vector3();
  camera.getWorldDirection(this._tacticalDirection);
  const down = -this._tacticalDirection.y;
  this._tacticalView = down + 1e-10 >= (this._tacticalView ? EXIT_DOWN : ENTER_DOWN);
  const overview = this.isTacticalOverview();
  const overviewTokens = [];
  if (!overview && this._tacticalOverview) {
    this._tacticalOverview.dispose();
    this._tacticalOverview = null;
  }
  if (overview) this._tacticalOverview ||= new TacticalOverview(this.gameManager, three);
  const tile = this.gameManager.spatial?.tileWorldSize || 1;
  for (const token of this.gameManager.placedTokens || []) {
    if (
      overview
        ? !this._tacticalOverview.contains(token)
        : this.isTokenProjection(token) && !this.isTokenProjectionVisible(token)
    ) {
      this._discardTacticalToken(token);
      if (token.__threeMesh) token.__threeMesh.visible = false;
      continue;
    }
    let visual = this._tacticalTokens.get(token);
    if (this._tacticalView && !visual && !this._tacticalTokenFailures.has(token)) {
      try {
        visual = this._createTacticalToken(token, three, scene);
      } catch (error) {
        this._discardTacticalToken(token);
        this._tacticalTokenFailures.add(token);
        GameErrors.rendering(error, {
          component: 'TacticalTokens',
          operation: 'createToken',
          tokenId: token.id,
        });
      }
    }
    if (!visual) continue;
    visual.mesh.visible = this._tacticalView;
    const model = token.__threeMesh;
    if (visual.hiddenModel && (!this._tacticalView || visual.hiddenModel !== model)) {
      visual.hiddenModel.visible = visual.modelVisibility;
      visual.hiddenModel = null;
    }
    if (this._tacticalView && model && visual.hiddenModel !== model) {
      visual.modelVisibility = model.visible;
      visual.hiddenModel = model;
    }
    if (this._tacticalView && model) model.visible = false;
    if (!this._tacticalView) continue;
    const world = this.getTokenViewPosition(token);
    visual.mesh.position.set(world.x, world.y + tile * 0.12, world.z);
    visual.mesh.scale.setScalar(tile);
    visual.mesh.material.depthTest = !overview && !this.gameManager.publicPlayerPresentation;
    visual.mesh.renderOrder = overview ? 1000 : 0;
    camera.getWorldQuaternion(visual.mesh.quaternion);
    visual.mesh.updateMatrixWorld(true);
    if (visual.characterId !== (token.characterSheetId || null)) this.refreshTokenAppearance(token);
    const highlight =
      this._selectedToken === token ? 'selected' : this._hoverToken === token ? 'hover' : '';
    if (visual.name !== getTokenDisplayName(token) || visual.highlight !== highlight) {
      this._drawTacticalToken(token, visual);
    }
    if (overview) overviewTokens.push({ token, mesh: visual.mesh });
  }
  if (overview) {
    this._tacticalOverview.update(
      overviewTokens,
      camera,
      manager.canvas || manager.renderer.domElement,
      scene
    );
  }
}

// -- Token texture and resources --

function _createTacticalToken(token, three, scene) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A canvas is required to render tactical tokens');
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  const mesh = new three.Mesh(
    new three.CircleGeometry(0.46, 64),
    new three.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: three.DoubleSide,
      toneMapped: false,
    })
  );
  mesh.name = `TacticalToken:${token.id}`;
  mesh.userData.__ttTacticalToken = true;
  mesh.visible = false;
  const visual = { mesh, canvas, context, texture, hiddenModel: null };
  this._tacticalTokens.set(token, visual);
  scene.add(mesh);
  this.refreshTokenAppearance(token);
  return visual;
}

function _drawTacticalToken(token, visual) {
  const { context: ctx, texture, image } = visual;
  visual.name = getTokenDisplayName(token);
  visual.highlight =
    this._selectedToken === token ? 'selected' : this._hoverToken === token ? 'hover' : '';
  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.save();
  ctx.beginPath();
  ctx.arc(256, 256, 248, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#283145';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  if (image) {
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(
      image,
      (image.naturalWidth - size) / 2,
      (image.naturalHeight - size) / 2,
      size,
      size,
      0,
      0,
      TEXTURE_SIZE,
      TEXTURE_SIZE
    );
  }
  let lines;
  let font = image ? 44 : 96;
  const words = visual.name.split(/\s+/);
  for (; font >= 16; font -= 2) {
    ctx.font = `600 ${font}px system-ui, sans-serif`;
    lines = wrapTokenName(ctx, visual.name, 360);
    const wordsFit = words.every((word) => ctx.measureText(word).width <= 360);
    if ((lines.length <= (image ? 2 : 3) && wordsFit) || font === 16) break;
  }
  const lineHeight = font * 1.2;
  const centerY = image ? 380 : 256;
  if (image) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fillRect(0, centerY - (lines.length * lineHeight) / 2 - 14, TEXTURE_SIZE, TEXTURE_SIZE);
  }
  ctx.fillStyle = '#fffaf0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.fillText(line, 256, centerY + (index - (lines.length - 1) / 2) * lineHeight, 360);
  });
  ctx.restore();
  ctx.beginPath();
  ctx.arc(256, 256, 248, 0, Math.PI * 2);
  ctx.lineWidth = 16;
  ctx.strokeStyle =
    visual.highlight === 'selected'
      ? '#ffcc55'
      : visual.highlight === 'hover'
        ? '#79caff'
        : '#b8c4d9';
  ctx.stroke();
  texture.needsUpdate = true;
}

function wrapTokenName(ctx, name, width) {
  const lines = [];
  let line = '';
  for (const word of name.split(/\s+/)) {
    if (line && ctx.measureText(`${line} ${word}`).width > width) {
      lines.push(line);
      line = '';
    }
    for (const character of `${line ? ' ' : ''}${word}`) {
      if (line && ctx.measureText(line + character).width > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function _discardTacticalToken(token) {
  const visual = this._tacticalTokens.get(token);
  if (!visual) return;
  if (visual.hiddenModel) visual.hiddenModel.visible = visual.modelVisibility;
  if (visual.loadingImage) {
    visual.loadingImage.onload = null;
    visual.loadingImage.onerror = null;
  }
  visual.mesh.parent?.remove(visual.mesh);
  visual.mesh.geometry.dispose();
  visual.mesh.material.dispose();
  visual.texture.dispose();
  this._tacticalTokens.delete(token);
  this._tacticalOverview?.remove(token.id);
}

// -- Mixin installation --

export function installTacticalTokenMethods(prototype) {
  prototype.getTokenVisual = getTokenVisual;
  prototype.isTacticalOverview = isTacticalOverview;
  prototype.refreshTokenAppearance = refreshTokenAppearance;
  prototype.disposeTacticalTokens = disposeTacticalTokens;
  prototype._syncTacticalTokens = _syncTacticalTokens;
  prototype._createTacticalToken = _createTacticalToken;
  prototype._drawTacticalToken = _drawTacticalToken;
  prototype._discardTacticalToken = _discardTacticalToken;
}
