# 3D Asset Ingestion Foundation

This is the repeatable contract for bringing new model packs into TavernTable.
`TODO.md` owns active pack-specific work; this file defines the common process.

## 1. Source record

Before copying an asset into runtime folders, record:

- Stable pack ID and display name
- Creator and canonical HTTPS source URL
- Redistribution license or explicit owner authorization
- Notice/license files that ship with the frontend
- Original archive or source-pack path
- Whether the pack is local-only, private-pilot approved, or production approved

Incomplete provenance is acceptable only for an existing legacy runtime asset.
A newly ingested asset must pass `normalizeAssetSource`.

## Protected model delivery

This is an opt-in delivery mechanism, not permission to redistribute an asset.
Review the specific license and required notices before packaging any model.
Selected restricted models are included only as encrypted packages. Originals,
keys and hosted key services are not included. A browser necessarily receives
the key and plaintext needed to render; encryption discourages casual
extraction, not determined access.

1. Prepare a GLB with every texture and other resource embedded. External URIs
   are rejected. The encrypted file must be at most 64 MiB. Keep the original
   model, source archive and keyring outside the checkout and all public roots.
2. Create a private keyring in a directory with appropriate OS access controls.
   The following Windows PowerShell example creates one new 256-bit key without
   printing it. The parent directory must already exist and must not be served:

   ```powershell
   node -e 'const fs=require("node:fs");const c=require("node:crypto");fs.writeFileSync(process.argv[1],JSON.stringify({version:1,keys:{[process.argv[2]]:c.randomBytes(32).toString("base64")}}),{flag:"wx",mode:0o600});' 'C:\Private\model-keys.json' 'cave-pack-v1'
   ```

   Protect the file with the platform's permissions; Node's `mode` alone does
   not configure a Windows ACL. Never paste key contents into source, logs,
   chat, frontend configuration or deployment command arguments.
3. Package an approved model using that private keyring:

   ```powershell
   node tools\cloud\protected-assets.js --input 'C:\Private\model.glb' --keyring-file 'C:\Private\model-keys.json' --key-id cave-pack-v1 --asset-id source-cave-stalagmite --output 'assets\protected\stalagmite-v1.ttasset'
   ```

   The command refuses existing output, input or keys inside the checkout,
   malformed GLBs and externally referenced textures. AES-256-GCM uses a fresh
   random nonce and authenticates both the key ID and the stable asset ID.
4. Register the matching literal path, `format: 'GLB'` and
   `protectedKeyId: 'cave-pack-v1'` under the same asset ID in
   [ModelAssetCache.js](../src/core/ModelAssetCache.js), then complete the normal
   material, scale, gameplay, notices and visual reviews. Only referenced
   `.ttasset` envelopes are included by the frontend packager. Its structural
   envelope check is not a cryptographic proof that a file was encrypted; use
   the packaging command and inspect the release before any publication.
5. After separate deployment approval, place the same keyring in a managed
   secret store, grant only the cloud service identity permission to read it,
   and mount it outside the application tree. Configure the API process with
   `TAVERNTABLE_PROTECTED_ASSET_KEYS_FILE` pointing to that mounted file. For
   example, a Cloud Run Secret Manager volume can expose
   `/var/run/secrets/taverntable/model-keys.json`. No secret contents belong in
   the environment variable. Missing or invalid configured secrets fail startup;
   an unconfigured service refuses protected-model requests.

The backend returns keys only over its authenticated cloud API after checking
the current campaign owner/member and access generation. An accepted member is
removed using **Remove player access**; revoking an unused invitation does not
remove an accepted member. Keys already delivered cannot be recalled. Use
HTTPS (or loopback for development); local-host cookies cannot authenticate to
the cloud API. Existing unprotected models continue to work normally. A local
development host may explicitly load a private keyring using
`TAVERNTABLE_PROTECTED_ASSET_KEYS_FILE`; its authenticated key endpoint accepts
direct loopback requests only, not forwarded or public-origin requests. This is
for local development, not a substitute for the central online key service.
Without a configured keyring the built-in scenery remains available, protected
scenery is disabled, and no plaintext fallback is used. Local servers already
running before this change must be restarted to load keys and enforce the latest
static-file restrictions.

