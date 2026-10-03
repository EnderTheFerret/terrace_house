# Session handoff

Updated: 2026-10-03 afternoon (Asia/Jerusalem). **Nothing is committed.** All work is in the working tree (see "Files" near the end).

## One model, recall, group-image style, PC freezes (2026-10-03 afternoon)

- **One dialogue model: `gemma4:12b`** for everything (`OLLAMA_MODEL_LINES` empty). 20-scene benchmark (`logs/roleplay-benchmark-1791015374495.json`): 97.7% voice/content pass, 0 player lines, 0 wrong speakers, ~3 s per scene once loaded. Mag-Mell 12B (downloaded, `hf.co/mradermacher/MN-12B-Mag-Mell-R1-i1-GGUF:Q4_K_M`) lost: 59% pass, 26 missing lines, two Ollama 500s. It can be removed with `ollama rm`.
- **Recall by meaning is on** (`nomic-embed-text` pulled). Live probe: paraphrases match the right memory at ~0.64, unrelated memories score 0.32–0.49, so `RECALL_MIN` went 0.25 → 0.55. nomic's `search_query:` prefixes made the margin worse, so they are not used.
- **Group images draw the room in pixel art:** `freezeRequest` now takes `fileOf(req)` and adds the room's prebaked background as the last reference ("redrawn in the pixel art style and palette of image N"); `group_ref` has a 7th slot. Live sample: `cache/probe/cf-351914934e49c710eeb154a8.png`, 62–70 s, faces kept.
- **GPU turn-taking:** every LLM call goes through `TextActivity.wrap(client, gpu)` → `ImageQueue.holdClear()`. It interrupts background art (priority < `currentScene`; freeze-frames included), waits for a running player-facing image (≤ 2 min) and for ComfyUI `/free`, then runs. Before this, calls outside scene streams ran beside ComfyUI and took 20–80 s.
- **PC freezes = RAM, not VRAM.** This ComfyUI build stages whole models in pinned RAM (19.5 GB + 8.9 GB for one Qwen job), which Windows cannot page, so everything else was paged out (free RAM 0, 700k pages/s). `run_nvidia_gpu.bat` now adds `--cache-ram 6 --reserve-vram 1 --fast-disk`. Since then: lowest free RAM 8.4 GB, at most 15 page writes/s. Ollama also gets `use_mmap: true`.
- **Edit model stays fp8:** the Q4_K_M GGUF fits the card but runs 57–73 s per edit vs ~40 s for fp8 (Blackwell does fp8 natively).
- **Real episode (`logs/real-episode-1791021502261.md`):** 100% LLM lines, sprite gate 114 s, tomorrow's sheets 4/4, median scene 80 s. The driver answers instantly, so a queued outfit/sprite (~40 s) slips in between segments and the next call waits for it. LLM work alone is ~35 s per scene (7 s Gemma reload + calls). A human's reading time should absorb the image wait; confirm in the full-season playthrough.
- "Failed" (red) prompts in the ComfyUI window are interrupted jobs; the server requeues them.
- Checks: typecheck, lint, **148/148 unit tests** (`SIM_SEEDS=10`), after all edits. No browser test run.

## Start here (morning)

**State:** every item in [required_features.md](required_features.md) is built except the two dropped by request (S5 character cards, S8 TTS). [features.md](features.md) describes it all ("Added in the October 2–3, 2026 updates").

**Verified at the end of the 2026-10-03 session:**
- typecheck, lint, **147/147 unit tests** (`SIM_SEEDS=10`), **16/16 browser tests** (Edge, mock mode);
- live checks: real-mode episode runs, a ComfyUI group image, furniture and background bakes.
- The 200-seed sim was not run.

**Next, in order** (details in required_features.md → "Still open"):
1. **Full-season playthrough** in the browser (the only P1 left).
2. **One dialogue model.** Scenes after an image job take about 25 s instead of 11 s while two models reload. Measure with `npx tsx scripts/real-episode.ts 4`.
3. **Recall by meaning:** pull `nomic-embed-text` (~270 MB, ask first) to switch on the embedding path.
4. **Group-image backgrounds** are photographic; consider a style LoRA.

**Run it:**
- `npm run dev` (real) or `npm run dev:mock`;
- tests: `npm test`, `npx playwright test`;
- house previews: `npx tsx scripts/assets/render-house.ts <dir>` (needs Vite on :5173).

**Gotchas that cost time this session:**
- Every dev-server restart re-warms Ollama, which slows ComfyUI 20–50×. The bake scripts and the server now unload it before images.
- PowerShell double-quoted `.Replace` silently eats JS `${...}`. Use the Edit tool or single-quoted here-strings (also saved to memory).
- Never abort an in-flight fetch to ComfyUI (Node 24 undici crash). Use `/interrupt`.
- The "fetch failed" bursts in `logs/llm-failures.jsonl` come from the unit tests' `DownLlm`, not real outages.
- `.claude/launch.json` has a `shared-roof-mock-preview` config: a mock server on :8795 with a throwaway data dir, safe next to your real save.

## Remaining-features batch (2026-10-03)

