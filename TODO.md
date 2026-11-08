# TavernTable — TODO

> Current backlog. Setup and the last verified test baseline are in
> [README.md](./README.md). Historical audits are not the current task list.
> Current platform work:
> [local hosting, JSON backups and multiplayer](#local-hosting-backups-and-multiplayer).
> Next construction priorities:
> [settlements, natural caves and campaign locations](#settlements-natural-caves-and-campaign-locations).

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
      cancel safely. Undo/Redo restores whole gestures and Reset Terrain, with a
      100-edit session history and explicit load/resize/generation resets.

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
      User visual signoff and combined authenticated host-command crossing
      remain open; passing geometry tests are not artistic acceptance.
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
      Prerequisite progress: S4b uses real excavated approaches/halls within a
      painted mountain heightfield. The general Cavern and other natural-cave biome recipes
      still need this separate redesign; they are not marked complete.

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
- [ ] **S5d - DM-controlled area access locks** - Let the DM lock/unlock access
      to internal areas independently of physical door/window state. Players
      cannot bypass an access restriction by changing camera, browsed area or
      client requests. The DM can remove the restriction whenever appropriate.
      Keep access restrictions separate from physical locks, sight occlusion and
      deferred fog-of-war/exploration rules.
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
      preserve user-authored maps and occupied structures. Verify each milestone
      with deterministic tests, visual inspection and save/reopen before marking
      it complete.
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

---

## Mannequin Movement Polish

Completed items have regression coverage and actual-FBX browser replays described
in [HANDOFF.md](./HANDOFF.md). Broader or unreproduced reports remain open.

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
- [ ] **Walk animation not playing for short paths** — Loaded-clip short walking paths now replay correctly. Reproduce the original cold-loading slide before declaring this report resolved.

---

## Map View and Menus

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

- [x] **Natural large d20 rolls** - Replace the scripted extended travel, three-axis
      spin, and late face snap with rigid-body physics. Read the real numbered
      facet, retain cocked dice for a manual reroll, and never substitute a random
      result for an unreadable physical die. Other dice types and multiple-die
      rolls are unchanged. Launch momentum now carries the die across the board
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
- [ ] **Tree overhang on manual placement** — Manual placement and preview do not yet apply the generated-tree support policy.
- [ ] **Tree orientation** — Investigate and fix incorrect tree orientation.
- [ ] **Tree variety** — Review and fix tree variety across generated biomes.
- [ ] **Unintended biome transparency** — Fix trees and other biome assets appearing transparent in biomes where they should remain opaque.
- [ ] **Water visuals** — Add visual water rendering for water-type biome tiles (rivers, lakes, swamps). Could include animated surface, transparency/depth effects, shoreline blending, and reflections.

---

## Local Hosting, Backups and Multiplayer

The local disk-backed host, automatic JSON backups and initial authenticated
player workspace are implemented and locally verified. Full player gameplay and
end-to-end internet deployment remain planned work; the player viewer is a
deliberately read-only first slice, not a complete multiplayer combat platform.

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
      before publishing their physical sight.
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
      meshes whose private data was already sent.
- [ ] **Multiplayer performance budgets** - Reuse geometry and assets, bound
      snapshot/notification traffic and caches, and keep per-client graphics
      quality independent of authoritative gameplay. Revisit the performance
      audit before adding particle-heavy VFX.

---

## Deferred Platform Work

- Desktop packaging and managed cloud hosting remain deferred. The current
  runtime uses a local disk-backed host; the active multiplayer rollout is
  tracked above. A later desktop package should reuse the same host/session
  modules rather than require a separate game-state implementation.
- Procedural biome shader painting remains a future enhancement under ADR-0001.