For example, start a separate local development host from PowerShell:

```powershell
$env:TAVERNTABLE_PROTECTED_ASSET_KEYS_FILE = 'C:\Private\model-keys.json'
npm start
```

The value is a private file path, not the key itself. The key service must be
configured separately for cloud campaigns and remote players.

Use a new key ID when rotating a key, retain older IDs while their frontend
releases remain usable, and re-encrypt under the new ID. Keyrings are read once
at host startup: restart all API instances after an update before publishing
models that use it. Removing an old key and restarting prevents new loads from
releases that reference it. Keep a secure backup of the private keyring outside
the checkout; losing a key makes its encrypted models unavailable. Treat actual Secret Manager creation, service IAM,
public signup, budgeting and deployment as separate approval-gated operations.

## 2. Model preparation

For each approved model:

1. Prefer one stable ID; never derive save identity from a filename.
2. Preserve source transforms initially.
3. Record format, source path, texture/resource path and required materials.
4. Calibrate model support bounds and target scale.
5. Measure footprint in feet, rotation policy and minimum spacing.
6. Decide collision, cover, sight blocking, shadow and cutaway behavior.
7. Preview from exterior, top-down, close zoom and player viewpoints.
8. Verify save/reload identity and replacement fallback.

## 3. Pack-to-use catalog

Every downloaded pack must declare:

- Exact biome or variant IDs
- Role in that context
- Intended generation/consumer module
- What the pack contributes visually or physically
- Source-only, runtime-approved and production-approved state

The repository catalog currently identifies these representative paths:

| Pack                   | Intended use                                                  |
| ---------------------- | ------------------------------------------------------------- |
| Low Poly Mining/Cave   | Terrain-integrated entrances; mine/cavern props               |
| Pure Poly Mining/Cave  | Candidate cave formations, mining sites and blacksmith props  |
| Free Mine Assets       | Selected CC0 mine frame and stalagmite-cluster derivatives   |
| Low Poly Cave Assets   | Selected CC0 stone-column derivative                          |
| Modular Dungeon        | Dungeon walls, corridors, rooms, stairs, doors and cells      |
| Fantasy Props          | Village/city/castle/dungeon furnishing and cover              |
| Fantasy Tavern         | Town/castle interiors and ruin dressing                       |
| Medieval Village       | Houses, civic structures, roads, markets and settlement props |
| Castle Wall Kit        | Castle walls, gates, towers, roofs and details                |
| Jampot Chests          | Source-only loot candidates; not distributed at runtime       |
| Weapon/equipment packs | Armories, racks, loot and character props                     |
| Kenney Retro Fantasy   | Low-poly fallback/testing kit, equipment and props            |

These entries are pack planning assignments. Nine previously reviewed representatives
and 162 selected Pure Poly derivatives are runtime placeables; whole packs remain
source-only. Town generation uses
four other Village wall, roof, gable and balcony models. The Village door-wall
ID is a generation marker and manual placeable, not the door leaf used in a
generated town; two window models are registered but not used by that renderer.
The modular Dungeon wall and CC0 torch are generated and manually placeable.
The decorative mine frame and Quaternius chest representatives remain manual-only.
Cavern uses the CC0 stalagmite and column derivatives; Crystal Spires uses
tinted clusters. Their stable saved IDs are unchanged. The previous dglopez
cave models and Jampot chest are local-only and excluded from public packaging.
The frame does not create a terrain opening.
Fungal Grove uses Asset Quest's purple mushroom cluster and giant fly agaric,
with their CC0 notice and source fingerprints included alongside runtime copies.

## Asset audit: 2026-11-21

