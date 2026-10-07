# Shared Roof — feature list

Everything below exists in the current code. Where a feature only works in one mode, it says so.

## Added in the October 5–6, 2026 updates

**Shared meal routines**
- New seasons and resumed active saves have a mandatory first-night welcome dinner after the final move-in introduction. All six residents gather in the kitchen, even if they had other plans; skipping or sleeping stops for this dinner. Existing saves enable meals without advancing time or arrivals.
- From day two, breakfast gathers one or two available housemates, while evening dinner gathers everyone available. Shifts, lectures, plans, outings, sleep and private routines affect attendance. Students can eat before their late-morning lectures.
- Meals start while free at home in the first hour of morning/evening, or immediately through **hang out**. Ordinary meals preserve explicit talks and outings. The table supports choices, addressed typed words and listening.
- Breakfast lasts at least 20 game minutes, dinner 40. The ready-to-eat vegan, kosher spread feeds every diner, uses fridge supplies/shared grocery budget, adds dishes and shared memories, and works on Shabbat. Meal completion is recorded once per day; saves and replay reproduce it.

**Everyday life together (goal 5)**
- The house's **everyday life** panel offers 15 quick activities: dishes, laundry, recycling, a house clean, sorting shelves, organizing the fridge, cooking for the house, coffee and tea, setting the table, plants, stretching, music, games, studying and small repairs.
- Choose alone or invite one housemate. You can join a housemate partway through their activity and type freely while it continues. Ending the talk finishes the remaining work; longer talks continue after the activity is done.
- Activities take 10–40 game minutes and require no extra minigames. Detailed cooking is still available. Dishes, laundry and recycling reduce the existing backlogs; housework credits both helpers. Shared-time bonuses are capped per pair per block.
- NPCs choose the same activities from needs, personality, hobbies and household backlogs, and may join another NPC. Cooking reserves ingredients once, then serves a real meal to available residents within the recipe's serving count, checking diets and kitchen routines. A meal already underway takes priority; other cooks can join it instead of starting another meal.
- Supportive check-ins, cold shoulders and jealousy widen NPC conversations. Jealousy needs a recent fact known to that character. Memories and small grudges carry friction into later choices; apologies help repair it.

**Chat log and re-read**
- A **chat log** screen (top bar) lists every finished conversation of the current day with its full transcript.
- **Re-read this scene / re-read all** asks the dialogue model to read today's finished scenes again. Affinity, romance, trust and tension are corrected to match what was actually said, and the player's board estimates follow the corrections. Repeated readings replace previous effects; saves and replays reproduce them. Failed or empty readings remain retryable; pending readings and overheard chats are skipped by re-read all.
- Re-read covers scenes with a written transcript only. NPC-only scenes resolved without dialogue are not included, and earlier days are not touched.

**Overheard housemate conversations**
- At the end of each time block, up to three background interactions become four lines of real dialogue, including ordinary chats, jokes, shared activities, check-ins, awkward exchanges, cold shoulders and jealousy alongside arguments, flirts, confessions, heart-to-hearts and apologies.
- The game's rules still decide who interacts, what kind of exchange it is and how it ends (a rejected confession stays polite, a petty argument stays unresolved); the model only voices it.
- The lines become both housemates' memories. They show in the chat log, marked "overheard", only if you were in the room. No template stand-in: an unusable answer shows nothing.
- Witnessed conversations from the previous day's last block stay in the next day's log, labeled **last night**. Generation uses the completed block's snapshot and recorded outcome.
- Runs in the background, one at a time, skipped while you are busy.

**Slower, more believable feelings**
- Affinity and romance from scenes and background chats count at half strength (`FEELING_SCALE` in `engine/core.ts`), so friendships and crushes build over days. Trust and tension are unchanged.
- A model reading that moves no feeling at all (an empty proposal) falls back to the game's own numbers instead of applying nothing.
- Only affinity can go below zero; romance, trust, tension and closeness run 0–100.

**Dialogue quality and the Rocinante model**
- Replies to typed words are 2–4 sentences and must add something real: a detail from the speaker's life, an honest opinion, a feeling, or a question back. Housemates notice actions written in your text ("I light up a cigarette").
- Line parsing tolerates roleplay-model formatting: `*actions*`, quote wrapping, backticks, bold or capitalised ids, narration paragraphs, and a speaker's quoted words continuing on the next paragraph. Lines are cut to four sentences.
- `terrace-rocinante:12b-q4` (Rocinante-X 12B, Mistral v3 Tekken template without `[SYSTEM_PROMPT]`) is set as the lines model in `.env`; see [docs/models/RocinanteX12B.Modelfile](docs/models/RocinanteX12B.Modelfile). Gemma 4 12B still handles structured calls. Rocinante has had only small probes, not a full benchmark.
- `scripts/conversation-probe.ts` and `scripts/overheard-probe.ts` print sample chats from the real model.

