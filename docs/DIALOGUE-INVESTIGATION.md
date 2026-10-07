# October 6 dialogue and lorebook test

The tested configuration uses `gemma4:12b` for structured calls and `terrace-rocinante:12b-q4` for dialogue. The latter is Rocinante X 12B Q4_K_M, with temperature 0.9, 8192 context, min_p 0.05 and repeat_penalty 1.05. The installed template uses Mistral instruction delimiters without SYSTEM_PROMPT, consistent with the [author's instructions](https://huggingface.co/TheDrummer/Rocinante-X-12B-v1). Earlier sections of ROLEPLAY.md describe historical model selections.

## Experiment

`scripts/dialogue-grounding-probe.ts` froze the existing production prompts before editing. It tested six single-turn fixtures with seeds 41 and 42 at temperatures 0.9 and 0.4. The fixtures cover the screenshot's arrival/crowding exchange, Kai's filming/coffee exchange, Ron's burned-toast answer, a question about the player's unknown sister, choosing between Jaffa's market and port, and Maya's Friday dinner preferences. The arrival reconstructs the screenshot exchange; the unavailable original request is not claimed to have been replayed exactly.

Three prompt variants produced **72 real Ollama responses**, each without template fallback. The report retains prompts, raw outputs, parsed lines, seeded options and mechanical checks at `logs/dialogue-grounding-comparison.json`. Each temperature/variant has 12 responses and 14 required speaker lines. All variants are rescored with the same final narration guard through `--summary`.

| Prompt | Temperature | Parsed lines | Accepted by content, voice and narration checks |
|---|---:|---:|---:|
| Baseline | 0.9 | 14/14 | 6/14 |
| Baseline | 0.4 | 14/14 | 8/14 |
| First revision + lore | 0.9 | 14/14 | 6/14 |
| First revision + lore | 0.4 | 13/14 | 9/14 |
| Focused biography + lore | 0.9 | 13/14 | 10/14 |
| Focused biography + lore | 0.4 | 14/14 | 10/14 |

These are mechanical counts, not accuracy scores. The first revision combined voice simplification, short-answer instructions and lore; the final variant additionally restricted biography to relevant questions and labeled personal contacts by owner. The experiment does not isolate the lorebook's effect from the other prompt changes.

## Human review and decision

Lower temperature alone did not fix invention. Baseline outputs included an unsupported landlord agreement, a possible baking-video identity for the player's sister, a supposed past roommate, and Maya claiming Shabbat habits that contradicted her card. The first revision also performed poorly: all four unknown-sister replies pulled in Dana or Beersheba from Maya's own background.

With focused biography, all four unknown-sister replies stopped supplying Dana or Beersheba. One says, "Mm... I don't think so? What's her name?" This supports withholding irrelevant personal context rather than repeatedly instructing the model to ignore it. Biography remains available when the player asks about the speaker's own family, hometown or work; relevant memories remain separate.

Other defects remain. The final 0.9 arrival run invented Yossi providing Maya the address. The final 0.9 dinner run had Maya suggest eating around meat and describe herself as not strict, contradicting her vegetarian/strict-kashrut card. The 0.4 dinner outputs were more consistent about Shabbat, but Jaffa replies became just "Flea market." Narration persisted at both temperatures, and some raw replies were truncated at the token limit. The parser can discard unlabelled paragraphs, so parsed text may omit part of the model's answer.

Keep the current temperature setting: this small comparison does not establish that 0.4 is a better overall conversational experience. Retain the focused prompts and narration guard as bounded improvements, not a claim of solved hallucination or naturalness. The guard recognizes common physical stage directions; it is not a semantic truth checker or an exhaustive narration detector. A plain unsupported biography claim can still pass it.

## Implementation and verification

Scene dialogue no longer demands a personal anecdote or 2–4 sentences. It omits exaggerated cadence examples, softens the seeded Kai voice, and supplies personal background only for relevant questions. Full planning cards still include exemplars. The shared spoken-dialogue guard rejects observed plain narration before display; scene replies retry once then use the existing fallback. Direct chat and overheard exchanges also apply the guard. The source-backed, keyword-triggered World Info book is documented in LOREBOOK.md.

The screenshot narration is covered by both a direct check and production Generator tests observing emitted tokens, valid retry acceptance and fallback after an invalid retry. Tests also cover the player/speaker sister distinction, whole-word matching including Hebrew, bounded lore and non-recursive activation. No existing assertions were weakened.

Build/typecheck and lint of changed TypeScript passed. The wider server run was 118/119: the image-expression queue test expected a base portrait to be ready but received failed, and the same failure reproduced in isolation. That image failure is not a passing verification and was not repaired in this dialogue/lorebook task. No live browser session or running SillyTavern import was verified.

### Final verification: verified with caveats

| Claim | Observed check |
|---|---|
| The final prompt and lore work through the real adapter | A further six real responses at seed 41 and temperature 0.9 parsed 7/7 required lines; 5/7 passed the final mechanical checks. This verification phase is retained separately, bringing the total to 78 responses. It still reproduced the incorrect vegetarian/kashrut reply. Seeded re-generation was not byte-identical across runs. |
| The screenshot narration cannot reach display through the tested scene path | Production Generator tests passed for a valid retry and fallback after an invalid retry, inspecting emitted tokens. |
| The book stays bounded and activates only matching entries | Keyword, Hebrew word-boundary, budget, source-metadata exclusion and non-recursion tests passed. |
| Related dialogue code still passes its existing checks | The final focused run passed 64/64 tests across eight files. Build/typecheck, changed-file lint and diff whitespace checks passed. The wider image test failure above remains. |
| The changes stayed within the task | Existing tests were unchanged. The working tree already contained extensive game/UI edits before this task; they were preserved. No dependency, model installation, saved-game change, commit or push was made. The reusable probe and report are intentional evidence artifacts. |

INTENT: code encourages elaborate personal replies and accepts plain narration; the task expects natural, grounded dialogue; the README specifies a slow life simulation with characters' own beliefs and histories.

TWINS: searched voiceCheck and spoken-line parsing - found 2 other paths: direct chat and overheard dialogue in generate.ts; both now use the narration check.

To reproduce a comparison, run the script with `--baseline` before changes, then `--phase=<label>` after changes. `--verify` restricts a phase to seed 41 at temperature 0.9. `--summary` rescans the saved report with the current narration guard. Baseline execution overwrites this report; preserve it before beginning a new comparison.
