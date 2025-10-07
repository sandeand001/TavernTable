v   # Expressive Biome Color Plan

Status: DRAFT (Awaiting Phase 0 implementation)
Branch: `feature/3d-transition`
Last Updated: 2025-09-27
Related Master Doc: `3D_TRANSITION_PLAN.md`

---
## 0. Purpose
Replace all legacy 3D terrain palette modes with **two** deliberately stylized pipelines:
1. **Expressive** – cinematic fantasy, high emotional contrast, bold chroma, abrupt banding allowed.
2. **Atlas** – illustrated atlas readability, cartographic clarity, restrained but still distinct.

Both derive initial hue/lightness anchors from the existing 2D painterly seed palette, then apply biome-driven transformations (no cross-biome blending). Elevation, time-of-day, and intensity become the only external modifiers.

Success Criterion: A viewer can reliably identify biome types ("dunes", "volcanic", "oasis", etc.) from a mixed map snapshot at default intensity; night mode remains readable.

---
## 1. Removal Scope
| Item | Action |
|------|--------|
| Modes: stylized, harmonized, both, painterly-1to1, painterly-lit | DELETE |
| Sliders: brightness, saturation, luminance, gamma, blends | DELETE |
| Mood styling legacy flags | SUPERSEDED |
| Legacy painterly pass-through | REMOVE (no fallback) |

All references in `UIController.js`, `TerrainRebuilder.js`, `TerrainMeshBuilder.js`, `BiomePalettes.js` updated accordingly.

---
## 2. New UI / Controls
| Control | Description | Range / Values | Default |
|---------|-------------|----------------|---------|
| Mode Select | `Expressive` / `Atlas` | enum | Expressive |
| Intensity Slider | Scales contrast, chroma, accent probability | 0.5 – 1.75 (step 0.01) | 1.0 |
| Time of Day | Numeric or slider hour | 0 – 24 (float) | 12 |
| Quick TOD Buttons | Dawn (6), Noon (12), Dusk (18), Night (22) | Buttons | N/A |

No other palette controls are presented to user. Internals exposed for debugging: `window.terrainStyleState`.

---
## 3. Global State Shape
```js
window.terrainStyleState = {
  mode: 'expressive' | 'atlas',
  intensity: 1.0,
  timeOfDay: 12.0,          // hours
  sun: { direction: new THREE.Vector3(), elevation: 0, azimuth: 0 },
  version: 1
};
```

---
## 4. Color Pipeline Overview
1. **Seed Extraction**: Get base hex from existing 2D biome height palette (quantized height).
2. **Biome Expression** (mode-dependent): Apply biome design (bands + accents). Hard edges allowed.
3. **Temporal Layer**: Adjust L, C, hue according to Time-of-Day (sun curve + warm/cool shift). Night collapses chroma; preserves emissive accents.
4. **Intensity Scaling**: Nonlinear scaling of contrast (L deviation), chroma, accent probability.
5. **Finalize**: Convert OKLCH → sRGB hex; assign to vertex color buffer.

Water overlays render on top; underlying ground color remains unchanged.

---
## 5. Biome Design Schema
```ts
type Band = {
  name: string;
  heightRange: [number, number]; // inclusive grid height band
  LShift?: number;               // additive shift
  CMult?: number;                // multiplicative chroma
  hueShift?: number;             // additive degrees (+/-)
  hueTarget?: number;            // optional absolute target for blending
  hueBlend?: number;             // 0..1 blend strength if hueTarget present
  hard?: boolean;                // no interpolation across boundary
};

type Accent =
  | { type: 'noiseHuePulse'; noise: 'micro'; threshold: number; hueTarget: number; amount: number }
  | { type: 'ember'; noise: 'micro'; min: number; hueTarget: number; LAdd: number; CAdd: number }
  | { type: 'sparkle'; noise: 'microHi'; min: number; hueDelta: number; CAdd: number; LAdd: number }
  | { type: 'algae'; noise: 'micro'; min: number; hueTarget: number; CAdd: number; LAdd?: number }
  | { type: 'fluor'; noise: 'micro'; min: number; hueTarget: number; CMult: number };

type BiomeModeDesign = {
  hueBase?: number;
  hueJitter?: number;     // random small variation
  chromaMin?: number;
  chromaMax?: number;
  lightnessBase?: number;
  lightnessSpan?: number;
  bands: Band[];
  accents: Accent[];
  allowHardBands?: boolean;
};

type BiomeDesign = {
  expressive: BiomeModeDesign;
  atlas: BiomeModeDesign;
};
```

---
## 6. Initial Biome Design Matrix (Seed Set)
Focus first on 3 core biomes → then expand.

| Biome | Expressive Highlights | Atlas Highlights | Notes |
|-------|----------------------|------------------|-------|
| sandDunes | Thermal gold crests, cobalt cooled valleys, 2–3 hard elevation bands | Controlled ochre steps, limited cool shadow tint | Strong high L contrast in expressive |
| mountain/alpine | Deep slate/cobalt shadows, warm ridges, abrupt snow cap | Neutral rock base + crisp white cap | Snow cap hard edge (height threshold) |
| swamp/wetlands | Murky olive ground, neon algae pulses, haze compression | Muted moss, minimal pulses | Algae accent probability reduced in atlas |

Subsequent expansion set: volcanic, coralReef, oasis, glacier/packIce, tundra, plains, desertHot/desertCold, oasis, subterranean.