Everything in required_features.md except S5 (character cards) and S8 (TTS).
- **Trips come up on their own:**
  - On Thursday evening, a housemate who likes you texts an invitation; Friday's panel shows it pre-filled.
  - On Friday, if you don't go, a close pair or couple may go without you. Their actions are locked to the trip spot (`away_<id>` flags) until the Saturday return scene.
  - Housemates who can't afford a trip pick up extra shifts (+1 budget for about a week).
  - The panel offers a room-sharing choice (a romance fact plus attraction), marks Shabbat observers, and is available from Friday **morning**.
  - Sleeping housemates can be invited.
  - Verified by `e2e/trip.spec.ts`: Friday panel, drive and night scenes, Saturday.
- **#14 Feed photos and S6 phone photos:**
  - `/api/image/feed/:id` and `/api/image/selfie/:from/:tick` use the group workflow with everyone's portrait.
  - The phone shows the procedural picture until the real one is ready.
  - A selfie comes back when you ask for a "pic/photo/selfie" in a thread.
  - Trip-goers post from the trip and text a close friend a photo.
- **S6 shot descriptions:** `Generator.shot` stages each freeze-frame in one LLM line. Trip destinations have prebaked backgrounds (`build-jobs.ts` + `comfy_gen.py`).
- **S7 without a download:** keyword emotion read (`feltEmotion` / `reactionTo` in `talk.ts`). Typed lines set the listener's face, e.g. a compliment makes them shy.
- **S1:**
  - **Memory archive:** `compactAll` archives instead of deleting (up to 300 per character); keyword recall searches the archive.
  - **Lorebook:** places, outsiders and trip spots enter the prompt only when mentioned.
  - **Embeddings:** `llm/recall.ts` uses Ollama `/api/embed` with vectors cached in SQLite (`embeddings` table), scored as cosine × (salience × recency, softened), top 3, at least 0.25. **Off until `nomic-embed-text` is pulled** (`OLLAMA_EMBED_MODEL`).
  - **Timed effects:** recalled memories are sticky for the scene, then cool down for 15 ticks.
- **Spec gaps closed:**
  - #4 "watch the episode" replay viewer (`/api/broadcast`; scene logs now carry `episode`/`title`/`participants`);
  - #5 `class-day` / `exam-day` scenes and exam weeks (every 6th episode; a missed exam costs more);
  - #10 outsiders written into persona cards.
- **Found by the real-mode check (`scripts/real-episode.ts`):** a block-wide LLM budget of 6 calls ran dry on the first scene, so every later scene in that block was templated (14% LLM lines). The budget is now per scene (`LLM_CALLS_PER_SCENE`, default 8).
- **One-GPU scheduling, measured with `npx tsx scripts/real-episode.ts 4`** (reports in `logs/real-episode-*.md`; MiniFantasy + llama3.2 + ComfyUI on the RTX 5060 Ti):

  | setup | sprite gate (4 sheets) | tomorrow's sheets | median scene | LLM lines |
  |---|---|---|---|---|
  | block budget of 6 calls (old) | 115 s | 4/4 | ~0 s (templates) | 14% |
  | per-scene budget, LLM left resident | >1200 s (timed out) | 0/4 | 11.5 s | 91% |
  | per-scene budget, LLM unloaded before each image (now) | 84–112 s | 4/4 | 24–25 s | 65–69% |

  - A resident LLM makes ComfyUI 20–50× slower on 16 GB. `ComfyBackend.beforeJob` now unloads Ollama (`FREE_LLM_FOR_IMAGES`, default on).
  - Dialogue preempts background art: `ImageQueue.hold()` sends ComfyUI `/interrupt` and requeues the running prefetch job. **Never abort our own fetch:** that crashes Node 24's undici (`ERR_INVALID_STATE`).
  - The remaining cost is model reload when images ran between scenes. The driver plays with no thinking time, which is the worst case.
  - **Next lever:** a single dialogue model, so only one model reloads (MiniFantasy for lines too, or llama3.2 for everything).
  - The "fetch failed" bursts in `logs/llm-failures.jsonl` come from the unit tests' `DownLlm`, not real outages.
- **E-key:** a new `e2e/responsiveness.spec.ts` measures E → visible response at 10 ms with focus on a side button. The "E" prompt and toasts were inside the zoomed stage (they could go off-screen at 3×); they now stay in the viewport.

## Terrace House revamp + feature pass (2026-10-02, evening session)

Verified: typecheck, lint, **140+ unit tests** (`SIM_SEEDS=10`), **14/14 mock E2E** (Edge), and a mock-mode browser check (move-in doorstep scene, keep listening, 3× house camera, budget label, tips). The 200-seed sim was not run.

**House (ComfyUI, Qwen-Image 2.1 turbo):**
- `content/house.json` relayout, Terrace House Tokyo 2019 style:
  - an indoor pool behind a floor-to-ceiling glass wall (`pooldeck` material; glass edges drawn in `house.ts`);
  - a landing cut-out (`void` furniture) that shows the living room below; the lounge moved to the right half;
  - a kitchen island with stools, a sheepskin rug, poufs, floor lamps, lanterns;
  - lived-in clutter: sneakers, magazines, guitar, coat stand, clothes rails, washer, weights, floor cushions;
  - a cream women's room and a cabin (dark wood, panelled) men's room;
  - a new `hallW` room (in `ROOMS`) connects the women's room to the landing.
