# Progress

| Milestone | Status | Notes |
|---|---|---|
| M1 Foundation | ✅ | npm workspaces, strict TS, ESLint/Prettier, zod model, mulberry32, mock adapters, `/api/health`, `dev:mock` title screen |
| M2 Engine & content | ✅ | relationships, director scoring, 87 event templates (30 arc-only, 11 domestic, 7 calendar, 11 system), slot/episode loop, leave rules, memory compaction; 200-seed sim passes |
| M2b Living world | ✅ | personas, default cast + generator, agent tick, beliefs/knowledge/gossip, arcs, house, social, outside cast, calendar, replacements, render filter + budget scheduler; all §5.5P tests pass |
| M3 Creator/House/Scenes/Phone | ✅ | 5-step creator with live portraits, top-down house, two-stage dialogue streamed over SSE, chat-app panel; a full episode is played in a server test and by hand in the browser |
| M4 City | ✅ | canvas map from `city.json`, Dijkstra travel time, hours, money, shared car, shifts, location backgrounds; exploration tests pass |
| M5 Cooking | ✅ | chop/boil/sauté/season/plate, DAG scheduling, shared time budget, reception formula, co-op, practice mode, 9 recipes; scoring + property tests pass |
| M6 Studio | ✅ | 5 panelists with bias profiles, commentary pipeline, predictions lifecycle with callbacks, freeze-frames, captions, episode cards, relationship board; commentary validates for 100% of mock outputs |
| M7 Real backends | ✅ | `OllamaClient` (streaming + JSON schema), `ComfyBackend` (API workflow + mapping, ws progress), queue, cache, fallbacks; `npm run smoke` passes against gemma4:12b + Qwen-Image; failing-adapter tests pass |
| M8 Polish & docs | ✅ | settings, keyboard/a11y pass, README, `docs/COMFYUI.md`, `DECISIONS.md`, prebaked pixel-art assets, replay script |

## Log
- **M1–M2b** — shared engine and content. Bug found by the 200-seed sweep and fixed: the season could end early when
  three housemates were marked to leave on the same night (before replacements).
- **M3–M6** — pixel-art UI (house, scenes, map, cooking, phone, board, bible, fridge, saves, settings, summary, debug).
  Browser playtest fixed: typewriter reveal double-advanced under React StrictMode; DOM name labels didn't refresh;
  asset manifest only loaded at server start (now hot-reloads).
- **M7** — smoke test against the real services: beat sheet, 8/8 LLM lines (streamed), 5-panelist commentary, one
  ComfyUI image. Real-mode playtest fixes: the LLM sometimes wrote extra player lines (now reassigned to NPCs, the
  player only speaks at their choice beat); intents now carry an explicit guide; freeze-frames only on freeze-worthy
  scenes; talking to someone in a bedroom/bathroom happens in the living room; model warm-up at server start.
- **M8** — 69 prebaked assets generated with the user's ComfyUI (Qwen-Image + Lightning), pixelated and quantized.
- **M9 show format + gaps** — studio intermissions (mid-episode and end, LLM or templates); departures follow the show (announcement to the house, one last day, last confession / leaving together, farewell next morning); welcome party for newcomers; part-time contracts with fixed weekly shifts; shaded top-down sprites with activity emotes; Qwen-Image-Edit reference workflow for consistent faces in freeze-frames (verified on the user's ComfyUI: one image, 52 s incl. model load); image queue holds and ComfyUI unloads its models while dialogue streams; Playwright E2E suite (3 tests). Bug found on the way: ComfyBackend polled `/history` in a tight loop once the websocket failed (could exhaust memory); now sleeps between polls.

- **M10 talk & turnover** — type your own words in scenes and on the phone (housemates answer what you said, remember it); graduate alone or with your partner and continue as a new character; replacements for every departure; 77-job catalogue with real shift schedules; 24 personality archetypes + type presets in the creator; goal-complete graduations; endless season option. Tests: 6 engine tests (intent reading, replies, memories/threads, graduation → new player, partner validation, replacements), a session test that types, texts, graduates, moves in and replays exactly, and 2 new E2E tests.

## Test inventory (`npm test`, `npm run test:e2e`)
- shared: rng, content, calendar, clamping, memory compaction, director scoring, leave rules, cast generator, purity,
  predictions, cooking (scores in [0,1], monotone, DAG, co-op, reception), city (Dijkstra, hours, money, car, job contracts), mock
  schema validity, commentary 100% valid, voice distinctness + catchphrase caps, appearance-prompt safety, 200-seed idle
  sweep (ranges, knowledge invariant, gossip source chains, NPC romance fraction, meaningful events/departures/arcs,
  schema validity), 30-seed active sweep, determinism.
- server: prompt budgets/order/knowledge, intermission (template fallback, host opens/closes, state untouched), reference workflow upload + patch, queue hold during dialogue, line parsing, structured retry/fallback/budget, Ollama request shape +
  NDJSON streaming, Comfy workflow patching, image queue priority/fallback/cancel, full episode with Ollama + ComfyUI
  down, deterministic replay, save/load + migration, HTTP validation (age ≥ 20 enforced).

## Known gaps
- Real mode on one GPU: dialogue now gets the card (queue hold + ComfyUI `/free`), but the next image pays a model
  reload. `gemma4:12b` intermissions take ~9–15 s; a 4B model is faster still.
- Reference faces: one reference per image (the lead); the second person in a two-shot relies on tag order.
  Portraits/locations do not use references (they are the references).
- E2E covers the main loop, intermissions and contracts in mock mode only; real-mode UI is still checked by hand.