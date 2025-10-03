# Biome Visual & Ecological Audit

Purpose: Provide a systematic, actionable review of every defined biome against three user‑requested criteria:
1. Terrain colors logical & distinctive
2. Sand / water level presentation appropriate
3. Trees / foliage / placeables fit the intended biome fantasy and integrate coherently

Legend:
- Palette Source: `Custom` = has explicit triad in `BiomePalettes.js`; `Default` = falling back to default triad; `Alias` = triad key exists but mismatched to runtime biome key; `Partial` = has triad but needs more nuance (e.g. lacks sand/snow banding).
- Priority: H = implement before further biome expansion; M = opportunistic next pass; L = polish / aesthetic refinement.

## Summary of Systemic Gaps
- Many variant/exotic biomes (mystic, shadowfell, astral, arcane, crystal, fungal, wasteland variants) use the default neutral bluish triad → appear greyed or samey.
- Hydrology: Single global waterline (h <= 0) with no per‑biome offsets or sand / shoreline gradient; beaches & wetlands lack transitional color ramp (mud, sand, silt).
- No moisture / temperature blending layers; biome extremes (volcanic vs glacier) rely only on triad without emissive/glint or frost layering.
- Foliage weighting strong for core forests, fair for wetlands, weak / absent for exotic & underground sets (intentionally zero, but may need special placeables later: crystals, fungi, bones, ruins, lava vents).
- Shadows currently ineffective because terrain material is unlit (`MeshBasicMaterial`). Switching to a lit material is prerequisite for meaningful palette tuning.

## Core Remediation Roadmap (High-Level)
1. Lighting & Material Foundation (H): Replace terrain material with `MeshStandardMaterial` (vertex colors) + low ambient + directional key → enables shading contrast & shadow readability.
2. Palette Differentiation Pass (H): Add explicit triads for every biome still on default; unify coast/beach aliasing; add variant/exotic color language.
3. Hydrology & Transitional Bands (H/M): Introduce sand/mud band: e.g. height in (0, +0.6) or a configurable per‑biome `shoreBand` controlling a separate lowland blend.
4. Special FX Layers (M): Optional overlay (emissive lava veins, subtle bloom for arcane/astral, fog tint for shadowfell, bioluminescent speckles for fungal/crystal).
5. Flora Profile Refinement (M): Add bespoke sets (mangrove roots, petrified pillars, crystal growth clusters, astral spires, arcane pylons) with deterministic spacing strategies.
6. Micro Variation & AO (L): Per‑instance deterministic scale/rotation jitter, lightweight screen‑space AO / contact shadow quad for grounded feel.

---

## Detailed Table
(Columns: Biome | Category | Palette Source | Visual Assessment | Hydrology / Sand | Flora Fit | Key Issues | Recommended Actions | Priority)