**Fixes**
- **Class:** a student can join a lecture late (30 minutes of the block must remain, no return leg needed). The message now says "too late: the lecture is nearly over". Before, long chats used up the block and the button failed with "too far for this slot".
- **Scene images** now stage your own typed action as well as the last NPC speaker's.
- **Seated housemates** keep foreshortened legs instead of having them cut off.
- **Relationship board** table caption explains that rows feel about columns, that your row is your real feelings, and that the other rows are your estimate.

## Added in the October 2–3, 2026 updates

**The house, remade like Terrace House Tokyo 2019–2020**
- An indoor pool behind a floor-to-ceiling glass wall. An upstairs landing opens onto the living room below, with a glass balustrade.
- A kitchen island with stools, a shaggy sheepskin rug, poufs, brass floor lamps and lanterns.
- A bright, cream women's room and a cabin-like men's room with dark wood panelling.
- Everyday clutter: kicked-off sneakers, magazines, a guitar, clothes rails, a washer, weights, floor cushions, and framed prints and shelves on the walls.
- About 40 furniture sprites and the visual-novel room backgrounds were drawn with ComfyUI (`scripts/assets/house_assets.py`, `comfy_gen.py`). The floors are procedural oak, dark wood and cream carpet.
- The house view starts at least 3×, expands to the available viewport, and follows you. Zoom controls allow a closer or wider view. Housemates walk real paths around furniture and through doors.
- Walking through a doorway never freezes input.

**Move-in day**
- Day one starts in the morning with you and one housemate. The second housemate arrives after a little conversation; the rest arrive one at a time through evening.
- The second housemate joins an ongoing conversation. Later arrivals pause it for introductions, then you choose a housemate to keep talking with or continue exploring.
- Tutorial tips appear when a system first matters: walking and E, the time blocks, talking, the phone, the board, the map, cooking. Skip them in the creator or on any tip; replay them from Settings → "how to play".

**Budget levels instead of money**
- No shekel balance. Your budget level (tight / modest / comfortable / generous) comes from your job, and a part-time job lifts it one step.
- Places, gifts and trips have price levels (₪ / ₪₪ / ₪₪₪). You can do anything at or below your level, and stretch one level above now and then: it strains you, and a date notices.
- You can treat a guest who can't afford a place.
- Housemates keep to their own budget when they go out, and pick up extra shifts to afford a trip.

**Careers and stays**
- Housemates change careers mid-season: back to school, starting a business, switching fields. They announce it in the group chat, and their schedule and career arc follow.
- About 40% of housemates have no fixed stay. They leave only for a reason, or stay until the finale.

**Broadcast lag**
- Each episode airs on the living-room TV two episodes later, as an evening scene.
- Housemates learn what was said behind their backs (a new `broadcast` knowledge source), hear the panel's remarks about them, and react: tension, lost trust, embarrassment.
- "Watch the episode" replays every scene as it aired, with yours highlighted.

**Daily life**
- **Work and class:** "Go to work" / "go to class" buttons when a shift or lecture is due. Students have a weekday timetable at Tel Aviv University and exam weeks every sixth episode. A missed exam costs more than a missed lecture.
- **Knocking:** both floors are walkable. Walking into the other bedroom knocks, and you go in only if someone inside answers and lets you in. The house overhears either way.
- **Sleepwear:** after 23:00, walk sheets and visual-novel figures switch to sleep outfits.

**Romance milestones**
- First date → "is this a date?" → hand-holding → first kiss.
- Each step is gated by romance and trust, gets its own scene and freeze-frame, and becomes a fact the house can find out.

**Overnight trips**
- Galilee campsite, the Dead Sea or Eilat, Friday morning to Saturday morning in the shared car.
- On Thursday evening, a housemate who likes you texts you an invitation, and Friday's panel opens with it filled in.
- You pick who comes and who shares your room. Shabbat observers stay home, and budgets apply.
- The drive and a late-night talk are scenes, and the group comes home on Saturday morning to a return scene at the door.
- If you don't go, a close pair or a couple may go without you: they are away all night, post from the trip, and text a close friend a photo.

**Life outside the house**
- Each housemate has a family member, a best friend and an ex, written into their character.
- They call, turn up at the door, or text out of nowhere.

**The panel**
- Panelists coin one nickname per housemate from a memorable moment ("Confession Ron") and reuse it all season.

**Images**
- Freeze-frames, "generate scene", feed photos and selfies show up to six people, each with their own portrait as a reference (Qwen-Image 2.1, `workflows/group_ref.api.json`).
- Before each freeze-frame, the LLM describes the shot: who stands where, poses, a prop.
- Feed photos are generated when you open the feed. Ask for a "pic" in a chat and the reply comes with a selfie.
- Visual-novel figures are sharper: no more nearest-neighbour downscaling, and framed portraits use half the pixel factor.
- Saved portraits, outfits, expressions and cutouts are reused after a restart, and stay available when ComfyUI is offline.

