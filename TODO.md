# TavernTable — TODO

> Current backlog. Setup and the last verified test baseline are in
> [README.md](./README.md). Historical audits are not the current task list.
> Current platform work:
> [local hosting, JSON backups and multiplayer](#local-hosting-backups-and-multiplayer).
> Next construction priorities:
> [settlements, natural caves and campaign locations](#settlements-natural-caves-and-campaign-locations).

## Task tracking policy

`TODO.md` is the canonical working backlog. The correction-intake document is
historical input, the codebase audit is a review/evidence record, and the cloud
checklist/preparation documents remain specialized release evidence rather than
parallel general-purpose task lists.

Current audit (2026-11-23):

- **59 active backlog items** are tracked below. This includes deferred later
  work, the additional physical dice models awaiting downloaded assets, and the
  five remaining cloud release gates.
- **5 cloud release gates** are tracked below as Cloud M5-06 and M5-08 through
  M5-11. The archived checklist is evidence only.
- The codebase audit's C-items are not a second backlog. Resolved findings stay
  in the audit; remaining implementation work is represented here.
- New requests enter this file first. Historical evidence and correction notes
  may link back here but should not remain independent unchecked lists.

---

## Terrain Editing

- [x] **Restore normal colors after Terrain Mode** - Refresh baked mesh colors
      after saving heights, including selected biome colors and delayed exits.
- [x] **Simple wall and box drawing** - Click-drag lines, Filled rectangles or
      hollow Outline boxes in any direction, with separate style/height controls,
      live 3D preview, release-to-place, and
      cancellation before committing. Set the exact target elevation, including
      cutting higher terrain and negative-level trenches.
- [x] **Transactional height editing and history** - Raise, Lower and Wall
      preview without changing gameplay or saved heights; commit on release and
      cancel safely. Undo/Redo restores whole gestures and Clear Grid, with a
      100-edit session history and explicit load/resize/generation resets.
      Clear Grid removes heights, physical geometry, placeables and linked
      generated building/cavern areas atomically, then permits a smaller grid.
- [ ] **Grid size and safe replacement during biome generation** - Offer grid
      width and height in every biome-generation review, including already
      generated maps. Honor the chosen size rather than silently expanding it;
      if a recipe cannot fit, ask the DM to adjust the size or options.
      After warning and confirmation, unless the DM has disabled warnings in
      this browser, clear the active map's
      terrain, structures, placeables and creature tokens before every
      generation, even when its dimensions do not change. Preserve character
      sheets and other maps, their contents and creatures. Keep valid links to
      separate cavern areas; if an existing dependent area or connection cannot
      remain valid, ask the DM rather than silently deleting it. Make clearing,
      resizing and generation atomic so a failure restores the prior scene.
      Verify repeated generation, resizing in both directions, linked areas,
      active combat, player views and save/reopen.
      Progress: every generation review now accepts exact dimensions and warns
      by default before removing active-map content. Terrain, scenery, construction
      models and their required textures are staged before commit; failed commits restore
      the prior scene, camera, selection and terrain Undo/Redo, while uncertain
      save outcomes require a reload. Compatible
      physical cavern passages and linked floors are retained and checked for
      traversal, and individual cavern chambers can be regenerated independently.
      Isolated host tests cover resizing, same-size clearing, character-sheet
      retention, player observer recovery and save/reopen. Connected building
      floors can resize around their existing physical footprint; incompatible
      links, undersized floors or overlapping cavern areas are rejected. Complete
      broader biome/seed and failure coverage before marking this item done.
      All 59 biome variants now have deterministic non-structure planning checks
      at 16 x 13 and 25 x 25 with two seeds; this is not replacement coverage.

---

## Terrain Foundation

- [x] **Complete the accepted terrain-engine migration** - Follow
      [ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md). Live callers use
      the engine's authoritative state and event seam; the coordinator only wires
      input and scene adapters.
- [x] **Add public-interface integration coverage for the migration** - Verify
      that game height queries and tool selection use the engine, resizing keeps
      game and terrain dimensions consistent, and reset/load trigger scene updates.
      Cover editing input, biome/flora generation, and adapter attach/detach without
      relying on legacy 2D fixtures.
- [ ] **Paused layered shared-world proof** - Solid/void geometry, multiple
      supports, a bridge/cave/two-storey example and traversal tests are
      implemented. Final validation is paused; preserve the proof without
      extending its numeric volume editor. Separate connected grids replace
      the shared-board layering direction.

---

## Connected-grid Map Building

- [x] **Connected-map records and persistence foundation** - Independent map
      records carry physical anchors, quarter-turn rotation and render scale.
      Version-3 saves/backups preserve one creature collection, map-local poses,
      shared combat and inactive terrain/structure cover. Explicit legacy
      migration preserves positions and existing spell areas/history. Model
      transfers keep physical position and identity without refreshing movement
      or teleporting between floor elevations.
- [x] **Campaign-space targeting foundation** - Target range and obstruction
      queries include unrendered map geometry, finite interior slabs and openings,
      plus unsaved edits from the active terrain owner. Spell picks and overlay
      rendering use inverse physical/view transforms. Test projection eligibility
      in both directions without creating duplicate gameplay tokens.
- [x] **Local map/focus controls** - Maps & focus browses maps or explicitly
      focuses/centers an existing creature. Preserve canonical identity, positions,
      resources, turn budgets and shared roll history without creature transfers.
      Persist independent per-map cameras across reopening. Guard unfinished
      movement/actions/terrain gestures, roll back failed switches and never save
      a partial map load. Same-map refocusing keeps terrain Undo intact.
- [ ] **Independent participant views** - Separate shared creature locations
      from each participant's focused character, displayed map and camera. A
      player follows their own character; the DM can focus any character on any
      map without moving other viewers. Implement the ownership and shared-session
      synchronization needed for actual connected players.
      Independent local focus, live map/focus controls and persistent per-map
      camera histories are implemented and tested; authenticated networking remains.
      Track the active networking rollout under
      [Local Hosting, Backups and Multiplayer](#local-hosting-backups-and-multiplayer).
      A raw generic-token fixture logged a focus error before its first connected-world
      checkpoint; the corresponding manual-placement path needs direct verification.
- [x] **Render synchronized cross-grid projections** - Render visible off-map
      characters at their translated position, facing and animation. Resolve
      clicks and targeting to their original ID; do not duplicate state or grant
      sight through walls, floors or visually hidden roofs. Model loads are
      shared across refreshes and stale loads cannot reveal hidden/removed actors.
- [x] **Map-aware creature occupancy** - Translate foreign cells and body heights
      for supported, heightfield and flight movement. Preserve actual physical
      blockers without leaking local interior coordinates into exterior ranges.
      Keep local placement/selection lookups scoped to their map.
- [x] **Canonical character-sheet focus** - Opening a sheet, clicking/keyboard
      switching its tabs or focusing the remaining neighboring tab switches to
      the creature's actual map and position. Keep passive projected-token
      selection separate, preserve state, and refresh/unlock view controls.
      Report failed focus visibly without claiming success.
      Publish busy/ready combat availability for tab/view transitions so End Turn
      does not remain disabled after returning to the active creature. Exercise
      production services, same/cross-map tabs, keyboard and pop-out controls.
- [x] **Supporting terrain for visible projections** - Render a bounded preview
      of actual source-map terrain along character sight lines, including real
      support at narrow window edges. Preserve elevations/rotation/scale, avoid
      overlapping the active floor, remove hidden contexts and dispose resources.
      Keep this visual context separate from editable/navigation terrain.
- [x] **Roofless interior wall views** - Show shared physical walls and actual
      window/door openings on interior grids, including unfocused/empty maps.
      Keep upper storeys and ceiling/roof coverage out of the current view,
      preserve map rotations/scales, and handle interior-owned structures too.
      Retain original exterior roofs, physics/sight data and source ownership;
      cutaway meshes are cached, cleaned up and never saved as new geometry.
- [x] **Clickable physical doorway and stair transfers** - Click an actual
      opening/staircase for an Enter / Use stairs confirmation popup, not a radial
      action or proximity trigger. Persist validated geometry references and
      supported routes, charge approach/elevation/prone costs, reject blockers and
      unaffordable travel, and preserve canonical actors, resources, turn and other
      views. Save the destination with its paid ledger; roll back/refund failures.
      Include the two-floor proof, grid-aligned landings, actual treads visible
      through the upper stairwell, and centre/head sight through upper windows
      without losing solid floor/roof occlusion.
- [x] **Automatic entrance approach** - A distant door/stair click uses normal
      pathing to walk toward its source entrance, stopping at the closest point
      reachable with the remaining movement. Offer explicit traversal only when
      close enough and affordable; otherwise stop without crossing or resetting
      the turn. Preserve obstacle/occupancy rules and charge walking normally.
      New destinations, actor selections and Escape cancel the pending offer
      without refunding walking. Retain the existing free-play per-move allowance
      refresh. Verify actual animated movement and exact costs.
- [x] **Physical flight, windows, balconies and falls** - Confirm Fly through
      after paid 3D approach alignment, preserving physical altitude and flight.
      Add low/high window and bare-opening climbing, supported balcony landings,
      saved exterior holds, partial ascents/descents and free Drop through the
      shared falling pipeline. Preserve real wall/floor clearance and movement
      ledgers without granting a free turn or elevation jump. Commit cross-floor
      landing and fall damage together; retry failed saves without double damage.
      Include the three-floor/balcony proof and actual humanoid animation tests.
      Cross-map crossings remain explicit atomic save operations, not seamless
      automatic transfers.
- [x] **Surface-based flight and wall controls** - Route real ground/balcony picks
      into normal flying movement. Replace window-bound hold controls with wall
      targets and ground/platform Climb / Drop choices. Animate physical wall
      travel, partial progress, safe redirects, platform mantles and confirmed
      window-gap drops/re-grabs. Save independent physical grips and atomic catch
      damage, retain exact movement costs, allow Take flight from a grip, and
      render empty interiors' physical floors. Wait for in-flight saves on focus
      changes without latching Changing map on an invalid checkpoint.
- [x] **Short animated window crossings** - Charge 5 ft to enter/exit when already
      at the opening, with genuine approach/ascent charged separately. Avoid
      synthetic hoist/settling charges and unnecessary centring detours. Switch
      a following view to the destination, animate with existing climb/recovery
      clips, then persist the final pose and movement. Keep confirmations brief
      and retain clear insufficient-movement/blocker errors.
- [ ] **Dedicated lateral climbing and corner routes** - Add suitable sideways
      clips and broader multi-face routing; current supported same-wall movement
      reuses available climb animations and never treats gaps as solid handholds.
- [x] **Curved shape foundation and playable proof** - Shared clipped ellipsoid
      and cylinder volumes support real cave chambers, arched tubes, hollow domes,
      walkable crenellated walls and round towers. Preserve physical support,
      ceiling/body clearance, sight, flight, connected-map transforms, cutaways,
      normal movement costs, Undo/Redo and legacy-compatible saving.
- [x] **Action-boundary routine autosave** - Retain safe movement waypoints in
      memory, but write routine scene changes only after the full action stops or
      finishes. Wait truthfully during movement, recheck queued/async captures,
      preserve atomic damage/resource/scene commits and derive saved local cells
      from the actual physical position rather than a transient movement target.
- [x] **Visual structure builder and resizing** - Replace numeric construction
      with illustrated cards, shared plain/battlement walls, arbitrary-angle drag
      previews and selectable diameter/height edits. Commit complete groups with
      undo, persistence, creature/connection guards and paid angled-wall climbing.
- [x] **Complete parametric building assemblies** - Generate a finite connected
      floor every 10 feet for new buildings/turrets, real switchback stairs,
      automatic editable windows, manually wall-dragged balconies with doors and
      rails, and physical roof/deck choices. Add anchored side/corner/height
      handles, 5-foot sizing with Shift fine adjustment, compound topology
      Undo/Redo and an explicit legacy-shell upgrade. Preserve interior edits,
      canonical actors/resources, independent views and action-boundary saves;
      cache unchanged floor geometry instead of rebuilding it on idle frames.
- [x] **Footprint-matched roofs and resizable wall features** - Offer rectangular
      and round building bases, square-fitting dome/pyramid profiles and round
      caps, with legacy-profile preservation. Add post-placement window
      width/height/sill and balcony width/depth handles, numeric sizing, true
      selection without edits, cancellation and release-only commits. Support
      small and multi-storey windows with floor-specific interactions, real slab
      grips, clearance denials, nearest wide-window entry and persisted Undo/Redo.
- [x] **Flexible floors, tall rooms and underground construction** - Add stable
      custom levels, 5-foot room-height increments, whole upper-slab removal,
      multiple rectangular floor openings/fill, and real supported stair flights
      for larger gaps. Add independent cellars extending beyond building bounds
      with optional connected stairs or animated ladders. Protect occupied edits,
      preserve interior data and movement/resources through Undo/save, and use
      real lower-floor falls. Restore the Castle wall preset with parallel flush
      stairs and castle-style Turret defaults with a playable crenellated deck.
- [x] **Movable battlement stairs and underground editor visibility** - Add
      independent stair direction/side/position, direct position handle and
      compact automatic switchbacks for tall walls. Preserve real tread/landing
      navigation, step/headroom checks and paid movement. Add Show underground
      before cellar selection, through-ground ghosts, selectable outlines and
      chosen-level handles with reversible render-only materials and cached
      previews. Identify structures on-map and highlight cellar targets in gold;
      filter targets by actual access/inner-footprint fit.
- [x] **Whole-structure movement and solid switchbacks** - Add centre drag handles
      for placed buildings and other shapes. Carry interior maps/lattice/content,
      but preserve all creatures' world positions and reject occupied-structure
      edits. Make new switchbacks solid masonry with the highest flight nearest
      the wall; spread higher flights outward instead of floating above or burying
      lower runs. Preserve earlier saved recipes until explicit editing.
- [x] **Generated castle cellars and dungeon wings** - Use the native Cellar
      feature for intact, cliffside, mountain and ruined castles. Add connected
      storage and deeper multi-room dungeon levels extending beyond the keep,
      with real editable walls, doorways and supported stairs. Keep compact sites
      usable, preserve map/landform bounds and existing underground structures,
      save the layout recipe and refuse generation that would erase authored
      underground rooms.
- [x] **Snap buildings into compound structures** - Snap compatible building
      faces/edges together to create connected wings, L/U-shaped buildings,
      courtyards and other interesting footprints instead of isolated boxes.
      Preview alignment and allow cancellation before committing. Define
      shared-wall/opening handling and floor-height connections explicitly so
      joined buildings are usable spaces, not overlapping sealed shells.
      Reuse existing construction parts; preserve editing, Undo/Redo, interiors
      and campaign persistence. Do not silently move occupied structures or
      replace existing manual work.
      Rectangular same-elevation joins now have real shared-wall cuts, immutable
      floor/topology previews, actor-safe atomic history and stable saved floor
      identities. Public controls support Cancel, Apply and disconnect/edit;
      real paid walking and five-foot member-floor crossings are verified.
      Public cutaways consume exact authorized floorContext references and
      preserve each joined room's ceiling without private building records.
- [x] **Biome geometry features** - Seed bounded caves/tunnels, dedicated town,
      city, fortress and ruined-city layouts, and occasional forest/desert castle
      ruins. Theme masonry/roofs/rock, preserve manual work and avoid flora overlap.
- [x] **Biome-family generation review** - Condense the terrain picker from the
      legacy 58-item taxonomy to 13 family buttons while retaining every old
      biome key as a selectable variant. Review the variant and only the choices
      supported by that family before generation, including terrain character,
      settlement footprint, castle topology/outskirts, cavern entrances and
      asset density. Persist the resolved versioned recipe so locked seeds and
      saved maps can reopen the same review defaults. Cancel remains atomic, and
      legacy saved biome identifiers continue to load without migration.
- [ ] **Connected-floor outline tool (later)** - Extend Build with a closed straight-line
      footprint. Generate a hollow exterior and separate floor grids from that
      outline. Complete when the endpoints meet; support preview/cancellation
      and an atomic build without partial structures or maps.
- [ ] **Magical portal transfers (later)** - Floating circular gates/vortices
      transport creatures between locations. No seeing or targeting through
      the portal. Keep this separate from physical doorway/stair connections;
      implement the two-floor physical travel/sight slice first.
- [ ] **Later builder extensions** - Add curved outline/circle authoring
      and further shape editing after the basic
      workflow. Direct parametric footprint/diameter/storey resizing, windows,
      balconies, roof styles and any-angle straight walls are implemented.
      Tall rooms, floor removal/cutouts and independent cellars are implemented.
      Cut/carving remains undecided and is not required for the first builder.

---

## Settlements, Natural Caves and Campaign Locations

Captured 2026-11-05. These are open improvements, not claims that the current
building/map foundations already provide the finished experience. Check an item
only after its acceptance criteria are verified.

Confirmed direction: start with S1 (restrained windows) and S2 (actual castle
layout variation). S1b window composition is implemented. S4 has been reopened
after a second visual rejection; passing traversal tests did not establish
convincing castles or landforms. S3 and the independent S5 location branch remain open,
with S6 after S5. Use a hybrid interior model: ordinary floors stay physically aligned;
special castle/dungeon interiors may be explicitly separate, larger encounter
maps. This does not convert existing buildings or authorize automatic creature
transfers.

### Near-term generation and architecture

Use a targeted generation-planning and asset-placement redesign rather than
replacing the terrain engine or the approved Village visuals. The shared
grid/reset work also underpins independent chamber generation.

- [ ] **Generation planning and transactional commit** - Stage and validate
      biome, geometry, placement and connection decisions before replacing the
      active scene. Keep TerrainEngine authoritative and renderer adapters
      separate; do not create a second persistent world model. Review or
      confirmation cancellation must leave the saved scene and generation recipe
      unchanged. Coordinate clear, resize, generation and asynchronous asset
      failures with the grid-size task above; restore the prior scene on failure
      and report errors instead of claiming success. Preserve linked maps,
      physical openings, existing saves and intentional visual selections.
      Progress: terrain, structures and biome flora can now be planned for
      a cleared target grid without changing the live map or requiring a
      renderer; the scene adapter consumes the same planned placements.
      Biome selection is a draft until generation or explicit
      palette-only application; cancelled reviews leave the map unchanged and
      generation refuses a changed map. Campaign generation now refuses to
      alter or remove stored linked maps or connections, including cavern areas
      and generated building floors; compatible regeneration retains them.
      Compatible physical and logical passages are preflighted without
      deleting linked maps; broader role-aware planning remains open.
- [ ] **Make biome generation controls meaningful** - Audit the visible
      roughness, moisture and other choices against the actual result for each
      supported variant. Implement meaningful effects where applicable or make
      unsupported choices unavailable with truthful descriptions. Test fixed
      seeds across several sizes and variants, including actual generated
      terrain or assets rather than only normalized option values. Do not
      regenerate saved maps merely because a recipe changes.
      Progress: surface character now changes landform frequency for calibrated
      plains, forest and hills variants; uncalibrated variants hide that choice.
      Moisture direction is corrected where supported and hidden elsewhere.
      Existing saved settings are retained, and locked-seed heightfields no longer
      depend on the previous biome's elevation scale. Density is hidden for
      variants without generated flora. Salt Flats now has versioned, walkable
      low-relief choices and independently meaningful moisture; legacy terrain
      and recipes remain unchanged. Tundra, Pack Ice and Scree Slope respond to
      all relief settings without changing their balanced defaults. Centered coastlines and
      raised River / Lake, Floodplain and Mangrove banks restore supported flora
      and meaningful density on sampled seeds and sizes. New Dead Forest, Ash
      Wastes and Wasteland terrain retains dry ground; those variants and
      Graveyard can populate supported zero-height cells. Geyser Basin now retains
      supported planting ground across moisture choices, with meaningful density
      on sampled 12, 25 and 50-square grids. Blood Marsh now retains shallow,
      supported planting sites, including on the smallest wet maps. Swamp and
      Wetlands now retain shallow scenery sites and a wet pocket across sampled
      relief, moisture and density settings. Steppe and Tundra can populate level
      ground, and Scree Slope can populate exposed rock below zero elevation,
      making density meaningful on sampled smaller maps. Cities, ruined
      settlements and Castle variants retry sites rejected by structures and
      distinguish dense scenery on sampled compact and standard maps; approved
      Village / Town generation and existing placements stay unchanged. River /
      Lake now permits supported zero-height shoreline while keeping scenery out
      of below-zero water, and dense compact Graveyards no longer round to the
      sparse count. All 47 flora-bearing variants now show increased planned
      density at 12 and 25 squares across three sampled seeds without structures;
      this is not full visual or structure-enabled coverage. Further calibration
      and visual acceptance remain open. With the protected scenery pack,
      Crystal Fields, Hot Desert and Sand Dunes now generate suitable crystals
      or cacti and expose density controls; Grassland and Scree Slope add
      passable grass or pebbles. Across 20 supported variants, staged scenery
      density increased from sparse to dense in 120 sampled
      seed/size cases; these are not full visual or structure-enabled coverage.
- [ ] **Role- and context-aware biome asset planning** - Build on the audited
      catalog and suitability matrix to select registered, reviewed assets by
      their intended role, biome, support surface, footprint, clearance,
      scale and physical behavior before applying weights. Preserve navigable
      entrances and distinguish decorative from sight-blocking objects.
      Keep source-only candidates unapproved until their license, in-game
      fit and player presentation are checked. Correct missing weighted IDs
      under the existing discarded-weights task, and retain deterministic
      seeds, fallbacks and saved placement identities.
      Progress: runtime suitability now rejects unregistered IDs and uses the
      registered category even if a caller supplies a conflicting definition.
      Existing registered legacy assets retain their prior eligibility; this does
      not yet implement role-, support- or clearance-aware planning.
      The grid is for player interaction, not a size constraint for natural
      assets: scenery can be smaller than or span multiple squares when
      visually appropriate. Other assets can follow the same rule; consider
      whether changing the simpler grid-based building workflow is warranted
      rather than assuming it is.
- [ ] **Integrate the purchased Pure Poly pack across suitable biomes and sites** -
      Review the full [inventory](./docs/ASSET-INVENTORY.csv), including its
      color/material variants and all candidate categories, rather than only
      the previewed cave formations. Evaluate natural rocks, crystals, fungi,
      plants and landforms for appropriate biomes; evaluate mine infrastructure,
      forge equipment, treasure, tools, lighting and architectural pieces for
      deliberate constructed or inhabited sites. Track which families are
      selected, deferred or unsuitable; filename-based categories are candidates,
      not proof of fit or unique geometry. Do not scatter torches or mining
      equipment randomly in natural caves.
      Calibrate appearance, scale, support, clearance, physical behavior,
      performance and player presentation before enabling a model. Preserve
      existing saves and the approved Village visuals. Package selected
      restricted models through encrypted delivery, keeping originals and keys
      private, and verify local/cloud behavior and release packaging.
      Progress: 2,597 individual FBX variants are cataloged. One hundred and thirty-seven
      selected formations, rocks, pebbles, crystal clusters, trees, grass, cacti, fungi, ore and
      deliberate-site props are encrypted. The natural models default for new
      supported biome choices only after key access is verified; built-in scenery
      remains selectable and saved choices are preserved. Ore and built-site props are
      manual-only. The other 2,460 remain source-only, not discarded or approved for runtime
      placement. Further mining, forge, construction, equipment and other categories
      remain to be reviewed and integrated; visual acceptance remains open.
      Small Pure Poly grass and pebble clusters are passable ground cover in suitable biomes.
      Brighter mushroom clusters generate in fungal groves and temperate forests,
      not automatically in natural Cavern.
      Six distinct leafless trees add variety to protected Dead Forest generation.
      Both scenery choices use leafless legacy trees rather than the crimson-leafed
      model previously labeled bare; existing placements are unchanged.
      Three ore-stone shapes in seven colors are available as manual decorations;
      mining interactions and depleted states remain unimplemented.
      All six crystal-cluster shapes and seven colors are available; blue, green
      and red variants generate in suitable crystal biomes, while the other colors
      are manual-only.
      New trees, cacti and rocks retain the existing grid-cell movement policy;
      physical footprint and cluster collision remain a separate open task.
- [ ] **Organic natural routes and scenery clearance** - High-density Caverns
      can place stalagmites through boulders and leave unnaturally straight,
      cleared walkways between entrances. Account for actual model footprints,
      scale and placement when avoiding obvious interpenetration, while retaining
      natural clusters and allowing appropriate contact between rocks. Larger
      formations and tightly packed clusters can block movement; small formations
      remain passable. Use their actual physical footprints and the creature's
      occupied space rather than blocking every square an asset touches. Assets
      can occupy fractions of a square or span several squares. Connect every
      usable door and entrance with supported routes at least wide enough for a
      Medium creature (5 feet), using organic gaps between clusters rather than
      visible straight-cut or deliberately landscaped walkways.
      Apply the same consideration to other natural biomes and areas needing
      traversable access, without changing deliberately constructed roads.
      Verify dense and sparse generation across seeds, sizes and entrances,
      including visual clearance, real traversal, save/reopen and performance.
      Existing saved or authored scenery must not change without explicit editing
      or regeneration; obtain visual review before marking this complete.
      Progress: new cavern terrain and underground scenery use bent, supported
      entrance routes instead of broad straight strips. The new terrain recipe
      is versioned; earlier recipes remain reproducible, and linked version-six
      chambers remain compatible with regenerated maps.
      Transformed model bounds protect a five-foot gap and reject formation/boulder
      or formation/formation intersections; shifted formations require level
      support. Clusters now leave
      open pockets and use varied sub-square positions. The direct generation
      path is also covered, and saved/authored scenery is unchanged.
      Multi-square formations, size-aware physical blocking, other natural
      biomes and visual review remain.

- [x] **S1 - Restrained, architecture-aware windows** - Reduce automatic window
      density, especially on large buildings and dense city blocks. Use deliberate
      spacing, solid wall sections and different opening patterns for homes,
      civic buildings, keeps and defensive towers. Castle turrets should not have
      ordinary outward-facing windows by default; keep suitable courtyard-facing
      openings. Treat possible arrow slits as a separate later choice, not
      automatically traversable full-size windows.
      Acceptance: compare small/large buildings, city skylines and every castle
      tower orientation; verify the intended sparse counts and actual opening
      clearance. Retain manual window authoring/resizing and preserve existing
      saved/manual features until explicit editing or regeneration.
      Verified: optional window-layout recipe caps new automatic openings at
      two per facade/floor, with inward-only castle-turret faces. Representative
      dense-city/castle renders have approximately 50-65% fewer windows. Legacy
      saves, manual edits, feature resizing, Undo and real window travel retain
      regression coverage. This completes density and defensive-facing rules,
      not variable window dimensions or richer facade composition (S1b).
- [x] **S1b - Variable window sizes and intentional facade patterns** - Use the
      existing resizable-window model in generation, not only manual authoring.
      The former automatic windows defaulted to 5 by 5 feet with a 2-foot
      sill and repeated castle openings in a single vertical column.
      Vary width, height, sill elevation, position and per-floor patterns
      through deterministic architectural recipes. Compose large hall windows,
      smaller domestic openings, deliberate blank wall sections and appropriate
      multi-storey windows instead of simply randomizing every aperture.
      Keep the sparse-window and inward-facing turret rules from S1.
      Acceptance: compare generated homes, civic buildings, keeps and towers
      across multiple sizes/seeds; demonstrate real dimension and arrangement
      variation, not only counts or tint, with no universal repeated column.
      Generated features must remain selectable/resizable through the same
      controls as manual windows. Preserve actual body clearance, stairs,
      balconies, floor slabs, sight and managed connections. Tall windows must
      not silently remove intervening floors. Preserve existing saved/manual
      features until explicit editing or regeneration, and retain performance
      budgets, exact locked-seed repeatability and save/reopen coverage.
      Verified: seeded version-2 recipes vary dimensions, sills, positions, blank
      rows and tall hall features. The normal size controls create manual
      overrides for generated windows; Undo, old recipes, real per-floor
      connections and intact floor slabs are covered. Native cliff-castle
      inspection confirmed 26 distinct generated opening sizes in one seed.
- [x] **S2 - Genuinely variable castle generation** - Replace the mostly fixed
      castle composition with seeded structural choices: overall footprint, keep
      dimensions and height, wall height and shape, number/placement of towers
      and buildings, courtyards, gatehouses and complexity. Retain an intentional
      architectural hierarchy rather than scattering unrelated random pieces.
      Acceptance: multiple unlocked seeds must produce visibly and measurably
      different geometry, not only names, colours or heraldry. A locked seed must
      reproduce exactly. Generated doors, stairs and wall walks remain usable,
      with bounded geometry/map counts and no destructive occupied edits.
      Verified: sixteen sampled seeds yield sixteen structural fingerprints;
      citadel/bailey/palace variants change real dimensions, tower/building
      counts, heights, flared curtains and supporting buildings. Door/stair
      support, complex-variant actual-rig travel, repeatability, save/reopen,
      authoring guards and navigation budgets are covered. Site-specific
      cliffside/mountain work is tracked separately in S4a/S4b below.
      This verifies structural variation, not final visual acceptance of the
      ordinary castle building itself; its architectural redesign is S2b.
- [ ] **S2b - Grand, connected Castle/Fortress architecture** - Redesign the
      ordinary castle's main keep/building itself, not just its terrain, outer
      walls or colours. User feedback: a box with four grain-silo-like towers
      still does not read as a castle. Compose joined keep wings, halls,
      gatehouses and courtyards with varied heights, rooflines and proportions;
      towers should support that composition rather than define the whole
      building. Reuse shared snapping/compound-building assembly rules instead
      of duplicating them in generation. Evaluate a larger empty/default grid
      for grand layouts, not merely a scaled-up version of the same box.
      Preserve manually sized/populated maps and existing scenes until explicit
      generation/editing. Acceptance: compare the main castle silhouette and
      connected interiors across seeds and supported grid sizes; retain usable
      entrances/stairs, deterministic generation and save/reopen, and obtain
      user visual acceptance. This is separate from S4's cliff/mountain landforms.
      Implementation progress: ordinary grand castles now share seven connected
      keep/wing/hall/court/gatehouse/watch parts, varied heights and roofs, an
      open-sky courtyard and supported arched access. Compact 25/40-square cases
      retain connected halls; no default-grid increase or saved-scene remodeling
      was needed. Public snap previews/Cancel, atomic commit/Undo/Redo, stable
      existing-format joins/reopen, real character walking and member-floor
      crossing, protected construction and disconnect-then-edit are covered.
      Native 25/40/50/60-square exteriors and structural sections were rendered;
      compact wing rooflines were refined and measured below the principal keep.
      Compact front bastions now retain supported 25-foot diameters and remain
      lower than 30/40-foot principal keeps; seed 7 was reviewed again natively.
      The local-dependency fixture rerun covered 25/40/50/60 x seeds 1/7/42,
      both views, with no shader failures, external/host requests or app storage.
      Previews also compile immutable floor/opening topology. Current-actor
      commit checks and occupied Undo after real paid movement are covered.
      Authenticated player commands now cross generated joins and return on
      25- and 50-square castles, preserving identity, health and exact movement
      charges; retrying a command does not charge twice. User visual signoff
      remains open; passing geometry tests are not artistic acceptance.
      The 20-square fortress wing/bastion overlap is fixed for new layouts;
      multiple seeds now retain supported approaches and connected keep wings.
      New grand and ruined bastions also clear their overlapping curtain walls,
      preserving access to their battlement stairs in both directions.
- [ ] **S3 - Natural caves, not surface moon bases** - Generate irregular,
      excavated chambers and passages within rock/terrain instead of assembling
      exposed dome-and-tube shells. Vary chamber proportions, tunnel direction
      and width, entrance shape, floor/ceiling relief and rocky silhouettes while
      keeping a clear connected route. Retain domes/tubes as useful manual shapes;
      do not silently remodel existing saved structures.
      Acceptance: exterior entrances look like rock openings; interior/cutaway
      views reveal readable natural chambers. Test continuous support, headroom,
      turns and actual creature movement through joins. Avoid expensive world-CSG
      rebuilding during previews or idle frames.
      Full-map Underground interiors now use the existing elevation tools
      for Cavern, Fungal Grove, Crystal Fields/Spires and Eldritch Rift
      to sculpt tall rock ridges and low uneven floors. Procedural stalagmite/
      stalactite generation and Build tools have been removed; reviewed
      cave-formation models are now placed as removable scenery. Saved prototypes
      remain readable and removable.
      No new cave-wall volume or
      floor-mask geometry is used. Automatic side chambers
      and an Add tunnel/chamber control connect separate visual
      areas retain paid movement, saved identities and authored-map protections.
      Independent blank chamber maps now connect through logical passages.
      Remaining S3 work includes outdoor entrance visuals, suitable cave
      formations, ceiling presentation and artistic acceptance, not placing
      dome shells or short cutaway walls in Underground maps.
      Prerequisite progress: S4b uses real excavated approaches/halls within a
      painted mountain heightfield. The general Cavern and other natural-cave biome recipes
      no longer use the earlier surface-shell arrangement.
- [ ] **Camera-aware boundary-wall cutaways** - When surrounding terrain or
      boundary walls, such as Cavern or Crystal Spires walls, obstruct a
      participant's view of the scene, hide only the obstructing portions for
      that viewer and restore them as the camera moves. Remove boundary-wall
      portions between the camera and usable floor in the currently viewed area,
      even without a selected creature. Never cut away the floor, interior walls
      or buildings; the floor must remain visible and clickable for interaction.
      Apply across area types, using the user's camera rather than the
      character's line of sight. Keep each participant's view independent and
      retain authoritative physical geometry, traversal, sight and player-data
      privacy. Verify floor picking, multiple camera angles, entrances, DM and
      player views, and unobstructed walls before visual acceptance.
      Progress: elevation-based cavern boundaries and generated Dungeon perimeter
      walls now cut away per viewer and follow camera rotation, with clickable
      floors and preserved interior walls. Host/player rendering, rotation and
      reopening are covered. Other area types and visual acceptance remain open.
- [x] **Independently generated cavern chambers and entrances** - For every
      natural Underground variant, let the DM choose a total chamber count
      including the starting map. Create each additional chamber as its own
      blank map until the DM generates or edits it independently. Build a
      traversable, branching network through the existing Main entrances:
      each link pairs available entrance/exit endpoints on its two maps.
      The maps are logically connected, not required to touch or align in world
      coordinates, and resizing one must not reposition the others.
      Let the DM designate one or more entrances as leading outside; create
      blank outside maps, allowing the DM to choose whether destinations are
      shared or separate. Shared outside maps need distinct entrances for each
      connection. Allow other entrances to remain unconnected for later use.
      Preserve existing chambers, contents and links during per-map generation;
      prompt for a resolution if there are too few available endpoints rather
      than silently discarding a link. Cover real player traversal in both
      directions, independent generation and sizing, existing saves, occupied
      linked maps, save/reopen and privacy between separate maps.
      Implemented: generation review creates blank linked chambers and shared
      or separate outside maps; Maps & focus can link more blank areas later.
      Entrance markers and accessible controls initiate paid, host-authorized
      travel. Independent resizing preserves other maps and links. Tests cover
      persistence, blocked landings, player privacy and cached cloud projections;
      the physical cavern-area workflow remains available and explicitly labeled.
- [x] **Underground local lighting** - Make every Underground biome, including
      Dungeon, independent of the outdoor sun's direction and time of day.
      Use local visual light from scene sources such as torches or glowing
      crystals/fungi, with enough ambient light to remain usable. Update their
      illumination when sources are added, moved or removed.
      The audited Dungeon, Props and Tavern packs contain candidate torches,
      lanterns and sconces; review their materials and licenses before use.
      Keep this visual lighting separate from the later gameplay darkness and
      darkvision rules. Avoid light leaking between separate maps; restore
      outdoor lighting on return and verify DM/player views, map switching,
      save/reopen and a bounded lighting/shadow rendering cost.
      Implemented: all six Underground variants use a fixed ambient profile,
      with the outdoor sun disabled. Generated Dungeons include CC0 torches,
      which can also be added or removed as placeables. Fungi and crystal-like
      scenery can illuminate nearby terrain. Up to eight nearby point lights
      render without shadow maps; they are visual only and follow the current
      map, source changes and the camera. The host/player transition and
      save/reopen paths are covered. Cave formation assets and cave shape
      remain separate work.
- [ ] **Underground vegetation and asset suitability audit** - Remove ordinary
      surface trees and tree-like placeables from true cavern/dungeon contexts.
      Cavern and Fungal Grove already exclude ordinary trees; Eldritch Rift
      retains the explicit magical-tree exception. Complete the replacement
      with suitable cavern roots, mushrooms, crystals, rubble, bones, fungi,
      stalagmites and other underground-appropriate assets. Suitability changes
      alone must not remove authored trees; confirmed map regeneration follows
      the clear-and-replace behavior above.
      Progress: Fungal Grove now generates grounded, glowing purple clusters and
      giant caps from two reviewed CC0 models. Player presentation and reopening
      are covered; user visual review is deferred.
- [ ] **Use the available cave-formation assets** - Review and integrate
      suitable stalagmite clusters and stone columns. Normal Cavern previously
      generated rocks and mushrooms, not these formations. Add appropriately
      varied, grounded formations without blocking required passages or adding
      duplicate overlay geometry. Verify licensing/notices, packaging, density,
      support, navigation, player presentation and save/reopen, with multi-angle
      visual inspection. Stalactites are not required.
      Progress: both reviewed cave models now populate Cavern as grounded,
      size-varied, clustered scenery, with reserved entrances clear and opaque
      sight bounds. Density targets use eligible cave floors, and rejected
      model-specific sites no longer consume the target.
      Denser settings add more nearby formations; the terrain mesh,
      grid and scenery now share the same restored elevation scale.
      Public-runtime models now use CC0 derivatives, with their source terms
      and fingerprints recorded; the previous restricted models remain local.
      The formations now have embedded CC0 stone texture for surface detail
      under ambient cave lighting. Host/player rendering and reopening are
      covered. The Pure Poly selection adds eight stalagmites,
      five columns and seven gray rocks without random cave torches. User visual
      review is deferred.
- [ ] **Make Crystal Spires look like spires** - Replace the predominantly
      ordinary rock/pebble silhouettes with clearly tall, varied crystal spires
      or pillars, using appropriately tinted cave formations or suitably
      stretched existing rocks. The audited Tavern pack also contains two
      source-only crystal-cluster models worth evaluating. Preserve suitable
      spacing, passable routes and biome colors. Inspect multiple seeds and
      angles and verify scale, support, performance, player presentation,
      licensing and save/reopen.
      Progress: size-varied, tinted cave clusters replace the generated
      rock/pebble mix and emit bounded local light. Higher density increases
      clustering; instance bounds are refreshed after regeneration so visible
      spires are not culled. A depth prepass keeps overlapping formations in
      their correct order as the camera moves, while retaining their translucent
      colors. Grounding, clear entrances, player rendering and save/reopen are
      covered; user visual review is deferred.
- [ ] **Add Dungeon as an Underground variant** - Add `Dungeon` to the
      Underground biome family and distinguish it from natural Cavern:
      deliberate rooms, corridors, dressed masonry, cells, storage, stairs,
      doors, traps/furnishings and a suitable constructed palette. It should
      reuse the separate-room/campaign-location model where appropriate rather
      than treating a dungeon as a randomized rocky cave.
      Generation now creates variable connected rectangular rooms and corridors,
      with open physical doorways, paving, torches and instanced masonry on
      boards of at least 12 x 12 squares. Existing collision and sight geometry
      remains authoritative, with procedural walls as the fallback. Player
      views still use procedural walls. Interactive doors, stairs, furnished
      interiors, traps, loot and additional connected locations remain open.
      Overhead views now hide generated doorway lintels locally, exposing the
      clickable openings while preserving jambs and physical collision/sight.
      Tilted views restore the lintels; host and player rendering are covered.
- [x] **Dungeon grid-edge coverage and room variation** - Extend the playable
      layout and outer walls to the selected grid edges instead of leaving an
      unused perimeter. Let the DM select the room count, and generate
      meaningfully different room sizes, placements and connected layouts across
      seeds instead of repeating an equal-sized central-corridor plan. Fit the
      selected count with usable openings and routes; if it physically cannot
      fit, notify the DM and request a grid-size or room-count adjustment.
      Keep locked seeds reproducible, retain instanced visual replacement and
      authoritative physical walls, and validate several grid sizes and seeds,
      connectivity, save/reopen and multi-angle appearance.
      Implemented: choose 1-16 rooms, with grid-specific fit guidance before
      replacement. Seeded partitions vary room dimensions and straight, T or
      cross corridors; their physical walls reach the grid edges and retain
      connected routes and torch placements. Real geometry, host-authorized
      player travel, saved choices, unchanged scenes after invalid choices, and
      multiple sizes/seeds are covered. Isolated native views were inspected;
      user visual review remains appropriate. **Next Dungeon layout** now cycles
      genuinely different wall layouts while retaining grid size and room count,
      even with seed lock on. The replacement warning can be skipped and restored
      per browser; ordinary locked generation remains repeatable.
- [ ] **Connected underground areas and line of sight** - Evaluate separate
      Dungeon room areas connected by doors against an equivalent single-map
      visibility approach. Reuse existing building-area, door, sight and travel
      mechanisms where applicable, and adapt cavern links for unaligned areas.
      In both Dungeons and caves/caverns, players see what their active character
      has line of sight to, including visible parts of adjoining areas through
      open doors, tunnels or passages; blocked or out-of-sight content stays hidden.
      Enforce visibility in host-authorized player data, not just by hiding
      meshes, including when a party is split across areas. Preserve character
      identity, movement and combat state through authorized transitions. Account
      for existing Dungeon room counts, layout cycling and campaign map limits;
      do not silently remodel existing saved Dungeons.
      Progress: player passage travel now preserves canonical focus and camera
      history when the DM follows that character, while an unfocused DM stays
      on their own map. Connected-area sight and privacy policy remain open.
- [ ] **Multiple depths for underground networks** - Allow Dungeons and
      caves/caverns to contain connected rooms or chambers at multiple depths.
      Define how the DM creates levels and connects them, how players travel
      between depths, and how the DM-only overview displays those links.
      Constructed Dungeons may use stairs or ladders; natural caves/caverns use
      ramps or naturally sloping tunnels instead, not stairs or ladders. Support
      travel in both directions. Preserve line-of-sight visibility, supported
      arrivals, split-party state, movement and combat continuity, and existing
      maps; verify generation, traversal and save/reopen.
- [ ] **Surface cave entrances must be terrain openings** - Replace the
      occasional surface “moon base” cave landmark seen in Plains/Hills/Mountain
      contexts with a readable hillside or ground entrance: sculpt a dark mouth,
      stone rim, approach and descending interior connection. The exposed
      entrance should not show domes or tube shells on the surface. Keep the
      actual interior as a separate connected underground area with a natural
      rocky ceiling/route.
- [x] **Biome asset integration matrix** - Before importing batches of new 3D
      assets, define a versioned suitability matrix per biome/variant covering
      category, density, placement spacing, elevation/roof/cave constraints,
      allowed surfaces, support footprint, scale, spectral/non-spectral
      variants, player-view privacy and save/restore identifiers. Include an
      ingest checklist so each asset pack can be mapped to the biomes where it
      belongs instead of becoming a global mixed-population menu. The current
      legacy catalog is fully enumerated, every biome has an explicit policy,
      unreviewed provenance is reported, ordinary-cave tree violations are
      diagnosable and Eldritch Rift remains the magical-tree exception. This
      runtime foundation covers placeable definitions, not every downloaded
      source model; the reassessment below records those candidates separately.
      See [ASSET-INGESTION.md](./docs/ASSET-INGESTION.md).
- [x] **Source-pack usage catalog** - Catalog the downloaded packs by the
      biomes/variants, scene role and intended generation consumer where they
      will be used. Current entries assign the cave pack to terrain entrances,
      modular dungeon kit to Dungeon/Castle interiors, village and castle kits
      to settlement generation, prop packs to dressing/cover and the Jampot pack
      to loot containers. Whole source packs remain `source-only`; selected
      reviewed representatives are available as biome-restricted placeables
      with packaged dependencies and browser-load coverage. The cave formation
      models now also serve Cavern and Crystal Spires. Six additional Village
      models are registered; four are used for generated town walls, roofs,
      gables and balcony rails, and two window models are registered but not
      used by that renderer. No whole source
      pack is enabled for generation.
- [x] **Reassess all asset packs and the biome matrix** - Inventory every
      unique asset in the downloaded and existing runtime packs, including
      structures, cave formations, props and equipment; account for other pack
      types separately where biome suitability is not applicable. Reconcile
      pack manifests, actual models and runtime registrations without counting
      alternate formats as separate assets. Check classifications, intended
      uses, biome/variant suitability, scale, support, materials, licensing and
      notices. Record whether each asset is source-only, manually available or
      used in generation, and correct missing or misleading matrix entries.
      Report how many assets were missed or miscategorized and identify the
      affected packs. Validate the revised catalog and representative visuals;
      do not enable entire packs for generation without individual review.
      The audit found 685 distinct terrain source assets in 1,559 files, of
      which 675 were source-only at audit time, plus 118 unregistered Asset
      Quest forest models. Corrected six missing runtime attributions, five
      source-format descriptions and inconsistent representative-ID versus definition
      suitability. Measured source geometry and inspected representative
      visuals; other per-asset biome candidates remain unapproved. See
      [ASSET-INGESTION.md](./docs/ASSET-INGESTION.md) and
      [ASSET-INVENTORY.csv](./docs/ASSET-INVENTORY.csv).
- [x] **Resolve silently discarded biome asset weights** - Fungal Grove uses
      reviewed `mushroom-glow` and `mushroom-giant-cap` models. Magical-biome
      `family-spectral` weights are distributed across concrete variants without
      changing their total. Generation logs the biome, ID, weight and reason for
      future invalid selections; catalog, selection, suitability, packaging and
      host/player reopening are tested. Existing saves are not regenerated.
- [ ] **Rework castles and villages with modular assets** - Revisit the
      settlement generation plan after the new structure/prop packs are
      evaluated. Replace placeholder box/kit silhouettes where modular assets
      provide real walls, roofs, doors, towers, houses, market stalls, props,
      roads, fences and furnishing detail. Preserve connected-floor topology,
      doors/windows, supported stairs, player roofs and save identities while
      changing the generated visual assembly. Cover village/town, city, active
      and ruined castle variants, then cliffside/mountain sites. Use asset
      suitability and fallback rules from the biome integration matrix rather
      than coupling generation to any single pack. Village / Town uses fitted
      instanced walls and trim, tiled gables, and three-sided balcony rails
      without changing the physical shell. The whole-town joint pass addressed
      protruding gable timbers, offset wall planes, mismatched window/door holes
      and duplicate solid balcony rails. The user accepted that village visual
      pass on 2026-11-21 after multi-angle inspection. Hipped roofs and unavailable
      model kits retain their procedural visuals. The audit identified unused
      stone/wood-grid walls, dormers, shutters, overhangs, roof sizes, chimneys
      and balcony variants in the same Village pack, plus 116 separately named
      modules in the Castle Wall Kit. Reassess them as alternatives while
      preserving the approved baseline and physical topology; measure their
      triangle and material costs. Remaining work includes settlement design
      variation and the separate castle rollout.
- [ ] **Architectural variation from the approved structure packs** - Use the
      downloaded village, castle, dungeon and prop kits to create distinct
      layouts, silhouettes, rooflines, wall treatments, entrances, markets,
      ruins and interior dressing across every biome variant that supports
      structures. Derive compatible modules from biome climate, culture and
      terrain rather than assigning one global building set. Keep topology,
      support, openings, sight, save identity and procedural fallbacks
      independent from the visual module chosen for each structure. This builds
      on, but is not limited to, the village and castle rollout above.

### Site-specific castles

Both variants have explicit generation choices under Settlements. Reopened
2026-11-06: the user rejected the rock-spur/terraced rework too. The actual
50 x 50 board took a sparse fallback with no towers, and the 60 x 60 version
still did not establish the requested visual distinction. Rebuild the landforms
with existing raised/lowered grid cells, not added rock solids, and make both
compositions recognizably fortified castles. Visual acceptance remains open;
do not equate passing physical tests with satisfying the artistic requirement.

- [ ] **S4a - Cliffside castle** - After S2, integrate a generated castle with a
      real cliff edge: varied elevation, supported foundations and courtyards,
      a convincing approach/gate and defensible exposed faces. Keep the cliff,
      drops and possible ledges physical rather than purely decorative.
      Acceptance: multiple seeds and map sizes preserve supported access, real
      falling rules, usable stairs and a clearly different silhouette from the
      flat-ground castle.
      Grid-based redesign implemented; visual acceptance pending: a high
      painted escarpment using positive and
      negative heights, with a substantial battlement keep, full curtain,
      corner/gate towers and arched approach. Standard 50 x 50 and 60 x 60
      canvases retain the full castle composition; compact boards still retain
      a keep, four towers and a complete curtain, not the former lone house/gate.
      Keep painted heights editable through the normal brush and Undo.
      Entrance/foundation and save/reopen checks cover 20-, 40-, 50- and
      60-square sizes, including rotated rectangular boards. Paid ascent and
      real-character entry/reopening cover the standard sites. A real-character
      50-foot fall requests 5d6 damage, applies prone and charges only the
      five-foot horizontal move. Final native visual acceptance is still required.
- [ ] **S4b - Mountain-integrated castle** - After S2 and S3, combine exposed
      ramparts/keeps with excavated halls, entrances and chambers embedded in the
      mountain. Terrain must meet the architecture without filling its rooms or
      leaving floating foundations.
      Acceptance: outside/inside transitions and cutaways are usable; rock
      ceilings, floors and walls remain authoritative for collision, sight and
      falling. This is a site recipe, not just another colour palette.
      Grid-based redesign implemented; visual acceptance pending: a coherent
      painted mountain rises above/behind
      a fortress emerging from its lower face, rather than a second cliff
      platform. Below-zero wards and excavated Stoneheart hall have real
      ceilings, approaches and paid stair access. Preserve the mountain
      heightfield underneath below-zero structures instead of flattening it
      during generation. Use only existing construction/excavation geometry;
      no added mountain/terrace rock solids or new shape types.
      Standard and compact fortifications, real-character travel, cutaways
      and reopening are verified. Compact sites retain the embedded keep,
      four towers and complete curtain; the separate buried hall is reserved
      for larger sites where its approaches fit. Final native visual
      acceptance remains open. General cave generation and S6 room dressing
      are separate unfinished work.

### Campaign locations and richer interiors

- [x] **S5a - Independent location-map model** - Extend the existing connected-map
      foundation to distinguish physically aligned floors/areas from independent
      campaign locations such as a town, wilderness site, dungeon or castle
      interior. Separate physical spaces explicitly; do not simulate separation
      by inventing giant coordinate offsets or letting unrelated maps overlap.
      An overall location is a separate rendered space; its physically connected
      rooms, floors and cellars are internal areas, not separate destinations
      requiring individual player publication.
      Acceptance: locations persist within one campaign, but cannot accidentally
      share sight, attacks, occupancy, support, flight or falling. Normal
      building floors/windows/balconies keep their existing physical alignment.
- [ ] **S5b - DM location management and creature transfers** - After S5a, add a
      usable workflow to create, name, open and revisit locations, then send
      selected creatures or the party to a chosen destination/arrival area.
      Support a split party in different independent locations. Keep separate
      controls for browsing a location as DM and moving selected characters or
      the whole party: DM browsing never moves characters or other viewers.
      Move the actual character/sprite, then move the controlling player's view
      with that character; do not merely switch access while leaving the actor
      in another location. A player with assigned characters in different
      locations can switch Active character and follow the selected one.
      Acceptance: preserve the same creature IDs, character links, HP, resources
      and inventory; validate arrivals without overlapping creatures or placing
      them inside solids. Save transfers atomically, retain each location's
      terrain/content/camera and protect unfinished actions. Decide explicitly
      how narrative travel interacts with active combat rather than silently
      resetting turns or movement.
      Implemented: create/save separate empty locations and browse their internal
      areas through Maps & focus, without moving or recreating actors. Explicit
      selected-character/party transfer controls and combat-travel policy remain.
- [x] **S5c - Character-driven location and area access** - Replace the initial
      per-grid publishing policy with access derived from the player's selected
      assigned character's location. Connected rooms, floors, cellars and other
      areas within that location are accessible through legal traversal without
      the DM separately publishing each area. The DM controls travel between
      independent locations by moving characters, not by sharing an arbitrary
      location browser. Preserve independent player cameras and single-character
      physical line of sight; area access does not reveal unseen creatures.
      Acceptance: entering an unlocked connected area follows the character
      without another permission step; changing the DM's view affects no player;
      selecting another assigned character follows that character's location.
      Implemented: server-authorized areas derive from the active assigned
      creature's location, without per-area publishing. Authoritative map changes
      move that player's view; other location data stays isolated. Player movement
      commands and area locks are separate pending tasks.
- [ ] **DM-only location-wide top-down overview** - Show all areas of a chosen
      location in a flat, connected, map-like view, not just a list or the current
      tactical grid. Adapt the layout to the location: same-level Dungeon rooms
      and cave/cavern chambers should read as a connected floor plan with their
      doors and passages visible. Multi-level buildings and underground areas
      show distinct levels and recognizable, appropriately labeled symbols
      linking stairs, ladders, ramps or sloping tunnels to their destination
      levels. Natural caves use ramps or sloping tunnels rather than stairs
      or ladders.
      Include differently sized, rotated or independently generated areas. Treat
      logically linked cavern chambers as one network for this overview even
      when they are stored as separate technical locations; do not include
      unrelated sites. Arrange unaligned areas and levels clearly without
      changing their gameplay coordinates, physical alignment or creature
      positions. Let the DM navigate the overview without moving characters or
      other viewers. Persist any overview layout as needed, keep it and hidden
      areas out of player-authorized data, and verify building, Dungeon and
      cavern examples across levels and save/reopen.
      Progress: Maps & focus now opens a DM-only, refreshable overview with
      connected cavern chambers, Dungeon floor plans, creature markers, distinct
      building levels and labeled stairs/ladder links. Layout is deterministic
      across reopening and does not change gameplay coordinates or player data.
      Natural multi-depth connections and visual acceptance remain open. The user
      is considering a rework; defer overview changes until they provide direction.
- [ ] **S5d - DM-controlled area access locks** - Let the DM lock/unlock access
      to internal areas independently of physical door/window state. Players
      cannot bypass an access restriction by changing camera, browsed area or
      client requests. The DM can remove the restriction whenever appropriate.
      Keep access restrictions separate from physical locks, sight occlusion and
      deferred fog-of-war/exploration rules.
      Clarify behavior for characters already inside a locked area and for
      physically visible areas before implementing this policy.
- [ ] **S5e - Physical opening locks and open/closed state** - Add independent
      locked/unlocked and open/closed states for doors, gates, hatches and
      applicable windows. Players can operate unlocked openings within reach of
      their active assigned character; the DM can always override. Locks remain
      until the DM unlocks them or adjudicates a successful unlock/pick/force
      attempt. Unlocking alone must not open the passage.
      Make sight material-aware: closed opaque doors block passage and sight;
      closed glass can block passage while remaining see-through; opaque
      shutters/curtains block sight. Opening/closing must update the actual
      traversal and sight queries, not just hide or show a rendered mesh.
      Acceptance: persist states in host saves/JSON backups, synchronize changes,
      revalidate reach/ownership/access on the host, reject conflicting
      interactions, and refresh affected routes and visibility without resetting
      character resources, movement or turns.
      Implemented for connected building doors: closed/unlocked defaults,
      open/close and DM-only locks, fitted opaque leaves in physical obstruction,
      host-validated five-foot reach and revisions, persistent per-player room
      visits, and hidden closed-room floors/walls/stairs. Native curved surfaces,
      strict room boundaries and single floor-surface ownership remove doorway
      texture/cap artifacts. Gates, hatches, glass/shutters and unlock/pick/force
      adjudication remain pending.
- [ ] **S6 - Designed castle and dungeon interiors** - After S5, create interiors
      that feel like complete encounter maps: entrance/guard rooms, throne or
      great halls, barracks, kitchens, storage, stairs, corridors, secret routes
      and furnishing/cover. Vary room scale, height and purpose instead of
      presenting an empty rectangular grid.
      Confirmed hybrid model: allow explicitly non-to-scale interiors larger than
      their exterior as independent locations, while ordinary aligned floors
      continue to obey physical traversal. Do not silently stretch a connected
      floor and break its window/balcony/sight relationships.
      Acceptance: entrances and exits return to the correct location, generated
      rooms are reachable and playable, arrival points remain supported, and
      saves/Undo cannot replace current character state with old resources.

### Parked UX work and verification gates

- [ ] **S7 - Creation-control refinement** - Revisit structure creation, selection
      and direct manipulation after the generation/map workflows settle. Keep
      this parked item visible; the current illustrated builder is a foundation,
      not the final creation UX.
- [ ] **S8 - Representative-scene and performance gates** - Apply across S1-S7:
      compare village, dense city, flat/cliff/mountain castle and natural cave
      scenes at their intended sizes. Validate real input/pathfinding latency,
      not only GPU frame rate; retain spatial-query acceleration, batched/cached
      rendering and action-boundary saves. Keep readable generation errors and
      protect linked maps while warning before clearing the active map unless the
      DM has explicitly disabled that warning in this browser. Verify each milestone
      with deterministic tests, visual inspection and save/reopen before marking it
      complete.
      Benchmark representative and large, densely populated maps on DM and
      player clients, including actual lighting and shadows. Record frame times,
      draw calls, triangle counts and load costs on the intended hardware before
      setting budgets. Reuse models and suitable supplied LODs where they
      preserve appearance; investigate expensive frequently repeated pieces
      first, and seek or simplify replacements only when measurements justify
      them. Do not degrade the approved Village baseline or silently substitute
      incompatible doors, openings or materials.
      Castle correction: include the user's actual 50 x 50 canvas, not only
      larger recommended defaults. Compare cliff and mountain views together;
      assert editable heightfield relief and full fortification at smaller
      sizes. Keep S4 visual acceptance open until the user accepts the result.
      This pass: 95 focused unit cases and seven actual-FBX travel/fall cases
      pass. Native 50- and 60-square source renders each retain all 19 recipe
      structures/eight towers, exact terrain save/reopen and working shaders.
      Native local 30-foot range queries measured 13.8-28 ms on their first
      run and 4.4-18.5 ms warmed; this is not a claim about full campaign input
      latency. Existing campaigns were not regenerated and no host restarted.
      A dense 100 x 100 Dead Forest plan produced 1,313 candidate placements
      for seed 42; this is not a rendered-performance measurement or budget.
      One 25 x 25 Crystal Spires view used 35 draw calls and 408,520 triangles
      without the depth pass, versus 39 calls and 611,380 triangles with it.
      This single view is not a performance budget.

---

## Mannequin Movement Polish

Completed items have regression coverage and actual-FBX browser replays described
in the [archived handoff](./.attic/HANDOFF.md). Broader or unreproduced reports remain open.

- [x] **Climb, crouch-to-stand, and fall alignment** — Correct root-space scale/rotation, continuous wall and mantle motion, authored recovery poses, foot grounding, and contact-timed landings for click and keyboard control.
- [x] **High-wall animation cycle continuity** - Keep the wall action running
      across height segments and retain fractional frame time; verify actual
      skinned-joint motion and action weight at fixed and uneven frame rates.
- [x] **Natural falling speed** - Use world-scaled gravitational acceleration
      instead of level-based slow constant descent, retain contact-timed normal-speed
      recovery, and verify actual airtime for ledge drops and wall releases.
- [x] **Orientation deferral during traversal** — Preserve facing throughout committed climbs and falls, retain requested post-climb turns, and evaluate navigated falls using the actual world-space goal direction.
- [x] **Edge tile destination overshoot** — Arrival obeys the movement budget and reaches the exact destination without consuming the tolerance as a final snap. Verified a running arrival beside a cliff without falling off.
- [x] **Sprint-to-climb on closely spaced elevations** — Verified two eight-level rises with a single intermediate tile, including sprinting approach and continued navigation.
- [x] **Multiple in-line falls animation** — Verified two consecutive ten-level drops. Unsafe rolls use a braced landing; the next fall begins normally and releases its world lock before movement resumes.
- [ ] **Broader fall edge cases** — Continue stress-testing irregular/diagonal terrain and retargeting during animated transitions. World-space edge tracing replaces the old stored-grid/same-elevation guard, but the validated cliff fixtures are not exhaustive coverage.
      Progress: actual-rig tests now cover 13.5-foot falls in all four diagonal
      directions, including routes that encounter an earlier damaging drop,
      a 6-foot fall redirected twice, and a redirected damaging fall. They
      verify supported landings, damage, prone movement costs, the committed
      fall trajectory and the latest queued destination.
- [x] **Walk animation not playing for short paths** — Reproduced a one-square
      move sliding while its walk clip was still loading. Local click movement
      now waits for locomotion, keeps the latest pending destination, and
      revalidates the creature and map before starting. Load errors are reported.
      An isolated browser test delays the real FBX and verifies both movement and
      the visible rig's leg animation after loading.

---

## Map View and Menus

- [ ] **Delete campaigns from the campaign menu** - Let an authorized owner
      delete a selected campaign from the user's campaign list, with an explicit
      confirmation and clear consequences. Decide backup retention and recovery
      behavior before implementation. Preserve all other campaigns and verify
      cancellation, authorization, failures and the refreshed menu.
- [x] **Move campaign/session controls into Settings** - Put the campaign name
      and ruleset, save status/retry, Campaigns, Players & sharing, Sign out and
      JSON backups under Settings instead of the floating center menu.
- [x] **Keep only DM map controls over the map** - Leave a compact Maps & focus
      tab for the DM; do not expose it to players.
- [x] **Collapsible dice panel and sidebar** - Collapse either menu independently
      to a small reopening tab. Remember the choices in this browser, preserve
      the current tab/dice history, and let the map fill the window when the
      sidebar is hidden. Verify keyboard controls and narrow-screen layouts.

---

## Dice Rolling

- [x] **Fix the hosted physical-drop dice failure** - Falling damage now uses
      the landing map's dice-board context and the player's selected physical d6s.
      A cocked roll requests a retry without moving the actor or spending Slow Fall.
      The player sees the approved roll after movement, and the complete player
      gameplay suite covers landing, distance, identity and resources.
- [x] **Natural large d20 rolls** - Replace the scripted extended travel, three-axis
      spin, and late face snap with rigid-body physics. Read the real numbered
      facet, retain cocked dice for a manual reroll, and never substitute a random
      result for an unreadable physical die. Player dice counts now launch that
      many physical dice and use every settled face. Launch momentum carries the dice across the board
      and supports physical banks off its boundary walls.

---

## Character Sheets

- [x] **In-app character sheet window** - One movable/resizable non-modal
      window with per-creature tabs, two-way map/tab selection sync, retained
      layout on close, movable minimized title bar, and tab cleanup on token removal.
- [x] **Sheet-tab camera focus** - Center on the selected creature's current
      world position without zoom/orbit changes, including elevated creatures.
- [x] **Distinct duplicate creature names** - Number copies when duplicates are
      placed, update existing menu/sheet labels, and do not reuse deleted numbers
      during the current session.
- [x] **Movement settings and reachable tiles** - Per-creature distance allowance,
      live Walk/Run and Default/Drunk controls, cost-based perimeter outlines, click-only
      constrained routes, significant-climb costs, and no retargeting while moving.
- [x] **Partial wall climbing** - Double-cost vertical climbs, held mid-wall poses,
      smooth near-five-foot destinations, vertical wall outlines and fresh-action
      resumption. Walk climbs down; Run drops freely to lower ground. Live mode
      changes respect the original allowance, including partial wall stops.
- [x] **Authored downward climbing** - Import Mixamo's Climbing Down Wall FBX
      and play its downward cycle forward for controlled descents, retaining
      smooth loops, held poses, resumption, double cost and separate Run drops.
- [x] **Wall-aligned selection rings** - Keep hanging-creature markers flat
      against their wall face and centered behind the rendered body; follow
      pose/height changes and restore ground markers after dismounting.
- [x] **Stable ledge hangs** - Keep affordable upper-wall areas selectable and
      finish in a two-hand edge grip rather than a paused crouch. Preserve safe
      movement-budget cutoffs, smooth resumption, and separate platform goals.
- [x] **Board-boundary input** - Ignore empty off-board clicks instead of clamping
      them to an edge destination. Preserve selection, valid edge/body/wall hits,
      and bounded fallback behavior without reviving 3D misses through 2D input.
- [x] **First-pass character contents and local persistence** - Editable campaign-owned
      identity, abilities, HP, proficiencies, notes, saved-character library and
      validated JSON backups, independent of ephemeral scene tokens.
- [x] **Open SRD compendium and supported automation** - Local searchable
      item/spell data, drag/drop and Add alternatives, inventory/equip/attune,
      derived checks/AC/attacks, prepared casting, slot/concentration/rest tracking
      and shared dice rolls. Reference-only effects are labeled explicitly.
- [x] **Minimal campaign system and immutable edition** - Startup Create/Open
      picker, campaign-owned characters, explicit 2014/2024 rule implementations,
      source settings and acknowledged board saves before returning to the picker.
- [x] **Versioned local resource databases** - Separate edition IndexedDB catalogs,
      reviewed and hashed SRD/Open5e/5e-bits bundles, compatible opt-in sources,
      attribution/licenses, and preserved owned content when sources are disabled.
- [x] **Acknowledged persistent writes and scoped backups** - Atomic queued character
      commits with revision conflict checks before UI/economy success; same-edition
      character copies and scene-inclusive campaign backups excluding catalog databases.
- [x] **2024 equivalents for existing automation** - Casting/Action Surge rules,
      save-based Grapple/Shove, Monk Focus/dice/bonus options, Paladin features,
      level-1 casting and revised rest/resource recovery. New conditional effects
      remain manual rather than inheriting 2014 mechanics.
- [x] **Independent sidebar compendium** - Browse without opening a sheet; default
      Add to the selected creature or choose a saved character. Preserve drag/drop,
      show destination confirmations and route sheet Details to the same sidebar.
- [x] **Equipment mechanics in Details** - Show armor/shield AC, Dexterity handling,
      minimum Strength and Stealth disadvantage alongside price/weight.
- [x] **Unified visible movement controls** - One saved-character speed drives
      linked-token range; edit it on Core and show remaining movement as a Combat
      progress bar. Walk/Run buttons and Default/Drunk style remain shared.
      No duplicate allowance controls or changes to traversal rules.
- [x] **Compact health bar** - Current/max bar, separate temporary HP, Damage/Heal
      and direct-edit controls; temp absorption, healing caps, validation and
      persistence, without automatic target damage application.
- [x] **Prominent rest and Hit Dice controls** - Short/Long Rest beside health,
      optional one-die-at-a-time healing with Constitution, persistent remaining
      dice, 2014 partial long-rest recovery and shared dice/log integration.
- [x] **Rest-aware common class resources** - Manual usage counters with correct
      short/long/daily recovery, Pact Magic and optional Wizard Arcane Recovery;
      preserve usage in edition-scoped version-5 character and campaign backups.
- [x] **Campaign world autosave** - Restore terrain, explicit flora placements,
      stable creature IDs/names/character links, facing, camera and safe ground,
      wall or ledge checkpoints. Resume committed turn budgets and sheet/shared
      rolls without replaying unfinished work; report save failures/conflicts.
- [x] **Shared editable creature names** - Edit the standalone sheet title on
      every page; Enter/blur saves and Escape cancels. Only the title and tab show
      the name during normal play. Linked labels and persistence stay synchronized.
- [x] **Sheet settings disclosure** - A gear holds saved-character management,
      new/import/export/delete and Compendium controls outside the normal play view;
      operation failures remain visible when the settings panel is closed.
- [x] **Grouped character information and compact initiative** - One plain-text-style
      identity card across every sheet page; class is read-only, other values remain
      editable, and initiative is a smaller neighboring roll widget.
- [ ] **Character builder / charactermancer** - Determine class during guided
      character creation/progression and replace the temporary manual class dropdown
      currently in Core. Do not treat the overview card as class selection.
- [x] **Space-grab map panning** - Hold Space and left-drag in either camera view
      without moving/facing creatures or painting terrain; preserve text input,
      outside-canvas release, focus-loss cleanup and autosaved camera position.
- [x] **Unreflected facing drags** - Align snapped pointer direction with rendered
      humanoid forward and the existing movement convention in both camera views;
      use one shared conversion for navigation, short climbs/descents, vaults/hops,
      wall holds and cover. Test the loaded rigs in every cardinal direction,
      including turns into climbs, rather than only stored angles or east-facing poses.
- [ ] **Guided progression and broader 5e rules** - Level-up choices, class/subclass
      features, multiclassing, additional conditional item/spell mechanics and
      resource models beyond the first-pass supported calculations.
- [x] **Combat / Non-combat play views** - Keep Core editing; add streamlined
      checks/saves, compact play identity and relevant play options.
- [x] **Customizable play layouts and Favorites** - Separate saved layouts per
      character/page; drag sections/cards or use keyboard ordering, move favorites
      without duplicates, auto-save and confirmed page reset. Preserve turn rules,
      spent-option hiding, backup compatibility and ordinary checks/saves.
- [x] **Visible character history rail** - Fixed right-hand, independently
      scrolling uses/rolls with All / This turn filters, complete session history,
      older follow-ups, checks/saves/rest dice and safe async attribution.
- [x] **Manual-turn action economy** - Start/End Turn, enforced shared movement
      tied to the grid, manual/DM adjustment, actions/bonus/reactions/free options,
      Extra Attack continuation, disappearing spent options and recent-action rolls.
- [x] **Ability/action cost integration** - Use the existing common rest-aware
      counters for actual costs; add persistent custom entries, turn/rest/day
      resets, linked class pools and attack-count overrides without duplication.
- [ ] **Broader conditional combat features** - Active Rage/conditions, subclass
      features, two-weapon fighting, rituals and conditional spell/ability effects.
- [ ] **Targeting and automatic effect application** - Later stage; keep hit/save
      confirmation and damage/healing/effects manual during the initial combat pass.
- [ ] **Initiative/encounter ordering** - Later than the manual-turn combat pass.

---

## Visual Features

- [x] **Shared humanoid character catalog** - Add Knight D Pelegrini and Mutant
      with generic creation, palette/model registration and the existing movement rules.
- [x] **Shared visual action catalog** - Preserve existing emotes and add Wave,
      Sit, Take Cover, Jump, Punch, Hit Reaction, Dodge and Cast Spell, with lazy
      loading, in-place previews, safe completion and traversal protection.
- [x] **Actual-rig compatibility contracts** - Verify all registered appearances,
      including reduced fingers, split skins, grounded feet, ledge contacts,
      climbing costs, falls and late-action loading/removal.
- [x] **Rendered visual pass for imported humanoids** - Confirm live board,
      Knight and Mutant rendering in VS Code. Fix the capability preflight to
      accept working software-backed WebGL rather than reject performance caveats;
      retain genuine unsupported-browser detection and add regression coverage.
- [x] **Hardware-first graphics with explicit fallback** - Prefer a
      high-performance WebGL 2 GPU on the current device, not a particular GPU
      model. Verify the actual adapter, display graphics status, retain a visible
      software fallback, and recheck after context restoration. Chrome and the
      restarted VS Code browser were verified using hardware rendering.
- [x] **Eight-direction facing gesture** - Left-drag an idle creature to set a
      camera-aware snapped heading without moving it or breaking ordinary clicks.
- [x] **Natural dodge recovery and wall cover** - Animate the sidestep and return;
      require an adjacent eligible cover wall and align the crouched body to it.
- [x] **Height-aware traversal and narrow-obstacle vaults** - Smooth small steps,
      short mantles, controlled Walk descents, Run hops, physical-height fall
      selection and committed Run vaults with clear supported landings and
      complete movement-allowance checks.
- [x] **Generated tree trunk overhang** — Fit the actual trunk base to supported terrain and map bounds; shrink uniformly only as needed to 65% of normal size, otherwise skip. Allow canopy overhang.
- [x] **Tree overhang on manual placement** — New manual trees use the same
      trunk support and minimum-size rules as generated trees. Teal/amber/red
      brush cells show normal, reduced and blocked placement; existing saved
      trees are unchanged. Family buttons now select concrete tree models.
- [ ] **Tree orientation** — Investigate and fix incorrect tree orientation.
      New Pure Poly trees are upright and use deterministic saved
      rotations; this does not establish that all legacy trees are corrected.
- [ ] **Tree variety** — Review and fix tree variety across generated biomes.
      Manual family buttons now select actual variants rather than a fallback.
      The Pure Poly set adds fir, broadleaf, autumn birch and leafless
      trees to suitable forest, highland and dry-land biomes. New Dead and Petrified
      Forests no longer generate the crimson-leafed legacy model labeled bare;
      protected Dead Forest generation also mixes six purchased leafless shapes.
      Staged density increases across 36 sampled size/seed cases in the corrected
      forest and protected dry-land profiles. Petrified stone appearance and
      visual review remain open.
      Bamboo Thicket currently samples generic tall, columnar and small plants;
      the audited inventory contains no model named bamboo. Review a suitable
      model and its license before replacing that biome's scenery.
- [ ] **Unintended biome transparency** — Fix trees and other biome assets appearing transparent in biomes where they should remain opaque.
      Several exotic biomes currently have explicitly documented translucent
      appearances; confirm the intended exceptions before changing them.
- [ ] **Water visuals** — Add visual water rendering for water-type biome tiles
      (rivers, lakes, swamps). Could include animated surface, transparency/depth
      effects, shoreline blending, and reflections.
      Progress: rivers/lakes, coasts, oceans, reefs, wetlands, swamps, marshes and
      oases now render a translucent biome-coloured surface over below-zero
      terrain. It follows terrain edits and view opacity without changing physical
      movement, sight or picking; host/player and reopening are covered. Connected
      exterior water is projected through the same viewer sight mask, including
      rotated interiors. Animated waves, reflections and user visual acceptance
      remain open.
- [x] **Player-selectable physical dice set** - Uses ghosted's
      [RPG Dice Set](https://sketchfab.com/3d-models/rpg-dice-set-2498c370c56842f89fa3d7096c72ed56)
      as the player set, retaining CC BY 4 attribution and all seven
      authored color variants. Keep the existing gold physical d20 exclusively
      as the DM d20 rather than replacing its calibrated model, physics key or
      authoritative face mapping. The original source is preserved; its six dice
      are separated in a 15 KB runtime GLB, and the 2048px maps are optimized to
      512px. Every numbered face and convex collider is calibrated, player
      d4/d6/d8/d10/d12/d20 rolls are deterministic and replayed from the host,
      multiple dice are rendered and settled as a physical group, and the
      persisted color selection is used by panel and character rolls.
      Percentile d10 remains deferred. A separate DM-only **DM Gold d20** button
      retains the original large gold die.

---

## Local Hosting, Backups and Multiplayer

The local disk-backed host, automatic JSON backups and initial authenticated
player workspace are implemented and locally verified. Full player gameplay and
end-to-end internet deployment remain planned work; the player viewer is a
deliberately read-only first slice, not a complete multiplayer combat platform.

- [x] **Resolve cloud observer-subscription test timeouts** - The two
      [participant projection regressions](./tests/cloud/ParticipantProjection.test.js)
      used incomplete synthetic campaign heads after checkpoint validation was
      added. Valid heads and immediate error propagation now exercise independent
      observer progress, catch-up, backwards-history errors and privacy.

### Completed foundation

- [x] **Automatic disk-backed campaign saves** - Persist campaign metadata,
      saved characters, layouts and committed scene/combat state in SQLite
      outside browser profiles. Acknowledge saves only after disk commit; report
      host failures rather than silently reverting to browser-only storage.
- [x] **Cross-browser and restart durability** - Verify the same saved character
      and scene state after host-process restart and from a fresh Chrome profile.
      Chrome and VS Code use the same host data directory. Preserve stale-write
      checks and atomic character/resource-plus-scene commits.
- [x] **Saved characters independent of tokens** - Existing character records
      can be saved, loaded and imported without recreating them each time a
      creature is placed or a campaign reopens. Multiplayer assignments must
      reference these persistent character IDs, not temporary token instances.
- [ ] **Retrievable saved player-character roster** - Add a campaign-scoped
      Player Characters section alongside the creature/token menu. Browse saved
      characters, open their sheets and place/retrieve their sprites without
      recreating character records or resetting HP, equipment, resources or
      layouts. Distinguish an unplaced character from its existing scene token;
      focus an already placed character instead of silently duplicating it.
      The DM can manage the full roster; players can retrieve only assigned
      characters through permission-checked placement/transfer commands.
      Retain character IDs, assignments and appearances across save/load,
      reconnect and JSON backup/restore. Removing a sprite must not delete its
      saved character.
      Implemented slice: DM roster placement below the creature palette,
      saved-sheet reuse for unplaced records, existing-token Focus and guarded
      retrieval/removal preserve character resources, layouts and images.
      Focused validation reports 18 suites / 184 tests passing.
      Remaining: authoritative assigned-player placement/transfer commands and
      the full interactive player client. Placed token models and character
      portraits persist; an unknown unplaced record requires an explicit next
      sprite choice. That next-placement choice is session-local, not a saved
      off-board model preference across reload/export.
- [x] **Explicit migration from browser-only storage** - Offer non-destructive
      Copy to host and validated campaign import/export. Never overwrite browser
      originals or claim that switching storage recovers lost in-memory data.

### Implemented local session milestone

- [x] **Automatic JSON snapshots** - Back up changed campaigns
      every five minutes and retain 20 snapshots per campaign. Include source
      pins, characters, resources, layouts, terrain, creatures and committed
      combat/history; exclude bundled catalogs, authentication keys and invites.
      Verify scheduling, rotation, failure handling and complete snapshots through
      automated tests and the actual host.
- [x] **Backup controls and visible failures** - Add Back up now,
      backup history, JSON download and Restore as copy in the picker and active
      campaign controls. Flush active saves before a manual snapshot. Keep the
      primary save receipt separate from backup failures, surface automatic
      backup errors, and never overwrite the active campaign during restore.
- [x] **Host and player authentication** - Give the DM full
      campaign control. Use private, reusable, revocable player invitations and
      authenticated sessions rather than handing players the host's unrestricted
      save credential. Keep the host access key outside served files and source
      control. Verify sign-in, expiry, logout, reissue and revocation.
- [x] **Persistent character assignments** - Persist player
      identities and assignments across reconnection and host restart. Players
      may edit their assigned sheets, including manual stats, HP, notes and
      equipment; they must not recreate characters on each connection. Reject
      edits to unassigned characters, ownership escalation and campaign-wide
      replacement writes.
- [x] **Initial DM sharing controls (transitional access policy)** - Let the DM create/revoke
      invitations, assign existing saved characters and explicitly publish maps.
      New and restored campaign copies remain private until deliberately shared.
      Do not transmit unpublished map data or unassigned characters' private
      notes to players.
      Per-grid publication was the initial policy. S5a/S5c now replace individual
      internal-area publishing with character-driven location access; invitations
      and ownership are preserved.

### First working local multiplayer milestone

- [x] **Host login and player joining UI** - Provide usable host sign-in,
      invitation joining, returning-player identity and assigned-character
      selection. Reuse existing character-sheet editing rather than introduce
      temporary characters or a second saved-character model.
- [x] **Published player views** - Give players independent camera/map views of
      maps explicitly published by the DM. The initial player viewer is a
      read-only published-terrain/tactical-token view; label unsupported
      movement/combat controls clearly. Never expose the canonical private
      campaign snapshot as a shortcut.
      The initial publication policy has been replaced by S5a/S5c location access,
      not expanded into more per-area publication controls.
- [ ] **Role-aware top-down tactical view (in progress)** - Let the DM see all characters and
      creatures across the map, including interiors and stacked floors, with
      at-a-glance structure names and floor/level labels. Players see their own
      assigned character and only other characters/creatures within that
      character's line of sight, not visibility determined by their camera.
      Respect physical terrain, walls, floors, roofs and openings across connected
      maps. Enforce player visibility in authorized data delivery, not merely by
      hiding tokens already sent to the client. Verify DM/player views, overlapping
      floors and clear/blocked sight lines.
      DM overview markers/location labels and authoritative active-character
      physical sight filtering are being integrated with the multiplayer viewer.
      The player Active character selector now sends the real authorized observer
      token ID, preserves it while browsing maps/opening sheets, and clears stale
      markers/responses when the selected viewpoint changes or is revoked.
      Keep DM markers within the viewed map and directly above/below its physical
      footprint, not unrelated campaign locations. Provide a Focus link beside
      each marker to open its actual map and center its creature.
      Capture opaque tree/rock sight bounds; older maps need a DM reopen/save
      before publishing their physical sight. The location-wide connected layout
      is tracked separately above and may share this view's controls.
- [ ] **Extended vision and exploration effects** - Add fog of war and explored
      terrain memory, lighting/darkness and vision distances, darkvision,
      invisibility/see-invisibility, Blinded and special senses after physical
      line of sight. Keep these separate from camera position and enforce them
      in authorized player data, not only renderer visibility.
- [x] **Authenticated live updates** - Notify authorized clients when assigned
      character data or shared views change. Refresh at safe checkpoints,
      preserve local cameras and unfinished field edits, handle reconnects, and
      retain revision checks rather than silently overwrite another participant.
- [x] **Multi-client permission and persistence verification** - Test a DM and
      separate local player browsers, character save/load after reconnect,
      assignment changes, revocation, unpublished-map privacy and stale writes.
      Exercise automatic backup scheduling, retention, restore-as-copy and
      disk/host failure paths through the actual host and UI.

### Following multiplayer and hosting work

- [ ] **Location/access rollout and regression coverage** - Implement S5a-S5e
      above alongside the authoritative gameplay commands. Verify split-party
      isolation, explicit DM group transfers, character-following player views,
      switching assigned characters across locations, automatic connected-area
      access, DM access gates, reachable opening interactions and material-aware
      sight changes. Cover save/reopen, reconnect, JSON restore and concurrent
      requests without leaking unrelated locations or restoring stale resources.
- [ ] **Authoritative player gameplay commands** - Enable player token movement,
      turns, attacks and spell targeting only through permission-checked commands.
      Preserve range/cover and 2014/2024 rules, action economy, shared movement,
      falling/Prone/standing, flight, concentration and caster-turn durations.
      Sending unrestricted scene saves from player clients is not acceptable.
- [ ] **Movement presentation and reconnect recovery** - Synchronize approved
      routes/poses rather than animation frames, interpolate remote movement,
      and restore the latest acknowledged checkpoint without replaying or
      charging unfinished actions twice.
- [ ] **Secure internet access to the locally hosted game** - Test locally
      first, then configure an explicit HTTPS public origin through a trusted
      tunnel or reverse proxy. Preserve origin/host checks, secure session
      cookies, authenticated transport and DM-only administration. Keep the
      actual host loopback-bound; do not automatically open firewall ports,
      publish an unauthenticated endpoint or claim internet readiness without
      end-to-end verification.
- [ ] **Player-view parity and visibility rules** - Extend published views with
      full model/animation, placeable and spell-visual support as appropriate;
      add explicit fog-of-war/hidden-content rules rather than rely on hiding
      meshes whose private data was already sent. Include approved generated
      Village and Dungeon replacement visuals without sending hidden structures
      or revealing rooms, and verify map switching and save/reopen in both views.
- [ ] **Multiplayer performance budgets** - Reuse geometry and assets, bound
      snapshot/notification traffic and caches, and keep per-client graphics
      quality independent of authoritative gameplay. Revisit the performance
      audit before adding particle-heavy VFX.
      Eager humanoid clips now load in bounded parallel batches; lazy action clips
      remain on demand and failed loads remain retryable.
- [ ] **Cloud M5-06 - Ten-client full-session acceptance** - Run the
      representative hosted full-session rehearsal for overlapping valid moves,
      conflict rejection, facing/motion continuity, reconnects and animation
      smoothness. Require the owner’s final foreground visual acceptance.
- [ ] **Cloud M5-08 - Production deployment approval** - Obtain an explicit
      owner decision to deploy the approved cloud release. Engineering evidence
      alone does not authorize production. Review any protected-model licenses,
      Secret Manager/IAM configuration, public-account eligibility, abuse controls
      and spending limits before enabling them.
- [ ] **Cloud M5-09 - Deploy production without cutover** - Deploy the approved
      backend/frontend and retain the current-data isolation. Verify runtime
      identity, health, auth, origins, IAM, rollback package and monitoring.
- [ ] **Cloud M5-10 - Selected-data cutover approval** - Obtain the explicit
      owner decision selecting the campaigns/data to migrate. Preserve originals
      and prohibit unapproved bulk migration.
- [ ] **Cloud M5-11 - Execute cutover and first production session** - Run the
      approved restore/copy or cutover path, verify account ownership, characters,
      maps, assignments, backups and rollback, then complete the first monitored
      production session.

---

## Developer Tooling and Delivery

- [x] **Refresh stale regression fixtures** - Player movement expectations now
      include the existing dice color, and the terrain performance mesh stub
      supports logical-passage marker lookups. Both suites pass.
- [x] **Playwright browser acceptance tests** - Added a focused Playwright suite
      without replacing Jest. Cover real WebGL startup, DM/player sign-in,
      saving and recovery, EventSource reconnects, terrain editing, dice
      settlement, map traversal and independent participant views. Include
      multi-client coverage against the actual local host. The first isolated
      local-host smoke creates, renders and reopens a campaign with installed
      Chrome; CI retains failure traces. Expand scenarios incrementally rather
      than turning the full ten-client benchmark into a per-PR gate.
- [x] **Incremental type safety for shared contracts** - Started with `checkJs`
      and JSDoc or targeted TypeScript modules at persistence, protocol and
      command seams. Type scene, command, receipt and snapshot contracts first;
      do not require a whole-project rewrite or weaken runtime validation.
      The initial opt-in gate checks command, public-player, owner, and cloud
      protocol files. Their existing runtime validation remains authoritative.
- [ ] **Bundled frontend delivery with Vite** - Evaluate Vite as a development
      and production delivery tool while retaining vanilla JavaScript and the
      Three.js/cannon-es runtime. Bundle pinned dependencies instead of loading
      them from jsDelivr, provide local development refresh, hash production
      assets and wire the output into local and cloud hosting. Deferred: first
      prove self-hosted dependencies against the existing release verifier and
      rollback package. Vite is not expected to fix gameplay-frame latency.
- [x] **Explicit runtime and tooling versions** - Declared the supported Node and
      npm versions in package metadata and a local version file. Keep tooling
      upgrades such as ESLint or Babel separate, compatibility-checked changes
      rather than coupling them to unrelated feature work. CI now reads Node from
      `.nvmrc`, while `packageManager` and `engines` pin npm and the supported Node
      major.

---

## Deferred Platform Work

- Desktop packaging and managed cloud hosting remain deferred. The current
  runtime uses a local disk-backed host; the active multiplayer rollout is
  tracked above. A later desktop package should reuse the same host/session
  modules rather than require a separate game-state implementation.
- Procedural biome shader painting remains a future enhancement under ADR-0001.
