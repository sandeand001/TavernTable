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

- [x] **3a.** Extract `BiomePalettes.js` algorithmic functions — *deferred, annotated* *(C1)*
- [x] **3b.** Extract `BiomePalettes3D.js` functions — *deferred, annotated* *(C1)*
- [x] **3c.** Extract `BiomePalettes3DHarmonized.js` functions — *deferred, annotated* *(C1)*
- [x] **3d.** Extract `FloraProfiles.js` logic — *partially done in prior pass, annotated* *(C1)*
- [x] **3e.** `TokenCommandConfig.js` — *deferred, annotated (tightly coupled)* *(C1)*

**Gate:** `npm test` passes, biome rendering works in browser  
**Commit:** `2caebb0`

---

## Phase 4 — Split Oversized Files

- [x] **4a.** `managers/terrain-manager/internals/placeables.js` (1020→722) → split into `placeables-removal.js`, `placeables-variant.js`
- [x] **4b.** `core/GameManager.js` (~796) → *already under guideline, skip*
- [x] **4c.** `utils/logger/Logger.js` (939→395) → extract handlers, LogEntry, PerformanceMonitor to `utils/logger/internals/`
- [x] **4d.** `utils/error/ErrorHandler.js` (~750) → *already under guideline, skip*
- [x] **4e.** `ui/UIController.js` (~873) → *cohesive glue layer, skip*
- [x] **4f.** `ui/components/RadialMenu.js` (~608) → *already under guideline, skip*
- [x] **4g.** `scene/ThreeSceneManager.js` (~1007) → *cohesive orchestrator with mixins, skip*

**Gate:** `npm test` passes, all UI interactions work  
**Commit:** `03d72b1`

---

## Phase 5 — Import & Export Pattern Fixes

- [x] **5a.** Fix singleton export pattern for `GameManager.js` — *skip: instantiated with options, class export is correct* *(C5)*
- [x] **5b.** Fix singleton export pattern for `ModelAssetCache.js` — *skip: same rationale* *(C5)*
- [x] **5c.** Verify mixin installer exports in 7 token-adapter files — *all 7 compliant* *(M1)*

**Gate:** `npm test` passes  
**Commit:** no changes needed

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