**Memory and dialogue (SillyTavern ideas)**
- Housemates who aren't addressed chime in by personality, mood and closeness to the speaker. Busy listeners stay quiet.
- **Keep listening:** stay quiet and two housemates carry the conversation on their own.
- At the end of each episode, every housemate writes a diary entry and their own view of each housemate, from only what they know. Dialogue then uses those notes.
- **Recall:**
  - Old memories are archived instead of deleted, and come back when someone mentions them.
  - Places, recurring outsiders and trip spots enter the prompt only when mentioned.
  - A recalled memory stays in that speaker's context for the scene, then rests for a few episodes.
  - Recall by meaning (Ollama embeddings) switches on once `nomic-embed-text` is installed.
- What you type changes the listener's face, from a local keyword emotion reader: a compliment makes them shy, an insult annoyed.
- Sampler presets per model family (min_p, top_k, repeat penalty), overridable with `OLLAMA_OPTIONS`.

**Performance on one GPU**
- Each rendered scene gets its own LLM call budget (`LLM_CALLS_PER_SCENE`, default 8). The old block-wide budget of 6 ran dry on the first scene and templated the rest.
- The idle LLM is unloaded before each image (`FREE_LLM_FOR_IMAGES`). A resident LLM made ComfyUI 20–50× slower on 16 GB.
- Starting dialogue interrupts a running background image and requeues it.

## Added in the October 2, 2026 update

- **Expression icons:** scene portraits and the character bible offer neutral, happy, sad, angry, in-love, shy, awkward, annoyed, excited and nervous faces. Click to generate through ComfyUI's reference workflow; variants cache separately, keep the original palette and never advance game time. The original portrait must be ready first. Offline mode keeps the original face and reports that the expression is unavailable. Selection changes the illustration, not the character's feelings.
- **Shared-history journal:** each character bible card shows your current relationship summary and up to five important shared memories, from your character's perspective. Private NPC memories remain hidden. Dialogue now builds relationship summaries from current state, including new interactions before the block ends. Memories and pair summaries already persist in saves; the existing 40-memory importance/recency limit remains.
- **Minute-by-minute housemate life:** timed activities (40-minute showers, 90-minute naps, 20-minute snacks), hourly conversations/gossip and deterministic time advancement. Working, sleeping, napping or showering housemates cannot be pulled into unrelated house scenes.
- **More control over time:** six daily blocks, including late night from 23:00–02:00; daily timeline, skip block and sleep until morning. Trips must fit outward travel, the activity and the return journey into the minutes left.
- **Seasons you can keep playing:** open-ended creator default, optional fixed length and a wrap-season action after episode 3 that makes the next full episode the finale, with confessions, epilogues and prediction resolution.
- **Career progression:** fourteen career arcs across seven job families, player contracts/workplace scenes, raises, dismissal, offers, coworker visits and work stress.
- **Generated personalities:** real-mode biographies and speech profiles, field validation/fallback, one retry for overly similar voices, saved persona snapshots and exact replay. Generated content preserves identity, traits and job schedules.
- **Describe your appearance:** free-text appearance mapping, sanitized image prompts and sprite colors sampled from the approved portrait. Sampled colors take priority over provisional model colors.
- **Generate scene:** illustrate any conversation you join, including phone messages, from its participants, location and recent dialogue. The button opens an image preview without ending the conversation or advancing time; phone scenes show the characters in separate places.
- **Tel Aviv setting:** local cast and recurring people, city places, price levels, local recipes, Sunday–Thursday work, Friday half-days, holidays, seasonal rain and sharav heatwaves.
- **Diet and observance:** strict/style/no kashrut, vegetarian/vegan choices, meat/dairy/parve food, separate pans and a marked shelf. Food acceptance, trust and kitchen disagreements respond to those choices. Shabbat observers stop work, cooking, car use and phone activity at the boundary.
- **Two-floor house:** ground-floor entrance, living room, kitchen, small bathroom and shared backyard; upstairs bedrooms, private balconies and main bathroom. Visible stair traversal and opening/closing doors; private-room invitations are enforced. Reduced motion skips stair animation, and actions are disabled while walking between rooms.
- **Plans with consequences:** NPC approaches, shared-calendar invitations, kept/broken promises, impossible-plan cancellation and shared-car availability checks. Car reservations and observance/opening-hour changes are respected when plans are carried out.
- **Small social gestures:** taste-aware gifts, coffee, notes, favors, recurring visitors, housemate barks and daily relationship upkeep.
- **A visibly lived-in home:** clutter, dishes, laundry, trash, fridge stock, clock-based lighting/lamps, synthesized ambience and phone notifications as game minutes advance.
- **Weather and learned routines:** tomorrow's forecast, rain-cancelled outdoor plans, heatwave mood effects and routines recorded in the character bible when you observe them.
- **Social photos and stories:** persisted appearance/location snapshots, feed likes and public knowledge with sources. Posting together establishes a shared moment, not a romance.
- **More responsive dialogue:** optional separate speaking model (`OLLAMA_MODEL_LINES`), independent fallback, speaker/content checks and stronger exact-word reply instructions. Direct replies prioritize what you typed, including refusals, over competing scripted topics.
- **New artwork:** 79 new ComfyUI images—six cast portraits, 36 city views, 36 house views and the title image—plus five retained panel avatars. All 83 manifest keys resolve; the title loads separately. Live and prebaked backgrounds share room/location viewpoints.
- **Model comparison tools:** reproducible 20-scene-per-model benchmark, single-reply probes and a real structured-generation/replay check. Gemma 4 remains the local default after comparison with Stheno; Stheno was faster but less reliable about speaker format and player agency.
- **A clearer play loop:** choose how to spend limited time, keep plans, learn routines, remember food preferences and follow career/social consequences. Friendship and staying single remain valid paths; player enjoyment still needs playtesting.

