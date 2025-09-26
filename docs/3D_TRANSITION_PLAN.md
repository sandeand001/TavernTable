# 3D Transition Plan (Living Document)

Status: INITIATED  
Branch: `feature/3d-transition`  
Last Updated: 2025-09-26

---
## 0. Purpose
Move TavernTable from a 2.5D isometric sprite projection to a true 3D scene using Three.js while preserving gameplay logic and allowing incremental adoption. This document is a living plan: update sections as phases complete or decisions change.

---
## 1. Guiding Principles
- Incremental: Each phase is independently shippable and reversible.
- Stable APIs: Keep `GameManager`, coordinator interfaces, and token/terrain manager contracts intact until Phase 7.
- Test Continuity: Existing tests survive early phases; new tests assert world mapping without forcing brittle rewrites too soon.
- Dual Mode Bridge: Support `renderMode = '2d-iso' | '3d-hybrid'` until full migration.
- Determinism: Grid ↔ world transformations must be pure & tested.

---
## 2. Phases Overview
| Phase | Goal | Output | Ship Criteria |
|-------|------|--------|---------------|
| 0 | Spatial abstraction | `SpatialCoordinator` + tests | No visual regressions |
| 1 | Three.js bootstrap | `ThreeSceneManager` canvas | 3D plane below 2D sprites |
| 2 | Heightmapped terrain | Terrain mesh updates with elevation | Terrain reacts to editor |
| 3 | Token billboards | 3D token planes + dual render | Feature toggle works |
| 4 | Placeable instancing | Instanced meshes | Performance stable |
| 5 | Lighting & shadows | Directional + ambient + fog | Shadows render clean |
| 6 | 3D interaction | Ray picking & movement | All core actions in 3D |
| 7 | Projection retirement | Remove iso dependency | All consumers use world |
| 8 | Polish & advanced | Splat maps, TOF, AO | Feature backlog curated |

---
## 3. Key Decisions (Initial)
| Concern | Decision (Initial) | Rationale | Revisit Phase |
|---------|--------------------|-----------|---------------|
| World axes | X east, Z south, Y up | Aligns with Three.js conventions | Only if pathfinding needs change |
| Tile world size | 1.0 x (sqrt(0.5))? (TBD) | Start simple: 1 unit square; iso visuals later | Phase 2 before mesh |
| Elevation unit | 0.5 world units per level | Visual separation; tweakable factor | Phase 2 tuning |
| Camera initial | Orthographic iso-like | Preserve current spatial feel | Could add perspective Phase 5 |
| Token form (3D) | Billboard Sprite first | Lowest friction migration | Replace with meshes Phase 4/5 |
| Placeables | Instanced quads initially | Perf; small memory footprint | Upgrade meshes Phase 8 |
| Lighting model | StandardMaterial + dir + amb | Fast path | Enhance with env map Phase 5 |
| Fog | Disabled early | Avoid visual confusion | Enable Phase 5 |
| Physics | Deferred | Not blocking base visuals | Evaluate after Phase 6 |

Open placeholders: finalize tile size conversion + world scaling constant in Phase 0/1.

---
## 4. Module Additions
| File | Layer | Responsibility |
|------|-------|----------------|
| `src/scene/SpatialCoordinator.js` | app/domain bridge | Grid ↔ world math (canonical) |
| `src/scene/ThreeSceneManager.js` | core/app | Renderer, scene lifecycle |
| `src/scene/CameraRig.js` | core/app | Camera setup & mode toggles |
| `src/scene/TerrainMeshBuilder.js` | domain/app | Build/update height mesh |
| `src/scene/TerrainRebuilder.js` | app | Debounced terrain mesh refresh |
| `src/scene/Token3DAdapter.js` | app | Wrap token creation into 3D handles |
| `src/scene/PlaceableMeshPool.js` | app | Instanced placeable management |
| `src/scene/PickingService.js` | app | Raycast → grid/token/placeable |

