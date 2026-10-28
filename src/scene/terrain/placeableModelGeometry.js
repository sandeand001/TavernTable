import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getModelSupportBounds } from '../../core/ModelPostProcessing.js';

/** Bake the complete cached model pose into geometry owned by one instance group. */
export function createPlaceableModelGeometry(three, root) {
  const supportBounds = getModelSupportBounds(three, root);
  const parts = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
    // Baking a reflection removes the renderer's negative-scale front-face correction.
    if (child.matrixWorld.determinant() < 0) {
      if (!geometry.index) {
        geometry.setIndex(
          Array.from({ length: geometry.attributes.position.count }, (_, index) => index)
        );
      }
      const index = geometry.index;
      for (let i = 0; i < index.count; i += 3) {
        const second = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, second);
      }
    }
    parts.push({
      geometry,
      material: child.material,
    });
  });
  if (!parts.length) throw new Error('Static placeable model contains no meshes');
  if (parts.length === 1) return { ...parts[0], supportBounds };

  const geometries = [];
  const materials = [];
  const groups = [];
  let vertexOffset = 0;
  try {
    for (const part of parts) {
      const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
      geometries.push(geometry);
      const sourceMaterials = Array.isArray(part.material) ? part.material : [part.material];
      const materialOffset = materials.length;
      materials.push(...sourceMaterials);
      if (Array.isArray(part.material) && geometry.groups.length) {
        for (const group of geometry.groups) {
          groups.push({
            start: vertexOffset + group.start,
            count: group.count,
            materialIndex: materialOffset + group.materialIndex,
          });
        }
      } else {
        groups.push({
          start: vertexOffset,
          count: geometry.attributes.position.count,
          materialIndex: materialOffset,
        });
      }
      vertexOffset += geometry.attributes.position.count;
    }
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error('Static placeable meshes have incompatible vertex attributes');
    geometry.clearGroups();
    for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    return { geometry, material: materials, supportBounds };
  } finally {
    const ownedParts = new Set([...parts.map((part) => part.geometry), ...geometries]);
    for (const geometry of ownedParts) geometry.dispose();
  }
}