- `scripts/assets/house_assets.py`:
  - a new palette/style prompt and ~20 new subjects;
  - the raw cache is keyed by a prompt hash, so a changed prompt re-bakes only that piece;
  - `FILL_WIDTH` stretches counters and sofas to fill their footprint;
  - `free_ollama()` runs before each generation (also in `comfy_gen.py`).
- **Gotcha:** every dev-server restart re-warms Ollama. On the 16 GB card, Qwen-Image then drops from 1.8 s/it to 30–100 s/it.
- `house.ts`:
  - new floors (`oak`, `wood-dark`, `carpet-cream`, `pooldeck`);
  - wall decor (frames, shelves, a clock);
  - panelling, glass walls, the void, more lamp types;
  - `findPath` (BFS).
  - `scripts/assets/render-house.ts` now loads the baked assets. Renders: `npx tsx scripts/assets/render-house.ts <dir>`.
- VN room backgrounds re-prompted in `requests.ts` and regenerated with `comfy_gen.py` for living, kitchen, pool deck, bedrooms, landing, entrance, hall and university. Run `npx tsx scripts/assets/build-jobs.ts` first: it rewrites the manifest.
- House view:
  - at least **3× zoom**, with a camera that follows the player;
  - NPCs walk BFS paths around furniture (P2 #11);
  - doorway crossings are no longer blocked on a server round-trip (part of the E-delay fix).

**Features (required_features.md numbering):**
- #1 Move-in day:
  - `createGame({ moveInDay })`; the server defaults it to true;
  - the six arrive one per block in a seeded order, and arrivals not yet in have status `arriving`;
  - group doorstep introductions;
  - tutorial tips (`components/Tip.tsx`) are skippable in the creator and on each tip; Settings has "how to play" to replay them.
  - Tests and E2E pass `moveInDay: false` where they need the full cast.
- #2 Budget levels replace money:
  - `engine/budget.ts`; `world.money` was removed;
  - `reachability` reports `price`/`afford`; budgets allow stretches (one every two episodes), treating a guest, and part-time +1;
  - NPC outings respect their own budget;
  - the UI shows `budget: <level>` and ₪ labels.
- #3 Some housemates have no fixed stay (`contractEp` 999 for about 40%, by hash). `careerChanges` runs at episode end: back to school, starting a business or switching fields, announced in the group chat.
- #4 Broadcast lag (`engine/broadcast.ts`):
  - episode N airs in the evening of N+2 as a `broadcast-watch` scene;
  - housemates learn on-camera facts with source `broadcast` and react (tension or trust when talked about, embarrassment);
  - they also hear the panel's remarks (`panelRemarks`, recorded via `recordCommentary`).
- #5 "Go to work" / "go to class" buttons in the house. There is a new `university` node and a `class` activity; students have weekday late-morning lectures, and missed ones are logged and noticed.
- #6 Knock on the other bedroom's door (`visit` with `knock: true` → `knock()` in `living.ts`): whoever inside trusts you most answers, and the house overhears.
- #8 Romance ladder: first date → "is this a date?" → hand-holding → first kiss (`milestone` cond/effect, `ms_` flags, 4 templates).
- #9 Overnight trips (`engine/trips.ts`, `trip` action, House "weekend trip" panel on Friday): Galilee, Dead Sea, Eilat; Shabbat observers stay home; budget checks; drive and night scenes; a return scene at the door; the house knows who went.
- #10 Outsiders (`engine/outsiders.ts`): a family call, an old friend at the door, or an ex texting, replacing half of the doorbell visits.
- #12 Sleepwear after 23:00:
  - the `sleep` sheet is prefetched after the daily ones; the sprite route takes `occasion`;
  - VN `occasionFor` returns `sleep` for lateNight house scenes.
- #13 Panel nicknames (`panelNicknames`, coined from the scene type, reused in the commentary and intermission prompts and in mock lines).
- S2: end-of-episode **diaries + pair notes** written by the LLM from each housemate's own memories (`Generator.diary`, `recordDiary`, logged as `diary` for replay). They feed `pairSummaryText` and the persona card.
- S3: **keep listening**: the player stays quiet and two housemates carry on, ranked by extraversion, mood and affinity, with no double turns; at most 3 times per scene.
- S4: sampler presets per model family in `llm/ollama.ts` (`OLLAMA_OPTIONS` JSON overrides them).
- Pending fixes from the earlier list:
  - **Portrait resolution:** the VN figure no longer nearest-neighbour downsamples 832×1216 (smooth now), and framed portraits use pixel factor 4 instead of 8.
  - **Asset reuse:** a new test proves portrait → outfit → expression → cutout enqueue nothing after a restart and stay real when ComfyUI is down. The `stand` route used to return a placeholder whenever ComfyUI was offline; it now serves saved cutouts.
  - **E-delay:** room crossings are now instant. A measured input-to-response profile with live services was **not** done.

- #7 Group images: `workflows/group_ref.api.json` + `group_ref_mapping.json` (Qwen-Image 2.1, up to 6 participant portraits via the encoder's `images.image_N` autogrow input; unused slots are pruned in `patchWorkflow`). Freeze frames and "generate scene" now pass every participant (`ImageRequest.references`, part of the cache key). Verified live: 3 housemates in about 40 s with recognisable faces (`npx tsx scripts/assets/probe-group.ts`). The turbo model draws the room photographically; the in-game pixelation (factor 6) hides most of it.
- E-key: E now works whatever has focus (it used to need canvas focus, so after any side-panel click it silently did nothing), and key repeat is ignored.

**Not done at that point** (superseded: all built on 2026-10-03 except S5/S8): S1, S6, S7 and the playability sweep. The 4×1 counter was split into two 2×1 pieces.

## Current speed and VN pass (2026-10-02)

- Configured `OLLAMA_MODEL=hf.co/Nubinu/Qwen3.5-4B-MiniFantasy-GGUF:Q4_K_M`, `OLLAMA_MODEL_LINES=llama3.2:latest`, `OLLAMA_KEEP_ALIVE=30m`; production context 8192. No downloads.
- Matched five-reply benchmark: Gemma 12.99 s, Llama 4.71 s (~2.8× faster for that batch). MiniFantasy passed 10/10 isolated structured-generation checks. See the **current selection** section in `docs/ROLEPLAY.md` for reports and prose-quality limitations.
- Ported a limited SillyTavern-inspired subset: all named speakers answer in mention order, everyone addressing, personality/mood/relationship chiming, busy listeners muted, keyword-triggered recall from each speaker's retained memories. Prompts expose the active speakers' context. Explicit refusal replies use persona-colored templates.
- Sprite preparation now lives in `App`, survives screen changes, and follows tomorrow's complete outfit → sheet → decoded-frame chain. Dependency retries are 1.5 s instead of 10 s (figures: 1.5 s instead of 8 s). Per-workflow hashes preserve unrelated cached art, with legacy-key migration.
- VN figures reset when outfit/day changes; offline cutouts are transparent placeholders. Expression labels describe the figure actually shown while a newer expression is pending.
- Live browser group check passed with **two actual PNG cutouts**, exact typed text, replies in mention order, and the bottom dialogue box. That typed exchange took 867 ms **using templates**, because the slot's six-call budget was exhausted. This is a services-on VN integration check, not an LLM reply latency measurement.
- Warm sprite API probe: Kai's days 0/1/4/5 returned ready real sheets in 26/2/1/1 ms; repeating rotation days reused identical keys. This verifies cache reuse, not cold drawing speed.
- Final checks: 129/129 unit checks passed with `SIM_SEEDS=20` (20 idle-season seeds plus the existing 30 active-season seeds); 12/12 mock browser checks passed, and the final stricter cutout test passed separately. Build/typecheck, lint and diff whitespace checks passed. The default 200-seed run was stopped after the connector's 300 s timeout; it is not verified.
- Final raw-model recheck found two Llama refusals incorrectly alleging minors in adult-only fixtures (3/5 parsed replies). Production's explicit-decline template route bypasses these calls. Keep the prose-quality caveat visible.
- Tests and the real VN screenshot/report are recorded in `C:/Users/User/Documents/Codex/2026-10-02/ta/outputs`. The real check used a copied SQLite database; the original save was not overwritten.

### Loading reasons and ETA (implemented in this session)

- A global, non-blocking activity card acknowledges foreground API/SSE requests immediately and polls `GET /api/activity` every second for the actual model/image stage. It names response generation, scene planning, relationship updates, commentary, character details, appearance interpretation, portraits, outfits, expressions, walk sprites, cutouts and scenery.
- Image status includes the housemate, sampling progress when ComfyUI provides it, remaining queued jobs, and **waiting for dialogue to finish** when the image queue is held for the GPU. The episode card explains that its remaining housemate sprites must finish before Begin.
- ETA is explicitly approximate **for the current step**, not a promise for an entire episode or dependency chain. Initial timing estimates learn from successful real calls during this server run. Queued/held jobs say “once started”; an overdue job shows elapsed time and “taking longer than estimated,” never a stuck 0-second countdown. Timing history resets with the server.
- Successful, failed and aborted requests clear their local activity. SSE server errors retain their actual message instead of being replaced by “stream interrupted.”
- Verification: 14/14 mock browser checks (including controlled long-wait, held-image and failed-SSE feedback), 30/30 relevant unit checks, build/typecheck and lint passed. A live MiniFantasy appearance request exposed its actual stage and cleared after 1.85 s without advancing the game clock. ComfyUI progress forwarding and late-callback safety were checked with a controlled backend, not a new live cold image generation.
- This adds feedback during accepted E-triggered interactions; the separate input/movement delay investigation below is still pending. It does not fix portrait resolution or cross-session asset reuse.

### Additional user-requested VN and responsiveness fixes (pending)

- **Fix the low-resolution character portraits/figures in the VN.** Improve detail and consistency at the displayed VN size while keeping the intended pixel-art style. Check both the generated source resolution and any downsampling/scaling in the portrait → expression → cutout → display chain; avoid making a good source unnecessarily blocky.
- **Persist and reuse character portraits and expressions.** Save approved base portraits, outfit variants, expression variants and their cutouts so revisiting a conversation, reloading the page, restarting the game/server or loading a save reuses the same finished assets. Audit the existing disk/SQLite cache and stable identity/outfit/emotion keys and references; diagnose why previously generated assets may be requested again. Generate only missing or deliberately invalidated variants. Verify that a second visit and a restart enqueue no ComfyUI jobs for unchanged images, and that saved images remain available when ComfyUI is offline.

- **Fix the delay between pressing E and the game responding.** The user reports sluggish house interactions. Measure input-to-visible-response time and identify whether the delay comes from movement/animation locks, input handling, API requests or generation. Give immediate visible acknowledgment when an interaction is accepted, and avoid blocking it on unnecessary work. Verify responsiveness for talking, doors, stairs and furniture, with services both running and offline; ensure repeated presses do not duplicate actions.

These are requested follow-ups, not completed fixes.

**Next stage:** the ComfyUI house revamp described below. Keep the existing Klein 20-step sprite recipe until a lower-step comparison demonstrates equal quality. Cold outfit edits remain expensive. Still open: larger live groups, beach/date outfit playthroughs, full real episode/season, sustained day-1 prefetch timing, memory archives/embeddings/rolling diaries, autonomous group turns.

The sections below retain the earlier session snapshot. This current update supersedes their model selection and "not tested" statements.

## Where things stood before this pass

| Area | State |
|---|---|
| Walk sheets (sprites) | **Done and verified in game.** FLUX.2 Klein base 4B + svntax `pixel_4walk` LoRA, drawn from each character's portrait. |
| Wardrobe / outfits | **Built.** Day 0 is verified; days 1+ were verified through the API (Mio), not by playing. Occasion outfits are untested in game. |
| Sprites before the game starts | **Done.** The episode card shows "drawing housemates… n/6" until every sheet is ready. This covers new games, continue, loaded saves, replacement players and new episodes. |
| House art | **First pass done** (furniture baked with ComfyUI, floors, walls, lighting, poses). The user finds it **still bland** and wants the sprites bigger: see "House revision" below. |
| Visual-novel conversations | **Proof of concept works** for one-on-one conversations and for watching NPC scenes with 2 people. Group chat **with the player** is not yet tested live. |
| required_features.md | Rewritten with all user requests from this session (15 items). |

## Earlier plan: switch to a smaller LLM (completed above)

The user requires it: the current LLM is so large it slows the entire game down.
- **Now:** `OLLAMA_MODEL=gemma4:12b` (`.env`; `OLLAMA_MODEL_LINES` defaults to the same model). It shares the 16 GB card with ComfyUI. While dialogue streams, `ImageQueue.hold()` stalls all image work below player-portrait priority: sheets, outfits, cutouts and expressions. Between the two, ComfyUI and Ollama keep evicting each other's models (`ComfyBackend.free()`, Ollama keep-alive). This session it showed up as cutouts and expressions sitting "queued" during scenes, and as minutes-long episode-card waits.
- **Candidates already installed** (no download needed), from `ollama list`:

  | Model | Size | Params |
  |---|---|---|
  | `gemma4:12b` (current, baseline) | 7.0 GB | 11.9B |
  | `terrace-stheno:8b-q4` (custom, `docs/models/SthenoQ4.Modelfile`) | 4.6 GB | 8B |
  | `hf.co/mradermacher/Hamanasu-Magnum-4B-i1-GGUF:Q4_K_M` | 2.6 GB | 4.5B |
  | `hf.co/Nubinu/Qwen3.5-4B-MiniFantasy-GGUF:Q4_K_M` | 2.5 GB | 4.2B |
  | `llama3.2:latest` | 1.9 GB | 3.2B |

- **Do (the user asked for this to run in the next session; the benchmark was started here and stopped before any results):**
  1. Free ComfyUI's VRAM first so the comparison is fair: `POST http://127.0.0.1:8188/free` with `{"unload_models":true,"free_memory":true}`.
  2. Benchmark dialogue lines (20 scenes each; speed, peak VRAM, voice and content pass rate, missing or wrong-speaker lines). Report goes to `config.logsDir`:
     ```bash
     npx tsx scripts/roleplay-benchmark.ts gemma4:12b terrace-stheno:8b-q4 hf.co/mradermacher/Hamanasu-Magnum-4B-i1-GGUF:Q4_K_M hf.co/Nubinu/Qwen3.5-4B-MiniFantasy-GGUF:Q4_K_M llama3.2:latest
     ```
     Add `--reply-only` for a quick 5-scene check of answers to typed words.
  3. Check structured output (beat sheets, personas JSON) for the best one or two with `npx tsx scripts/generation-probe.ts --run-real`. The lines benchmark doesn't cover JSON.
  4. Read samples by hand: the mechanical checks don't judge realism, consent or knowledge.
  5. Set `OLLAMA_MODEL` (and `OLLAMA_MODEL_LINES` if splitting) in `.env`. A split option: a small, fast model for streamed lines and a bigger one only for rare planning calls.
  6. Re-measure the episode-card wait and the VN expression wait in a real scene.
- If none of the installed models is good enough, a new one is a download: confirm with the user before pulling.

## Decisions made this session

- **Sprite model:** FLUX.2 Klein **base** 4B (`flux-2-klein-base-4b-fp8`) + LoRA `pixel_4walk_small_flux2_klein_base_4b_v1` (svntax-dev, HF), edit mode with the portrait as `ReferenceLatent`. 512×512, 20 steps, CFG 5, euler, LoRA 1.0, about 35 s per sheet.
  - Sheet layout from the LoRA's training prompt: 4×4 grid of 32×32 cells. Rows are down / left / right / up; columns 0–2 are the walk (step, stand, step); column 3 is an extra pose (unused).
  - **Right = mirrored left** (the model often faces the right row the wrong way). Walk cycle 0,1,2,1.
  - Rejected alternatives: the Qwen 2511 / 2.1 staged approach (style never matched); restyling the B2W2 ref sheet with Qwen (layout scrambles); Mystic07 `gmsspritesheet` (needs gated Klein 9B: accept the BFL licence on HF to try it); paid Retro Diffusion / PixelLab (cloud).
- **Outfits need an outfit portrait first:** text alone can't change clothes, because the reference wins. Chain: approved portrait → Qwen 2511 edit "change only the clothing" → walk sheet / VN figure.
- **Daily outfits rotate over 4 days** (signature outfit on day 0, then 3 picks). Occasion outfits: date (dresses for women), beach (bikini / swim trunks), outdoor, sleep. See `packages/shared/src/wardrobe.ts`.
- **Furniture is generated per piece, not per floor.** Whole-floor restyles either invent furniture that isn't in the collision map (Qwen at denoise 1) or barely change anything (denoise 0.8). Per-piece sprites keep collision exact.
- **VN figures** are cutouts: the portrait (outfit, then expression) has its background removed by ComfyUI `easy imageRemBg` (BEN2) → `InvertMask` → `JoinImageWithAlpha`.
- **Money becomes budget levels** (spec only, not built): see required_features.md item 3.

## What was built

### Sprites and wardrobe
- `workflows/sprite_edit.api.json` + `sprite_mapping.json`: Klein + LoRA workflow (only `reference` is required now).
- `apps/server/src/image/requests.ts`:
  - `spriteRequest(c, portrait, outfit)`: subject key `sprite:klein-4walk-v1:…`;
  - `outfitPortraitRequest`;
  - `cutoutRequest`.
- `apps/server/src/app.ts`:
  - `GET /api/image/character/:id/sprite?day=`: portrait → outfit portrait → sheet; 409 while a step is missing. Today's day runs at portrait priority, other days at prefetch.
  - `GET /api/image/character/:id/outfit?occasion=&day=`.
  - `GET /api/image/character/:id/stand?occasion=&day=&emotion=`: the VN cutout chain.
  - `POST …/expression` now takes `occasion` and `day`, so expressions keep the scene's clothes.
- `packages/shared/src/sprite-sheet.ts`: slices a 4×4 sheet into `[direction][frame]` 32×40 frames. One shared crop and scale for all cells; majority colour per 4×4 block.
- `apps/web/src/pixel/sprites.ts`:
  - `useCharacterSprites` returns the pending count, retries 409s every 10 s, and prefetches tomorrow;
  - `sprite(c, dir, frame)`;
  - `posedSprite` (sit, sleep).
- `PlayerView.day` was added (`engine/view.ts`).
- `ComfyBackend` takes `kinds: { sprite, cutout }` (per-kind img2img workflows) instead of the old `sprites` argument.

### House
- `scripts/assets/house_assets.py`: bakes every furniture type × footprint with Qwen-Image 2.1 turbo.
  - Keys out white (threshold 205), drops specks, reduces to 32 px per tile, saves to `apps/web/public/assets/house/`.
  - Raw generations are cached in `scripts/assets/house/raw/`, so re-reducing costs no GPU.
  - Stairs, door and railing stay procedural.
- `apps/web/src/pixel/house.ts`:
  - `renderHouse` draws at 2×, with baked sprites when loaded (`loadHouseAssets`);
  - new procedural floors, 3/4 wall faces, thick walls;
  - `drawLighting(ctx, floor, hour)`: morning shafts, golden hour, night darkness with lamp pools;
  - `seatFor(room, activity, i)`: beds for sleepers, the stove for the cook, chairs and table sides for eaters, sofas for loungers.
- `content/house.json`: the backyard is now grass; an upstairs lounge was added (rug, sofa, coffee table, bookshelf, plants, desk).
- `House.tsx`:
  - seats and poses (sit, sleep, cook with steam);
  - walk cycle 0,1,2,1;
  - lighting pass;
  - **sprites drawn at 32×40 (1:1) since the end of the session: not yet seen in the browser.**
- `scripts/assets/render-house.ts`: renders the procedural floors to PNG through Playwright with system Edge (needs the dev server on :5173).

### Visual novel and group chat
- `Scene.tsx`:
  - full-bleed location background;
  - cut-out figures (`Stand` in `components/pixel.tsx`) standing on it; the speaker steps forward and the others dim; the player is never on stage;
  - a name tag and dialogue box at the bottom, with a full-width typing box in it;
  - the per-line emotion picks the speaker's expression figure (generated on first use). The neutral figure shows meanwhile, and the framed portrait until the first cutout exists.
- The scene header carries `occasion` (`occasionFor`: beach / outdoor / date / daily).
- `typedResponders` (`engine/talk.ts`): typed words go to whoever is named, else the last speaker. A second housemate chimes in when the player says "guys", "everyone" and the like, or names two people, and sometimes otherwise. `session.reply` realizes both beats.
- `planPlayerScene` (`loop.ts`): **light** scenes pull in everyone else in the room (up to 3 more).

### Game start
- The episode card gates on sprites. `continue`, `loadSave` and `joinAsNewPlayer` now go through the episode card.

## Tested

- Typecheck and lint clean (last run, after the VN changes).
- Unit tests: **full run at the end of the session, 127/127 passed** (15 files). This includes the new `sprite-sheet.test.ts`, `sprite.test.ts` (wardrobe and occasions) and `talk.test.ts` (group responders).
- In the browser (real mode):
  - six generated sheets in the house;
  - the episode-card gate;
  - VN one-on-one: Kai's cutout on the rainy entrance, the "excited" expression generated on demand, a typed reply answered in character;
  - NPC scene with 2 figures (Ron and Shira);
  - the new house art rendered at 10:00 and 21:30.

## Not tested yet (do this first next session, about 30–45 min)

1. **Group chat with the player (the main proof-of-concept gap).**
   - Get 3+ housemates into the living room (morning puts everyone in the kitchen and bathrooms; try slot1 or evening).
   - "Talk" to one of them: the scene should include the others.
   - Type "what are you guys doing tonight?": two people should answer. Type a name: that person answers.
   - Unit tests only cover the routing. The room "company" logic has no test, because the living simulation re-schedules everyone each action, so a forced setup doesn't hold. Test it live.
2. **The 32×40 house sprites** (just changed): check alignment with tiles, and labels, emotes, the sleep head on the pillow, the sit offset, and stair transitions.
3. **Day 1+:** advance a day. The episode card should wait for new outfit portraits and sheets (about 2 min per character, so up to about 12 min for 6 on the first rotation). Check whether tomorrow's prefetch makes this faster in practice.
4. **Occasion outfits in VN:** a beach outing and a date (`goOut` with `activity: date`) should show the bikini / trunks / date outfit.
5. **E2E (mock mode):** Playwright specs were **not run**, and probably break:
   - `continue` and loading a save now land on the episode card, not the house;
   - the Scene layout changed (portrait expression buttons are gone from scenes).

   Playwright's own Chromium isn't installed, so use `channel: 'msedge'` or run `npx playwright install` (a download: ask first).
6. **Mock / offline mode:** the episode gate should be skipped (pending 0). The stand route returns placeholder figures.

**Recommendation:** switch the LLM first (see the MUST section above), because it changes how every test below behaves. Then run items 1, 2 and 5 before the house revision. Item 5 is likely broken by this session's flow changes, and item 1 is the open proof-of-concept question. Items 3, 4 and 6 can happen alongside the house work.

## House revision (next session, user request)

The user's feedback: "the house looks really bland and the sprites are still too small." Target vibe: **Terrace House Tokyo 2019–2020** (the Setagaya house). From research:
- the house is vertical, and **two landings look down into the living room**;
- an **indoor pool separated from the living room by a sheet of glass**;
- a **rooftop patio surrounded by high walls** (drinks at night);
- a dimly lit playroom;
- sleek and aspirational: natural wood, sheepskin rugs and throws, mid-century and contemporary furniture, air plants;
- the women's room is bright, with pillows and a common seating area; the men's room is cabin-like, with wood panelling.

Sources: [GaijinPot](https://blog.gaijinpot.com/terrace-house-tokyo-2019-2020-is-a-return-to-form-for-the-cult-japanese-reality-show/), [Domino](https://www.domino.com/content/terrace-house-interior-design/) (that piece covers the Karuizawa house: same design team).

Planned changes, mapped onto our Tel Aviv layout (`content/house.json`, `apps/web/src/pixel/house.ts`):
1. **Landing over the living room:** a non-walkable void in the upstairs hall (`stairsUp`) above the living room. It draws the floor-0 render of that area darkened, with a balustrade around it. Move the new upstairs lounge (now at x 9–16, y 11–15) to the right half.
2. **Pool behind glass:** the backyard becomes a pool garden: a pool basin (new type, solid), loungers, and a **glass wall** (light, translucent wall render) between the living room and the pool.
3. **Living room:** a cream sheepskin rug instead of the red one; ottomans / poufs; a floor lamp (add it to `LIGHTS`); air plants. Kitchen: an island with stools.
4. **Bedrooms:** the women's room goes white and cream with floor cushions and throws; the men's room gets wood-panel walls, a darker wood floor and plaid blankets. Needs new floor materials (`wood-dark`, a cream carpet) and a wall-panel style in `WALL`.
5. **Balcony / roof feel:** string lights (lighting pass), planters, a high wall.
6. **Bigger sprites:** now 32×40, about 1.5 tiles tall. If that's still small, raise the house scale: `House.tsx` fit uses `Math.floor(...*2)/2`; allow a larger scale or crop to the current room.
7. New furniture types (pool, lounger, pouf, floor lamp, island, stool, cushions, sheepskin rug) need `SUBJECT` entries in `scripts/assets/house_assets.py`, then a bake run (about 30 s per piece).

## After that

Work through [required_features.md](required_features.md):
- **P1:** VN polish (item 1), move-in day tutorial (2), budget levels instead of money (3), career changes and stay-to-the-end (4), broadcast lag (5), work/class time skip (6), both floors walkable plus knock-to-enter (7).
- Then P2 and P3.

## Known issues and gotchas

- **The image cache key hashes all workflows together** (`ComfyBackend.workflowHash` → `cacheKey`). Adding the cutout workflow invalidated every cached generated image (sheets, outfit portraits) once. Prebaked cast portraits are keyed by subject and were unaffected. Fix: hash only the workflow a request uses (per kind).
- **Preview harness:** `preview_start` injects `PORT=5173`, so the API server took Vite's port and served the stale build. `.claude/launch.json` now runs `cmd /c "set PORT=8787&& npm run dev"`, but under the harness Vite still hung silently. This session ran Vite and the API by hand:
  - `node node_modules/vite/bin/vite.js --port 5173 --strictPort` (in `apps/web`);
  - `node node_modules/tsx/dist/cli.mjs src/main.ts` with `PORT=8787 MODE=real` (in `apps/server`). Restart it after server changes (no watch).
- `ctx_shell` runs through bash and eats `$` in inline PowerShell; use the PowerShell tool (also saved to memory).
- The embedded Python ignores the script's directory: experiment scripts insert their own folder into `sys.path`.
- Furniture `w`/`h` default to 1 when omitted (two entries in house.json have no `h`).
- A 32×32 LoRA cell gives a figure about 24 px tall in a 40-row frame: that's the native size, not a bug.
- Older open items: the `sprite_tests.py` `--force` filter bug; `scripts/assets/sprite_tests.py`, `sprite-jobs.json` and `apps/web/public/assets/sprite-tests/` are now obsolete (old Qwen sheet pipeline) and could be deleted; reference cache keys use file paths, not content hashes (fine for content-hashed `cf-*.png`).

## Models and ComfyUI

Installed this session (ComfyUI `models/`, ~12.5 GB):
- `diffusion_models/flux-2-klein-base-4b-fp8.safetensors`
- `text_encoders/qwen_3_4b.safetensors`
- `text_encoders/qwen_3_8b_fp8mixed.safetensors` (for Klein 9B, unused: the 9B base is gated)
- `vae/flux2-vae.safetensors`
- `loras/pixel_4walk_small_flux2_klein_base_4b_v1.safetensors`
- `loras/gmsspritesheet1.safetensors` (Mystic07, needs 9B, unused)

Also used: `rembg/BEN2_Base.pth` (already present) via the `easy imageRemBg` node; Qwen 2511 edit (outfits, expressions); Qwen-Image 2.1 turbo Q8 (furniture).

ComfyUI: `http://127.0.0.1:8188`, RTX 5060 Ti 16 GB. Embedded Python: `C:/Projects/ComfyUI_windows_portable/ComfyUI_windows_portable/python_embeded/python.exe`.

## Files

**Added on 2026-10-02 / 03 (untracked):**
- **Engine:** `packages/shared/src/engine/{broadcast,budget,trips,outsiders}.ts` plus tests (`broadcast`, `milestones`, `movein`, `trips`).
- **Server:** `apps/server/src/llm/recall.ts` (+ test), `apps/server/src/game/diary.test.ts`.
- **Web:** `apps/web/src/components/Tip.tsx`, `apps/web/src/pixel/house.test.ts`.
- **Workflows:** `workflows/group_ref.api.json` + `group_ref_mapping.json`.
- **Scripts:** `scripts/real-episode.ts`, `scripts/assets/probe-group.ts`.
- **Browser tests:** `e2e/trip.spec.ts`, `e2e/responsiveness.spec.ts`.
- **Art:** baked furniture in `apps/web/public/assets/house/`; new backgrounds for the hall, university, Galilee, Dead Sea and Eilat; regenerated house-room backgrounds (modified).
- **Modified throughout:** the engine (`loop`, `living`, `agents`, `city`, `talk`, `memory`, `view`, `arcs`, `castgen`, `outcome`, `conditions`, `core`), server (`session`, `app`, `main`, `config`, `db`, `queue`, `comfy`, `requests`, `prompts/*`, `llm/ollama`), web (`House`, `Phone`, `CityMap`, `Scene`, `Creator`, `Info`, `layout`, `pixel`, `sprites`, `store`, `api`), and content (`house.json`, `city.json`, `events/core.json`).

**Earlier in the session:**
- **Modified:** the server image pipeline (`app.ts`, `requests.ts`, `comfy.ts`, `mock.ts`, `main.ts`, `session.ts`); the web client (`api.ts`, `store.ts`, `pixel.tsx`, `sprites.ts`, `house.ts`, `House.tsx`, `Scene.tsx`, `Episode.tsx`, `Title.tsx`, `CityMap.tsx`); shared (`sprite-sheet.ts`, `talk.ts`, `loop.ts`, `view.ts`, `interfaces.ts`, `index.ts`); `content/house.json`; `workflows/sprite_*`; tests; `required_features.md`.
- **New:** `packages/shared/src/wardrobe.ts`, `workflows/cutout.api.json`, `workflows/cutout_mapping.json`, `scripts/assets/house_assets.py`, `scripts/assets/render-house.ts`, `apps/web/public/assets/house/*.png` (24 baked furniture sprites), `scripts/assets/house/` (raws, layout renders, contact sheet), `.claude/launch.json`.
- **Experiments (untracked, keep or delete):** `scripts/assets/sprite-experiments/`, which has `exp_klein.py` (the working sprite recipe), `exp_sheet.py`, `exp_rows.py`, `exp_house.py`, `random_portraits.ts`, `slice_preview.ts`, and the configs and results.