| Biome           | Category       | Palette | Visual Assessment                                         | Hydrology / Sand                                   | Flora Fit Assessment              | Key Issues / Gaps                                      | Recommended Actions                                                    | P |
|-----------------|----------------|---------|-----------------------------------------------------------|---------------------------------------------------|----------------------------------|--------------------------------------------------------|------------------------------------------------------------------------|---|
| grassland       | Common         | Custom  | Earthy low green to dry high; readable                   | Flat waterline only; no dry-to-sand               | Light scatter of mixed deciduous OK | Lacks lowland damp/wet tint                          | Add shallow band (lush green) + subtle sand edge                      | M |
| hills           | Common         | Custom  | Good mid greens; highs a bit yellow                      | Same global waterline                             | Moderate tree mix OK              | High elevation not distinct enough                    | Slightly desaturate highs; add rock accent placeables                 | M |
| forestTemperate | Common         | Custom  | Lush gradient; readable canopy base                      | Waterline abrupt                                  | Strong diverse set                | No understory layering                                 | Add ground shrubs/ferns low-height weight; damp band                  | M |
| forestConifer   | Common         | Custom  | Deep cool greens -> teal high: distinct                  | Abrupt waterline                                  | Very good conifer balance         | Slight lack of deadfall / rocks                        | Inject mossy rocks + fallen log assets (when available)               | M |
| savanna         | Common         | Default | Uses bluish default -> wrong biome feel                  | Lacks parched soil / dusty band                   | Tree weights sparse OK            | Color mismatch reduces identity                        | Add warm ochre triad; lighten highs; add termite mounds asset hook    | H |
| steppe          | Common         | Default | Neutral cool; should be semi‑arid tan                    | Same                                              | Sparse profile OK                  | Color sameness with savanna now                        | Add muted straw triad; optional low wildflower speckles              | H |
| desertHot       | Desert         | Custom  | Warm brown → pale sand high OK                           | No dune crest highlight band                      | No flora (intended)               | Flat dunes visually uniform                            | Add subtle high ridge bleaching; ripple normal map option             | M |
| desertCold      | Desert         | Custom  | Cooler slate → pale; acceptable                          | Same                                              | No flora                          | Cold desert could show frost edge                      | Slight blue frost overlay near waterline; lighter high albedo         | L |
| sandDunes       | Desert         | Custom  | Good dune tonality                                       | No moisture gradient near oases                   | Flora none (intended)             | Similar to desertHot; needs variance                   | Add windward/leeward dual-tone shading (normal tweak)                 | M |
| oasis           | Desert         | Custom  | Vibrant turquoise mid maybe too saturated                | Water edge abrupt; no wet sand ring               | Palm weighting good               | Saturation jump harsh                                  | Add shoreBand with darker wet sand gradient; lower mid saturation 10% | H |
| saltFlats       | Desert         | Default | Grey-blue default, should be bright saline               | Flat                                              | No flora (ok)                      | Missing high reflectance look                         | Add near-white triad with faint lavender mids; optional shimmer fx    | H |
| thornscrub      | Desert         | Default | Needs dusty olive + muted green                          | Flat                                              | Basic small/bare picked; fine     | Color identity absent                                  | Add khaki/olive triad; increase small thorny shrubs asset group       | H |
| tundra          | Arctic         | Custom  | Muted dark → pale ice high OK                            | Waterline abrupt; needs boggy permafrost band     | Sparse cold flora OK              | Ground feel slightly foresty dark                      | Lighten low band; add lichen/mat rock placeables                      | M |
| glacier         | Arctic         | Custom  | Strong blue to white high                                | Water embedded visually same                      | No flora (ok)                      | Uniform mid plateau                                    | Add crevasse shadow tint via height slope factor                      | L |
| frozenLake      | Arctic         | Custom  | Blue mid to cyan high; fine                              | Edge transition abrupt                            | No flora (ok)                      | Needs shoreline cracked ice ring                      | Add narrow semi-transparent edge decal band                           | M |
| packIce         | Arctic         | Custom  | Good; maybe too saturated mid                            | Same                                              | None (ok)                         | Lacks floe differentiation                             | Introduce per-tile floe tint jitter; dark water seams                 | M |
| mountain        | Mountain       | Custom  | Slate to snow high; good readability                     | Waterline rarely seen                             | Conifer & pines at elevation OK   | Snow line too smooth                                   | Add snow threshold with noise jitter; scree rubble placeables         | H |
| alpine          | Mountain       | Custom  | Cooler cyan snow cap; works                              | Waterline n/a mostly                              | High elevation pines good         | Slight overlap with mountain palette                   | Increase high brightness; add sparse wildflower alpine plants         | M |
| screeSlope      | Mountain       | Custom  | Neutral greys; acceptable                                | N/A                                               | Sparse bare/small trees ok        | May need more rock debris                              | Add rock/pebble cluster placeables; reduce green tint                 | M |
| cedarHighlands  | Mountain       | Default | Default bluish; should have cedar greens + reddish soil  | Standard                                          | Decent elevated conifers          | Palette mismatch                                      | Create custom triad: deep evergreen lows, rich umber mids, pale granite highs | H |
| geyserBasin     | Mountain       | Default | Needs mineral oranges / silica white                     | Waterline = hot pools not represented             | Sparse bare/columnar used         | Missing geothermal identity                            | Add steam particle anchors, sulfuric triad (ochre→teal deposits)      | H |
| swamp           | Wetlands       | Custom  | Dark peat → olive high; fine                             | Water depth bands via flora filter only           | High willow emphasis correct      | Visual flattening due to single material               | Add shallow water color darkening; floating debris placeables         | M |
| wetlands        | Wetlands       | Custom  | Similar to swamp; slightly brighter                      | Same limitations                                  | Good mix (willows, small)         | Indistinct from swamp                                  | Slightly shift mid hue toward cooler moss green; differentiate        | M |
| floodplain      | Wetlands       | Custom  | Green to tan high (OK)                                   | Waterline abrupt; seasonal mud missing            | Tree mix fine                     | Needs silt/mud transitional                            | Add mud band (0..+0.4); reduce high dryness                            | H |
| bloodMarsh      | Wetlands       | Default | Should have deep crimson / black peat; neutral now       | Same                                              | Custom weights present            | Palette undermines fantasy                             | Add dark maroon -> clotted red -> sickly pale triad + faint emissive  | H |
| mangrove        | Wetlands       | Custom  | Teal mid to aqua high maybe too bright                   | Water edge abrupt; roots not represented          | Willows stand in for mangroves    | Missing prop roots / pneumatophore feel                | Darken low band; custom mangrove root asset group; water tint          | H |
| coast           | Aquatic        | Custom  | Deep blue low → sandy high OK                            | No intertidal wet sand band                       | Palms on coastline tiles OK       | Lacks tidal zone contrast                              | Add wet sand gradient (-0.2..+0.4), shells/pebbles placeables         | H |
| riverLake       | Aquatic        | Custom  | Teal/green mid good; edges abrupt                        | Same                                              | Willow mix OK                     | No riparian mud/silt coloring                          | Add bank band; damp soil triad adjustment near waterline              | H |
| ocean           | Aquatic        | Custom  | Deep marine gradient works                               | Depth shading coarse (single threshold)           | No flora (intended)               | Flat seafloor if exposed                              | Later: subsurface scattering / foam pass                              | L |
| coralReef       | Aquatic        | Custom  | Vibrant; pink highlight good                             | Waterline rarely relevant                         | No flora (needs coral props)      | Lacks coral placeables                                 | Add coral asset group; bioluminescent speckles                       | M |
| deadForest      | ForestVariants | Default | Needs ashen / charcoal triad                             | Standard                                          | Dead tree weighting solid         | Palette mismatch reduces mood                          | Add dark charcoal → ashen grey → faint ember triad                    | H |
| petrifiedForest | ForestVariants | Default | Should be stone hues; now bluish                         | Standard                                          | Dead tree weighting OK            | Missing stone feel & subtle gloss                      | Create sandstone/granite triad; add petrified log assets              | H |
| bambooThicket   | ForestVariants | Default | Needs deep emerald / jade banding                        | Standard                                          | Tall/columnar weighting ok        | Dense canopy appears dull                              | Add rich green triad with lighter mid highlights                      | M |
| orchard         | ForestVariants | Default | Should look cultivated: warm soil + orderly green        | Standard                                          | Grid strategy excellent           | Palette neutral                                        | Add tilled soil brown low, bright green mid, pale sun-bleached high   | M |
| mysticGrove     | ForestVariants | Default | Should be saturated purples/pinks                        | Standard                                          | Cherry/orange/yellow weighting strong | Color undermines fantasy                           | Add twilight triad (deep violet → magenta → pastel glow) + mild bloom | H |
| feywildBloom    | ForestVariants | Default | Needs luminous pastel rainbow bias                       | Standard                                          | Rich flower weighting good        | Same as above                                          | Distinct pastel triad (teal→pink→gold) + emissive speckles            | H |
| shadowfellForest| ForestVariants | Default | Should be desaturated near‑monochrome with cold highlights | Standard                                        | Dead + sparse greens fine        | Lacks gloom feel                                      | Add near-black → desat moss → cold moonlit grey triad + fog           | H |
| cavern          | Underground    | Default | Neutral; should be dark slate                            | Waterline repurposed maybe for pools              | No flora (expected)               | Flat darkness                                         | Add dark triad, moisture gloss, stalagmite placeables                 | M |
| fungalGrove     | Underground    | Default | Needs rich damp browns + bioluminescent accents          | Same                                              | (Zero flora; future mushrooms)    | Missing identity                                      | Add earthy triad + glow overlay & spawn mushroom placeables           | H |
| crystalFields   | Underground    | Default | Should have cool cyan / prismatic highs                  | Same                                              | None yet                          | No crystal props                                      | Add crystalline triad and crystal spire placeables                    | H |
| crystalSpires   | Underground    | Default | Same as above but higher contrast                        | Same                                              | None yet                          | Same                                                  | Higher contrast triad; vertical spire assets cluster strategy         | H |
| eldritchRift    | Underground    | Default | Needs void purples / green glints                        | Same                                              | None                              | Lacks anomaly visuals                                 | Add dark purple triad + animated rune decals                         | H |
| volcanic        | Volcanic       | Custom  | Good lava-warm gradient                                  | Waterline seldom relevant                         | Sparse dead/bare ok               | Could use glowing cracks                               | Add emissive mask via height slope & noise                           | M |
| obsidianPlain   | Volcanic       | Custom  | Dark glassy; mid maybe too light                         | Waterline n/a                                     | No flora (intended)               | Lack sheen/caustic highlights                          | Add subtle specular/roughness variation                              | L |
| ashWastes       | Volcanic       | Custom  | Grey ash OK                                              | Waterline n/a                                     | Sparse dead weighting fine        | Flat matte look                                       | Add powdery noise overlay; wind-streak decals                        | M |
| lavaFields      | Volcanic       | Custom  | Strong lava palette                                      | Waterline n/a                                     | Flora none (ok)                   | Static                                                | Animated lava flow mask (future)                                     | L |
| wasteland       | Wasteland      | Default | Should be sickly olive / toxic                           | Standard                                          | Sparse dead/bare set OK           | Neutral palette weakens vibe                          | Add olive→brown→ashen triad; add bone/ruin placeables                 | H |
| ruinedUrban     | Wasteland      | Default | Needs concrete greys + rust & moss                       | Standard                                          | Sparse weighting                  | Missing structural debris                             | Add rubble placeables + custom triad (dark concrete→rust→pale dust)  | H |
| graveyard       | Wasteland      | Default | Should be dark soil + cold stone                         | Standard                                          | Sparse weighting ok               | Mood not sold                                         | Add dark brown→cool grey triad; tombstone placeables                  | M |
| astralPlateau   | Exotic         | Default | Should be cosmic blues + star flecks                     | Standard                                          | Tall/columnar stand-ins okay      | Lacks cosmic treatment                                | Add deep indigo triad + particle shimmer                             | H |
| arcaneLeyNexus  | Exotic         | Default | Needs arcane cyan + magenta glows                        | Standard                                          | Weighted for magical trees/flowers | Palette mismatch                                     | Add cyan→violet→white triad + pulsating rune overlay                  | H |

