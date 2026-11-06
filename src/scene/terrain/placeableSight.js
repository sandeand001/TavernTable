export function opaqueModelBounds(three, root) {
  const bounds = new three.Box3();
  const point = new three.Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geometry.groups.length
      ? geometry.groups
      : [
          {
            start: 0,
            count: geometry.index?.count ?? geometry.attributes.position.count,
            materialIndex: 0,
          },
        ];
    for (const group of groups) {
      const material = materials[Array.isArray(mesh.material) ? group.materialIndex : 0];
      if (!material || material.userData?.__foliageCandidate || material.opacity === 0) continue;
      for (let i = group.start; i < group.start + group.count; i++) {
        const index = geometry.index ? geometry.index.getX(i) : i;
        point
          .fromBufferAttribute(geometry.attributes.position, index)
          .applyMatrix4(mesh.matrixWorld);
        bounds.expandByPoint(point);
      }
    }
  });
  return bounds.isEmpty() ? null : bounds;
}
