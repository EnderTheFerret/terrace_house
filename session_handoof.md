# Session handoff

Updated: 2026-10-07 (Asia/Jerusalem). Latest workflow status is below; older sections record earlier experiments.

## Returning graduates and world realism (2026-10-08, later)
- [x] **Graduates move back** (`leave.ts`): after `RETURN_AFTER` = 4 days away a graduate (never a former player character, never one who left with their partner, at most once) can fill a same-gender vacancy instead of a stranger: 20% on their own, 60% when someone in the house still pulls them (romance ≥ 40). Reasons: the player asked, "couldn't stop thinking about X", a second chance after leaving unhappy, or a life reason. `rejoin` restores every system, gives a fresh stay of the old contract length, re-inits their arc, keeps old memories/relationships, and the door scene becomes "X is back".
- [x] **Ask them back:** phone → plans → "former housemates" → "ask them to move back" (`askBack` action, logged `ask-back`, replayed). Allowed once a same-gender housemate is leaving or a room is open; they agree when they still like/trust the player.
- [x] **Plan texts:** when a shared plan starts without the player the housemate texts "heading to X now"; a no-show gets "I waited at X…" (and a memory), a housemate who didn't make it texts "sorry… rain check?".
- [x] **Names in memories:** model memories saying "Hana and player…" are rewritten with first names (`nameMemories`).
- [x] **Texts aren't stage directions:** chat replies that start with the sender's own name or describe the phone ("Shira's phone buzzes… types back") are rejected.
- **Verified:** typecheck, ESLint, full vitest (`SIM_SEEDS=20`) 388/388. **Not verified:** the phone "former housemates" card in a browser (no graduates in the current save).