## Missing / Alias Notes
- `beach` triad exists but no `beach` biome key; `coast` should reference that triad (currently it has its own). If intentional, remove unused `beach` or alias.
- Biomes using default triad need explicit entries in `BIOME_BASE_TRIADS` to avoid chromatic flattening.

## Recommended Data Structure Extensions
```js
// In BiomePalettes.js (example additions)
const BIOME_BASE_TRIADS = {
  // ...existing
  savanna: [0x3b2d14, 0xa88632, 0xe8d9a3],
  steppe: [0x2f2a1d, 0x8a7a45, 0xd8cfa8],
  cedarHighlands: [0x142418, 0x365c34, 0xc9b497],
  geyserBasin: [0x3a2712, 0xcf8f2a, 0xf3eddc],
  saltFlats: [0xb7bcc2, 0xe2e6eb, 0xffffff],
  thornscrub: [0x312a18, 0x6e5d33, 0xc3b38a],
  bloodMarsh: [0x170406, 0x5a0f18, 0xc24e4e],
  mysticGrove: [0x1b0628, 0x6a2fa8, 0xf2b4ff],
  feywildBloom: [0x1b2435, 0x5cb5d4, 0xfff0c9],
  shadowfellForest: [0x08090a, 0x303438, 0x8a949c],
  petrifiedForest: [0x2b241f, 0x6a5b4d, 0xd9cebf],
  bambooThicket: [0x0d1f12, 0x1f6a34, 0x9ed38b],
  orchard: [0x3d2714, 0x5f7f2a, 0xc8d68f],
  mangrove: [0x0d1e19, 0x1f6a5a, 0x9ed3c5],
  bloodMarsh: [0x16070a, 0x641b29, 0xbf6977],
  deadForest: [0x0c0c0c, 0x3a3a3a, 0x8d8d8d],
  fungalGrove: [0x1a1410, 0x4d3a27, 0xbfa37c],
  crystalFields: [0x0f1c24, 0x2f8cab, 0xbcefff],
  crystalSpires: [0x0a1218, 0x2e6e9a, 0xe1f5ff],
  eldritchRift: [0x0a0412, 0x421b5f, 0xb58dff],
  wasteland: [0x1a1f12, 0x48502b, 0x9e9f6a],
  ruinedUrban: [0x1a1d1f, 0x535a60, 0xb9c1c7],
  graveyard: [0x14110f, 0x3e3d3a, 0x9ea4a8],
  astralPlateau: [0x040a24, 0x182f6a, 0xbad4ff],
  arcaneLeyNexus: [0x07132a, 0x264d8f, 0xe6d8ff],
};
```
(Exact hexes are placeholders – tune after lighting/shadow changes.)