The [asset inventory](./ASSET-INVENTORY.csv) records 3,722 entries across
downloaded packs and legacy models, including individual castle-kit nodes,
animation clips and dice. The original 1,125-entry audit groups alternate file
formats and tavern LODs. The 2,597 Pure Poly entries each represent one
downloaded FBX file, including named color or material variants; the total is
therefore not a count of unique models. Roles and candidate biome variants are
planning classifications, **not** permission to place or generate an asset.
Runtime status, the allowed biomes of manual placeables and current generation
variants are listed separately. Update the inventory when an asset's
registration or suitability changes.

The original nine downloaded terrain packs contain 1,559 model files but 685
distinct models or addressable modules. Ten of those models are now
runtime-registered; 675 remain source-only. Three additional runtime derivatives
from two CC0 sources are cataloged separately. Source-only is often intentional
staging, not proof that each asset was accidentally omitted.

| Terrain pack         | Model files | Distinct assets | Runtime models |
| -------------------- | ----------: | --------------: | -------------: |
| Mining/Cave          |          90 |              30 |              0 |
| Modular Dungeon      |         144 |              48 |              3 |
| Fantasy Props        |         282 |              94 |              0 |
| Fantasy Tavern       |         180 |             104 |              0 |
| Medieval Village     |         528 |             176 |              7 |
| Castle Wall Kit      |           3 |             116 |              0 |
| Fantasy Weapons      |           7 |               7 |              0 |
| Kenney Retro Fantasy |         315 |             105 |              0 |
| Jampot Chests        |          10 |               5 |              0 |

The two additional CC0 catalog entries count only their three selected runtime
derivatives, not the complete upstream packs. The cave formations embed a
tone-adjusted CC0 stone texture; original and derivative fingerprints and
material changes are recorded beside the runtime models.

The Castle Wall Kit's FBX and glTF each contain the same 116 named mesh nodes;
the third file is a Blender preview. Fantasy Tavern includes 76 LOD files for
38 of its 104 props. The prior source catalog omitted six registered Village
models and listed five packs' available formats incorrectly; both are corrected.
The 134 entries in the existing placeable catalog are placeable definitions,
not a count of unique source models.

Additional findings:

- The existing Asset Quest forest kit contains 118 FBX models, including fungi,
  foliage, birds and mossy rocks. Two color-atlas mushroom models are registered
  for Fungal Grove; other models and foliage-alpha setup remain source-only.
- Of 116 Stylized Nature OBJ models, 78 have placeable definitions and 57 are
  referenced by biome profiles; 12 more are registered models without a
  placeable and 26 have no model registration. The Tropical FBX contains 16
  named mesh nodes, including a helper; nine nodes are registered. The six
  other non-helper nodes still need individual usability review. Its license
  remains unverified beyond the existing owner-approved private pilot.
- The audit found four intended flora IDs without placeable definitions and a
  weighted `family-spectral` selector that could not render directly. The rock
  and mushroom models are now registered, and spectral weights expand to
  concrete variants. `assetCatalogCoverage()` reports unavailable weighted
  assets, and generation warns if future weights are discarded.
- The two animation libraries contain 43 named clips each, with in-place and
  root-motion exports. FBX clip names add an `Armature|` prefix; Three.js
  reports trimming skin weights beyond four during import. Retargeting and
  animation behavior are not approved by this audit.
- The 14 packs in the original audit have local notices and recorded license files.
  Some licenses prohibit standalone redistribution. Confirm the deployment
  terms for each selected asset before adding it to a publicly served build;
  local availability is not blanket distribution approval.

Geometry, source bounds and material names were measured for 1,011 terrain
models/LOD exports and 13 character/dice models. The inventory stores source
units and bounding-box minima, **not** calibrated game feet, collision shapes or
verified support points. Textures were disabled during the bulk measurements.
Fifty-five selected assets were also rendered locally for visual inspection;
some FBX materials require relinking or source-specific import treatment. These
checks do not replace per-asset in-game, player-view or licensing approval.

