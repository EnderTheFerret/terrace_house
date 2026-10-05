# Decisions

Choices made where the spec was silent or where the user overrode it. Newest at the bottom of each section.

## Visual direction
- **Top-down pixel art (user request, overrides "anime illustration" default).** The world (house floor plan, city map,
  character sprites, furniture) is procedural pixel art drawn on `<canvas>` from data, so it is always consistent and
  works offline. Illustrations (portraits, location backgrounds, panel avatars, title art, freeze-frames) come from the
  image pipeline in a pixel-art style and are displayed nearest-neighbour.
- `IMAGE_STYLE_PREFIX` default is `pixel art, 16-bit retro game art, …` instead of the anime prefix.
- City map is canvas pixel art (spec said SVG) — keeps one renderer style; nodes/edges still come from `city.json`.
- Pixel font: DotGothic16 (SIL OFL) bundled via `@fontsource/dotgothic16` so nothing loads from the network.

## Image generation
- The user already runs ComfyUI portable (`C:\Projects\ComfyUI_windows_portable`). Its installed models include
  **Qwen-Image (fp8) + Lightning 8-step LoRA** (Apache-2.0), which renders clean pixel art natively. The default
  `workflows/txt2img.api.json` targets those; `mapping.json` maps logical inputs to node ids so any workflow can be
  swapped in without code changes (see `docs/COMFYUI.md`).
- Default cast portraits, location backgrounds, panelist avatars and title art are **pre-generated** with that
  workflow by `scripts/assets/comfy_gen.py` (Pillow downscale + palette quantize → true pixel grid) and shipped in
  `apps/web/public/assets/`. The server checks this prebaked library (`manifest.json`) before queueing work, so mock
  mode still looks finished; anything else (custom player portrait, freeze-frames) is generated live or falls back to
  procedural SVG placeholders.
- Live generated images are pixelated client-side (draw into a 1/8-size canvas, scale up with `image-rendering: pixelated`).

## Engine
- One episode = one in-game day; the calendar advances 15 days per episode so a 24-episode season spans April→March and
  hits every city event (cherry blossom, beach day, fireworks, matsuri, Christmas lights, New Year, typhoon). Covered by a test.
- State transitions clone the input (`structuredClone`) and mutate the clone internally: pure from the outside, simple inside.
- Relationship matrices are id-keyed maps (`rel[i][j]`), not index matrices, so replacements don't reshuffle indices.
- The director picks one player scene per slot (from the player's chosen activity/room), at most one arc beat, and at
  most one extra NPC template event; co-located NPC pairs resolve as engine interactions. Render filter = player
  co-present ∪ top-k salience (k = 1) ∪ arc beats; the rest becomes one-line log entries.
- The player only speaks at their choice beat (intent realized in their voice); NPCs carry the rest of the scene.
- Confession answers are deterministic given state (no hidden dice), so the dialogue can be written consistently
  with the outcome.
- Romantic interest uses an explicit `interestedIn` field. The default cast is written as opposite-sex attracted to
  match the show format; the player chooses their own `interestedIn` in the creator.
- Birthdays are derived deterministically from the character id (no extra content field).
- The engine never sees LLM text: LLM delta proposals go through `sanitizeProposal` (zod + clamp ±15 + id whitelist).
- Panel predictions: the engine proposes a *resolvable* condition (confess/couple/fight/leave by episode N); the LLM
  only phrases it. Resolution and callbacks are engine-driven.
- Replay determinism: only engine functions touch `rngState`, in a fixed order (plan → autoChoices → proposeOutcome →
  resolveScene → panelPrediction → finishSlot). Text generation uses its own RNG seeded by prompt hash.

## Server / tooling
- `tsx` runs the server in dev and prod (no separate server build step); `npm run build` = typecheck all + Vite build.
- Node's built-in `process.loadEnvFile` instead of `dotenv`; Node's global `fetch`/`WebSocket` instead of `ws`/`axios`.
- `scripts/dev.mjs` replaces `concurrently` (two `spawn` calls).
- TypeScript pinned to 6.0.x because typescript-eslint does not yet support TS 7.
- Local `.env` uses `OLLAMA_MODEL=gemma4:12b` (installed on this machine); `.env.example` keeps the spec default `gemma3:12b`.
- One LLM call realizes a batch of beats (streamed, `speaker_id: text` lines) instead of one call per beat, so a player
  scene costs ~5 calls (beats, lines×2, deltas, commentary) and fits `LLM_CALLS_PER_SLOT=6`.

## Gameplay details decided during playtests
- Part-time jobs: drop-in shifts at work-capable spots (café, konbini, grill, records, live house) pay a fixed wage per
  slot; signing a contract fixes that slot on three weekdays (sign day, +2, +4; episodes advance the weekday by one) at
  1.25× wage. Two missed shifts end the contract; typhoon days are excused.
- Talking to someone who is in a bedroom or the bathroom moves the conversation to the living room.
- Freeze-frames only end scenes whose template is marked `freeze` (peaks, arrivals, farewells, dates), even if the LLM
  offers a caption.
- The LLM premise "flavor pass" is opt-in (`FLAVOR_PASS=1`) so the default budget of 6 calls covers a full player
  scene: beat sheet, lines before the choice, lines after it, deltas, commentary.
- Model warm-up request at server start in real mode (the first structured call otherwise pays the load time).
- Mock-mode freeze-frames composite the participants' procedural pixel busts over the procedural location.
- Arrival scenes show an intro card (portrait, name, age, job, hometown) for a few seconds.
- Departures follow the show's rhythm: marked in episode E → announcement to the house in E+1 (the leaver stays
  available for scenes that day) → farewell at the door and departure the morning of E+2. A leaver with romance ≥ 45
  toward an attracted, unattached housemate gets one rooftop "last confession" (slot3/evening); a yes marks the other
  person leaving on the same day (or offers the player "graduate together").