Verification: 115 tests in the full run, 29 subsequent focused checks, seven browser flows, production build/typecheck/lint, and live dialogue/commentary/image smoke passed. The real structured-generation probe passed all ten checks. See [IMPLEMENTATION.md](IMPLEMENTATION.md), [artwork coverage](docs/ARTWORK.md) and [model evaluation](docs/ROLEPLAY.md).

Known limits: holidays and Friday/Saturday 18:00 Shabbat boundaries are approximations; NPC time advances with game actions. Portrait colors use central-region sampling rather than segmentation; feed pictures were procedural freeze frames (generated since October 3). Additional weather/custom-cast images generate at runtime. Testing with both services open does not establish simultaneous full image-model and LLM GPU residency.

## Start a fresh game on this machine

Keep Ollama and ComfyUI running. The existing `.env` selects real mode, `hf.co/Nubinu/Qwen3.5-4B-MiniFantasy-GGUF:Q4_K_M` for planning, `llama3.2:latest` for spoken lines, and ComfyUI at port 8188.

```powershell
cd C:\Projects\terrace_house
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), click **new season**, complete the five creator steps and click **move in**. The season opens with move-in day; leave it open-ended to try the wrap-season flow. Keep the default cast for the new portraits, or choose **randomize cast** to try generated housemates. Leave the terminal running while playing. If the game is already running, reload the page and choose **new season**.

Start by walking with **WASD/arrows**, pressing **E** at a person or hotspot, and opening the phone with **P** to check messages and plans. If you want a quick session without waiting for models, use `npm run dev:mock` instead.

## Modes and setup
- **Mock mode** (`npm run dev:mock`): fully playable with no external services. Text comes from templates, images from procedural pixel art plus the prebaked asset library.
- **Real mode** (`npm run dev`): dialogue from Ollama (any chat model; currently MiniFantasy 4B for planning and Llama 3.2 3B for lines, see [docs/ROLEPLAY.md](docs/ROLEPLAY.md)), images from ComfyUI.
- Automatic per-call fallback: if Ollama or ComfyUI is down or slow, that call uses templates/placeholders and the game keeps going.
- `/api/health` probe; title screen and top bar show "text: model / templates" and "images offline" badges.
- Model warm-up request at server start in real mode.
- Configuration through `.env` (`.env.example` provided): mode, URLs, model, workflow paths, style prefix, season length, LLM calls per scene, LLM unloading before images, sampler overrides, embedding model, seed, port, timeouts, temperatures, optional premise "flavor pass".

## Season and episode structure
- Open-ended by default (`SEASON_LENGTH=0`); fixed length is optional. After episode 3, announce a finale for the next full episode. Graduations keep rotating the cast until the finale.
- Each episode: morning → three daytime slots → evening → late night (23:00–02:00), 180 in-game minutes each, with a clock. Talking lasts as long as the conversation (3 min per line); short house activities use part of a slot (tidy 30, cook 60…); going out, resting or letting time pass uses the whole slot.
- Episode title card ("EPISODE n") with date, season, today's city event and a "previously" recap.
- Episode end card with a teaser line built from the highest-tension or most one-sided pair.
- **Studio intermissions** like the show's: the footage stops halfway through the day (after the afternoon) and again after the last scene, and the panel talks over the most important moments since the last break, riffing off each other. The host opens; at the end of an episode the host signs off with the teaser. Works with the LLM or templates.
- Calendar: consecutive days, Sunday–Thursday work, Friday half-days and Saturday openings. Seasonal sun/cloud/rain and sharav heatwaves; no generated snow. Holiday dates are fixed game-calendar approximations.
- Local events: Purim, Independence Day, Shavuot, Pride, Rosh Hashanah, Sukkot, Hanukkah, Friday dinner and beach days. A sharav heatwave keeps people indoors.
- Season finale screen: an epilogue for every housemate (including those who left) and the panel's prediction score.
- **You can graduate too**: leave alone, accept a departing partner's invitation, or ask your partner to come. They can choose to stay; the confirmation explains that you will leave alone if they decline. Your farewell plays at the door, anyone who leaves is replaced, and then you **create your next character**, who rings the doorbell as a stranger while the season carries on.

## Characters
- Real mode generates validated persona fields and appearance text, retries an overly similar voice once, and logs complete snapshots for deterministic replay. Mock mode uses seeded archetypes.
- Kashrut (strict/style/none), vegetarian/vegan diets and Shabbat observance affect cooking, work, cars and phone availability.
- **Jobs with real schedules** (``content/jobs.json``, 77 occupations): each job has a workplace (a city spot, the station for commuters, or their own room for remote work) and a shift pattern (early, day, late, night, flex) on weekdays, weekends or mixed days. Housemates actually go to work on those slots (night-shift nurses are out in the evening, bartenders at the Florentin bar, remote workers in their rooms), so you can run into them at work. The character bible shows where and when they work once you know them a little.
- Housemates also graduate when they've **found what they came for** (their arc is complete), unless someone in the house is worth staying for.
- Default cast of five original adults (Ron, Kai, Shai, Maya, Shira); stable internal ids remain unchanged. Each has a full persona: Big-Five traits, attachment style, conflict style, ranked values, need decay rates, long- and short-term goals, a secret, fears, tells, speech profile, weekly routine, tastes, hobbies, backstory and homesickness.
- Speech profiles: sentence length, formality, filler words, humor type, rate-capped catchphrase, chat-app style (stamps, punctuation, reply speed, read-and-ignore chance), three example lines and a "do not" list.
- **24 personality archetypes** for generated casts (quiet craftsman, hype creator, gentle mediator, anxious caretaker, blunt artist, sunny athlete, cool strategist, dreamy romantic, class clown, homebody gamer, elegant heiress, earnest student, wanderer, big sister, night-shift nurse, ambitious salesperson, aspiring comedian, fashion student, zen instructor, shy illustrator, rebel courier, kindergarten sunshine, jet-setter, country kid). "Randomize cast" uses farthest-point sampling so the five are as different as possible, then resamples until the cast has ≥2 compatible pairs, ≥2 friction pairs, a latent love triangle and a stabilizer.
- Leaving follows the show: whoever decides to go **announces it to the house** the next day, gets one last day, then leaves at the door the morning after. A last-day confession can start a relationship, but leaving together is a separate decision. NPC partners need their own reason to leave and enough mutual goodwill; the player explicitly accepts or stays.
- **Past residents visit**, including your previous player character: occasional evening reunions after at least three episodes away, with a three-episode cooldown between visits. They keep their saved memories, relationships and knowledge, meet newcomers, and can exchange gossip with its source recorded. They remain guests; they do not take a resident slot or rejoin the group chat.
- A **welcome party** (shared dinner, `so what do you want to get out of this house?`) for each newcomer, the player included.
- **Every graduation brings a newcomer**: a replacement of the same gender arrives the same day, right up to the last episode. They are chosen to stir things up (a new triangle, friction with the most settled pair) while staying unlike the existing cast.
- Every character is 20 or older. This is enforced in the creator, the API and every image prompt.

## Character creator (5 steps, keyboard accessible)
1. Identity: name, age (20–35 enforced), gender, who you're interested in, hometown, occupation (77 jobs from the catalogue, or custom).
2. Personality: start from any of the 24 personality types (sets the sliders and a matching job, shows your closest type), five trait sliders, three quirks (16 to choose from, each with a real effect), and a generated summary sentence.
3. Tastes: six food-preference sliders and three hobbies.
4. Appearance: hair style/color, eyes, build, outfit, accessory and skin; describe your look in free text and map it to those fields. Generate a portrait and walking sprite when the look is ready, using the same rendering as the housemates. Preview the walk animation in four directions beside the portrait; reduced-motion settings pause the animation. Change the sprite independently or describe a correction and fix it while keeping the portrait. The selected sprite seed and corrections carry into the game and saves. Editing keeps the last preview visible and creates no image jobs; reroll portrait generates another variation. The default player uses prebaked artwork immediately. Custom artwork shows a labeled temporary preview while generating or offline.
5. Housemates: preview or randomize the cast; optional seed, open-ended default or fixed season length.

## The house (top-down pixel view)
- Two floors from `content/house.json`: ground-floor entrance, living room, kitchen, small bathroom and an indoor pool deck behind glass; upstairs a landing over the living room, an upstairs hall, bedrooms, private balconies and the main bathroom. Stairs change floors; the other bedroom needs a knock and an answer, another bedroom's balcony an invitation.
- Walk your character with arrow keys/WASD; collision with walls and furniture.
- Housemates appear as pixel sprites in the room they're actually in, with idle bobbing and walking between rooms. Sprites are shaded (light from the top-left), with per-style hair (bob, braids, ponytail, buzz, messy, long), two-pixel eyes, swinging arms, outfit details (skirts, shorts, aprons, jackets, stripes), build width and accessories (glasses, caps, headphones, scarves, hair clips, ear cuffs).
- Activity emotes above housemates you can see: asleep, cooking, eating, hobby, working, exercising, texting, tidying, keeping to themselves. Name and mood labels use text plus a symbol, never color alone.
- Hotspots: press E at the stove (cook), fridge/whiteboard (chores), sofa (hang out), TV (hobby), sink (tidy), pool deck, beds (rest) and front door (city map).
- Walk up to a housemate and press E to talk.
- Clock-based light, lamps and rain on the pool deck and balconies; dishes, laundry, trash, groceries and living-room mess are visible.
- Side panel with every action as a button (hang out, cook, backyard, tidy, hobby, rest, go out, skip block, sleep until morning, wrap season) and a confirmation of which slot it uses.
- "Who's where" panel: each housemate's portrait, room (or "out"), mood word, new/leaving tags and a talk button.

## Scenes and dialogue
- **Type to the characters**: at your turn in any scene you can pick a response *or type your own words* (up to 200 characters). The housemate who spoke last answers what you actually said, in their own voice and according to how they feel about you; then it's your turn again (up to 30 exchanges) until you press "that's all". The engine reads an intent from your words (confess, apologize, confront, flirt, support, joke, tease, deflect, listen, honest) so relationships move just as with the buttons, and everyone present remembers what you said (it comes back in later dialogue). In real mode the LLM sees your exact words; in mock mode template replies echo them.
- **Typed phone messages**: write the message yourself on the phone; it opens the chat and the reply thread is kept in the chat history.
- Two-stage generation: a beat sheet (speaker, intent, emotion, beat type, subtext, depth, topic), then the lines.
- Lines stream token by token over SSE, shown with a typewriter effect that can be skipped (Space/Enter/click).
- Choice point: the player picks one of 2–4 intents (be honest, deflect, flirt, support, joke, tease, apologize, confront, confess, decline, listen) with buttons or number keys, or types their own words (see above). A picked intent is written as a line in the player's own voice; NPCs carry the rest of the scene.
- On-screen captions such as `[awkward silence]`, `[laughter]`, `[voices rising]`, and a speaker's tells when they deflect. Captions can be turned off.
- Location backgrounds (generated or prebaked pixel art, gradient fallback), rain overlay and evening tint.
- Participant portraits, with the current speaker raised.
- Recurring outsiders (café owner, ex, sister on the phone…) speak in scenes.
- Chat scenes are shown inside a phone frame with chat bubbles and a typing indicator.
- Intro card (portrait, name, age, job, hometown) when a new housemate arrives.
- Freeze-frame at the end of big scenes: still image, zoom-in effect and caption.
- Outcome cues with no numbers ("they are together now", "something about Maya came out", "they noticed you listening"); a suitcase animation when someone decides to leave.
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

## Living world (minute schedules and hourly interactions)
- Activity deadlines let housemates shower for 40 minutes, nap for 90, snack for 20, then choose again. Hourly interactions use lighter relationship changes than full conversations.
- NPC approaches, invitations on a shared calendar, kept/broken promises, barks, gifts/favors, recurring visitors and daily relationship upkeep.
- Rain cancels outdoor plans, heatwaves affect mood, tomorrow's forecast is visible, and the bible records routines you actually observe.
- Needs (energy, hunger, social, privacy, romance, achievement) decay at persona-specific rates.
- Each housemate picks an action by utility with seeded randomness: sleep, cook, eat, tidy, work, exercise, hobby, go out, seek someone, avoid someone, text someone, gossip, apologize, confess, retreat. Routines, jobs, goals and values all weigh in.
- Approach/avoid pull toward each person comes from affinity, romance, tension, reputation, beliefs and attachment style (avoidant people damp their pull, anxious people amplify it).
- Housemates in the same room interact: chat, joke, deep talk, flirt, bicker, awkward silence, gossip, apology, confession.
- NPC–NPC romances form and break, couples happen, people fight and reconcile, all without the player.
- Render filter: a moment becomes a full scene if you're there, if it's the most significant of the slot, or if it's an arc beat. Everything else becomes a one-line log entry.
- LLM budget per rendered scene (`LLM_CALLS_PER_SCENE`, default 8: beats, lines, voice retries, outcome, commentary); anything beyond uses templates. Unrendered moments never call the LLM.

## Knowledge, beliefs and gossip
- Facts are tracked individually. Each character knows a fact through a source: self, witnessed, told, rumor, overheard or group chat, with a confidence level.
- Characters act on beliefs, not the truth. Their estimates of others' feelings are noisy: anxious people over-read signals aimed at them, avoidant people hide their own.
- Gossip: a housemate with a juicy fact and a motive may tell someone they trust. Loyalty, harmony and trust can make them keep a secret instead.
- Gossip can distort as it spreads, creating a "rumor" version of the fact. If a rumor reaches its subject, they resent the teller.
- Secrets can come out through arc events, deep late-night talks or gossip.
- Tested invariants: no character references a fact they don't know, and every passed-on fact has a valid source chain.

## Personal arcs
- Fourteen career arcs: two each for food, health, creative, trades, office, student and service, including player contracts and workplace beats. Shifts can bring raises, dismissal, offers, coworker visits or stress.
- Three-act arcs for each default housemate, triggered by conditions:
  - Ron: the family restaurant.
  - Kai: inflated follower numbers.
  - Shai: family pressure about settling down.
  - Maya: the ex.
  - Shira: the album and joining for exposure.
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
- Leaving the house: unresolved rejection, low mood, the end of a planned stay, or an arc decision. Dating alone never forces a departure. Partners leave together only when both agree; leaving separately does not automatically break them up. Residents with no fixed stay can remain until the finale.
- Memory: each character keeps their 40 most important memories (importance × recency) active and archives the rest for recall, writes an end-of-episode diary (real mode), keeps a relationship note per housemate (LLM-written, template fallback), and the episode gets a "previously" recap.

## House as shared state
- Fridge stock that cooking uses up, grocery runs and a shared grocery budget.
- Dishes, laundry and trash pile up. The chore rota rotates every episode.
- Done/skipped ledger per person; resentment builds against whoever skips.
- Labeled food that sometimes gets eaten by someone else.
- Morning bathroom queue, night-time noise, aircon temperature disputes.
- 11 domestic events: dishes tower, who ate the pudding, bathroom queue, noise at night, aircon war, laundry mix-up, grocery budget meeting, grocery run, missed trash day, house-rules meeting, rice cooker incident.
- Fridge & chores screen: ingredient counts, labeled food, rota, done/skipped ledger with warnings, meters for dishes/laundry/trash/noise, aircon setting, house rules.

## Events
- Core, domestic, local-calendar, career/personal-arc and system/interaction event templates.
- Required events included: new arrival at the door, chore-rota conflict, late-night kitchen talk, backyard talk, shared-car date, part-time job mishap, group dinner, jealousy after a date, confession at a scenic spot, farewell at the door, cooking for someone, silent breakfast, birthday, rainy day indoors, group outing, private chat exchange.
- Also included: café date, karaoke duet, solo wander, work shift, gossip on the sofa, apology, the big argument, morning run, movie night, call from home, former housemate visit, neighbor complaint.
- Event director scores candidates for expected drama, variety, pacing (confession/farewell budgets, quiet scenes after peaks) and the player's recent choices. It picks with seeded softmax.

## City
- Tel Aviv places across Jaffa, Florentin, Neve Tzedek/Rothschild, central/north and beach districts, with weekday opening hours, travel times and price levels (₪ / ₪₪ / ₪₪₪).
- Pixel-art map drawn from `city.json` with time-of-day tint. Reachable places blink; unreachable ones are dimmed with a reason (too far, closed, needs the car); prices show whether they are in, a stretch for, or out of your budget.
- Shortest-path travel times; outward journey, activity and return journey must fit the minutes remaining, and the venue must be open when you arrive.
- Shared car: unlocks far places and is faster, but only one person can use it per slot.
- Activities: date (invite a housemate), wander, work a shift, attend class (students), shop, karaoke, eat out, invite housemates.
- **Part-time contracts**: sign on at a work spot for that time slot on three fixed weekdays. A contract lifts your budget a level while you keep it; the house screen offers "go to work" when a shift is due; two missed shifts and the manager lets you go (extreme weather excused).
- Housemates who went to the same place can run into you. Regular locals (café owner, makolet owner, street musician…) show up on their schedule and remember you.
- Location backgrounds for every place.

## Cooking minigame
- Local recipes (shakshuka, sabich, hummus, schnitzel and Friday chicken), each with a chain of steps. Meat/dairy/parve and vegan/vegetarian tags, separate pans and a marked kosher shelf affect whether housemates eat and trust the cook.
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
- Unread notifications update as world minutes advance. Shared plans and a social feed of photos/stories (generated with everyone's real face, procedural until ready) show who posted with whom and who liked them. Asking for a picture in a chat gets a selfie back.
- A photo establishes that people posted together; it does not establish a romance. Public posts enter the existing knowledge system with their source retained.
- Private chat threads with each housemate, with read/delivered status.
- House group chat. You can be left out of it; posts carry information to everyone in it.
- Sending a message starts a chat scene and consumes the actual conversation minutes. You can type the message yourself; the conversation is saved in the thread.
- Housemates text each other and you on their own. Anxious senders take a read-and-ignore badly.

## Information screens
- **Relationship board:** graph and table views of affinity, romance or trust. It shows only what you know. Line style shows how you know it (witnessed/your own feelings solid, told dashed, rumor dotted), and "!" marks lopsided relationships. Also lists couples you know of.
- **Character bible:** housemates as you've come to know them. Hobbies, work schedule, personality, values, tells, goals, fears, backstory and secret unlock with closeness and trust. Known facts are shown with reliability tags.
- **"While you were out" digest:** what you learned during the slot, tagged witnessed / told / rumor, with "might be exaggerated" on rumors.
- **Debug view** (author mode, backtick key): voice-distance matrix between characters, voice-check failures, LLM budget usage per slot, image queue, the real relationship values, arc progress, full event log.

## Images
- ComfyUI backend: API-format workflow plus `mapping.json`, so you can swap workflows without code changes. Progress over websocket.
- Default workflow: Qwen-Image + Lightning 8-step LoRA.
- Priority queue (player portrait > current scene > prefetch), one job at a time, cancellation, disk cache keyed by workflow, prompt, seed and size, indexed in SQLite.
- Versioned Tel Aviv asset manifest with 84 valid PNGs: 79 newly generated local cast/title/place/room images and five retained panel avatars. All 83 manifest keys resolve. Room viewpoints are shared with live generation; procedural art remains the fallback. See [docs/ARTWORK.md](docs/ARTWORK.md).
- **Consistent faces**: freeze-frames, scene images, feed photos and selfies pass every participant's approved portrait (up to six) to a Qwen-Image 2.1 group workflow (`workflows/group_ref.api.json` + `group_ref_mapping.json`); outfit and expression edits use Qwen-Image-Edit 2511 (`workflows/ref_edit.api.json`).
- One GPU for both services: while dialogue streams, the image queue waits, a running background image is interrupted and requeued, and ComfyUI unloads its models; before each image the idle LLM is unloaded (`FREE_LLM_FOR_IMAGES`).
- Prompts are built in one place (`compileAppearancePrompt`): style prefix, an adult tag, a fixed tag order and a fixed seed per character, minors-coded words stripped, and a global safety negative prompt.
- Placeholders: procedural pixel portraits, locations, and freeze-frames that composite the participants over the location.
- Generated images are shown pixelated (nearest-neighbour) with a crossfade from the placeholder; visual-novel figures are scaled smoothly to keep their detail.

## Saving and replay
- SQLite: full game state with schema version and a migration stub, memories export, image index, event log.
- Autosave at every slot boundary; five manual save slots; load from the menu.
- `npm run replay -- <saveId>` replays the event log and checks the result is identical to the save.
- The game engine is deterministic: same seed and same actions give the same season.

## Settings and accessibility
- Service status with model and backend names.
- Toggles: captions, typewriter text, reduced motion, image generation (off = placeholders only), sound, author mode, tutorial tips (plus "how to play" to replay them).
- Text size from small to extra large.
- Full keyboard play: walking, hotspots, number keys for choices, shortcuts P/B/I/F/M, Escape closes dialogs, visible focus outlines.
- Information is never shown by color alone (symbols, words and line styles).
- Screen-reader labels on the canvas views and buttons, plus table alternatives to the graph and map.
- Synthesized dialogue blips and chimes (WebAudio, no audio files).

## Tooling and tests
- `npm test`: unit/integration tests, including the 200-seed season simulation (value ranges, knowledge invariant, gossip source chains, NPC romance appearing in some seeds but not all, idle seasons still producing events, departures, arrivals and arc beats), plus determinism, cooking property tests, city tests, prompt budgets, LLM fallback and retry, Ollama streaming, ComfyUI patching, image queue, a full episode with both services down, replay, save/load, and API validation.
- `npm run test:e2e`: browser end-to-end tests (Playwright, system Edge): creator → a full first episode with both studio intermissions → episode 2, intermission panel lines, typing your own words in a scene, graduating and moving in as someone new, signing a job contract on the city map, the visual-novel group scene, activity feedback, a weekend trip end to end, and E-key responsiveness (16 specs).
- `npx tsx scripts/real-episode.ts [seed]` (one full real-mode move-in episode: scene times, LLM share, sprite gate, prefetch; report in `logs/`), `npm run smoke` (real-service check), `npm run sim` (headless season summary), `scripts/stats.ts` (tuning numbers across seeds).
- Strict TypeScript everywhere, ESLint, Prettier, `npm run build`.