## Purchased Pure Poly FBX audit: 2026-11-22

The purchased [Low Poly Mining, Cave & Blacksmith Pack](https://www.fab.com/listings/626d3388-33d2-4012-a944-cb512baf83b4)
is recorded as `pure-poly-mining-cave-blacksmith`. Its downloaded individual
archive contains **2,597 FBX files**, each listed by its exact filename stem in
the inventory; append `.fbx` to recover the source filename. The filename index
fingerprint and archive provenance are in its
[source notice](../assets/terrain/source-packs/biome-caves/pure-poly-mining-cave-blacksmith/SOURCE-NOTICE.txt).
Original archives, models, textures and keys remain outside the repository.

Removing the seven named color/material suffixes yields 1,110 filename groups;
249 groups contain multiple such variants. This is a naming analysis, not a
verified count of unique geometry. The publisher advertises 1,156 unique assets
and 2,649 including variations; those totals have not been independently
reconciled with the downloaded files. The separately downloaded demo archive
contains two composite FBX scenes, one duplicated by the standalone demo-list
file. The listing describes 52 Unity particle effects, matching the numerical
difference from the 2,597 downloaded FBXs. The Unity package was not downloaded,
so it is not verified whether those effects explain the publisher's total; they
are not represented as inventoried models.

| Candidate category | FBX files |
| ------------------ | --------: |
| Tools and weapons | 632 |
| Crystals and gemstones | 420 |
| Treasure and resources | 226 |
| Construction and settlement props | 210 |
| Ore and crystal stones | 180 |
| Cave walls, including veined variants | 184 |
| Rock formations | 126 |
| Pebble clusters | 11 |
| Forge apparatus and tools | 108 |
| Light fixtures | 72 |
| Rails and transport | 58 |
| Trees | 39 |
| Exposed tree roots | 10 |
| Tree stumps | 2 |
| Stalactites, stalagmites and connected columns | 26 |
| Cave tunnel shells | 20 |
| Water and lake surfaces | 18 |

These are filename-based planning categories, not gameplay assignments. In
particular, human-made mining props and light fixtures are candidates for
deliberate occupied sites, **not** automatic scenery in a natural cavern.
Entrances, tunnel shells and water still require independent physical and
gameplay validation. One hundred and sixty-two selected formations, rocks, pebbles, crystal
clusters, trees, grass, cacti, fungi, ore and deliberate-site props have encrypted
derivatives registered as manual placeables. One hundred and six natural models are also available
through the **Pure Poly scenery** generation choice for appropriate biomes.
When the current account can obtain a working key and decrypt a selected model,
new supported biome choices default to Pure Poly; built-in scenery remains
selectable. Saved generation choices remain unchanged, and failed key checks are
shown before offering built-in scenery. Access is checked again before replacing
a map; a failed check leaves it unchanged. Existing maps are not regenerated.
Ore, mine, forge, storage, furnishing and lighting props are manual-only,
not randomly scattered in natural caves.
The protected Scree Slope profile uses stone ground cover rather than woodland trees.
Gray rock outcrops generate in Cavern; brown rocks suit dry biomes and mountains,
while mossy rocks are limited to forests and hills.
The brighter mushroom clusters generate in fungal groves and temperate forests,
but not automatically in natural Cavern.
New Dead Forests use leafless legacy trees with a small chance of green survivors.
The protected profile also mixes in six reviewed leafless Pure Poly shapes.
The previously dominant legacy “bare” model has a crimson canopy and is no longer
generated in Dead or Petrified Forests. Existing placements are unchanged.
The other 2,435 variants remain source-only candidates. Production distribution
and user visual acceptance remain open.

| Selected family | Models | Remaining review |
| --------------- | -----: | ---------------- |
| Stalagmites, rock columns and rocks | 33 | Ceiling-attached formations require actual ceiling support. |
| Crystal clusters | 42 | Six shapes and seven colors; metallic colors are manual-only. |
| Trees, cacti and fungi | 41 | Review additional vegetation and biome-specific colors. |
| Grass | 6 | Small ground cover is passable and does not obstruct sight. |
| Pebble clusters | 8 | Small ground cover is passable and does not obstruct sight. |
| Mine, forge, storage and furnishing props | 10 | Rails, structural modules and equipment need fit and interaction review. |
| Ore stones | 21 | Three shapes and seven colors are manual-only; mined states need gameplay review. |
| Lantern | 1 | Additional fixtures are for deliberate built sites only. |

Wall fungi, stalactites, tunnel shells and entrances remain source-only until
their attachment and passage behavior is supported. Rails, structural modules,
tools and weapons also need appropriate placement or interaction; additional
standalone crystals, gemstones, ore and treasure remain candidates for future review.
All 42 crystal-cluster variants were compared with their conversions. Blue shapes
generate in Crystal Fields and Crystal Spires, green and red shapes only in
Crystal Fields; copper, gold, iron and silver are manual-only. All 11
leafless tree shapes were compared with their conversions; five additional shapes
were selected for variety, while similar or higher-cost shapes remain source-only.
The review also compared all 23 cacti, 11 pebble clusters, 21 dark ground mushrooms
and ten single grass blades. Six additional cacti, two pebble clusters and four
dark mushroom groups were selected; similar or higher-cost variants remain
source-only. Individual grass blades need ground-cover density review before use.
Eighty brown, mossy, piled, standing-stone and plateau rocks were also compared.
Three cave outcrops, three brown rocks and seven mossy rocks were selected;
flat-topped plateaus remain source-only until their walkable-surface behavior
is defined.

Generated cavern routes and scenery intersections are checked against rendered
model bounds. Movement still uses the existing grid-cell obstacle policy for
trees, cacti and rocks; true size-aware physical formation and cluster collision
remains an open task and must not be inferred from those visual clearance checks.

The inventory includes measured triangle counts, bounds and material names for
each downloaded FBX variant. Pure Poly bounds use the application's Three.js
FBXLoader source coordinates, rounded to four decimal places. Blender imported
the same bounds at 1/100 of that scale; triangle counts matched across all
2,597 files. Source coordinates are not game feet or approved collision
geometry. The downloaded set includes 107 files with multiple mesh objects,
14 using a transparent material and two essentially flat water surfaces; review their
rendering and behavior before use.

Selected derivatives were exported as GLB with the original palette embedded.
The FBX import's green emission was removed from those derivatives; original
archives and textures were not changed. The encrypted-model manifest records
each selected source filename, runtime ID and ciphertext fingerprint.

### Implications for upcoming work

- **Village:** the approved assembly currently uses a small subset of 176
  Village modules. Inspected alternatives include stone walls, wood-grid walls,
  dormers, roof sizes, shutters, doors, overhangs, chimneys and different
  balcony rails. Use them to evaluate genuinely varied buildings without
  automatically replacing the approved baseline or its physical openings.
  Costs vary: the current 6x8 tile roof has 3,796 triangles; one round door
  has 6,188. Instancing reduces draw calls, not per-instance triangle work.
- **Castle:** the 116-node Castle Wall Kit includes walls, openings, stairs,
  battlements and bartizans. Its glTF does not bind the supplied textures, and
  several parts are thin surfaces or decorative door/window decals, not
  authoritative physical geometry. Relink materials and fit them to actual
  walls, openings and navigation before using them.
- **Cavern and crystals:** CC0 stalagmite clusters and a stone column now
  generate in Cavern, and tinted clusters appear in Crystal Spires.
  The Tavern pack also contains actual Crystal Cluster and Crystal Small models,
  measured at 296 and 162 triangles respectively.
  They are candidates for Crystal Spires, subject to tint, scale, support and
  licensing review, rather than assuming ordinary rocks are the only option.
  Their geometry does not itself provide in-game light.
- **Dungeon and lighting:** the Dungeon pack includes stairs, doors, traps and
  a torch; the Props and Tavern packs contain additional light fixtures. Every
  measured Dungeon FBX has at least one material imported at zero opacity.
  The selected CC0 torch uses an opaque import and emissive flame; other
  unreviewed materials still require individual review.
- **Rendering budget:** Tavern's full hut and castle models measure 21,326 and
  24,396 triangles respectively, with smaller LOD alternatives. They need
  interior/opening and style evaluation before being considered as building
  replacements; they must not be blindly overlaid on existing structures.

## 4. Biome suitability

Assign one primary category:

- Tree
- Bush
- Tropical plant
- Flower
- Grass
- Mushroom
- Pebble
- Rock
- Prop

Review the asset against the 13 generation families and their variants. A family
allow-list is not an automatic promise that every biome in that family accepts
the asset: generation profiles remain the final placement authority.
Runtime suitability requires a registered placeable ID and uses its cataloged
category, not a caller-supplied category. Existing registered legacy assets
retain their prior eligibility. Source-only candidates are ineligible until
registered and must be individually reviewed before registration.

Current hard exceptions:

- Ordinary Cavern, Fungal Grove, Crystal Fields and Crystal Spires do not accept
  trees.
- Eldritch Rift may accept unusual or magical trees.
- Dungeon gets constructed furnishings and props, not natural cave-tree fill.
- Surface packs cannot introduce shell-like cave entrances on their own.

## 5. Generation integration

An asset is not integrated merely because it renders in the placeable menu.
Confirm:

- Allowed biome/variant IDs
- Density multiplier behavior
- Minimum spacing and collision footprint
- Elevation and support requirements
- Cave/roof/overhang constraints
- Generated versus manually authored placement
- Player-view privacy and physical sight impact
- Exact save identifier and migration fallback

## 6. Validation gates

Do not mark an ingest complete until:

- Asset catalog and biome suitability tests pass
- Source notices are included in `FRONTEND-NOTICES.txt`
- Frontend package tracing includes every required model and texture
- A generated biome and a manual placement are tested
- Save/reopen and player projection are tested
- Missing or deleted model fallback is explicit
- No asset path, token, credential or private campaign data is exposed in docs

## 7. Pack-specific rollout

Integrate one representative asset before a full pack:

1. Catalog/provenance
2. Runtime model descriptor
3. Manual placement
4. Generated placement
5. Player-view behavior
6. Save/reopen
7. Full pack expansion

Intact Village / Town buildings use the Medieval Village kit without changing
their physical shell, topology, openings, or sight. The wall panels share one
plaster plane and use fitted sections around each actual door and window.
Gable frames sit on the end walls under the tiled overhang; the source timber
is retained. Modeled rails sit on the existing balcony deck and replace only
the rendering of the corresponding solid rails. The renderer swaps the whole
assembled kit at once and keeps the equivalent procedural exterior if a model
is unavailable. Repeated pieces use instanced draws. Hipped roofs still use
their existing visuals.

For visual review, inspect a rotated multi-storey inn and multiple single-storey
houses from the front, rear, and near eave height. Check both gable ends,
continuous wall corners and fascia, real openings rather than blind recesses,
and all three rails contacting the deck. Bounding boxes alone do not verify
these joints.

The Dungeon generator fills the chosen grid with seeded rectangular rooms and
straight, T-shaped or cross corridors. It creates physical openings and torch
placeables, but not interactive doors or other furnishings.
The reviewed wall model repeats at up to 10-foot intervals, replacing only the
DM wall rendering while retaining the original collision and sight geometry.
Its source FBX masonry materials require an explicit opaque-material import
override. Missing models fall back to procedural walls; player projections
currently retain those procedural walls and still need modeled-wall validation.
Generation with structures requires at least a 12 x 12-square board.

Dice assets use the same provenance and scale process, but remain a separate
physical-dice workflow because collider geometry and settling differ from
terrain placeables.