- Studio intermissions are text only and never touch game state (no prediction bookkeeping), so replay is unaffected.
  They cover log entries since the previous intermission (salience ≥ 0.45, top 3).
- Top-down sprites stay 16×20 procedural pixel art (shared with the server); activity emotes come from the NPC's
  current action, only for housemates the player can see.

## Free-text talk and the player's next character
- Typed words become an intent through keyword cues (`classifyIntent`), restricted to the intents the scene offers, so
  the engine and replay stay deterministic; the LLM still reads the exact words when writing the reply. Each typed
  exchange gets its own LLM call on top of the slot budget (it is the player's explicit action). Max 30 exchanges.
- What the player typed is stored as a memory for every listener and logged as a `words` event; phone transcripts are
  logged as `chat` events. Replay applies both, so `npm run replay` still reproduces saves exactly.
- Graduating no longer ends the season: the player's character departs like any housemate (their partner too, whose
  place is refilled), the game waits (`awaitingPlayer`), and `joinNewPlayer` adds the next player character as a
  stranger (`player-2`, `player-3`…; the previous one stays in the cast history with `isPlayer=false`). Logged as
  `new-player` for replay.
- Leaving "with" someone is only honoured for your partner or a leaver who asked; otherwise you leave alone.
- Replacements now arrive for every departure until the season's last episode (was: none in the last 3 episodes).
  `SEASON_LENGTH=0` runs an endless season (internally 9999 episodes; the top bar hides the total).
- Jobs are data (`content/jobs.json`): workplace + shift + day pattern → `routine.jobSlots`. Unknown occupations keep
  the old keyword workplace guess and a random weekday schedule. Generated ids get a suffix when a first name repeats.

## Images on one GPU
- Consistent faces use Qwen-Image-Edit 2511 with the portrait as a reference image rather than IP-Adapter: the user's
  ComfyUI has the edit model and its Lightning LoRA but no SDXL checkpoint for the installed SDXL IP-Adapter weights.
  The reference workflow is a second workflow/mapping pair; requests without a reference keep the txt2img workflow.
- While a scene segment streams, the image queue starts no jobs except the player's portrait, and asks ComfyUI to
  `/free` its models if it generated anything since the last free. Dialogue latency beats image latency.

## Dependencies (non-trivial)
- `fastify` + `@fastify/static`: HTTP + SSE + static images.
- `better-sqlite3`: required by spec; prebuilt binaries for Node 20–24.
- `zod` v4: schemas + `z.toJSONSchema` for Ollama structured output.
- `zustand`, `react`, `vite`, `tailwindcss`: required stack.
- `@fontsource/dotgothic16`: offline pixel font (OFL).
- `@playwright/test` (dev): browser E2E tests, run on the system Edge (`channel: 'msedge'`) so no browser download.
