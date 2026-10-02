VERIFIED WITH CAVEATS

# Terrace House simulation pass

Implemented the playable requirements in `required_features.md` using existing engine/screens/adapters; no new dependencies. Preserved pre-existing local work. New games default to an open-ended season in a two-story Tel Aviv house.

| Requirement | Result |
|---|---|
| NPC durations/hourly life | Activity deadlines, 40-minute showers, 90-minute naps, 20-minute snacks, hourly interactions/gossip; deterministic, chunk-independent clock advancement. |
| Travel/late night | Round-trip journey/activity fits remaining minutes and arrival opening hours; 23:00–02:00 block, skip/sleep and daily timeline. |
| Season | Creator fixed/open-ended choice; after episode 3, announce next full episode as finale; confessions, epilogues and prediction resolution. |
| Careers | Two arcs per seven career families; player contracts/workplace beats, raises, dismissal, offers, coworker visits and stress. |
| Generated housemates | Validated field fallback, distinctness retry, appearance text, saved/logged snapshots and deterministic replay. Mock stays seeded. |
| Appearance | Free-text mapping, sanitized prompts, portrait-derived sprite colors; central-region sampling rather than segmentation. Sprite sheets remain the explicitly later upgrade. |
| Tel Aviv | Local cast/recurring people, places, Sunday–Thursday work/Friday half-days, shekels, foods, holidays and sharav; stable internal ids. |
| Kashrut/diet/Shabbat | Strict/style/none, vegetarian/vegan, meat/dairy/parve, separate pans/marked shelf, declined food/trust, state-triggered kitchen conversations. Observers stop work/cook/car/phone at boundary; phone scenes close before it. |
| House | Ground-floor living/kitchen/entrance/small bathroom/backyard; upstairs bedrooms/private balconies/main bathroom; animated stair traversal/doors and server-side invitation checks. Reduced motion skips traversal. No rooftop. |
| Independent social life | Approaches, shared calendar, kept/broken plans, barks, taste-aware gifts, coffee/notes, recurring visitors and upkeep. Busy workers/nappers/shower users cannot be recruited into house scenes. |
| Visible life | Clutter/fridge stock, clock lighting/lamps, synthesized ambience and world-minute phone notifications. |
| Feed | Photo/story cards with persisted appearance/location snapshots and likes/public knowledge. A shared photo does not establish romance. |
| Weather/routines | Forecast, rain-cancelled outdoor plans, heatwave mood and actually observed habits in bible. |
| Dialogue models | Separate speaking-model setting, independent fallback, smoke/content checks and reproducible 20-scene evaluation script. |
| Artwork | 84 valid PNGs: 79 new ComfyUI images and five retained panel avatars; all 83 manifest keys resolve. Room viewpoints are shared by live/prebaked requests. Details: [docs/ARTWORK.md](docs/ARTWORK.md). |

The fun direction follows ordinary shared life: work, meals, dating, awkward conversations and voluntary departures. The missing game layer was follow-through: anticipate a plan, choose how to spend limited time, learn a routine, remember a dietary preference, and see trust/career consequences later. Quiet friendship and staying single remain valid. These are design choices, not measured enjoyment. Research and sources: [docs/ROLEPLAY.md](docs/ROLEPLAY.md).

## Verification

- Typecheck, lint and production build passed.
- Final real-service smoke passed: eight of eight dialogue beats used the LLM, five-voice panel commentary completed, and ComfyUI generated a fresh portrait that was visually inspected.
- Corrected real structured-generation probe passed all ten checks, including fresh persona content, requested appearance and exact saved replay. Report: `logs/generation-probe-1790928388028.json`.
- Full run: 115 tests passed, including 200 idle-player seasons, 30 active-player seasons, value/knowledge/source-chain invariants and replay. Report: `logs/verification-final-all.json`. Subsequent live-probe prompt fixes passed 29 focused server/persona tests; the simulation engine was unchanged.
- Seven Edge browser flows passed: full episode/intermissions, typed dialogue, graduation/replacement, contract, creator appearance/diet/season choices, stairs/privacy/plans/social photos. The stair flow also exercises normal animation and samples the canvas to verify doors open and close.
- Final availability/car/Shabbat refinements: focused engine/server and seven browser flows passed. The full 200-seed run passes the unchanged romance-frequency bounds.
- Judge reproduced privacy, impossible-plan cancellation, stale approaches, busy-housemate guards, sleep/finale progression and chunk-independent time. Existing simulation thresholds preserved; currency/calendar/map assertions follow requested setting and stronger round-trip validation.
- No application dependencies, deployments, commits or pushes added. A local 8B Stheno evaluation model was imported; the configured Gemma default is unchanged.

## Live evaluation and limits

- Artwork is complete and visually inspected: 79 new images plus five retained panel avatars, 84 valid/distinct PNGs and all 83 manifest keys resolving. This is the default clear-weather set; custom cast and additional weather use runtime generation. See [docs/ARTWORK.md](docs/ARTWORK.md).
- Gemma and Stheno each completed the same 20 seeded scenes. Gemma had the better mechanical pass rate (90.55% vs 87.40%); Stheno was faster but invented four player lines and more narration. Gemma remains the default. Five later single-answer Gemma probes acknowledged refusals after fixing competing scripted topics. Reports and semantic review: [docs/ROLEPLAY.md](docs/ROLEPLAY.md).
- Both text models ran with ComfyUI open and its retained/offloaded cache, without GPU failures. This does not prove simultaneous full image-model GPU residency.
- Holiday dates are game approximations; Shabbat uses Friday/Saturday 18:00. Simulation advances with game minutes rather than wall-clock server pushes. Feed photos reuse procedural freeze frames; visitors reuse recurring outsiders.

INTENT: code advances NPC life once per block; the task expects people and plans to change during the block; `required_features.md` specifies timed schedules, hourly interactions, and travel that fits the remaining time.

TWINS: searched incomplete busy-housemate filters - found 3 other sites: `loop.ts` (2), `living.ts` (1). Extended naps/showers guards, checked visitors/greeters and preserved workplace arc availability.