## Hydrology Enhancement Proposal
Add per-biome optional parameters in a new config, e.g. `BiomeHydrology.js`:
```js
export const BIOME_HYDROLOGY = {
  coast: { shoreBand: [0, 0.6], wetSandTint: 0x3a3123 },
  swamp: { floodedMin: -3.2, floodedSoft: -0.8, emergentMax: 0.8 },
  riverLake: { shoreBand: [0, 0.5], mudTint: 0x2d2218 },
  floodplain: { shoreBand: [0, 0.7], siltTint: 0x4a3d26 },
  mangrove: { floodedMin: -2.2, propRootPref: true },
  oasis: { shoreBand: [0, 0.4], wetSandTint: 0x5e4a30 },
};
```
Renderer: if tile height in `shoreBand`, blend base color toward tint; if below `floodedSoft`, apply darker saturation; allow flora filters to read these thresholds instead of hard-coded values.

## Flora System Extensions
- Add new asset tags (e.g. `rooted`, `crystal`, `fungal`, `arcane`, `petrified`, `bone`, `ruin`).
- Introduce cluster strategy: spawn N (2–5) instances around a seed coordinate for crystal / mushroom / bone piles.
- Add elevation + slope based exclusions (prevent large trees on steep scree tiles) by exposing a `getTerrainSlope(x,y)` helper.
- Deterministic micro-jitter: apply a per-instance scale factor (±6%) & rotation yaw jitter seeded by (x,y,biome) hash for natural variation.

