# Shared Roof — feature list

Everything below exists in the current code. Where a feature only works in one mode, it says so.

## Modes and setup
- **Mock mode** (`npm run dev:mock`): fully playable with no external services. Text comes from templates, images from procedural pixel art plus the prebaked asset library.
- **Real mode** (`npm run dev`): dialogue from Ollama (any chat model; `gemma3:12b` default, tested with `gemma4:12b`), images from ComfyUI.
- Automatic per-call fallback: if Ollama or ComfyUI is down or slow, that call uses templates/placeholders and the game keeps going.
- `/api/health` probe; title screen and top bar show "text: model / templates" and "images offline" badges.
- Model warm-up request at server start in real mode.
- Configuration through `.env` (`.env.example` provided): mode, URLs, model, workflow paths, style prefix, season length, LLM calls per slot, seed, port, timeouts, temperatures, optional premise "flavor pass".

## Season and episode structure
- Season of 24 episodes (configurable); ends early if 3 or fewer housemates remain and no replacements are coming.
- Each episode: morning → three daytime slots → evening. Each player choice uses one slot.
- Episode title card ("EPISODE n") with date, season, today's city event and a "previously" recap.
- Episode end card with a teaser line built from the highest-tension or most one-sided pair.
- Calendar: one episode per in-game day, 15 days apart, so a season runs April → March. Weekdays and weekends, four seasons, seasonal weather (sun, clouds, rain, snow).
- Six city events: cherry blossom viewing, summer beach day, harbor fireworks, autumn matsuri, Christmas lights, New Year shrine visit. Plus a typhoon day that keeps everyone in the house.
- Season finale screen: an epilogue for every housemate (including those who left) and the panel's prediction score.
- The player can "graduate together" when they are in a couple and the conditions are met; this ends their season.

## Characters
- Default cast of five original adults (Ren, Kaito, Shun, Mio, Sora). Each has a full persona: Big-Five traits, attachment style, conflict style, ranked values, need decay rates, long- and short-term goals, a secret, fears, tells, speech profile, weekly routine, tastes, hobbies, backstory and homesickness.
- Speech profiles: sentence length, formality, filler words, humor type, rate-capped catchphrase, chat-app style (stamps, punctuation, reply speed, read-and-ignore chance), three example lines and a "do not" list.
- 14 archetypes for generated casts. "Randomize cast" uses farthest-point sampling so the five are as different as possible, then resamples until the cast has ≥2 compatible pairs, ≥2 friction pairs, a latent love triangle and a stabilizer.
- Replacement housemates arrive when someone leaves (same gender, until the last 3 episodes). They are chosen to stir things up (a new triangle, friction with the most settled pair) while staying unlike the existing cast.
- Every character is 20 or older. This is enforced in the creator, the API and every image prompt.

## Character creator (5 steps, keyboard accessible)
1. Identity: name, age (20–35 enforced), gender, who you're interested in, hometown, occupation (list or custom).
2. Personality: five trait sliders, three quirks (16 to choose from, each with a real effect), and a generated summary sentence.
3. Tastes: six food-preference sliders and three hobbies.
4. Appearance: hair style and color, eyes, build, outfit, accessory, skin tone. A live portrait shows instantly as procedural pixel art, then a low-res generated image, then high-res on confirm. Reroll button with a fixed portrait seed.
5. Housemates: preview of the default cast with portraits, or randomize the cast; optional season seed.

## The house (top-down pixel view)
- Procedurally drawn floor plan from `content/house.json`: two bedrooms, bathroom, rooftop terrace, entrance, living room and kitchen, with floors, walls, doors and about 30 pieces of furniture.
- Walk your character with arrow keys/WASD; collision with walls and furniture.
- Housemates appear as pixel sprites in the room they're actually in, with idle bobbing and walking between rooms. Name and mood labels use text plus a symbol, never color alone.
- Hotspots: press E at the stove (cook), fridge/whiteboard (chores), sofa (hang out), TV (hobby), sink (tidy), rooftop bench, beds (rest) and front door (city map).
- Walk up to a housemate and press E to talk.
- Time-of-day tint and rain on the rooftop.
- Side panel with every action as a button (hang out, cook, rooftop, tidy, hobby, rest, go out, let time pass) and a confirmation of which slot it uses.
- "Who's where" panel: each housemate's portrait, room (or "out"), mood word, new/leaving tags and a talk button.

