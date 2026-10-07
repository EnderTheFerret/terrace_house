# Shared Roof

A slow, top-down pixel-art life-sim inspired by quiet share-house reality TV. You move into a seaside house with five
strangers in Tel Aviv, cook, go out in the city, fall for someone (or don't), and leave the house alone, as a couple, or after a
confession that went wrong. A studio panel of five commentators watches everything and makes predictions.

- **Local-first.** `npm run dev:mock` runs the whole game with no external services: dialogue, commentary and images
  come from deterministic templates and procedural pixel art.
- **Real mode** uses your own machine: [Ollama](https://ollama.com) for dialogue (Gemma by default) and
  [ComfyUI](https://github.com/comfyanonymous/ComfyUI) for pixel-art portraits, backgrounds and freeze-frames.
- **Living world.** The five housemates are agents with needs, goals, secrets, beliefs and schedules. They gossip,
  fall in love, fight and leave whether or not you're in the room.
- All characters are fictional adults (20+). Content rating PG-13.

See [the feature list and latest additions](features.md), [the implementation audit](IMPLEMENTATION.md) and [dialogue model research](docs/ROLEPLAY.md).

The [October 6 dialogue investigation](docs/DIALOGUE-INVESTIGATION.md) records the current Rocinante comparison and remaining quality limits. The [Terrace House / Tel Aviv / Israel lorebook](docs/LOREBOOK.md) works in game scenes and can be imported into SillyTavern.

Open **sprite library** from the main menu or game toolbar to browse each character's walking sheet and conversation expressions by outfit and day. Select artwork, describe a correction and use **apply edit**, or choose **new variation**. Edits are saved with the season and used by walking animations and dialogue; expression edits keep their named emotion and apply across outfits. Finish active conversations before saving edits. Browsing uses cached art; generation needs the image service. During dialogue, the latest revealed line selects the speaker's expression, with neutral shown while that face is being prepared.

During a visual novel scene, use **character artwork** to select a participant and generate an expression or outfit. Choose **formal / suit** for suits, tuxedos and evening wear, or enter a **custom outfit** description. Group conversations let you choose the character. Write the exact clothing and facial expression in the custom description fields, then choose **generate expression**, **generate clothing**, or **generate both**. A custom expression overrides the preset; expression-only uses the character's currently displayed clothing, and clothing-only uses the neutral face without generating an expression. The finished expression previews until the next dialogue line, then follows dialogue again; outfit choices stay for the current scene. The sprite library supports the same formal and custom outfit filters. Conversation figures keep the original pixel-art faces, palette and outlines, with balanced adult proportions and knees-up framing; date dress presets use tailored midi silhouettes and formal dresses use evening gowns. Portrait backgrounds are cleaned before outfit edits. Updated portrait/outfit/expression cache keys regenerate older artwork with oversized heads, incorrect framing or unwanted clothes and accessories.

Replies use larger, wrapping text, with narration in separate entries. **Retry reply** regenerates the latest scene or phone response without advancing time or repeating your message. In the house, **invite housemates** lets you choose a room and several people; ordinary conversations include the people at that location. Generated CG scenes match the activity: seated meals, dancing, café coffee, and other contextual actions. New episodes can begin while art loads, with the player and nearby housemates drawing first. Reading messages and plans clears their phone notifications. The title-screen load menu cannot overwrite saves.

Group TV watches show delayed episodes: **episode 1 covers days 1–3 and airs on day 6**, episode 2 covers days 4–6 and airs on day 9, and so on. The house watches together in the evening, sees important moments from each recorded day and the recorded scene/studio panel commentary, and reacts to what it learns. Panel commentary still appears during ordinary play. The latest broadcast can be replayed from the house screen.

## Quick start (mock mode, no services)

Requires Node.js 20+ (tested on 24).

```bash
npm install
npm run dev:mock
```

Open http://localhost:5173. That's it.

## Real mode (Ollama + ComfyUI)

1. **Ollama** — install from https://ollama.com, then pull a model:

   ```bash
   ollama pull llama3.2:latest
   ollama pull hf.co/Nubinu/Qwen3.5-4B-MiniFantasy-GGUF:Q4_K_M
   ```

   The example configuration uses MiniFantasy 4B for structured JSON and Llama 3.2 for dialogue, with an 8192-token context.
   Both were already installed on the development machine. Set `OLLAMA_MODEL` and `OLLAMA_MODEL_LINES` to use another pair.
   See `docs/ROLEPLAY.md` for measured results and quality limits.

2. **ComfyUI** — install and start ComfyUI (the Windows portable build is fine). The default workflow uses Qwen-Image +
   the Lightning 8-step LoRA. See [docs/COMFYUI.md](docs/COMFYUI.md) for the model files, how to import or export
   your own workflow, and how `workflows/mapping.json` works.

3. **Configure** — copy `.env.example` to `.env` and adjust:

   ```bash
   cp .env.example .env
   ```

   | key | default | meaning |
   |---|---|---|
   | `MODE` | `real` | `real` or `mock` (`dev:mock` forces mock) |
   | `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / MiniFantasy 4B in `.env.example` | structured JSON model |
   | `COMFY_URL` / `COMFY_WORKFLOW` / `COMFY_MAPPING` | `http://127.0.0.1:8188` / `./workflows/…` | image backend |
   | `IMAGE_STYLE_PREFIX` | pixel art … | prepended to every image prompt |
   | `SEASON_LENGTH` | `0` | open-ended; positive values set a fixed season |
   | `OLLAMA_MODEL_LINES` | `llama3.2:latest` in `.env.example`; otherwise same as `OLLAMA_MODEL` | speaking/reply model |
   | `OLLAMA_KEEP_ALIVE` | `30m` in `.env.example` | keeps the small models warm between calls |
   | `LLM_CALLS_PER_SLOT` | `6` | hard cap of LLM calls per time slot; the rest uses templates |
   | `SEED` | random | fixed seed for reproducible seasons |
   | `PORT` | `8787` | API port (the web dev server proxies to it) |

4. **Run**

   ```bash
   npm run dev
   ```

   The title screen shows which services are up. If Ollama or ComfyUI are down, the game keeps working: each call
   falls back to templates or placeholders and an "images offline" / "templates" badge appears.

5. **Smoke test** (one dialogue, one commentary, one image against your services):

   ```bash
   npm run smoke
   ```

Tip: on a single 16 GB GPU, ComfyUI and a 12B model compete for VRAM. Scenes still stream, just slower; a 4B model or
leaving ComfyUI idle makes dialogue near-instant.

## How to play

Conversations you start open directly at your reply controls, without scripted small-talk lines. You can accept or decline incoming phone plans during a conversation; the response saves immediately without advancing time or closing the conversation.

Open **activity guide** from the title menu or game toolbar for a short, expandable guide with screenshots of every activity and its activation controls. The guide pauses the world clock and cooking timers, preserves your progress, and returns to your current screen with Escape or **back to game / menu**.

New seasons and resumed active saves gather all six residents for a mandatory welcome dinner after the last first-day arrival and introduction. Existing saves enable meals without advancing time or arrivals. From day two, free housemates share small breakfasts and evening house dinners around work, class and other plans. Meals start while you are free at home early in the morning/evening; choose **hang out** to join a due meal immediately. Talk, address everyone or listen while eating.

- **House** — walk with arrow keys / WASD, press **E** at people or hotspots. Take the stairs to the bedrooms and private balconies; the backyard is shared. Buttons cover the same actions.
- **Time** — morning → three daytime blocks → evening → late night. Conversations advance six game minutes per spoken line. Watching the house or city advances five game minutes every 20 seconds; dialogs, active scenes and hidden tabs pause this clock. Skip a block or sleep until morning when ready.
- **Housemates** — when an activity finishes, the local language model chooses their next activity from their personality, needs, memories and messages they have read. They can visit common rooms or explore the city, alone or with a mutually agreed companion. Conversations face the listener; outings use walking paths through the house. Mock mode or an unavailable model uses the existing rules as a fallback.
- **Move-in day** — you and one housemate start at 07:00. The remaining four arrive at 07:30, 10:30, 14:00 and 20:00, in a seeded random order. Introductions happen one at a time, including during conversations. Everyone is home by the evening introduction.
- **Plans** — use the phone to make/accept invitations, share photos/stories, or read messages. Learn routines, buy gifts, make coffee, keep promises and pursue career goals. Friendship and staying single are valid outcomes.
- **Housemate performances** — musicians (including Shira), DJs (including Noga), actors and comedians invite a specific person or the house to their own concert, DJ set, play or stand-up show at Florentin Basement. Invitations arrive in phone messages and **plans**, at most once a week per performer. Accept, then choose **attend show / DJ set / play** during the scheduled evening. Available NPC guests attend even if you stay home; keeping your promise builds trust and leaves a shared memory. Work, Shabbat and other commitments affect who can attend.
- **Season** — open-ended by default. After episode 3, wrap the season to announce the next full episode as the finale, or choose a fixed length in the creator.
- **City** — go out for dates, wandering, gifts, part-time shifts and karaoke. Round-trip travel must fit the minutes left, and weekday openings matter. Far spots need the shared car.
- **Scenes** — dialogue streams in; at your moment, pick an intent (be honest, flirt, joke, support…). Your character
  says it in their own voice. You can join, eavesdrop on, or ignore conversations you walk into.
- **Cooking** — chop to the beat, boil, keep the pan in the band, season by taste, plate like the photo. Who you feed,
  and what they like, matters. There's a practice kitchen on the title screen.
  The recipe book has 15 dishes, including mujaddara, falafel pita, lemon chicken bowls, latkes, strawberry pancakes
  and eggplant with tahini. Search by dish or ingredient, filter by diet, or show only recipes your fridge can make.
  Food, ingredients and cooking animations use prebaked ComfyUI pixel art in both real and mock modes.
- **Phone, board, bible, fridge** — `P`, `B`, `I`, `F`. The relationship board only shows what you know, and how you
  know it.

## Scripts

| command | what it does |
|---|---|
| `npm run dev:mock` / `npm run dev` | server + web in mock / real mode |
| `npm test` | all tests, including 200 idle-player seasons and 30 active-player seasons; several minutes |
| `npm run test:e2e` | 7 browser flows in system Edge against a throwaway mock-mode save directory |
| `npm run typecheck` / `npm run lint` | TypeScript (strict) and ESLint |
| `npm run build` | typecheck + production web build (`npm start` serves it with the API on `PORT`) |
| `npm run smoke` | real-service smoke test |
| `npm run replay -- <saveId>` | deterministic replay of a save's event log (lists saves without an id) |
| `npm run sim -- <seed> [idle\|active] [random]` | headless season run with a summary |

Faster test loop: `SIM_SEEDS=20 npm test`.

## Architecture

```
web (React, Zustand, Tailwind, canvas)  <-- HTTP + SSE -->  server (Fastify)
                                                             ├─ engine (packages/shared, pure + deterministic)
                                                             ├─ director / agents / knowledge / arcs (engine)
                                                             ├─ llm: ollama | mock     (structured calls + fallback)
                                                             ├─ images: comfyui | mock (priority queue + disk cache)
                                                             └─ sqlite: saves, memories, images, events_log
```

- `packages/shared` — zod model, seeded RNG (mulberry32), content loader, the whole engine, mock text generators,
  pixel-art generators. No I/O. Every state transition is `(state, action) → state` with randomness from
  `state.rngState`, so seasons replay exactly.
- `apps/server` — adapters, prompt builders (`src/prompts/*.ts`), generation service with voice checks and budget,
  game session, SSE scene streaming, image queue, persistence.
- `apps/web` — screens, procedural top-down renderer (house, city, sprites), cooking minigame renderer.
- `content/` — cast, archetypes, arcs, events, city, recipes, panel, quirks, recurring NPCs, house layout, calendar.

The LLM never touches game state: it proposes deltas, the engine validates them with zod, clamps every delta to ±15
and only applies ids that exist. Characters only "know" facts in their knowledge set; prompts never include facts a
speaker doesn't know.

See [DECISIONS.md](DECISIONS.md) for design choices and [PROGRESS.md](PROGRESS.md) for milestone status.

## Known limitations

- The Tel Aviv pass includes 79 new ComfyUI images plus five retained panel avatars; [artwork verification](docs/ARTWORK.md) records coverage and visual corrections. The portrait palette sampler uses central image regions rather than segmentation.
- Holiday dates and Friday/Saturday 18:00 Shabbat boundaries are game approximations. NPC state updates when game minutes advance, rather than from a real-time server timer.
- Gemma and Stheno each completed 20 seeded comparison scenes. Stheno was faster but followed the format less reliably and invented player speech; Gemma remains the default. [docs/ROLEPLAY.md](docs/ROLEPLAY.md) records the raw review, licensing, single-reply probes and qualified ComfyUI memory evidence.
- Dialogue in real mode is only as good (and fast) as the local model; with the default budget of 6 calls per slot,
  NPC-only scenes beyond the first are template-written.
- Images: the default workflow targets Qwen-Image; other models need a workflow export and a `mapping.json` edit.
  Freeze-frames keep the lead character's face through a Qwen-Image-Edit reference workflow (one reference face per
  image); portraits and backgrounds rely on fixed seeds and tag order.
- One GPU for both services: while dialogue streams the image queue waits and ComfyUI's models are unloaded, so the
  next image pays a model reload. A smaller model (`OLLAMA_MODEL=gemma3:4b`) makes first lines near-instant.
- English only (`LANGUAGE` is reserved).
- The pixel world is procedural and intentionally simple: no pathfinding animation between rooms beyond tweening,
  no in-house cut-scenes.
- Single local player, single active game per server process.
