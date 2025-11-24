function disposeMesh(group, mesh) {
  if (!mesh) return;
  try {
    if (mesh.parent === group) {
      group.remove(mesh);
    } else {
      mesh.parent?.remove?.(mesh);
    }
  } catch (_) {
    /* ignore */
  }
  try {
    mesh.geometry?.dispose?.();
  } catch (_) {
    /* ignore */
  }
  try {
    mesh.material?.dispose?.();
  } catch (_) {
    /* ignore */
  }
}

export function ensurePlaneMesh({
  three,
  group,
  mesh,
  capacity = 0,
  required,
  colorHex,
  opacity,
}) {
  if (!group || !three?.InstancedMesh || !three?.PlaneGeometry || !three?.MeshBasicMaterial) {
    return { mesh, capacity };
  }
  if (!Number.isFinite(required) || required <= 0) {
    return { mesh, capacity };
  }
  if (mesh && capacity >= required) {
    return { mesh, capacity };
  }

  const newCapacity = Math.max(required, capacity > 0 ? capacity * 2 : 32);
  if (mesh) {
    disposeMesh(group, mesh);
  }

  const geometry = new three.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new three.MeshBasicMaterial({
    color: typeof colorHex === 'number' ? colorHex : undefined,
    transparent: true,
    opacity: Number.isFinite(opacity) ? opacity : 0.12,
    depthWrite: false,
    side: three.FrontSide,
  });
  material.toneMapped = false;
  material.depthTest = false;

  const instanced = new three.InstancedMesh(geometry, material, newCapacity);
  instanced.name = 'TerrainBrushOverlay3DMesh';
  instanced.instanceMatrix.setUsage?.(three.DynamicDrawUsage || three.StreamDrawUsage);
  instanced.frustumCulled = false;
  instanced.count = 0;
  instanced.renderOrder = 10;
  group.add(instanced);

  return { mesh: instanced, capacity: newCapacity };
}

export function ensureBoxMesh({
  three,
  group,
  mesh,
  capacity = 0,
  required,
  colorHex,
  opacity,
  name,
  renderOrder = 11,
}) {
  if (!group || !three?.InstancedMesh || !three?.BoxGeometry || !three?.MeshBasicMaterial) {
    return { mesh, capacity };
  }
  if (!Number.isFinite(required) || required <= 0) {
    return { mesh, capacity };
  }
  if (mesh && capacity >= required) {
    return { mesh, capacity };
  }

  const newCapacity = Math.max(required, capacity > 0 ? capacity * 2 : 16);
  if (mesh) {
    disposeMesh(group, mesh);
  }

  const geometry = new three.BoxGeometry(1, 1, 1);
  const material = new three.MeshBasicMaterial({
    color: typeof colorHex === 'number' ? colorHex : undefined,
    transparent: true,
    opacity: Number.isFinite(opacity) ? opacity : 0.32,
    depthWrite: false,
    depthTest: false,
    side: three.DoubleSide,
  });
  material.toneMapped = false;

  const instanced = new three.InstancedMesh(geometry, material, newCapacity);
  instanced.name = name || 'TerrainBrushOverlay3DBox';
  instanced.instanceMatrix.setUsage?.(three.DynamicDrawUsage || three.StreamDrawUsage);
  instanced.frustumCulled = false;
  instanced.count = 0;
  instanced.renderOrder = renderOrder;
  group.add(instanced);

  return { mesh: instanced, capacity: newCapacity };
}

export function syncMeshMaterial(mesh, colorHex, opacity) {
  if (!mesh?.material) return;
  const material = mesh.material;
  try {
    if (material.color && typeof colorHex === 'number') {
      material.color.set(colorHex);
    }
    if (Number.isFinite(opacity)) {
      material.opacity = opacity;
      material.transparent = opacity < 1;
    }
    material.needsUpdate = true;
  } catch (_) {
    /* ignore */
  }
}