## Scenes and dialogue
- Two-stage generation: a beat sheet (speaker, intent, emotion, beat type, subtext, depth, topic), then the lines.
- Lines stream token by token over SSE, shown with a typewriter effect that can be skipped (Space/Enter/click).
- Choice point: the player picks one of 2–4 intents (be honest, deflect, flirt, support, joke, tease, apologize, confront, confess, decline, listen) with buttons or number keys. The player's line is written in their own voice; NPCs carry the rest of the scene.
- On-screen captions such as `[awkward silence]`, `[laughter]`, `[voices rising]`, and a speaker's tells when they deflect. Captions can be turned off.
- Location backgrounds (generated or prebaked pixel art, gradient fallback), rain overlay and evening tint.
- Participant portraits, with the current speaker raised.
- Recurring outsiders (café owner, ex, sister on the phone…) speak in scenes.
- Chat scenes are shown inside a phone frame with chat bubbles and a typing indicator.
- Intro card (portrait, name, age, job, hometown) when a new housemate arrives.
- Freeze-frame at the end of big scenes: still image, zoom-in effect and caption.
- Outcome cues with no numbers ("they are together now", "something about Mio came out", "they noticed you listening"); a suitcase animation when someone decides to leave.
- **Eavesdrop / join / ignore** prompt when you walk into an NPC–NPC conversation. Eavesdropping can get you noticed, which costs trust.
- Real mode: rule-based voice check per line (length, formality, catchphrase cap, banned meta phrases), one regeneration on failure, then a template fallback.
- The LLM only proposes relationship changes. The engine validates them (zod), clamps each to ±15, drops unknown ids and applies them.
- Prompts include each speaker's persona card, example lines, speech settings, last two lines, relationship summary, top memories and only the facts that speaker actually knows. The "do not" list is part of the persona card. One user turn per call (works with Gemma), under a hard token budget per call type.

## Studio panel
- Five original panelists (veteran host, stand-up comedian, actress, young idol, novelist), each with a persona, favorite housemates and pet peeves that color their lines.
- After every rendered scene, the strip expands and 2–4 panelists react one by one with avatars, lines and reaction icons (laugh, gasp, cringe, aww, silence, groan).
- They react to NPC-only moments too.
- Predictions: the engine picks a checkable claim (X confesses to Y, X and Y become a couple, X and Y fight, X leaves, all by episode N) and a panelist voices it.
- Predictions resolve automatically (true when it happens, false when the deadline passes). Panelists later call back "I called it" or "I was wrong".
- The panel never gives hints and never changes the game state.
- Panel avatars are prebaked pixel portraits.

## Living world (runs every slot, with or without the player)
- Needs (energy, hunger, social, privacy, romance, achievement) decay at persona-specific rates.
- Each housemate picks an action by utility with seeded randomness: sleep, cook, eat, tidy, work, exercise, hobby, go out, seek someone, avoid someone, text someone, gossip, apologize, confess, retreat. Routines, jobs, goals and values all weigh in.
- Approach/avoid pull toward each person comes from affinity, romance, tension, reputation, beliefs and attachment style (avoidant people damp their pull, anxious people amplify it).
- Housemates in the same room interact: chat, joke, deep talk, flirt, bicker, awkward silence, gossip, apology, confession.
- NPC–NPC romances form and break, couples happen, people fight and reconcile, all without the player.
- Render filter: a moment becomes a full scene if you're there, if it's the most significant of the slot, or if it's an arc beat. Everything else becomes a one-line log entry.
- LLM budget per slot (default 6 calls). Priority: your scene, then arc beats, then other scenes; the rest use templates.

## Knowledge, beliefs and gossip
- Facts are tracked individually. Each character knows a fact through a source: self, witnessed, told, rumor, overheard or group chat, with a confidence level.
- Characters act on beliefs, not the truth. Their estimates of others' feelings are noisy: anxious people over-read signals aimed at them, avoidant people hide their own.
- Gossip: a housemate with a juicy fact and a motive may tell someone they trust. Loyalty, harmony and trust can make them keep a secret instead.
- Gossip can distort as it spreads, creating a "rumor" version of the fact. If a rumor reaches its subject, they resent the teller.
- Secrets can come out through arc events, deep late-night talks or gossip.
- Tested invariants: no character references a fact they don't know, and every passed-on fact has a valid source chain.

