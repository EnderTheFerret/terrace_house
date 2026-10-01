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

## Dependencies (non-trivial)
- `fastify` + `@fastify/static`: HTTP + SSE + static images.
- `better-sqlite3`: required by spec; prebuilt binaries for Node 20–24.
- `zod` v4: schemas + `z.toJSONSchema` for Ollama structured output.
- `zustand`, `react`, `vite`, `tailwindcss`: required stack.
- `@fontsource/dotgothic16`: offline pixel font (OFL).