## Invites, readings, board and stray CGs (2026-10-08)
- **User report:** invites through chat/phone broken; flirting/friendliness didn't move relationships; board hard to read; wants earlier days and texts re-readable; CGs drawn without the player.
- [x] **Invite parsing** (`living.ts`): full place names win ("Dizengoff Square"); the place must sit in an inviting sentence ("Drinking at the bar later. Want gossip?" no longer books Noga for the bar and then breaks the plan); `planConflict` lets you join someone already going to the same place (her own DJ set).
- [x] **LLM plan read:** `Generator.planRead` (main model, JSON) reads a text thread or scene and `applyPlanRead` adds / moves / accepts / cancels the pair's plan; engine still blocks work/place conflicts. Runs after texts and typed scene turns when a keyword gate (`PLAN_TALK`) matches; logged as `plan-read` (replayed). Real gemma4 probe on the saved threads: Noga → Florentin Basement tonight; Shira → café tomorrow 10:00 (blocked: her shift).
- [x] **Invited outings** (`loop.ts`): a picked template keeps "arranged to come together" instead of "a chance encounter… neither planned this".
- [x] **Readings:** prompt now covers romance (with allowed attraction directions and the player's flirt lines) and trust; `rereadChange` keeps the scene's value for pairs the reading omits (was wiping trust gains); `dropUnattracted`; `welcomedFlirts` adds +2..4 romance when an attracted listener's liking rose after a flirt.
- [x] **Chat log:** browse any day (`/api/game/log?day=N`), re-read earlier scenes (memories dated to that day); today's page lists text threads with "check texts for plans".
- [x] **Board:** edges ≥2 shown (was ≥8, hiding nearly everything); "how they feel about you" panel in words + numbers.
- [x] **CGs:** the stray non-player CGs were feed photos of NPC posts; only posts from/with the player get artwork now (server + client). Old images stay in the gallery.
- **Verified:** typecheck, ESLint on changed files, full vitest with `SIM_SEEDS=20` 383/383, browser check of board/chat log on a copy of the real save, live Ollama probes of plan read and readings.
- **Not verified:** a full live play-through of texting → plan → outing.

## Time, plans and grounded dialogue (2026-10-07)
- **User report:** characters invented things about the player, talked about "last week" on day 1, had no sense of time, plans (calendar or phone) or real interactions with other housemates.
- [x] **Day and clock:** `dayLine` (`prompts/common.ts`) replaces "episode N" in scene, phone, overheard and autonomy prompts: day number, date, clock, who moved in today, how long people have lived together.
- [x] **Dated memories:** `memoriesBlock` tags each memory "today / yesterday / N days ago" and adds up to two of today's everyday moments (salience < 0.6) with people outside the scene, so housemates can mention real interactions. Weightier private memories still surface only by keyword.
- [x] **Plans in prompts:** `plansBlock` lists a speaker's own plans (when, where, agreed / kept / fell through) and other people's plans they know about. Autonomy cards include it.
- [x] **About the player:** `aboutPlayer` gives age/job/hometown only after move-in day; everything else is marked unknown ("ask instead of assuming").
- [x] **Housemates and surroundings:** `housematesBlock` (public move-in intros), `surroundingsLine` (city place description, or house state: dishes, laundry, trash, noise, empty fridge), `elsewhereBlock` (where absent housemates are), and what each speaker was doing when the scene started.
- [x] **Phone replies:** `chatPrompt` gets the clock, the sender's location, plans, memories and day-tagged messages. Its token budget was too small (500) and silently dropped recent messages; budgets are now chat 1400, lines 3500, beats 3000 (Ollama `num_ctx` 8192).
- [x] **Wrong-time premises fixed:** "backyard at dusk", "past midnight" (×2) and "sunset from the train". Mock NPC texts no longer claim errands, plans or earlier moments the engine never recorded.
- [x] **Talk plans:** `proposedPlan` (`engine/living.ts`) reads a later meet-up from typed or texted words ("cafe tomorrow morning?", "beach at 4?", "flea market on Friday"). `planDecision` decides with the existing invite logic, checking work, Shabbat and existing plans at that time. The reply is written to match, and `addTalkPlan` adds an accepted invitation, logged as a `talk-plan` event (replayed). English keywords only; plans a housemate proposes and the player accepts are not captured.
- [x] **Typing limits removed:** no 200-char input caps (`Scene.tsx`, `Phone.tsx`) and no 30-reply cap (`MAX_TYPED_EXCHANGES` deleted). The server keeps an 8000-char sanity cap (`TYPED_MAX`). Memories of the player's words are still truncated to ~180 chars.
- [x] **Private dates:** `Invitation.date`. Friend plans are public (house calendar); dates create a `romance` fact only the pair knows (`notePlan`/`knowsPlan`/`planFactId` in `engine/core.ts`), which spreads through normal gossip. Prompts, the player's calendar view and the "kept/missed their plan" log respect it. Dates come from the phone form's "as a date" checkbox, date words in typed plans ("a date", "just us", "romantic"), or NPC plans between attracted pairs with romance ≥ 30. A date needs attraction to be accepted.
- **Verified:** typecheck (all three projects), ESLint on changed sources, new tests `time-context.test.ts` and additions to `chat-plan.test.ts` (parser, scene and text plans, decline on work shift, private date, replay equality). An earlier full run (365 tests, before talk plans/dates) had one failure, caused by this work and since fixed. Browser (mock preview): the "as a date" checkbox renders and toggles; its first automated fill did not register, so a UI-made date plan was not observed end to end (server test covers it).
- **Not verified:** live Ollama dialogue with the new prompts; the final full-suite result is recorded in the commit message/next session.
- INTENT: prompts gave the model no day, plans, player facts or other-housemate context, so it invented them; the user wants characters grounded in time, plans and real interactions.
- TWINS: searched every prompt builder (scene lines/beats, chat, overheard, autonomy, delta) and every `invitations.push` site (talk, calendar, NPC hourly, performances); all now use the shared helpers.
## Panel commentary in evening TV watches (2026-10-06)
- [x] Keep scene and studio commentary visible during ordinary play. Record every panel line with its speaker and full text, including mid/end-day intermissions under the correct recorded day.
- [x] Display recorded commentary on the delayed group TV watch and its replay. All watching residents remember the comments, including comments about someone else; absent residents do not acquire them early.
- [x] Persist the broadcast's commentary snapshot through remark pruning/save/load. Intermission recording is idempotent, autosaved and deterministic on event replay.
- [x] Restrict broadcasts to evening; days 1–3 still air on day 6.
- **Verified:** 48 targeted engine/server tests, five browser checks (day-6 watch displays panel comments from days 1/2/3; ordinary end-of-day studio still appears), build/typecheck, source ESLint and diff whitespace checks. The earlier broader-suite caveats below remain; that suite was not rerun for this follow-up.
- **Judge check:** complete 24-line commentary survives pruning in the aired snapshot, an uninvolved watcher remembers it, an absent resident does not, duplicate studio requests record once, and studio recording replays exactly through save/load. The temporary browser database was removed; standard test reports remain.
- INTENT: the code broadcasts selected scene remarks; your request includes panel commentary in the evening group watch; the README says the house hears the panel.
- TWINS: searched truncated panel recording and commentary/intermission writers - found 1 other writer: studio intermission. Both recording paths now preserve commentary for the group TV watch; the daytime UI and panel prompts are unchanged.

## Dialogue, playability and delayed broadcasts (2026-10-06)
- [x] Separate narration, larger wrapping replies, retry scene/phone replies without duplicate player text or extra time; reject truncated model output and phone stage directions.
- [x] Respect room occupants, support selected groups, prevent title-screen saving, clear incoming phone/plan badges on reading, and keep the studio panel visible with retry recovery.
- [x] Fix sprite extraction (foreground crop, connected fragments, white clothes and full height), prioritize player/nearby sprites, and allow play while artwork loads.
- [x] CGs use scene/activity poses for all participants: seated meals, dancing, cafe coffee, karaoke, cooking, swimming and furniture. User clarified this applies to generated CGs only; the added VN table and seated portrait pipeline were removed.
- [x] Broadcast 1 covers days 1–3 and airs on day 6; broadcast 2 covers days 4–6 and airs on day 9. Retain important facts and panel remarks until broadcast, include highlights from each day, and expose transcript clips on the TV and replay screen. A queued watch survives ending an earlier conversation; move/teach the audience only when it starts, with a replayable activation event.
- **Verified:** 57 focused engine/server checks; latest CG/broadcast checks 12/12; browser 5/5 including actual day-6 TV, end-of-day studio, title saves, grouped conversations, retries, phone reading and actual generated sprite extraction. Typecheck/build, source ESLint and diff whitespace checks pass. Independent judge advanced a real mock session to day 6 and confirmed deterministic replay equality.
- **Broader suite:** 345/348 passed with `SIM_SEEDS=20` before the final CG clarification. Three failures remain: `movein.test.ts:147` expects more than one pending scene but receives one; `cooking.test.ts:102` expects 15 distinct recipe shapes but receives 13; `returns.test.ts:150` expects affinity 61 but receives 63.20213702851481. Do not claim the whole suite passes. The default 200-seed run exceeded the tool's five-minute timeout; its verified worker was stopped before the bounded rerun.
- **Limits:** prompt generation/integration and mock gameplay are verified; live ComfyUI images have not been visually judged after this change. Cache hashes include updated CG prompts and there are no prebaked CG manifest entries overriding them. Four temporary browser databases from this continuation were removed; standard ignored screenshots/test reports remain as evidence. Existing dirty changes and the user's active game database were preserved. No dependencies, commit or push.
- INTENT: the code merges actions into speech, redirects bedroom talks, and blocks episode starts on artwork; your request calls for separate narration, location-based chats, and faster play; the README describes location-aware housemates and playable fallbacks.
- TWINS: searched pending scene auto-resolution, reply truncation, phone read-count subtraction, and the removed VN table/pose constructs; no additional faulty sites remain in app sources. CG pose context is shared by manual scenes, freeze frames and phone/feed photos through `freezeRequest`.

## Meals in the current season (2026-10-06)
- INTENT / AUTH: the user said, "Add to the current season too. It’s the first day and not all of the housemates arrived yet."
- [x] Enable meals when loading/resuming active older saves, with a replayable activation event and no time/arrival changes.
- [x] Apply to the actual current autosave, preserving the season, clock, cast, memories and saved conversation metadata; back up the database first.
- [x] Verify migration, repeat prevention, pending arrivals, welcome dinner gating and build; complete Fable judge review.
- **Current save:** autosave 161, episode 1, `slot1`, minute 94, four residents present and two arriving. Deep comparison confirms only `world.flags.communalMeals = true` changed. Welcome dinner is still waiting; the migration does not gather residents early. Backup: `data/backups/pre-meals-1791281303693.sqlite`.
- **Replay:** loading continues the saved branch, then records `meal-routines`. Old history scheduling remains unchanged before activation. Two migration tests verify exact replay and idempotence on manual load and startup resume, including discarding an abandoned post-save branch. The actual older season already differs from replay under the current engine; activation preserves its saved state rather than reconstructing it.
- **Fable judge: VERIFIED WITH CAVEATS.** Observed 15/15 focused meal/migration/move-in checks, 103/103 server checks (excluding the previously documented failing portrait-test file), a successful build, changed-file ESLint and `git diff --check`. No existing assertions were removed or weakened, no dependencies added. A second read-only check confirmed the migrated save persisted, only the meal flag changed, and the backup retains all original history. Replay already differed before migration, confirmed against the backup; full replay of its older history is the caveat. Both one-off scripts were removed.

## Shared meal routines (2026-10-06)
- INTENT: existing quick cooking feeds residents without gathering them, and random dinner/breakfast templates do not create daily routines. The user wants small breakfasts around occupations, evening house dinners, and a mandatory first-day dinner with all six.
- [x] Add schedule-aware breakfasts/dinners and protect the welcome dinner from skipping/sleeping.
- [x] Feed participants, account for groceries/dishes, persist memories and preserve replay.
- [x] Verify browser meals, capture guide screenshots and complete the Fable judge review.
- New sessions enable `communalMeals`; active older saves enable it on load/resume with a replayable activation event. Legacy event logs retain their scheduling before activation. Regular meals start on a free world pulse or **hang out** during the first hour of morning/evening, from day two. Explicit talks, shifts and outings retain priority. Welcome dinner waits for all move-in introductions and finishes any active household work before gathering everyone.
- **Fable judge: VERIFIED WITH CAVEATS.**

| Claim | Observed evidence |
| --- | --- |
| All six attend the first-night dinner, after introductions | Engine tests and the server first-day replay test pass; browser captured all six participants and typed to everyone. Sleep/skip stop for dinner, and graduation/overnight trips wait until after it. |
| Breakfast/dinner attendance respects schedules | Engine tests cover early shifts, students before class, sleep, shower, outings, accepted plans and overnight absences. Browser shows a three-person breakfast and six-person evening dinner on day two. |
| Meals feed once and survive saves/replay | Engine/server tests cover hunger, time, grocery cost, dishes, memories, pending-meal save/load, automatic pulses, exact replay and repeat prevention. Vegan/parve food works on Shabbat; unmarked fridge supplies remain untouched. |
| Guide includes real meal screenshots | `meal-welcome.png`, `meal-breakfast.png`, `meal-dinner.png` captured through actual controls and visually inspected; guide now has 51 screenshots. |
| Checks pass except the documented image failure | Final broad suite: **290/291 passed**; only `expressions-memory.test.ts:28` still reports portrait `failed` rather than `ready`. Build/typecheck, changed-file ESLint and diff whitespace checks pass. Browser suite: **5 passed**, with the opt-in full-guide recapture skipped; meal capture passed separately. Three eight-day meal simulations pass schema checks, plus a repeated seed produces the same state. |

- **Review:** no new dependencies or removed/skipped assertions. Two existing scene-draining helpers now include scenes queued after the last introduction. The sundown fixture uses `moveInDay: false` to reach its phone test without bypassing the newly mandatory welcome dinner; its assertions are unchanged. Prior dirty changes are preserved. Five throwaway browser databases from this task were removed; standard ignored reports remain.
- **Limits:** meals use a single ready-to-eat vegan/kosher spread and a small shared-budget charge rather than a new cooking simulation. Live-model meal dialogue quality remains unverified; browser/server checks use mock dialogue. No commit or push.

## Goal 5 implemented (2026-10-06)
- [x] Read goal 5 and inspect the engine, activity scheduler, NPC autonomy, cooking and chat log.
- [x] Implement 15 quick household and leisure activities, alone/together/join midway, with typed conversation during work.
- [x] Give NPCs those activities and real meal service; preserve diet, kitchen and Shabbat checks, reserved ingredients and deterministic deadlines.
- [x] Add supportive exchanges, cold shoulders and knowledge-grounded jealousy; remember friction and use grudges in approach/avoid choices.
- [x] Expand voiced background conversations and display witnessed last-block conversations as "last night" in the next day's log.
- [x] Engine/server regressions cover all activities, completion during talk, early ending, NPC cooperation, meals, diets, refusal, deadlines, save/load, replay, private activity visibility and grudge/jealousy behavior.
- [x] Finish browser and season checks, inspect the diff with the Fable judge, and record final results.
- **Implementation:** `engine/household.ts` owns the catalogue and timed outcomes. Optional character fields persist the activity id, lead and reserved recipe; no schema-version bump is needed. `planSlot` creates a focused two-person scene for shared activities, and `resolveScene` finishes any remaining activity time. `advanceLiving` completes work at deadlines even when participants are protected by a conversation. NPC cook/tidy choices are normalized into this system; `applyCooking` accepts an internal reserved-ingredients flag. UI: "everyday life" in the house panel, visible task labels and join buttons.
- **Cooking and boundaries:** one shared meal can be underway at a time. Other NPC cooks can join it; ingredients are not consumed again. The cook counts as one serving, with a helper and hungry eligible residents prioritized for the remaining servings. Starting together and joining midway respect diets, kosher preparation, Shabbat, weather, remaining block time and a housemate's availability or wish for space.
- **Verification:** final `npm run build` (all three TypeScript projects and Vite), changed-file ESLint and `git diff --check` passed. Broad suite (`npx vitest run --exclude packages/shared/src/sim/simulation.test.ts`): **279/280 passed**. The only failure remains the previously documented `apps/server/src/game/expressions-memory.test.ts:28` portrait status (`failed` instead of `ready`); that code and assertion were not changed. All **11 season checks passed** with `SIM_SEEDS=20` (20 idle seeds, 30 active seeds, plus default/random-cast determinism). The Playwright household flow passed through the real menu: 15 choices, solo laundry, invite a free housemate, complete the shared conversation and see the chore log. The server test covers typed words during work, completion, save/load and exact replay. Engine regressions cover all 15 solo activities, shared deadlines, ingredient reservation, serving counts, NPC cooperation, diet/kitchen/routine checks, refusal, privacy, friction memories, grounded jealousy and the correct cold-shoulder actor. No existing assertions were removed or skipped for goal 5.
- **Limits:** the browser/server runs use the mock dialogue adapter. Live-model household talk and all 13 expanded overheard styles remain unverified for dialogue quality. Cleaning/sorting/small repairs produce chore credit, memories and needs effects without adding new upkeep meters; dishes/laundry/trash use the existing backlogs. Existing automatic chores remain in place so the player need not manage every task.
- **Fable judge: VERIFIED WITH CAVEATS.** Reviewed the goal-5 changes against the initial dirty tree and reran broad/season/build/lint/browser checks. Caveats are the known portrait failure and live-model dialogue quality. Five throwaway browser databases were removed; the new server fixtures clean up their temporary data. Standard build/test reports remain ignored.
- **Next scope:** goals 1–5 are implemented. Further playtesting can assess everyday dialogue variety and pacing.
- **Preserved:** earlier dirty working tree for goals 1–4 and overheard dialogue. No commit, push, new dependency or environment changes.
- INTENT: code offers generic tidying and background chats; the task expects varied shared activities and lasting social consequences; the README describes a slow life-sim whose housemates act independently.
- TWINS: searched NPC cooking ingredient-consumption paths, avoidance-to-cold dispatch and current-day chat filters - found 0 other defective sites: none.


## Goals 3 and 4 implemented (2026-10-06)

- **Couples may stay.** Dating and high romance no longer schedule departures. Existing personal reasons (planned stay, mood, rejection, completed arc) still apply. `contractEp >= 999` means no fixed departure, even in an open-ended season.
- **Leaving together requires two decisions.** `leave.ts` shares `agreesToLeave`/`invitePartnerToLeave` across episode evaluation, arc departures, last-day confessions and player graduation. An NPC needs their own leave reason (or an already planned departure), romance at least 55, nonnegative affinity and tension below 50. NPC initiators must want the partnership too. A departing partner offers the player a choice; the player never auto-leaves. Asking an NPC to accompany player graduation can be declined, leaving the player alone; the UI confirmation says this explicitly. Decisions become memories/facts/log entries. Leaving separately preserves dating; `left-together` is set only at an agreed departure, and epilogues distinguish staying from leaving together.
- **Real former residents visit.** `pastResidents` reuses saved characters with `status: left` and `leftEp`, including previous player characters after `joinNewPlayer`. `returningResident` rolls a 30% chance on eligible evening blocks, chooses a familiar available host when possible, and allows one visit per episode with three episodes since departure/last visit. The existing `former-housemate` template now binds actual former residents instead of the fixed Neta outsider. Visitors remain `left`, retain memories/relationships/knowledge, can meet newcomers and answer typed words, and neither occupy a resident slot nor trigger arrivals. Current activities/explicit scenes take priority; reunions can also happen while the player is away.
- **Knowledge and gossip.** Visits add witnessed event facts and memories. Host and visitor may exchange only known gossip through the existing source-chain mechanism; secrets respect the existing discretion check, and a deflecting listener skips gossip. Former residents' old sleep/text activities are reset for their visit so they can respond.
- **Verification:** 53/53 focused tests passed, including graduation agreement/refusal, separate departures, last-day confession, stay-to-end behavior, save/load of a former player, visit cooldowns, NPC reunions, typed guest replies, and source-preserving gossip. Broad suite: 241/242 passed; the known `expressions-memory.test.ts:28` portrait failure remains (`failed` instead of `ready`). Final build/typecheck, changed-file lint and diff whitespace checks passed. All 11 final season checks passed with `SIM_SEEDS=20` (20 idle seeds, 30 active seeds, plus determinism checks). The browser graduation → new-player flow passed against the final code. Tests deliberately replace the former assertion that dating causes departures and give the joint-graduation fixture an NPC who independently wants to leave; assertions were not skipped or weakened.
- **Limits:** NPC departure choices use existing motives and relationship thresholds, not a new LLM judgement. Return visits were verified through engine/server tests; a browser playthrough of a return visit and real-model reunion dialogue remain unverified. Old saved departure plans are preserved; the new rules apply to subsequent decisions. Pre-existing goals 1–2/overheard changes are preserved. No commit or push.
- **Next scope:** goal 5 (general realism), listed below. Goals 1–4 are implemented.
- **Fable judge: VERIFIED WITH CAVEATS.** Final focused/broad/season/build/lint/browser checks were observed; the diff was reviewed against goals 3–4 and the initial dirty working tree. Known portrait failure and untested return-visit browser/real-model dialogue are the caveats. New server-test temporary files and the two throwaway browser databases were cleaned up; standard build/test reports remain ignored.

## Goals 1 and 2 implemented (2026-10-06)

- **Player-ended talks read what was said.** The scene closes immediately with the engine outcome; a background reading applies only its net correction to the current state, logs a replayable `reading` event, and autosaves. It waits for an in-flight action/scene to finish before touching state. Loading a save or starting another game discards late results from the old branch. Chat log shows reading pending, applied, or usual outcome kept. Manual re-read still works once afterward, against the automatic reading rather than the original template.
- **Readings use `OLLAMA_MODEL_LINES` (currently `terrace-rocinante:12b-q4`).** Previously, dialogue used Rocinante but `Generator.deltas` still used the main Gemma model. The user corrected this split. The reading prompt now prioritizes actual words and their explicit addressees, preserves all player words in long talks, and explains the direction of the listener's affinity change. Real Rocinante probe: compliment proposed +2 toward the player; direct insult proposed -10 toward the player and +12 tension (affinity is then multiplied by `FEELING_SCALE = 0.5`). These are two samples, not a reliability benchmark.
- **Fallbacks:** invalid, empty, or zero-only readings keep the engine outcome. A narrow direct-English-insult fallback in `talk.ts` lowers the addressed housemate's affinity when the model is unavailable or shrugs. It respects selected recipients/everyone, skips quoted speech and explicit joking, and does not treat ordinary refusal or unrelated negativity as an insult. Subtle rudeness still depends on a usable model reading.
- **Personality fit now changes affinity through shared time.** Reuses cast `compat` plus attachment, meal routines (diet/kashrut), and Shabbat routines. Every 30 minutes together changes affinity both ways by up to 0.15; poor matches can fall below zero. Only awake, available current residents in the same place count. Half-hour accounting and rounding keep action chunking deterministic. No additional romance, trust, or closeness drift. After shared time, pair summaries explain the fit even when a fresh diary note exists.
- **Verification:** 228/229 tests passed outside the season sweep; the remaining failure is the previously documented `expressions-memory.test.ts:28` portrait status (`failed` instead of `ready`). All 11 season checks passed with `SIM_SEEDS=20` (20 idle seeds, 30 active seeds, plus determinism checks). The original 200-idle-seed run was interrupted and stopped; it is not claimed as passed. Final targeted checks: 31/31, including model routing, long transcripts, negative fallback, instant closure, delayed corrections during another scene, replay, and save branching. Build/typecheck, changed-file lint, and `git diff --check` passed.
- **Still unverified:** browser playthrough of the chat-log status and long real-model conversations. Temporary probe/report files were removed. No commit or push this session; pre-existing overheard-chat work is preserved.
- **Next scope:** goals 3–5 below (couples/leaving, returning residents, general realism). The original descriptions of goals 1–2 below are kept as historical context.

## Start here next session (2026-10-06 plan, from the user)

Goal: make the game more realistic. In this order:

1. **Let the model read typed words at the end of a talk.**
   - Today, ending a talk yourself applies the scene's fixed template (about +1.5 to +3 affinity each way) and never reads what you typed. A compliment or an insult changes nothing beyond that. Typed words are only read if the scene runs on or is interrupted, or if you press re-read in the chat log.
   - `session.ts` `finishScene`: `const llmProposal = run.endedByPlayer ? null : await this.gen.deltas(...)`. Change this to also call `gen.deltas` when `run.said.length` (your typed words), and keep the fallback to the engine proposal when the reading moves nothing.
   - **A test forbids this on purpose:** `movein.test.ts` asserts `gen.deltas` is not called when the player ends a talk. Update it deliberately; ending a talk must still feel instant (consider showing the "relationship updated" step after the scene closes, in the background, as diaries do).
   - Also allow negatives: rudeness should be able to lower affinity. A cheap keyword rule for clear insults (no model call) is the fallback option.
2. **Affinity loss when personalities don't align.**
   - Only affinity can go below zero (-100..100); romance, trust, tension and closeness are 0..100.
   - Today only 15 of 149 event templates lower trust or affinity, and background arguments are tiny (about -0.1 each after scaling). Add a compatibility term (traits, values, conflict style, attachment, diet and Shabbat clashes) that slowly pulls affinity down for poor matches and up for good ones, tied to shared time. Keep it small and visible in the pair summaries.
3. **Couples and leaving the house.**
   - Let housemates who become a couple stay in the house, and make leaving a **mutual decision** (both agree, or one stays), instead of the current forced departures.
   - Look at `engine/leave.ts` (graduation and departures), `arcs.ts`, the `graduate` and `leave with partner` actions in `loop.ts`/`House.tsx`, and the stay-to-the-end flags (`contractEp`).
4. **Past housemates visit.**
   - Let housemates meet people who used to live there, **including the player's own character if they graduated**.
   - Existing hooks: `engine/outsiders.ts` (doorbell visitors, family calls, exes), `leave.ts`, the epilogue code. Needs a record of past residents with their memories and relationships (the saved state already keeps them), a visit scene type, and knowledge/gossip updates when they return.
5. **General realism pass.** Ideas the user and this session raised:
   - Negative drama beyond bickers (jealousy, cold shoulders, avoidance that sticks).
   - More NPC-to-NPC conversations: the overheard feature covers 5 interaction types and two per block; widen it, let it nudge numbers, and let NPCs refer to it.
   - Overheard chats from the last block of a day are logged under the previous day, so the new day's chat log misses them.

**Run it:** `npm run dev` (stop any running server first; a server started before these changes will not have them). `.env` sets `OLLAMA_MODEL_LINES=terrace-rocinante:12b-q4`; in the cloud, recreate it with `ollama create terrace-rocinante:12b-q4 -f docs/models/RocinanteX12B.Modelfile` after pulling `hf.co/bartowski/TheDrummer_Rocinante-X-12B-v1-GGUF:Q4_K_M`. `.env` is gitignored.

## Chat log, re-read, overheard chats, Rocinante (2026-10-05 to 06, latest)
- **Branch:** `rp-model-chatlog-reread`, pushed to GitHub as e4310ed. **Uncommitted since then:** overheard chats, the narration filter, the empty-reading guard in re-read, and these doc updates.
- **Fixes from the user's playtest report:**
  - Class "too far for this slot": the block is 180 min, each spoken line costs 6, so chats ate the block; the check also demanded walk there and back plus an hour. `reachability(..., lecture)` in `city.ts` now needs only the walk plus `LATE_LECTURE_MINUTES` (30) for class.
  - "I light up a cigarette" never reached the scene image: `Generator.shot` staged only the last speaker. `shotIds` in `prompts/studio.ts` now adds the player when they spoke in the last four lines.
  - Seated sprites had their legs cut (`posedSprite` in `pixel/sprites.ts`); the lower body is now foreshortened. Not looked at in a browser.
  - Kai stayed at affinity 0: the model's delta proposal came back empty and was applied as-is. `finishScene` now falls back to the engine proposal when the reading moves nothing. Board table caption now explains rows (feel) versus columns (about).
- **Chat log + re-read:** `GET /api/game/log`, `POST /api/game/reread/:id`, `ChatLog.tsx`, `session.dayLog()/reread()`, new `reread` event (replay handler in `replay.ts`), `rereadChange`/`applyReread` in `engine/relationships.ts`, flag `reread:<sceneId>`. Re-read re-bases scenes applied under an older scale using `feelingScale` stored in the `scene` event. Refuses an empty reading. Test: `reread.test.ts`.
- **Scaling:** `FEELING_SCALE = 0.5` in `engine/core.ts`, applied to affinity and romance in `applyProposal`. Old event logs no longer replay to identical relationship numbers; saves load from stored state, so they are unaffected.
- **Overheard chats:** `Generator.overheard`, `overheardPrompt`/`OVERHEARD_TYPES` in `prompts/studio.ts`, `session.overheard()` called from `endSlot`, `logInteraction` now stores the interaction type in `templateId`. Probe over 15 chats with Rocinante: all usable, outcomes respected; flirts are the weakest. Tests: `overheard.test.ts`, `scripts/overheard-probe.ts`.
- **Rocinante-X 12B:** `docs/models/RocinanteX12B.Modelfile`; `parseLines` and the lines prompt were hardened for its formatting (`prompts/scene.ts`, test `prompts/parse.test.ts`). Probe: 8 of 8 lines pass content and voice checks. Not yet tried in a real playthrough. Compare with Gemma on a full session before keeping it.
- **Dialogue depth:** typed replies now ask for 2–4 sentences with a real detail, opinion or question (`linesPrompt`). The delta prompt tells the model that compliments and rudeness should move affinity.
- **Tests:** server + shared suites pass (208 of 209), typecheck and lint clean. The one failure, `expressions-memory.test.ts` (base portrait request ends `failed` instead of `ready`), failed the same way before this work started and is unrelated; its image queue code had uncommitted changes from earlier.
- **Gotchas:** PowerShell 5.1 mangles multi-line `git commit -m @'...'@`; write the message to a file and use `git commit -F`. `Set-Content -Encoding UTF8` adds a BOM, which would corrupt the first `.env` key; use `[IO.File]::WriteAllText` with `UTF8Encoding($false)`. The `ctx_search` tool throttles after about 10 calls in 5 minutes; use Grep.

## Room-only scene workflow integrated (2026-10-03, latest)
- User accepts the initial kitchen image's character likeness and changes in art style. Success means distinct requested characters without extra copies.
- `group_ref.api.json` now uses Qwen-Image 2.1 Turbo Q8 with only the room canvas. Character descriptions include hair, skin, build, clothes and accessories; there are no portrait-reference nodes.
- All scenes up to six people use this route, including manual images and automatic freeze frames. Missing room art uses the same model with an empty latent; scene workflow hashes invalidate old cached stills.
- `Generator.shot` returns one short JSON action for the latest participating speaker. It is attached inside that character's description. The game supplies swimming positions and the other characters' emotion/body language. Invalid output falls back to those defaults.
- Six detailed LLM action descriptions failed the first integration smoke (eight people); shortened descriptions and one action corrected it. Final real-model API smoke, replaying the dialogue captured in the first real run, rendered exactly six distinct housemates. Evidence: `logs/scene-probe/integrated-short/pool.png`, `scene-job.json` and `integrated-short.log` (gitignored).
- Earlier fixed-prompt pool experiment: 10/10 clean seeds. Final integration smoke: one clean image; broader character-count reliability still needs playtesting. Full history: [docs/GENERATE-SCENE.md](docs/GENERATE-SCENE.md).
- Final checks: 45 targeted tests passed; build passed; source lint passed with `--ignore-pattern logs/**`. Plain lint fails in gitignored exploratory scripts and downloaded LanPaint code. No new dependency or production custom-node installation.
- Playtest app was started at http://127.0.0.1:5173, API 8787 in real mode; health reports Gemma4 12B and ComfyUI healthy. Test probes used separate databases.
- User authorized publication: "commit and push".

## Cast balance, generate scene on real scenes, rain indoors (earlier 2026-10-03 evening)
- **Three men and three women, always:**
  - `content/cast.json` has a 6th hand-written housemate, **Noga Friedman** (`hana`, woman). The schema now expects 6 entries.
  - `defaultCast(playerGender)` and `castGenders()` (`castgen.ts`) pick the five who complete the player's half; `defaultCast()` with no argument still returns all six (used by `build-jobs.ts`). Before this, a male player got 4 men and 2 women.
  - The Creator previews the matching five.
  - Replacing a graduated *player* must keep their gender: `session.newPlayer` throws, and the Creator locks the gender select. The check is not in `joinNewPlayer`, so old replay logs still load.
  - NPC graduates were already refilled with the same gender (`leave.ts`). A nonbinary player gets the woman's split.
  - Noga has **no prebaked portrait** yet; it is generated on demand. Run `build-jobs.ts` + `comfy_gen.py` to bake it.
- **Generate scene, tested live** (male player, seed 21, real Ollama + ComfyUI). Probe: `npx tsx logs/scene-probe.ts logs/scene-probe pool|dinner`. It lives in the git-ignored `logs/`, as do the images in `logs/scene-probe/`.
  - **The first pool image was a placeholder.** The 6-person + room job (7 references) passed `IMAGE_TIMEOUT_MS` (180 s); the abandoned ComfyUI job then ran 456 s and slowed the next LLM calls to over a minute.
  - Uncontended benchmarks for 7 references: 768 → 77 s, 512 → 36 s, 384 → 28 s (faces equal at 512); cold start 101 s; right after a location job 109 s. **The 456 s was not reproduced in isolation.**
  - Fixes:
    - `patchWorkflow` sets the encoder `resolution` to 512 for 5+ references (`resolution` entry in `group_ref_mapping.json`).
    - `ComfyBackend` cancels its own prompt on timeout (targeted `/interrupt` + `/queue delete`).
    - `ImageQueue` logs `[images] <kind> failed, using a placeholder: <reason>` once (not for jobs skipped while offline).
  - **Staging** (`freezeRequest(…, lines)`):
    - per person, in-water vs "out of the water and dry" when anyone is swimming;
    - body language from their last line's emotion (`POSE` map; `Line.emotion` is now kept in transcripts);
    - "talking, mid-gesture" for the last speaker;
    - "candid moment … not lined up".
  - `sceneImage` is now async and calls `gen.shot`. With a shot, the premise and raw dialogue are left out. `shotPrompt` says who is in the water.
  - **Open: duplicate people. Full record of every attempt, with images, saved workflows and scripts: [docs/GENERATE-SCENE.md](docs/GENERATE-SCENE.md). Fix this first next session.** Qwen-Image 2.1 sometimes draws someone twice, worst with the player's full-res 832×1216 outfit portrait (the prebaked portraits are 104×152).
    - Shipped: names tied to references ("Omer, the person from image 1") and an exact headcount.
    - Tried and dropped: room-first ordering, an "identity references only" line, equal tiny references (0.02 MP), head-and-shoulders crops (1/3 clean).
    - Next idea: rework the group workflow (crop or mask the outfit portrait to the face, or a different identity method).
  - Live timings: pool image 90 s (129 s with the LLM shot), kitchen 165 s (249 s total).
  - Gotcha: resubmitting a job to ComfyUI while Gemma was resident produced pure noise. The game itself unloads Ollama first (`beforeJob`).
- **Rain never falls indoors:**
  - `isOutdoors(place)` (`living.ts`; pool deck, balconies, beach/park/scenic/harbor nodes).
  - `locationRequest` only makes rain/snow variants outdoors, so indoor rooms reuse the clear prebaked art.
  - The VN `rain-overlay` only shows outdoors.
  - Scene images say "rain only outside the windows, dry indoors" inside.
  - The house map was already outdoor-only. Trip destinations count as indoor.
- Checks: typecheck, lint, **164/164 unit tests** (`SIM_SEEDS=10`), 9 browser tests (scene-image, game, pool, VN; Edge, mock), a mock browser check of a rainy indoor scene.
- Files: `content/cast.json`, `packages/shared/src/{content,engine/castgen,engine/loop,engine/living,engine/engine.test}.ts`, `apps/server/src/{image/requests,image/comfy,image/queue,game/session,game/generate,prompts/studio,server.test,game/scene-image.test}.ts`, `apps/web/src/screens/{Creator,Scene}.tsx`, `workflows/group_ref_mapping.json`.

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
