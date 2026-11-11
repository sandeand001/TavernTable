import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ThreeSceneManager } from '../../scene/ThreeSceneManager.js';
import { configureConstructionMaterial } from '../../scene/terrain/ConstructionMaterials.js';

function floats(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.byteLength % 4) throw new Error('The published terrain buffer is invalid');
  return new Float32Array(bytes.buffer);
}

export default class PublishedMapViewer {
  constructor(container) {
    this.container = container;
    this.labels = new Map();
    this.mapId = null;
    this.terrainKey = null;
    this.capacity = 0;
    this.updateVersion = 0;
  }

  async _initialize(view) {
    const tile = view.grid.tileWorldSize;
    this.context = {
      cols: view.grid.cols,
      rows: view.grid.rows,
      spatial: { tileWorldSize: tile, elevationUnit: 0.3 },
      getTerrainHeight: () => 0,
      getViewMode: () => 'isometric',
    };
    const manager = new ThreeSceneManager(this.context);
    this.manager = manager;
    await manager.initialize(this.container.id);
    if (this.manager !== manager) {
      const renderer = manager.renderer;
      manager.dispose();
      renderer?.forceContextLoss?.();
      return;
    }
    if (!this.manager.initialized) throw new Error(this.manager.degradeReason);
    this.manager.setBootstrapGridVisible(false);
    this.manager.renderer.shadowMap.enabled = false;
    this.controls = new OrbitControls(this.manager.camera, this.manager.canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    const three = this.manager.three;
    this.markerGeometry = new three.CylinderGeometry(0.3, 0.3, 0.1, 16);
    this.markerMaterial = new three.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
    });
    this.color = new three.Color();
    this.matrix = new three.Matrix4();
  }

  async update(view) {
    const version = ++this.updateVersion;
    if (!view) {
      this.container.hidden = true;
      this.container.style.display = 'none';
      this.destroy();
      return;
    }
    this.container.hidden = false;
    this.container.style.display = 'block';
    if (!this.manager) await this._initialize(view);
    if (version !== this.updateVersion) return;
    const three = this.manager.three;
    if (view.id !== this.mapId) {
      this.mapId = view.id;
      this.context.cols = view.grid.cols;
      this.context.rows = view.grid.rows;
      this.context.spatial.tileWorldSize = view.grid.tileWorldSize;
      this.manager.reframe();
      this.controls.target.set(
        (view.grid.cols * view.grid.tileWorldSize) / 2,
        0,
        (view.grid.rows * view.grid.tileWorldSize) / 2
      );
      this.controls.update();
    }
    if (view.terrain && view.terrainKey !== this.terrainKey) {
      const positions = floats(view.terrain.positions);
      const colors = floats(view.terrain.colors);
      const normals = view.terrain.normals ? floats(view.terrain.normals) : null;
      const styles = view.terrain.constructionMaterials
        ? floats(view.terrain.constructionMaterials)
        : null;
      if (
        positions.length !== colors.length ||
        positions.length % 9 ||
        (normals && normals.length !== positions.length) ||
        (styles && styles.length !== positions.length / 3) ||
        [positions, colors, normals, styles].some(
          (values) => values && !values.every(Number.isFinite)
        ) ||
        (styles && !styles.every((value) => Number.isInteger(value) && value >= 0 && value <= 9))
      )
        throw new Error('The published terrain attributes do not match');
      const geometry = new three.BufferGeometry();
      geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
      if (normals) geometry.setAttribute('normal', new three.Float32BufferAttribute(normals, 3));
      else geometry.computeVertexNormals();
      if (styles)
        geometry.setAttribute('constructionMaterial', new three.Float32BufferAttribute(styles, 1));
      geometry.computeBoundingSphere();
      if (this.terrain) {
        this.terrain.geometry.dispose();
        this.terrain.geometry = geometry;
      } else {
        this.terrain = new three.Mesh(
          geometry,
          new three.MeshLambertMaterial({
            vertexColors: true,
            side: three.DoubleSide,
          })
        );
        this.terrain.name = 'PublishedTerrain';
        this.manager.scene.add(this.terrain);
      }
      if (styles) configureConstructionMaterial(this.terrain.material, view.grid.tileWorldSize / 5);
      this.terrainKey = view.terrainKey;
    }
    if (this.terrain) this.terrain.visible = true;
    this._tokens(view.tokens, view.grid.tileWorldSize);
  }

  _tokens(tokens, tile) {
    const three = this.manager.three;
    if (!this.markers || tokens.length > this.capacity) {
      this.markers?.removeFromParent();
      this.markers?.dispose();
      this.capacity = Math.max(1, tokens.length, this.capacity * 2);
      this.markers = new three.InstancedMesh(
        this.markerGeometry,
        this.markerMaterial,
        this.capacity
      );
      this.markers.name = 'PublishedTacticalTokens';
      this.markers.renderOrder = 10;
      this.manager.scene.add(this.markers);
    }
    this.markers.count = tokens.length;
    const labelled = new Set();
    for (const [index, token] of tokens.entries()) {
      this.matrix
        .makeScale(tile, tile, tile)
        .setPosition(token.world.x, token.world.y + tile * 0.06, token.world.z);
      this.markers.setMatrixAt(index, this.matrix);
      this.color.setHex(
        token.characterId ? 0x34d399 : token.allegiance === 'hostile' ? 0xfb7185 : 0x94a3b8
      );
      this.markers.setColorAt(index, this.color);
      if (token.characterId || labelled.size < 80) {
        labelled.add(token.id);
        let label = this.labels.get(token.id);
        if (label?.name !== token.name) {
          if (label) this._removeLabel(token.id);
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 48;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Player token labels require a canvas context');
          context.fillStyle = '#111827';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = '#ffffff';
          context.font = '22px sans-serif';
          context.textAlign = 'center';
          context.fillText(token.name, 128, 31, 246);
          const texture = new three.CanvasTexture(canvas);
          texture.colorSpace = three.SRGBColorSpace;
          const sprite = new three.Sprite(
            new three.SpriteMaterial({
              map: texture,
              depthWrite: false,
              depthTest: false,
            })
          );
          sprite.renderOrder = 11;
          this.manager.scene.add(sprite);
          label = { name: token.name, texture, sprite };
          this.labels.set(token.id, label);
        }
        label.sprite.position.set(token.world.x, token.world.y + tile * 0.65, token.world.z);
        label.sprite.scale.set(tile * 1.8, tile * 0.34, 1);
      }
    }
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    this.markers.computeBoundingSphere();
    for (const id of this.labels.keys()) if (!labelled.has(id)) this._removeLabel(id);
  }

  _removeLabel(id) {
    const label = this.labels.get(id);
    label.sprite.removeFromParent();
    label.sprite.material.dispose();
    label.texture.dispose();
    this.labels.delete(id);
  }

  clearTokens() {
    this.updateVersion++;
    if (this.markers) this.markers.count = 0;
    for (const id of this.labels.keys()) this._removeLabel(id);
  }

  concealTerrain() {
    if (this.terrain) this.terrain.visible = false;
  }

  destroy() {
    this.clearTokens();
    this.controls?.dispose();
    this.terrain?.geometry.dispose();
    this.terrain?.material.dispose();
    this.markerGeometry?.dispose();
    this.markerMaterial?.dispose();
    this.markers?.dispose();
    const renderer = this.manager?.renderer;
    this.manager?.dispose();
    renderer?.forceContextLoss?.();
    this.manager = null;
    this.controls = null;
    this.terrain = null;
    this.markerGeometry = null;
    this.markerMaterial = null;
    this.markers = null;
    this.capacity = 0;
    this.mapId = null;
    this.terrainKey = null;
  }
}
