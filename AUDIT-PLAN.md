# Conventions Audit — Remediation Plan & Tracking

**Source:** [CONVENTIONS-AUDIT.md](CONVENTIONS-AUDIT.md)  
**Approach:** 6 phases ordered by risk, each ending with `npm test` verification.

---

## Phase 1 — Zero-Risk: Delete & Move (no logic changes)

- [x] **1a.** Delete duplicate `src/coordinators/ProjectionUtils.js`, update import in `StateCoordinator.js` *(C3)*
- [x] **1b.** Move `scene/token-adapter/MannequinConfig.js` → `config/token-adapter/MannequinConfig.js`, update ~13 imports *(C4)*
- [x] **1c.** Replace wildcard import in `activation/reset.js` with named imports *(H3)*

**Gate:** `npm test` passes, app loads in browser  
**Commit:** `3cacc3e`

---

## Phase 2 — Cosmetic: Section Comments & Formatting (no logic changes)

- [x] **2a.** Add section comments to 17 files listed in H1
- [x] **2b.** Standardize section comment dash lengths across all files *(M3)*
- [x] **2c.** Fix import grouping in `GameManager.js`, `ModelAssetCache.js`, `ModelPostProcessing.js`, `CreatureToken.js` *(H4)*

**Gate:** `npm test` passes  
**Commit:** `7c37c94`

---

## Phase 3 — Extract Logic from Config Files (high impact)

- [ ] **3a.** Extract `BiomePalettes.js` algorithmic functions (OKLCH, Perlin, hydrology) → `terrain/painting/color-pipeline.js` or `utils/color/` *(C1)*
- [ ] **3b.** Extract `BiomePalettes3D.js` functions → appropriate domain module *(C1)*
- [ ] **3c.** Extract `BiomePalettes3DHarmonized.js` functions → appropriate domain module *(C1)*
- [ ] **3d.** Extract `FloraProfiles.js` logic (`pickIds`, `makeWeights`, `withSpectralVariants`) → `terrain/flora/` *(C1)*
- [ ] **3e.** `TokenCommandConfig.js`: move `_registerCommand` and `getTokenCommand` to runtime module (if layering allows) *(C1)*

**Gate:** `npm test` passes, biome rendering works in browser

---

## Phase 4 — Split Oversized Files

- [ ] **4a.** `managers/terrain-manager/internals/placeables.js` (1000+) → split into `placeables-plant-3d.js`, `placeables-variant-cycling.js`, `placeables-removal.js`
- [ ] **4b.** `core/GameManager.js` (~1100) → further decompose to `game-manager/internals/`
- [ ] **4c.** `utils/logger/Logger.js` (~1050) → extract handler classes to `utils/logger/internals/`
- [ ] **4d.** `utils/error/ErrorHandler.js` (~950) → extract to `utils/error/internals/`
- [ ] **4e.** `ui/UIController.js` (~900) → extract token drag-drop to `ui/internals/`
- [ ] **4f.** `ui/components/RadialMenu.js` (~900) → extract to `ui/components/radial-menu/internals/`
- [ ] **4g.** `scene/ThreeSceneManager.js` (~1000) → extract to `scene/three-scene-manager/internals/`

**Gate:** `npm test` passes, all UI interactions work

---

## Phase 5 — Import & Export Pattern Fixes

- [ ] **5a.** Fix singleton export pattern for `GameManager.js` *(C5)*
- [ ] **5b.** Fix singleton export pattern for `ModelAssetCache.js` *(C5)*
- [ ] **5c.** Verify mixin installer exports in 7 token-adapter files *(M1)*

**Gate:** `npm test` passes

---

## Phase 6 — Color Dedup & Final Cleanup

- [ ] **6a.** Add missing functions to `utils/color/ColorUtils.js`: `clamp`, `srgbToLinear`, `hexToLinearRGB`, `mixLinearColor` *(H2)*
- [ ] **6b.** Replace duplicate color functions in `BiomePalettes*.js` with `ColorUtils` imports *(H2)*
- [ ] **6c.** Replace duplicate color functions in `LightingSystem.js` with `ColorUtils` imports *(H2)*
- [ ] **6d.** Plan `dice/` subdirectories for future growth *(M2)*

**Gate:** `npm test` passes, terrain colors correct in browser

---

## Summary

| Phase | Risk | Est. Files | Focus |
|-------|------|-----------|-------|
| **1** | None–Low | ~15 | Delete duplicate, move config, fix wildcard import |
| **2** | None | ~21 | Section comments, import grouping |
| **3** | Medium | ~10 | Extract logic from config/ |
| **4** | Medium | ~14 | Split oversized files |
| **5** | Low | ~10 | Export pattern fixes, mixin verification |
| **6** | Low | ~8 | Color deduplication, cleanup |
