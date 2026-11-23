Items that need correction

> Archived from `docs/proposals/Items that need correction.md` on 2026-11-20.
> This is owner-request history; active follow-up belongs in `TODO.md`.

> Archived correction intake. `TODO.md` is now the canonical active backlog.
> Completed notes remain here as owner-request history; new work should be added
> to `TODO.md`, not maintained as a separate unchecked list.

- [x] saving every movement of the map. only signiifcant changes should be saved. view angle of the map does not need to be saved. as it can be easily re adjusted if lost. Only meaningful changes should be saved. saving should also occur in the background, it should not interrupt gameplay or have nayu visual indicator for users. Fixed and verified; camera-only changes do not create scene revisions, while routine save success stays nonmodal.

- [x] was unable to generate castle biome while cavern after cavern biome, had to generate an intermediary like swamp before castle was able to generate. Fixed by reconciling completed cavern/building topology before final validation.

- [x] I want to be able to zoom in closer. curently on large maps i feel like I cant zoom in enough. on that note, I want players views to be locked to thier creature. They should not be able to raom the map like the DM can. I will need to determine how closely i want them locked. they should be able to zoom in and out to an extent, and rotate around their character, but thier view should be slaved to their character in the center fo the screen like when the DM uses the focus function (if they have multiple assigned, which ever is secleted, either via sprite selection or character sheet selection ). Fixed: player cameras support close zoom up to `6x`, cannot pan or area-browse away from the active observer, follow the creature every rendered frame, and switch observers when an assigned sprite or sheet is selected.

- [x] the following notes made me realize the biomes have some significant issues. currently all biomes generate at the current size of the grid. but maybe when a biome is generate we should have a pop out that asks the user for further information based on the biome before generating. Implemented as 13 biome families with a variant/terrain review, family-specific options, persisted resolved recipes and legacy biome-key compatibility.

castle/fortress biome generation:

- [x] walls are not wsquare with each toerh, doors on corner turrnets could be rotated in to allow walla to connect at right angles. Fixed: generated curtain walls now use rectangular cardinal geometry, bastion entrances remain oriented toward the bailey, and every corner-wall endpoint is physically contained by its tower footprint instead of being detached.
- [x] castle generation is still overly formulaic, every layout looks essential the same. Fixed: the citadel, bailey and palace families now produce distinct three-, six- and seven-link attached-building graphs rather than sharing one seven-link plan.
- [x] castle generation does not conform to grid size beyond a certain size. castles could be much larger and more interesting. could also start to have buildings around a castle if enough space is available. Fixed: large castle sites expand their curtain court up to 300 ft and add four outer-ward buildings outside the walls; default and smaller maps retain their existing compact scale.
- [x] window placement on castles still feels weird. now isntead of being every sinlge availbel window it looks like they were randomly punched out. The windows should look itentional, on things like castles windows are generally symetric, exceptions being things like towers with spiral stiracases spanig the height of the tower. Fixed: new castle building layouts use a version-3 symmetric fortress rhythm, with mirrored opposite façades and vertically aligned slots; legacy layouts are preserved, while turrets retain their separate inward/stair-aware variation.

Castle player view:

- [x] Castle buildings are missing roofs in the player test session. Verify that roofs render when they should be visible. Fixed with roof-specific player display masking; generated castle regressions and wall/room privacy cases pass.

underground:

- [x] placeabales appeart to float above the ground. Fixed: placeable models are anchored from their measured basal support bound, including below-zero cavern floors and later terrain-height resync.
- [x] crystal spires looks insane, like al the cryustal formtaions are just clustered in. the previous crystal spires was much more appealing. Fixed: Crystal Spires now uses sparse deterministic placement (`0.015` density, Manhattan spacing `5`), keeps at least one large rock landmark for the fixed-seed regression, and preserves the no-procedural-formation cave contract.
- [x] all underground biomes look the same. one entrance, one exit. alwats adjacent walls. no real variation similar to castles. Fixed: cavern recipe v6 gives each underground biome a deterministic two- or three-exit profile and a distinct room/route elevation template; recipe v5 remains reconstructible for existing saves.

- [x] character radial menus shouild only pop up when right clicking a sprite. players should only be able to produce radial menus for characters assigned to them. currently players can summon the DMs sprites characeter sheets, though they cannot act on them, but they should not be able to summon them at all. Verified: left-click selects without opening a radial, right-click captures only authorized assigned creatures, stale UI events are rejected, and assignment revocation blocks commands from an already-open menu.

additional dice models

- Canonical active item: `TODO.md` → “Additional physical dice models”.
- Deferred until the user downloads/provides the remaining approved assets.
