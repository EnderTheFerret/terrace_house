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

## Test inventory (`npm test`)
- shared: rng, content, calendar, clamping, memory compaction, director scoring, leave rules, cast generator, purity,
  predictions, cooking (scores in [0,1], monotone, DAG, co-op, reception), city (Dijkstra, hours, money, car), mock
  schema validity, commentary 100% valid, voice distinctness + catchphrase caps, appearance-prompt safety, 200-seed idle
  sweep (ranges, knowledge invariant, gossip source chains, NPC romance fraction, meaningful events/departures/arcs,
  schema validity), 30-seed active sweep, determinism.
- server: prompt budgets/order/knowledge, line parsing, structured retry/fallback/budget, Ollama request shape +
  NDJSON streaming, Comfy workflow patching, image queue priority/fallback/cancel, full episode with Ollama + ComfyUI
  down, deterministic replay, save/load + migration, HTTP validation (age ≥ 20 enforced).

## Known gaps
- Real-mode latency on one GPU shared with ComfyUI is high (tens of seconds for the first lines of a scene).
- Character consistency for live-generated images relies on fixed seeds and tag order (no IP-Adapter).
- No automated browser (E2E) tests; UI verified by hand in mock and real mode.
- Part-time jobs are drop-in shifts rather than contracts with a fixed weekly schedule.