## Immediate Action Priorities (Condensed)
High (do first):
1. Swap terrain material to lit + adjust lighting (enable visible shadows & depth).
2. Add custom triads for all default-biome fallbacks (list above).
3. Implement shore / wet bands for coast, riverLake, floodplain, oasis, mangrove, swamp differentiation.
4. Palette updates for fantasy/exotics (mystic, feywild, shadowfell, astral, arcane, bloodMarsh, eldritchRift).

Medium:
5. Introduce cluster placement strategy and new placeable categories (crystal, fungal, bones, ruins).
6. Add snowline & scree noise jitter; alpine high wildflowers.
7. Rock / debris / shell accent placeables for mountains, beaches, wastelands.

Low:
8. Emissive / bloom / rune overlays.
9. Contact shadow quads or SSAO-like pass.
10. Per-biome subtle hue shifting by world seed for map variety.

---

## Verification Plan After Implementation
1. Deterministic Snapshot: With fixed seed, capture before/after palette screenshots per biome.
2. Histogram Check: Ensure luminance separation between at least adjacent categories (forest vs swamp vs mystic vs shadowfell).
3. Flora Density Metrics: Log placed count vs candidate count per biome to confirm density unaffected by palette changes.
4. Performance: Measure frame time pre/post lit material & shadow expansion; if >10% regression, consider LOD or selective shadow casting.

---

Feel free to request an automated script to generate comparison atlases or to implement the first high-priority changes.

---