---
## 5. Refactor Touch Map
| Existing Area | Impact | Strategy |
|---------------|--------|----------|
| `CoordinateUtils.gridToIsometric` | Deprecated eventually | Wrap calls behind SpatialCoordinator early |
| `ProjectionUtils` | Removal target | Mark deprecated Phase 3; delete Phase 7 |
| `TokenManager` placement/positioning | Medium | Dual-write iso & world, then remove iso |
| `TerrainManager` placeables repositioning | High | Stop per-sprite Y adjustments once world set |
| `ElevationScaleController` | Medium | Switch to vertex height scaling |
| `DepthUtils` (zIndex) | Legacy overlay only | Replace with actual world depth ordering |

---
## 6. Testing Strategy Evolution
| Stage | Legacy Tests | New Tests |
|-------|--------------|-----------|
| 0 | All unchanged | `SpatialMapping.test` |
| 1 | All unchanged | Scene bootstrap smoke |
| 2 | Iso asserts tolerant (pixel ≈ projected world) | TerrainMesh vertex heights |
| 3 | Dual (iso + world) | Token3DAdapter sync |
| 4 | Placeable iso zIndex optional | Instancing lifecycle |
| 5 | Remove strict iso depth tests | Lighting config presence |
| 6 | Interaction: replace iso pick tests | PickingService ray grid mapping |
| 7 | Remove projection tests | World invariants only |
| 8 | Add shader/fog/time-of-day | Perf guards |

---
## 7. Risks & Mitigations
| Risk | Phase | Mitigation |
|------|-------|-----------|
| Grid/world drift | 0–2 | Centralized SpatialCoordinator + unit roundtrip tests |
| Performance regression (instancing) | 4 | Profiling & threshold gating |
| Shadow artifacts | 5 | Bias tuning & cascade option |
| Picking inaccuracies | 6 | Barycentric clamp + cell bounds check |
| Test brittleness | 2–3 | Tolerance-based comparisons, not exact px |
| Over-scope | All | Phase gates + feature flag per milestone |

---
## 8. Incremental Deliverables (Week-by-Week)
Week 1: Phase 0–1 (SpatialCoordinator + Three bootstrap + dev flag)  
Week 2: Phase 2 (height mesh) + partial Phase 3 (first billboard token)  
Week 3: Complete Phase 3; Phase 4 instancing; begin Phase 5 lighting  
Week 4: Phase 5–6 finalize; Phase 7 cleanup; backlog grooming for Phase 8  

---
## 9. Backlog (Polish & Advanced)
- Splat map biome blending
- Time-of-day light & sky gradient
- Ambient occlusion (baked or SSAO)
- Particle weather (rain, snow)
- Token mesh replacement (animated glTF)
- Fog-of-war shader (mask texture)
- Dice physics (Rapier integration)
- Selection outline postprocess

---
## 10. Immediate Action Items (Phase 0)
- [x] Decide tile world size constant & elevation world scalar (defaults accepted: 1.0 tile, 0.5 elev)
- [x] Implement `SpatialCoordinator` skeleton + tests (`SpatialMapping.test.js`)
- [x] Inject into `GameManager` (no visual change)
- [x] Refactor token placement to store `token.world` (grid-derived)
- [x] Add dev flag `gameManager.renderMode`

### 10A. Early Phase 1 Tasks (Bootstrap)
- [x] Stub `ThreeSceneManager` (scene, camera, renderer guarded) + unit test
- [x] Hook minimal grid plane (base world reference)
- [ ] Add camera rig abstraction
- [x] Expose hybrid toggle dev hook (`gameManager.enableHybridRender()`) (UI pending)
- [ ] Metrics: log degraded vs ready init state

---
## 11. Open Questions
| Question | Notes | Owner |
|----------|-------|-------|
| Should elevation allow fractional levels? | Needed for smooth ramps? | TBD |
| Keep support for top-down 2D mode post-migration? | Could project from 3D camera | TBD |
| Asset pipeline for 3D models | FBX→glTF conversion script | TBD |

---
## 12. Change Log
| Date | Change | Author |
|------|--------|--------|
| INITIAL | Document created on branch `feature/3d-transition` | system |
| 2025-09-26 | Phase 0 complete; Phase 1 bootstrap (ThreeSceneManager + world coordinates) | system |
| 2025-09-26 | Added minimal grid plane & dev hybrid toggle hook | system |

---
## 13. Maintenance Notes
- Update phase tables as each completes; do not delete previous rows—append status.
- Keep decisions immutable unless new row added with supersede note.
- Add test references when a phase lands (file paths).