## Personal arcs
- Three-act arcs for each default housemate, triggered by conditions:
  - Ren: the family restaurant.
  - Kaito: inflated follower numbers.
  - Shun: the marriage meeting.
  - Mio: the ex.
  - Sora: the album and joining for exposure.
- Five arc templates for generated characters: secret, crossroads, ex returns, breakthrough, homesick.
- Arc decisions can make a housemate leave; having someone in the house worth staying for lowers the chance.

## Relationships and social dynamics
- Directed values for every pair: affinity, romance, tension, trust and closeness. One-sided feelings are tracked and highlighted.
- Conversation depth (small talk → personal → vulnerable) is gated by trust and closeness.
- Reputation per observer: cooking for everyone, skipping chores and public fights all change it. New arrivals pick up first impressions from it.
- Grudges fade over time unless renewed.
- How well an apology works depends on the apologizer's sincerity, how late it comes and the other person's attachment style.
- Shared references (inside jokes, nicknames, running gags, promises) come out of memorable scenes and get recalled later in dialogue and panel lines.
- Mood drifts back to each person's baseline and spreads between people in the same room. Hunger, tiredness, weather and stress affect it.
- Cliques form from mutual liking. A hostile clique can make a new group chat without someone.
- Confessions: anyone can confess. The answer is decided by the other person's real feelings. A yes makes a couple and triggers jealousy in others; a no causes rejection and a grudge.
- Leaving the house: a couple leaves together, an unanswered confession lingers, a streak of low mood, the end of a stay contract, or an arc decision. Someone leaving gets a farewell scene at the door.
- Memory: each character keeps their most important memories (importance × recency), a rolling relationship summary per pair, and a "previously" recap.

## House as shared state
- Fridge stock that cooking uses up, grocery runs and a shared grocery budget.
- Dishes, laundry and trash pile up. The chore rota rotates every episode.
- Done/skipped ledger per person; resentment builds against whoever skips.
- Labeled food that sometimes gets eaten by someone else.
- Morning bathroom queue, night-time noise, aircon temperature disputes.
- 11 domestic events: dishes tower, who ate the pudding, bathroom queue, noise at night, aircon war, laundry mix-up, grocery budget meeting, grocery run, missed trash day, house-rules meeting, rice cooker incident.
- Fridge & chores screen: ingredient counts, labeled food, rota, done/skipped ledger with warnings, meters for dishes/laundry/trash/noise, aircon setting, house rules.

## Events
- 87 event templates: 28 core, 11 domestic, 7 calendar, 30 arc beats, 11 system/interaction templates.
- Required events included: new arrival at the door, chore-rota conflict, late-night kitchen talk, rooftop talk, shared-car date, part-time job mishap, group dinner, jealousy after a date, confession at a scenic spot, farewell at the door, cooking for someone, silent breakfast, birthday, rainy day indoors, group outing, private chat exchange.
- Also included: café date, karaoke duet, solo wander, work shift, gossip on the sofa, apology, the big argument, morning run, movie night, call from home, former housemate visit, neighbor complaint.
- Event director scores candidates for expected drama, variety, pacing (confession/farewell budgets, quiet scenes after peaks) and the player's recent choices. It picks with seeded softmax.

## City
- Fictional coastal city: 19 places across 4 districts (harbor, old town, hillside, coast) with travel times, opening hours (including late-night venues), costs and activities.
- Pixel-art map drawn from `city.json` with time-of-day tint. Reachable places blink; unreachable ones are dimmed with a reason (too far, closed, not enough money, needs the car).
- Shortest-path travel times; a trip must fit the time slot.
- Shared car: unlocks far places and is faster, but only one person can use it per slot.
- Activities: date (invite a housemate), wander, work a shift (earns money), shop, karaoke, eat out, invite housemates.
- Housemates who went to the same place can run into you. Regular locals (café owner, konbini clerk, street musician…) show up on their schedule and remember you.
- Location backgrounds for every place.