---
## 7. Time-of-Day Model
| TOD (h) | Sun Elevation | Expressive Effects | Atlas Effects |
|---------|---------------|--------------------|---------------|
| 6 (Dawn) | Low | Warm hue drift (toward 28°), slight L contrast softening | Mild warm shift, limited chroma change |
| 12 (Noon) | High | Neutral baseline | Neutral baseline |
| 18 (Dusk) | Low | Strong warm shift + extended shadow cool bias | Warm shift moderate |
| 22 (Night) | <0 (below horizon) | Chroma collapse (C *= 0.4–0.5), L compression, emissive accents preserved | Chroma reduced (C *= 0.55) |

Sun Direction Computation:
```
azimuth = (tod / 24) * 2π
// elevation curve: peak at noon, negative at night
phase = ((tod - 6) / 12) * π  // 6→18 maps to 0→π
raw = sin(clamp(phase, 0, π))
elevation = raw * maxElevation - nightDrop
```

---
## 8. Water Overlay Strategy
| Aspect | Approach |
|--------|----------|
| Base Ground | Always computed normally (no water recolor blending) |
| Water Mesh | Transparent plane w/ depth alpha (shallows clearer) |
| Depth Alpha | `alpha = clamp(0.15 + depth * 0.6, 0.15, 0.9)` |
| Tint | Slight biome-based hue (oasis/coral), otherwise neutral blue-green |
| Night | Slight luminance drop, maybe faint moon highlight |

Later enhancement: caustic noise & screen-space attenuation.

---
## 9. Intensity Scaling
```
scale = 1 + (intensity - 1) * modeFactor
Expressive: modeFactor ≈ 1.1 (affects C, band LStretch, accent probability)
Atlas: modeFactor ≈ 0.6 (affects L separation + mild C)
```
Probability-based accents (embers, algae, sparkle) gate via noise threshold adjusted by intensity.

---
## 10. Implementation Phases
| Phase | Goal | Key Files |
|-------|------|----------|
| 0 | Remove legacy palette modes & UI | UIController, index.html, TerrainRebuilder, BiomePalettes |
| 1 | Add new controls + global state | UIController, new `PaletteDesign.js` |
| 2 | Implement pipeline skeleton (seed→expression→temporal→final) | BiomePalettes (refactor) |
| 3 | Add directional sun + TOD modulation | ThreeSceneManager |
| 4 | Implement 3 core biome designs | PaletteDesign.js |
| 5 | Extend to full biome set | PaletteDesign.js |
| 6 | Water overlay update (separate mesh) | TerrainMaterialFactory / new WaterOverlay.js |
| 7 | Intensity scaling refinement + night emissive accent rules | BiomePalettes |
| 8 | Snapshot tests + ΔE distinctness harness | tests/biomes/*.test.js |
| 9 | Performance memoization (cache buckets) | BiomePalettes, helpers |

---
## 11. Testing & Validation
Automated:
- Snapshot color tests across grid: (biome, height, mode, todBucket, intensityBucket) → hex.
- ΔE (OKLCH) separation test for midday distinctness threshold.
- Performance: 50x50 full rebuild under target budget (initial threshold 50ms dev machine).

Manual Visual QA:
- Gallery script (renders grid of biomes at Dawn/Noon/Dusk/Night).
- Side-by-side Expressive vs Atlas for same world seed.
- Night readability check (volcanic vs mountain vs tundra differentiation).

---
## 12. Extensibility Placeholders
| Future | Hook |
|--------|------|
| Seasons | Add `seasonProfile` to design map (multipliers) |
| Weather (fog/rain) | L & C compression pre-finalize |
| Emissive Pass | Separate additive overlay (volcanic, biolum caves, coral polyps) |
| Outline / Atlas Lines | Post-process edge detection toggled in Atlas mode |
| Flower Speckle Layer (plains) | Accent type extension |

---
## 13. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Overdraw from water overlay | DepthWrite=false + minor polygon offset |
| Performance regression from per-vertex noise | Bucketed caching + shared noise fields |
| Expressive mode overwhelms gameplay readability | Intensity cap + atlas fallback always available |
| Hard edges perceived as artifact | Optional micro dithering toggle (later) |
| Night too dark | Minimum lightness clamp + emissive preservation |

---
## 14. Initial Action Checklist (Ready to Implement)
- [ ] Phase 0 deletions applied
- [ ] New UI controls scaffolded
- [ ] `PaletteDesign.js` created with 3 seed biomes
- [ ] Pipeline refactor entry point prepared
- [ ] Directional sun stub added (updates on timeOfDay change)

---
## 15. Approval & Iteration
Once Phase 0–2 merged, we iterate biome design expanders in small PRs (3–4 biomes each) to keep reviewable diffs. Adjust intensity curves after first visual gallery.

---
## 16. Quick Reference API
```js
// Set mode
terrainStyleState.mode = 'expressive';
// Adjust intensity
terrainStyleState.intensity = 1.25; requestTerrain3DRebuild();
// Change time of day
terrainStyleState.timeOfDay = 18; updateSun(); requestTerrain3DRebuild();
```

---
## 17. Open Questions
- Minimum per-biome distinctness threshold (current assumption ΔE >= 0.08) – confirm later.
- Should oasis ring logic depend on radial noise or strict distance only? TBD.
- Exact night emissive rules (volcanic, subterranean, coral) brightness scaling formula.

---
## 18. Changelog
| Date | Change |
|------|--------|
| 2025-09-27 | Initial draft created |

---
End of document.
