import { getBiomeColorWithHydrology, normalizeBiomeKey } from '../../config/biome/BiomePalettes.js';

const WATER_BIOMES = new Set([
  'coast',
  'beach',
  'riverLake',
  'ocean',
  'coralReef',
  'swamp',
  'wetlands',
  'floodplain',
  'bloodMarsh',
  'mangrove',
  'oasis',
]);
const WATER_MATERIALS = new WeakMap();

function validateWaterGrid({ cols, rows, getHeight, tileWorldSize, three, mergeCells = false }) {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols <= 0 ||
    rows <= 0 ||
    typeof getHeight !== 'function' ||
    !Number.isFinite(tileWorldSize) ||
    tileWorldSize <= 0 ||
    !three
  )
    throw new Error('Water rendering requires a valid terrain grid and scale');
  if (typeof mergeCells !== 'boolean') throw new TypeError('Water merging must be boolean');
}

export function createWaterSurface({
  biomeKey,
  cols,
  rows,
  getHeight,
  tileWorldSize,
  three,
  mergeCells = false,
}) {
  biomeKey = normalizeBiomeKey(biomeKey);
  if (!WATER_BIOMES.has(biomeKey)) return null;
  validateWaterGrid({ cols, rows, getHeight, tileWorldSize, three, mergeCells });
  const heights = new Float64Array(cols * rows);
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++) {
      const height = getHeight(x, z);
      if (!Number.isFinite(height))
        throw new Error('Water rendering requires valid terrain heights');
      heights[z * cols + x] = height;
    }
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new three.Color();
  const highlight = new three.Color(0xffffff);
  const visited = new Uint8Array(cols * rows);
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++) {
      const height = heights[z * cols + x];
      if (height >= 0 || visited[z * cols + x]) continue;
      let endX = x + 1;
      let endZ = z + 1;
      if (mergeCells) {
        while (endX < cols && !visited[z * cols + endX] && heights[z * cols + endX] === height)
          endX++;
        while (endZ < rows) {
          let matches = true;
          for (let column = x; column < endX; column++)
            if (visited[endZ * cols + column] || heights[endZ * cols + column] !== height) {
              matches = false;
              break;
            }
          if (!matches) break;
          endZ++;
        }
      }
      for (let row = z; row < endZ; row++)
        for (let column = x; column < endX; column++) visited[row * cols + column] = 1;
      const x0 = x * tileWorldSize,
        x1 = endX * tileWorldSize,
        z0 = z * tileWorldSize,
        z1 = endZ * tileWorldSize,
        first = positions.length / 3;
      positions.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0);
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      color.setHex(
        getBiomeColorWithHydrology(biomeKey === 'beach' ? 'coast' : biomeKey, Math.max(-8, height))
      );
      // The water and riverbed otherwise receive identical biome colors and lighting.
      color.lerp(highlight, 0.2);
      for (let vertex = 0; vertex < 4; vertex++) colors.push(color.r, color.g, color.b);
    }
  if (!positions.length) return null;
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new three.MeshPhongMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    shininess: 90,
    specular: 0x445d68,
    side: three.DoubleSide,
    forceSinglePass: true,
  });
  const mesh = new three.Mesh(geometry, material);
  mesh.name = 'TerrainWater';
  mesh.userData.renderOnly = true;
  mesh.userData.waterSurface = true;
  mesh.userData.baseOpacity = material.opacity;
  WATER_MATERIALS.set(mesh, material);
  mesh.raycast = () => {};
  return mesh;
}

export function syncWaterSurface(parent, options) {
  const previous = parent.getObjectByName?.('TerrainWater');
  const biomeKey = normalizeBiomeKey(options.biomeKey);
  let signature = null;
  let heights = null;
  if (WATER_BIOMES.has(biomeKey)) {
    validateWaterGrid(options);
    heights = [];
    for (let z = 0; z < options.rows; z++)
      for (let x = 0; x < options.cols; x++) heights.push(options.getHeight(x, z));
    signature = JSON.stringify([
      biomeKey,
      options.cols,
      options.rows,
      options.tileWorldSize,
      options.mergeCells ?? false,
      heights,
    ]);
  }
  if (
    parent.userData?.waterSignature === signature &&
    !!previous === parent.userData.waterSurfacePresent
  )
    return previous ?? null;
  const previousMaterial = previous ? WATER_MATERIALS.get(previous) : null;
  if (previous && !previousMaterial) throw new Error('The rendered water material is missing');
  const water = heights
    ? createWaterSurface({
        ...options,
        getHeight: (x, z) => heights[z * options.cols + x],
      })
    : null;
  if (previous) {
    previous.geometry.dispose();
    previousMaterial.dispose();
    WATER_MATERIALS.delete(previous);
    previous.removeFromParent();
  }
  if (water) parent.add(water);
  parent.userData ??= {};
  parent.userData.waterSignature = signature;
  parent.userData.waterSurfacePresent = !!water;
  return water;
}