## Placeable Asset Catalog & Biome Inclusion Matrix

This section enumerates every current plant-type placeable (trees, variants, bushes, flowers, mushrooms, grasses, rocks/pebbles) and recommends which biomes they should appear in (either already via `flora.js` weights or proposed future additions). Use it to:
1. Audit gaps (e.g. birch missing from hills if desired)
2. Drive future weighting refinements
3. Support UI filtering/tagging

Legend:
- Core = baseline natural distribution
- Accent = occasional / low weight for visual spice
- Rare = very low probability, narrative or exotic flair
- Exclude = should not appear (kept explicit to avoid accidental inclusion via regex picks)

### Tree Families

| Asset ID             | Family        | Recommended Biomes (Role)                                                                                                                                                               |
|----------------------|---------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| tree-green-deciduous | Deciduous     | forestTemperate (Core), grassland (Accent), hills (Core), orchard (Core), floodplain (Core), riverLake (Accent), mysticGrove (Accent), feywildBloom (Accent)                               |
| tree-green-oval      | Deciduous     | forestTemperate (Core), grassland (Core), hills (Core), savanna (Accent), steppe (Rare), floodplain (Core), riverLake (Accent)                                                            |
| tree-green-small     | Deciduous     | forestTemperate (Core), forestConifer (Understory Accent), grassland (Accent), hills (Accent), swamp (Accent), wetlands (Accent), mangrove (Accent), mysticGrove (Accent), arcaneLeyNexus (Accent) |
| tree-green-small-oval| Deciduous     | Same set as tree-green-small (optional addition)                                                                                                                                         |
| tree-green-willow    | Willow        | swamp (Core), wetlands (Core), riverLake (Core), floodplain (Core), mangrove (Core), oasis (Accent), bloodMarsh (Accent), mysticGrove (Accent), arcaneLeyNexus (Accent)                    |
| tree-yellow-willow   | Willow (Yellow)| swamp (Accent), wetlands (Accent), mangrove (Accent), mysticGrove (Accent), feywildBloom (Accent), arcaneLeyNexus (Accent), bloodMarsh (Accent)                                          |
| tree-bare-deciduous  | Bare Deciduous| deadForest (Core), shadowfellForest (Core), petrifiedForest (Core), bloodMarsh (Core), swamp (Accent), wetlands (Accent), tundra (Accent), wasteland (Accent)                              |
| tree-orange-deciduous| Seasonal/Fantastical | mysticGrove (Core), feywildBloom (Core), arcaneLeyNexus (Core), forestTemperate (Rare Autumn accent), orchard (Rare)                                                            |
| tree-yellow-conifer  | Conifer Variant| mysticGrove (Accent), feywildBloom (Accent), arcaneLeyNexus (Accent), alpine (Rare), mountain (Rare)                                                                                    |
| tree-green-conifer   | Conifer       | forestConifer (Core), mountain (Core), alpine (Core), cedarHighlands (Core), tundra (Rare), hills (Accent), astralPlateau (Accent)                                                       |
| tree-green-columnar  | Conifer Columnar | forestConifer (Core), mountain (Core), alpine (Accent), cedarHighlands (Core), hills (Accent), orchard (Accent), arcaneLeyNexus (Accent)                                         |
| tree-green-tall-columnar | Tall Columnar | forestConifer (Core), alpine (Accent), mountain (Accent), cedarHighlands (Core), astralPlateau (Accent)                                                                             |
| tree-giant-pine-a..e | Giant Pine    | mountain (Core), alpine (Core), cedarHighlands (Core), forestConifer (Accent)                                                                                                            |
| tree-thick-a..e      | Thick Trunk   | alpine (Accent), mountain (Core), cedarHighlands (Core), forestTemperate (Rare ancient), mysticGrove (Accent)                                                                            |
| tree-dead-a..e       | Dead Tree     | deadForest (Core), shadowfellForest (Core), petrifiedForest (Core), swamp (Accent), wetlands (Accent), wasteland (Accent), bloodMarsh (Accent)                                           |
| tree-birch-a..e      | Birch         | forestTemperate (Core), hills (Accent), grassland (Accent), riverLake (Accent), floodplain (Accent), mysticGrove (Accent), arcaneLeyNexus (Accent)                                        |
| tree-cherry-a..e     | Cherry Blossom| mysticGrove (Core), feywildBloom (Core), arcaneLeyNexus (Core), orchard (Accent festival), forestTemperate (Rare)                                                                       |
| tree-single-palm     | Palm          | oasis (Core), coast (Core), sandDunes (Accent), riverLake (Rare), arcaneLeyNexus (Accent)                                                                                                |
| tree-double-palm     | Palm Cluster  | oasis (Core), coast (Core), sandDunes (Accent), riverLake (Rare)                                                                                                                         |