## Cooking minigame
- Nine recipes, each with a different chain of steps.
- Five step mechanics:
  - Chop: rhythm hits on a beat track.
  - Boil: stop the timer in the right window.
  - Sauté: hold to keep the pan in a moving temperature band.
  - Season: dial with a hidden best point and one "taste" hint.
  - Plate: drag items to match the chef's photo (keyboard: Tab + arrow keys).
- Steps with no dependencies can be done in any order. One shared time budget; going over it costs quality.
- Final quality is a weighted mean of the step scores. Each eater's reception depends on quality and how well the dish's flavor matches their taste preferences. Reception changes their affinity toward the cook and their mood.
- Co-op: cook with a housemate who auto-plays some of the steps.
- Choose who to serve; missing ingredients mean an "improvised" dish at lower quality.
- After cooking you can sit down to eat (a dinner scene).
- Practice kitchen from the title screen.
- Scoring is pure and tested (always between 0 and 1, never lower for more accurate play).

## Phone
- Private chat threads with each housemate, with read/delivered status.
- House group chat. You can be left out of it; posts carry information to everyone in it.
- Sending a message uses a time slot and starts a chat scene.
- Housemates text each other and you on their own. Anxious senders take a read-and-ignore badly.

## Information screens
- **Relationship board:** graph and table views of affinity, romance or trust. It shows only what you know. Line style shows how you know it (witnessed/your own feelings solid, told dashed, rumor dotted), and "!" marks lopsided relationships. Also lists couples you know of.
- **Character bible:** housemates as you've come to know them. Hobbies, personality, values, tells, goals, fears, backstory and secret unlock with closeness and trust. Known facts are shown with reliability tags.
- **"While you were out" digest:** what you learned during the slot, tagged witnessed / told / rumor, with "might be exaggerated" on rumors.
- **Debug view** (author mode, backtick key): voice-distance matrix between characters, voice-check failures, LLM budget usage per slot, image queue, the real relationship values, arc progress, full event log.

## Images
- ComfyUI backend: API-format workflow plus `mapping.json`, so you can swap workflows without code changes. Progress over websocket.
- Default workflow: Qwen-Image + Lightning 8-step LoRA.
- Priority queue (player portrait > current scene > prefetch), one job at a time, cancellation, disk cache keyed by workflow, prompt, seed and size, indexed in SQLite.
- Prebaked library of 69 pixel-art images (cast and default-player portraits, panel avatars, every city place by day and evening, every house room morning/day/night, title art), generated by `scripts/assets/comfy_gen.py`.
- Prompts are built in one place (`compileAppearancePrompt`): style prefix, an adult tag, a fixed tag order and a fixed seed per character, minors-coded words stripped, and a global safety negative prompt.
- Placeholders: procedural pixel portraits, locations, and freeze-frames that composite the participants over the location.
- Generated images are shown pixelated (nearest-neighbour) with a crossfade from the placeholder.

## Saving and replay
- SQLite: full game state with schema version and a migration stub, memories export, image index, event log.
- Autosave at every slot boundary; five manual save slots; load from the menu.
- `npm run replay -- <saveId>` replays the event log and checks the result is identical to the save.
- The game engine is deterministic: same seed and same actions give the same season.

## Settings and accessibility
- Service status with model and backend names.
- Toggles: captions, typewriter text, reduced motion, image generation (off = placeholders only), sound, author mode.
- Text size from small to extra large.
- Full keyboard play: walking, hotspots, number keys for choices, shortcuts P/B/I/F/M, Escape closes dialogs, visible focus outlines.
- Information is never shown by color alone (symbols, words and line styles).
- Screen-reader labels on the canvas views and buttons, plus table alternatives to the graph and map.
- Synthesized dialogue blips and chimes (WebAudio, no audio files).

## Tooling and tests
- `npm test`: 79 tests, including the 200-seed season simulation (value ranges, knowledge invariant, gossip source chains, NPC romance appearing in some seeds but not all, idle seasons still producing events, departures, arrivals and arc beats), plus determinism, cooking property tests, city tests, prompt budgets, LLM fallback and retry, Ollama streaming, ComfyUI patching, image queue, a full episode with both services down, replay, save/load, and API validation.
- `npm run smoke` (real-service check), `npm run sim` (headless season summary), `scripts/stats.ts` (tuning numbers across seeds).
- Strict TypeScript everywhere, ESLint, Prettier, `npm run build`.
