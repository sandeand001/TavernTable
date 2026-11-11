import {
  buildingWindows,
  buildingLevels,
  buildingLevelElevation,
  buildingLocalToFeet,
  BUILDING_SIDES,
} from '../../terrain/BuildingModel.js';
import { CONSTRUCTION_MATERIALS } from '../../config/biome/ConstructionPalettes.js';
import { wallOpeningProfile } from '../../terrain/ConstructionBlueprints.js';

export function buildConstructionDetails({
  specs,
  three,
  worldUnitsPerFoot,
  visibleLayers = null,
}) {
  const positions = [],
    colours = [],
    styles = [],
    colour = new three.Color();
  const triangle = (spec, points, hex, style = 'none') => {
    colour.setHex(hex);
    for (const local of points) {
      const point = buildingLocalToFeet(spec, local);
      positions.push(
        point.x * worldUnitsPerFoot,
        point.y * worldUnitsPerFoot,
        point.z * worldUnitsPerFoot
      );
      colours.push(colour.r, colour.g, colour.b);
      styles.push(CONSTRUCTION_MATERIALS[style]);
    }
  };
  const quad = (spec, points, hex, style) => {
    triangle(spec, [points[0], points[1], points[2]], hex, style);
    triangle(spec, [points[0], points[2], points[3]], hex, style);
  };
  const box = (spec, min, max, hex, style) => {
    const p = [
      { x: min.x, y: min.y, z: min.z },
      { x: max.x, y: min.y, z: min.z },
      { x: max.x, y: max.y, z: min.z },
      { x: min.x, y: max.y, z: min.z },
      { x: min.x, y: min.y, z: max.z },
      { x: max.x, y: min.y, z: max.z },
      { x: max.x, y: max.y, z: max.z },
      { x: min.x, y: max.y, z: max.z },
    ];
    for (const face of [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
    ])
      quad(
        spec,
        face.map((i) => p[i]),
        hex,
        style
      );
  };
  const strip = (spec, side, low, high, bottom, top, hex, style) => {
    const along = ['north', 'south'].includes(side) ? 'x' : 'z',
      thin = along === 'x' ? 'z' : 'x';
    const span = thin === 'x' ? spec.lengthFeet : spec.widthFeet;
    const sign = ['north', 'west'].includes(side) ? -1 : 1;
    const face = sign * (span / 2 + 0.04);
    box(
      spec,
      { [along]: low, [thin]: face - 0.08, y: bottom },
      { [along]: high, [thin]: face + 0.08, y: top },
      hex,
      style
    );
  };
  for (const spec of specs) {
    if (!spec.appearance || spec.ruined || !['building', 'turret', 'wall'].includes(spec.kind))
      continue;
    const appearance = spec.appearance;
    if (spec.kind === 'wall') {
      if (
        !spec.opening ||
        appearance.detail !== 'fortress' ||
        (visibleLayers && !visibleLayers.includes('castle'))
      )
        continue;
      const width = spec.openingWidthFeet ?? 7.5,
        z = spec.widthFeet / 2 + 0.13;
      const profile = wallOpeningProfile(spec),
        height = spec.openingHeightFeet ?? Math.min(8, spec.heightFeet - 1);
      const rise = spec.openingShape === 'arch' ? Math.min(width / 2, height - 5) : 0;
      const spring = height - rise;
      const outer = profile.map((p) => ({
        x: p.x * (1 + 1 / width),
        y:
          p.y > spring && rise > 0
            ? spring + (p.y - spring) * (1 + 0.5 / rise)
            : p.y === height
              ? height + 0.5
              : p.y,
        z,
      }));
      for (let i = 1; i < profile.length; i++) {
        const j = (i + 1) % profile.length;
        quad(
          spec,
          [{ ...profile[i], z }, { ...profile[j], z }, outer[j], outer[i]],
          appearance.trimColor,
          'stone'
        );
      }
      for (const sign of [-1, 1]) {
        const x = sign * (width / 2 + 5),
          low = spec.heightFeet - 7,
          high = spec.heightFeet - 1.5;
        const points = [
          { x: x - 1.6, y: high, z },
          { x: x + 1.6, y: high, z },
          { x: x + 1.6, y: low + 0.8, z },
          { x, y: low, z },
          { x: x - 1.6, y: low + 0.8, z },
        ];
        for (let i = 1; i < points.length - 1; i++)
          triangle(spec, [points[0], points[i], points[i + 1]], appearance.accentColor);
        quad(
          spec,
          [
            { x: x - 0.22, y: high - 0.8, z: z + 0.01 },
            { x: x + 0.22, y: high - 0.8, z: z + 0.01 },
            { x: x + 0.22, y: low + 1, z: z + 0.01 },
            { x: x - 0.22, y: low + 1, z: z + 0.01 },
          ],
          0xd8ba67
        );
      }
      continue;
    }
    if (visibleLayers && !visibleLayers.includes('ground')) continue;
    const levels = buildingLevels(spec, { includeDeck: false });
    const bandHeights = [
      0.6,
      ...levels.slice(1).map((level) => level.elevationFeet - 0.2),
      spec.heightFeet - 0.3,
    ];
    const trimMaterial = appearance.detail === 'timber' ? 'timber' : 'stone';
    if (spec.kind === 'turret') {
      const radius = spec.diameterFeet / 2 + 0.08;
      for (const height of bandHeights)
        for (let segment = 0; segment < 16; segment++) {
          const a = (segment * Math.PI) / 8,
            b = ((segment + 1) * Math.PI) / 8;
          quad(
            spec,
            [
              { x: radius * Math.cos(a), y: height, z: radius * Math.sin(a) },
              { x: radius * Math.cos(b), y: height, z: radius * Math.sin(b) },
              { x: radius * Math.cos(b), y: height + 0.22, z: radius * Math.sin(b) },
              { x: radius * Math.cos(a), y: height + 0.22, z: radius * Math.sin(a) },
            ],
            appearance.trimColor,
            'stone'
          );
        }
      continue;
    }
    const apertures = [
      { side: 'south', u: 0.5, widthFeet: 5, bottom: 0, top: 8 },
      ...buildingWindows(spec).map((w) => ({
        ...w,
        bottom: buildingLevelElevation(spec, w.floor) + w.sillFeet,
        top: buildingLevelElevation(spec, w.floor) + w.sillFeet + w.heightFeet,
      })),
      ...spec.building.balconies.map((b) => ({
        ...b,
        widthFeet: 5,
        bottom: buildingLevelElevation(spec, b.floor),
        top: buildingLevelElevation(spec, b.floor) + 8,
      })),
    ];
    const segments = (side, bottom, top) => {
      const span = ['north', 'south'].includes(side) ? spec.lengthFeet : spec.widthFeet;
      let pieces = [[-span / 2, span / 2]];
      for (const opening of apertures.filter(
        (a) => a.side === side && a.bottom < top && a.top > bottom
      )) {
        const centre = (opening.u - 0.5) * span,
          low = centre - opening.widthFeet / 2,
          high = centre + opening.widthFeet / 2;
        pieces = pieces.flatMap(([a, b]) => {
          if (high <= a || low >= b) return [[a, b]];
          return [...(low > a ? [[a, low]] : []), ...(high < b ? [[high, b]] : [])];
        });
      }
      return pieces;
    };
    for (const side of BUILDING_SIDES) {
      for (const height of bandHeights)
        for (const [low, high] of segments(side, height, height + 0.26))
          strip(spec, side, low, high, height, height + 0.26, appearance.trimColor, trimMaterial);
      for (const opening of apertures.filter((a) => a.side === side)) {
        const span = ['north', 'south'].includes(side) ? spec.lengthFeet : spec.widthFeet;
        const centre = (opening.u - 0.5) * span,
          low = centre - opening.widthFeet / 2,
          high = centre + opening.widthFeet / 2;
        strip(
          spec,
          side,
          low - 0.2,
          low,
          opening.bottom - 0.16,
          opening.top + 0.2,
          appearance.trimColor,
          trimMaterial
        );
        strip(
          spec,
          side,
          high,
          high + 0.2,
          opening.bottom - 0.16,
          opening.top + 0.2,
          appearance.trimColor,
          trimMaterial
        );
        strip(
          spec,
          side,
          low,
          high,
          opening.top,
          opening.top + 0.2,
          appearance.trimColor,
          trimMaterial
        );
        if (opening.bottom > 0)
          strip(
            spec,
            side,
            low,
            high,
            opening.bottom - 0.16,
            opening.bottom,
            appearance.trimColor,
            trimMaterial
          );
      }
    }
    if (appearance.detail === 'timber') {
      for (const x of [-spec.lengthFeet / 2, spec.lengthFeet / 2])
        for (const z of [-spec.widthFeet / 2, spec.widthFeet / 2])
          box(
            spec,
            { x: x - 0.13, z: z - 0.13, y: 0.6 },
            { x: x + 0.13, z: z + 0.13, y: spec.heightFeet },
            appearance.trimColor,
            'timber'
          );
      if (spec.building.roof === 'gable' && (!visibleLayers || visibleLayers.includes('roof')))
        for (const sign of [-1, 1]) {
          const x = sign * (spec.lengthFeet / 2 + 0.04),
            top = spec.heightFeet,
            rise = spec.building.roofRiseFeet;
          for (const edge of [-1, 1])
            quad(
              spec,
              [
                { x, y: top, z: (edge * spec.widthFeet) / 2 },
                { x, y: top + 0.25, z: (edge * spec.widthFeet) / 2 },
                { x, y: top + rise, z: 0.12 },
                { x, y: top + rise - 0.25, z: -0.12 },
              ],
              appearance.trimColor,
              'timber'
            );
        }
    }
    if (/Inn|Market|Forge|Bakery|Tavern/.test(spec.name || '')) {
      const space = segments('south', 6, 7.5)
        .filter(([a, b]) => b - a >= 2.2)
        .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
      if (space) {
        const x = (space[0] + space[1]) / 2,
          z = spec.widthFeet / 2 + 0.22;
        box(
          spec,
          { x: x - 1, y: 6, z: z - 0.1 },
          { x: x + 1, y: 7.25, z: z + 0.1 },
          appearance.trimColor,
          'timber'
        );
        quad(
          spec,
          [
            { x: x - 0.2, y: 6.25, z: z + 0.11 },
            { x: x + 0.2, y: 6.25, z: z + 0.11 },
            { x: x + 0.2, y: 7, z: z + 0.11 },
            { x: x - 0.2, y: 7, z: z + 0.11 },
          ],
          appearance.accentColor
        );
      }
    }
  }
  if (!positions.length) return null;
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new three.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('constructionMaterial', new three.Float32BufferAttribute(styles, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