### Understory / Bushes

| Asset ID              | Recommended Biomes (Role)                                                                                                         |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------|
| bush-common           | forestTemperate (Core), forestConifer (Accent), grassland (Accent), hills (Accent), swamp (Accent), wetlands (Accent), mysticGrove (Accent) |
| bush-common-flowers   | forestTemperate (Accent), mysticGrove (Core), feywildBloom (Core), arcaneLeyNexus (Accent), orchard (Accent)                      |
| bush-large            | forestTemperate (Accent), mountain (Accent), cedarHighlands (Accent)                                                             |
| bush-large-flowers    | mysticGrove (Core), feywildBloom (Core), arcaneLeyNexus (Accent)                                                                  |
| bush-long-1           | swamp (Accent), wetlands (Core), mangrove (Core), bloodMarsh (Accent)                                                            |
| bush-long-2           | swamp (Accent), wetlands (Core), mangrove (Core), bloodMarsh (Accent)                                                            |

### Flowers

| Asset ID         | Recommended Biomes (Role)                                                                                                   |
|------------------|------------------------------------------------------------------------------------------------------------------------------|
| flower-1-group   | forestTemperate (Accent), mysticGrove (Core), feywildBloom (Core), arcaneLeyNexus (Core), orchard (Accent), grassland (Accent) |
| flower-1-single  | Same as flower-1-group (lower weight)                                                                                        |
| flower-2-group   | forestTemperate (Accent), mysticGrove (Core), feywildBloom (Core), arcaneLeyNexus (Core)                                      |
| flower-2-single  | Same as flower-2-group (lower weight)                                                                                        |
| flower-3-group   | mysticGrove (Core), feywildBloom (Core), arcaneLeyNexus (Accent)                                                             |
| flower-3-single  | Same as flower-3-group (lower weight)                                                                                        |
| flower-4-group   | mysticGrove (Accent), feywildBloom (Core), arcaneLeyNexus (Accent)                                                           |
| flower-4-single  | Same as flower-4-group (lower weight)                                                                                        |
| flower-6         | arcaneLeyNexus (Core), mysticGrove (Accent), feywildBloom (Accent)                                                           |
| flower-6-2       | arcaneLeyNexus (Core), mysticGrove (Accent), feywildBloom (Accent)                                                           |
| flower-7-group   | feywildBloom (Core), mysticGrove (Accent), arcaneLeyNexus (Accent)                                                           |
| flower-7-single  | Same as flower-7-group (lower weight)                                                                                        |

### Mushrooms

| Asset ID              | Recommended Biomes (Role)                                                                                  |
|-----------------------|-------------------------------------------------------------------------------------------------------------|
| mushroom-common       | swamp (Core), wetlands (Core), fungalGrove (Future Core), shadowfellForest (Accent), bloodMarsh (Accent)   |
| mushroom-redcap       | mysticGrove (Accent), feywildBloom (Accent), swamp (Accent), fungalGrove (Future Core)                     |
| mushroom-oyster       | swamp (Accent), wetlands (Accent), fungalGrove (Core), petrifiedForest (Accent)                           |
| mushroom-laetiporus   | mysticGrove (Accent), feywildBloom (Accent), arcaneLeyNexus (Accent), fungalGrove (Core)                   |

### Grasses

