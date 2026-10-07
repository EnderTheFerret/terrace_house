# House and pool upgrade

User intent: bring the playable house closer to the generated interior references, with furniture proportional to people, six dining seats, six sofa places, atmospheric lighting/weather, and group swimming with the existing wardrobe pipeline.

Scope: house content/layout and canvas renderer; House controls; sprite occasion selection; shared pool state/actions/scheduling; server image wardrobe requests; focused tests and asset credits. Keep the authored navigable map rather than using a room illustration as collision geometry.

Verification: native-scale floor renders, day/night/weather review, room/hotspot and seat path checks, group entry/leave and validation tests, swimwear fallback/generation requests, browser pool flow, TypeScript/build/lint.

Checklist:
- [x] Download and integrate licensed pixel furniture with source credits.
- [x] Correct furniture/person proportions and compose six-seat dining/lounge areas.
- [x] Match reference room materials, storage, beds and warm light.
- [x] Animate water and render weather across exterior rooms.
- [x] Add group swimming state, controls, water poses and wardrobe generation.
- [x] Verify engine, renderer, browser flow and surrounding build.

Asset research: 0_mem0ry's [Midcentury Modern Furniture Set](https://0-mem0ry.itch.io/midcentury-modern-furniture-set-free) includes directional chairs, beds, sofas, storage and plants. The creator allows commercial/noncommercial game use and modification, prohibits resale/redistribution as an asset pack. Used here as embedded game furniture; credit 0_mem0ry. Do not republish this sheet as a standalone asset download. The original sheet was downloaded through the creator's free download flow on 3 October 2026.

Also considered: iletzy's [Pixel Couches](https://opengameart.org/content/pixel-couches), CC0; Kenney's [Roguelike Indoor Pack](https://opengameart.org/content/roguelike-indoor-pack), CC0. Existing ComfyUI furniture remains appropriate for kitchen appliances, pool equipment and reference-specific decorations. Third-party art is not sent to ComfyUI.

The replacement layout is authored in `scripts/assets/rebuild-house.mjs`: a compact irregular footprint, fitted L-shaped kitchen, six directional dining chairs, two facing three-person sofas, a furnished genkan, three beds per bedroom, storage at walls, and defined walking aisles. Furniture was refitted from existing full-size ComfyUI artwork with `scripts/assets/refit-house.py`, preserving its proportions. Daytime window light, warm room-clipped lamps, water shimmer, rain and snow are rendered separately from collision geometry.

Furnishing pass (October 2026), same rooms and doors: the upstairs stairwell now sits directly over the flight below (the old see-through void is gone) and both flights are drawn as oak stairs; the lounge sofa faces the TV with a side sofa and armchair; every room gained storage, rugs, plants and fixtures. Side sofas, armchairs, credenzas, round rugs, shelves and the palm are further 0_mem0ry sheet pieces drawn unstretched (`SHEET` in `house.ts`). Toilet, towel ladder, laundry basket, pantry, vanity, grill, bistro table, patio set and pool towels are new ComfyUI bakes (`house_assets.py`). Shading: stepped contact shadows under furniture and occlusion along walls.

Pool controls support entering alone, adding housemates up to six total, and leaving together. Swimming has individual persistent state and selects beach wardrobe for sprites, portraits and conversation participants. Dry visitors retain their ordinary clothes. Wardrobe choices include bikinis, one-pieces and trunks; leaving restores the normal occasion. Busy or absent residents cannot be invited.

Verification record: 61 focused engine, HTTP/image and layout tests passed; three browser flows passed (creator, stairs/doors/private balconies/plans, and pool entry → three swimmers → six swimmers → everyone out). Production build, TypeScript, ESLint and diff whitespace checks passed. Reviewed both floors plus day/night/rain/snow renders. The independent review found and helped resolve floor ghosts, sleeper alignment, a standing spot inside the whiteboard, and swimming onto the pool rim. A real ComfyUI run generated Sora's white-bikini portrait and 4×4 sprite sheet; other cast/outfit combinations generate on demand rather than being exhaustively sampled here. Browser tests use isolated mock sessions; the real image pipeline was checked separately.

Retained review artifacts: `logs/house-upgrade/rebuild/` (six lighting/layout previews), `logs/house-upgrade/pool-full.png` (browser proof), and `logs/house-upgrade/swimwear/` (real ComfyUI outputs). These are intentional local review artifacts in the ignored logs directory.

INTENT: the game currently draws undersized furniture and offers a decorative pool; your request calls for a furnished six-person house and group swimming; the README describes a top-down share-house life sim with adult characters and ComfyUI artwork.

AUTH: user said "good pixel art furniture assets we can download and use".

TWINS: searched `taken.get(String(activity))`, `poolSeat(swimmers++)`, global participant outfit selection, base-canvas drawing and sleep offsets — no other faulty seat-assignment or swim-occasion sites remain; Scene, shared wardrobe and server image requests now select clothes per participant. CityMap's other base-canvas draw uses its own fully painted map.
