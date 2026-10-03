# Required features — what is left

Updated: 2026-10-03. Scope is **a single-player simulation of the show Terrace House**, as close to the show and to real life as possible. Multiplayer, cloud sessions, localization, touch and gamepad input are out of scope.

[features.md](features.md) lists everything that exists. The "Done" table at the bottom maps the original list to where each item now lives.

## Still open

### 1. Full-season playthrough (P1)
- **What:** play a whole season in the browser and log blockers: creator → move-in day → episodes → a trip → graduation → a newcomer → the finale.
- **Why:** the user asked for it. Every system has unit and browser tests, but no one has played them together for a whole season.
- **Status:** not started. `scripts/real-episode.ts` covers one real-mode episode.

### 2. Scene wait behind images with a fast player (P2)
- **Done on 2026-10-03:** one model (`gemma4:12b`), GPU turn-taking on every LLM call, ComfyUI memory flags (no more PC freezes). See session_handoof.md.
- **Left:** `scripts/real-episode.ts` (instant answers) still shows a median 80 s scene: about 35 s of LLM work, plus a ~40 s outfit or sprite job that starts between segments. Check in the full-season playthrough whether a human's reading time hides it. If it doesn't, make dialogue interrupt portrait-priority jobs too; new expressions would then show up late.

### 3. Recall by meaning — done (2026-10-03)
- `nomic-embed-text` installed. A live probe matches paraphrases at ~0.64 against 0.32–0.49 for unrelated memories, and `RECALL_MIN` is 0.55. Not yet seen in a long real conversation.

### 4. Group images in pixel art — done (2026-10-03)
- The room's prebaked background is the last reference image, and the prompt asks for its pixel-art style. Checked on one live sample (`npx tsx scripts/assets/probe-group.ts`).

### S5. Character card import / export (Card V2 / V3) — not planned (by request)
- **What:**
  - **Import:** a SillyTavern PNG card (a `chara` / `ccv3` tEXt chunk holding base64 JSON) becomes a custom housemate or the player character:
    - `description` / `personality` / `scenario` → persona, through the text-to-persona path in `apps/server/src/game/personas.ts`;
    - the card image → the reference portrait;
    - `mes_example` → speech exemplars;
    - `talkativeness` → group turn-taking;
    - `character_book` → backstory facts.
  - Card text is untrusted: sanitize it, and enforce adults 20+ and PG-13.
  - **Export:** at graduation or the finale, write each housemate as a V2 card, with their memories and pair notes as an embedded lorebook.
- **Why:** bring-your-own cast, replayability, and an "after-show" in SillyTavern.

### S8. Voiced lines (TTS) — not planned (by request)
- **What:** optional per-character voices: Kokoro in the browser (kokoro-js), or AllTalk / XTTS from the SillyTavern Launcher. Pick each voice from gender, age and `voiceNotes`, and give the panel its own voices. Off by default. Needs a model download.
- **Why:** atmosphere; the show is watched, not read.

### Optional upgrades to built items
- **S7 emotion classifier:** a keyword lexicon (`feltEmotion` in `packages/shared/src/engine/talk.ts`). Swap in SillyTavern's `distilbert-base-uncased-go-emotions-onnx` (transformers.js, a download) only if typed lines often get the wrong face.
- **Budgets:** housemates pick up extra shifts only to afford a trip; nothing else drives it.
- **Trips:** one trip at a time; the shared car is not blocked for others while it is away.
- **Recall cooldown:** kept in server memory, so it resets when the server restarts.

## Done (2026-10-02 / 03)

| # | Item | Where it lives |
|---|---|---|
| 1 | Move-in day as the tutorial (one-by-one arrivals, doorstep introductions, skippable tips, "how to play") | features.md → Move-in day |
| 2 | Budget levels instead of money (₪ price levels, stretches, treating, part-time and extra shifts) | features.md → Budget levels |
| 3 | Careers change; some housemates stay to the end | features.md → Careers and stays |
| 4 | Broadcast lag (airs two episodes later, `broadcast` knowledge, panel remarks, replay viewer) | features.md → Broadcast lag |
| 5 | Go to work / class (timetable, exam weeks, class scenes) | features.md → Daily life |
| 6 | Both floors walkable; knock before entering the other bedroom | features.md → Daily life |
| 7 | Group images with every participant's face | features.md → Images |
| 8 | Romance milestones (first date → kiss) | features.md → Romance milestones |
| 9 | Overnight trips (invitations, trips without the player, room sharing, Shabbat, budgets, return scene) | features.md → Overnight trips |
| 10 | Friends, family and exes from outside the house | features.md → Life outside the house |
| 11 | NPC pathfinding inside the house | features.md → The house |
| 12 | Sleepwear at night | features.md → Daily life |
| 13 | Persistent panel nicknames | features.md → The panel |
| 14 | Generated social-feed photos (and selfies) | features.md → Images |
| S1 | Relevance-triggered recall (archive, lorebook, sticky/cooldown, embeddings) | features.md → Memory and dialogue; see open item 3 |
| S2 | LLM-written diaries and pair notes | features.md → Memory and dialogue |
| S3 | Group turn-taking and "keep listening" | features.md → Memory and dialogue |
| S4 | Sampler presets per model | features.md → Memory and dialogue |
| S6 | Shot descriptions, phone photos, trip backgrounds | features.md → Images |
| S7 | Emotion read for typed lines (keyword version) | features.md → Memory and dialogue |
| — | Real-mode end-to-end check | `scripts/real-episode.ts`; findings in open item 2 |
| — | Generation budget (does tomorrow's prefetch finish during play?) | yes, 4/4, once the LLM is unloaded before images |