| Asset ID             | Recommended Biomes (Role)                                                                                      |
|----------------------|----------------------------------------------------------------------------------------------------------------|
| grass-common-short   | grassland (Core), hills (Core), forestTemperate (Understory), orchard (Core), steppe (Core)                   |
| grass-common-tall    | grassland (Accent), hills (Accent), swamp (Accent), wetlands (Accent), mangrove (Accent)                      |
| grass-wide-short     | savanna (Core), steppe (Core), grassland (Accent)                                                              |
| grass-wide-tall      | savanna (Accent), steppe (Accent), floodplain (Accent)                                                         |
| grass-wispy-short    | steppe (Core), savanna (Core), desertCold (Rare), tundra (Accent)                                              |
| grass-wispy-tall     | steppe (Accent), savanna (Accent), floodplain (Accent)                                                         |
| grass-wheat          | orchard (Accent), grassland (Accent), steppe (Accent), savanna (Accent)                                        |

### Rocks & Pebbles (Decorative Ground Variety)

| Asset ID          | Recommended Biomes (Role)                                                                                                          |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| rock-medium-4     | mountain (Core), screeSlope (Core), petrifiedForest (Accent), deadForest (Accent), wasteland (Accent), swamp (Accent)              |
| rock-big-1        | mountain (Core), screeSlope (Core), alpine (Core), cedarHighlands (Core)                                                           |
| rock-big-2        | mountain (Core), alpine (Core), cedarHighlands (Core), volcanic (Accent)                                                          |
| pebble-round-1    | forestTemperate (Accent), coast (Accent), riverLake (Accent)                                                                       |
| pebble-round-2    | deadForest (Accent), shadowfellForest (Accent), coast (Accent)                                                                     |
| pebble-round-3    | mysticGrove (Accent), feywildBloom (Accent), arcaneLeyNexus (Accent)                                                               |
| pebble-round-4    | coast (Accent), riverLake (Accent), floodplain (Accent)                                                                            |
| pebble-round-5    | coast (Accent), desertHot (Accent), sandDunes (Accent)                                                                             |
| pebble-square-1   | wasteland (Accent), ruinedUrban (Core), graveyard (Accent)                                                                        |
| pebble-square-2   | ruinedUrban (Core), petrifiedForest (Accent)                                                                                       |
| pebble-square-3   | petrifiedForest (Core), deadForest (Accent)                                                                                        |
| pebble-square-4   | ruinedUrban (Core), volcanic (Accent), obsidianPlain (Accent)                                                                      |
| pebble-square-5   | geyserBasin (Accent), volcanic (Accent)                                                                                             |
| pebble-square-6   | saltFlats (Accent), astralPlateau (Accent), arcaneLeyNexus (Accent)                                                                |

### Future / Planned Asset Tags

| Tag        | Intended Use / Placement Logic                                                                                 |
|------------|-----------------------------------------------------------------------------------------------------------------|
| crystal    | crystalFields / crystalSpires / arcaneLeyNexus (cluster strategy)                                              |
| fungal     | fungalGrove (dense clusters), swamp/wetlands (sparse), shadowfellForest (rare)                                 |
| arcane     | arcaneLeyNexus / mysticGrove / eldritchRift (glowing rune pylons)                                              |
| petrified  | petrifiedForest (trunks, stumps), wasteland (accent)                                                           |
| bone       | wasteland / graveyard / ashWastes (scattered remains)                                                          |
| ruin       | ruinedUrban / wasteland / graveyard (structural debris)                                                        |
| lavaVent   | volcanic / lavaFields (emissive particle sources)                                                              |
| astral     | astralPlateau (floating crystal shards / light beams)                                                          |
| eldritch   | eldritchRift (animated tentacle growths or void crystals)                                                      |

### Implementation Notes
1. Many recommendations already partially satisfied by regex weight picks (e.g. /deciduous|oval/ includes several deciduous variants). To enforce stricter curation, replace broad regex `pickIds` calls with explicit `makeWeights` maps.
2. Understory layering (bushes, grasses, small rocks) should follow a secondary pass with lower density to avoid crowding tall canopy instances.
3. Rocks/pebbles currently typed as `plant` for instancing convenience—consider a `decor` type flag if behavior diverges later.
4. For fantasy biomes (mystic/feywild/arcane), consider color grading or emissive tint per instance based on model family to unify chroma.
5. Future cluster strategy: for tags `crystal`, `fungal`, `bone`, pick a leader tile, then spawn 2–5 offsets within Manhattan radius 2, respecting spacing.

---
