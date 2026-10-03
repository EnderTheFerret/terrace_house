# Generate scene: room-only workflow integrated

Status on 2026-10-03: **the accepted room-only approach is integrated into the game.** Scenes use character descriptions and one room canvas, with the current speaker's dialogue action attached to their description. Manual scene images and automatic freeze frames share this route. The final real-model API smoke image contains six distinct housemates; broader playtesting is still needed. The earlier failures and experiments below remain as historical evidence.

For every cast size up to six, the room background is `reference2`. `patchWorkflow` makes it image 1, resizes it to 1216×832, sets encoder `resolution: 0`, and samples the encoder's latent output. There are no portrait references. Without a room image, the same Qwen 2.1 scene model uses an empty latent at the requested size. Scene workflow hashes invalidate old scene caches when the server restarts.

## Integrated workflow verification

- Model: `qwen_image_2.1_turbo_Q8_0.gguf`, 8 steps, CFG 1, Euler/simple.
- User acceptance: distinct cast matters; style changes in the initial kitchen image are acceptable.
- Dialogue staging: JSON action for only the latest participating speaker, at most 100 characters. Positions, swimming status and other characters' emotions come from the game. Invalid responses use existing body-language defaults.
- The first integration attempt asked the LLM for six detailed actions. It rendered eight people, including floating duplicates and invented props. Preserved at `logs/scene-probe/integrated/`; this version was corrected before shipping.
- The final smoke replayed the three actual dialogue lines captured by that first API run, with live Ollama staging and ComfyUI generation. `logs/scene-probe/integrated-short/pool.png` shows exactly six people: Omer, Noga, Kai, Maya, Ron and Shira. The submitted graph is `scene-job.json`; the result was a real PNG, not a placeholder. This single integration smoke is separate from the earlier 10/10 experimental pool seed set.
- Regression checks cover current dialogue, six unique characters, inline actions, outfits, mixed swimming status, phone scenes, cache reuse, room-only graph patching and scene-model selection without a room. Targeted suite: 45 tests passed.
- Build passed. Source lint passed with `npm run lint -- --ignore-pattern logs/**`; plain lint also scans the gitignored experiment scripts and downloaded LanPaint source and reports their unrelated JavaScript globals.
- No guarantee of exact character count on every future prompt or seed. Playtest new scenes rather than judging old saved images.

Most images and scripts referenced here live in `logs/scene-probe/`. **`logs/` is git-ignored.** Copy the folder somewhere safe before cleaning the logs.

## What works and what doesn't

| | State |
|---|---|
| Real image instead of a placeholder | ✅ Verified on the integrated scene route; timed-out jobs are cancelled |
| Swimmers in the water, everyone else dry | ✅ Works ([pool.png](../logs/scene-probe/pool.png)) |
| Poses from the dialogue (speaker mid-gesture, emotion → body language) | ✅ Works ([pool.png](../logs/scene-probe/pool.png), [control-cut.png](../logs/scene-probe/control-cut.png)) |
| Rain only outdoors | ✅ Fixed |
| **Each person drawn exactly once** | ✅ Six in the final integrated pool smoke; future scenes still need playtesting |

## Historical test setup (before integration)

- Workflow: `workflows/group_ref.api.json`. Qwen-Image 2.1 turbo Q8 GGUF, `TextEncodeQwenImage21`, 8 steps, CFG 1, 1216×832. One-/two-person scenes with a background use the room first and sample the matching encoder latent. For larger groups the original order remains: people first, then the background as the last of up to 7 references.
- Prompt: built by `freezeRequest` in `apps/server/src/image/requests.ts`, plus the context from `session.sceneImage`.
- Game: seed 21, `moveInDay: false`, a **male** player called Omer Tal (portrait seed 4242).
- Reference images (copies in [`logs/scene-probe/references/`](../logs/scene-probe/references/)):

  | file | size | who |
  |---|---|---|
  | `shared_roof_037a88b2ace8.png` | 832×1216 | Omer (player), **outfit portrait, waist-up, hands in pockets** (kitchen ref 1) |
  | `shared_roof_0c1613256e9a.png` | 104×152 | Maya, prebaked (kitchen ref 2, pool ref 4) |
  | `shared_roof_9076b8a35f16.png` | 208×144 | kitchen background, night (kitchen ref 3) |
  | `shared_roof_93e1f94bcd71.png`, `shared_roof_ec05638ff3b9.png` | 832×1216 | generated portraits (pool refs 1 and 2: the player and Noga) |
  | `shared_roof_4c199f5e0386.png`, `shared_roof_3e753a03f83e.png`, `shared_roof_420e3b3418b3.png` | 104×152 | prebaked housemates (pool refs 3, 5, 6) |
  | `shared_roof_39d5426b0574.png` | 208×144 | pool deck background (pool ref 7) |

- Saved workflows, so a test can be repeated exactly (ComfyUI's history is lost when ComfyUI restarts): [`logs/scene-probe/workflows/`](../logs/scene-probe/workflows/)
  - `kitchen-2people.json`: the "cooking for someone" job (Maya + Omer + kitchen background). Most controls start from this one.
  - `pool-7refs.json`: the first pool job (6 people + pool deck), **old prompt**, before staging.
  - `location-backyard.json`: a txt2img background job, used to test model swapping.

## Every attempt

### A. Pool, six people (before any fixes)

| image | what changed | people drawn | notes |
|---|---|---|---|
| (none, placeholder) | first live probe, old code, encoder resolution 768 | n/a | Timed out after 180 s and showed a placeholder SVG. The job kept running in ComfyUI for **456 s** and slowed the next LLM calls to 1.5 min. |
| [pool-res768.png](../logs/scene-probe/pool-res768.png) | same job resubmitted, warm, Ollama unloaded | 6 ✅ | 77 s. Lined up for the camera; people on the deck look waist-deep in water. |
| [pool-res512.png](../logs/scene-probe/pool-res512.png) | resolution 512 | 6 ✅ | 36 s. Same faces. **This is the image the user flagged** ("people outside are submerged, nobody poses"). |
| [pool-res384.png](../logs/scene-probe/pool-res384.png) | resolution 384 | **7 ❌** | 28 s. A second man in blue trunks. **Duplicates happen even without the LLM shot line.** |
| [pool-res736.png](../logs/scene-probe/pool-res736.png) | 736, cold start (after `/free`) | 6 ✅ | 101 s. The water spills over the deck. |

Model-swap test (`scripts/bench-swap.mjs`): a location job, then the 7-reference job straight after = 30 s + 109 s. **The 456 s was not reproduced in isolation.** The likely cause was contention with the LLM after the timeout, now prevented by cancel-on-timeout.

### B. Pool with the new staging (live probe, current code minus the name and headcount fixes)

| image | people drawn | notes |
|---|---|---|
| [pool.png](../logs/scene-probe/pool.png) | **8 of 6 ❌** | Everyone is in the water, Noga (the speaker) is laughing mid-gesture, and the rain matches the weather. **Kai and Maya appear twice.** Image 90 s, 129 s with the LLM shot. |

### C. Kitchen, two people (Maya + Omer)

Live probe, then controls resubmitted from `kitchen-2people.json` with Ollama unloaded (22–36 s each). "Shot" means the LLM's one-sentence staging: *"Maya stands behind the counter with a soft, bashful smile as she slides a steaming bowl of soup toward Omer, who sits opposite her, looking up in surprised delight."* The premise adds: *"Maya quietly makes a second plate and slides it across the counter to Omer."*

| image | variant | result |
|---|---|---|
| [dinner.png](../logs/scene-probe/dinner.png) | live probe (staging + shot + premise + dialogue; headcount line only for 3+ people) | ❌ **Omer twice**: seated with the soup, and standing on the right in the **exact pose of his reference** (hands in pockets) |
| [control-plain.png](../logs/scene-probe/control-plain.png) | same job, same seed | ❌ identical to dinner.png (jobs are deterministic) |
| [control-seed.png](../logs/scene-probe/control-seed.png) | seed + 1 | ❌ Omer twice |
| [control-phrase.png](../logs/scene-probe/control-phrase.png) | + "exactly 2 people, each of them appears once, nobody else" | ❌ Omer twice |
| [control-roomfirst.png](../logs/scene-probe/control-roomfirst.png) | room background moved to image 1 (the edit canvas), people after it | ❌ Omer twice |
| [control-nodepth.png](../logs/scene-probe/control-nodepth.png) | headcount + removed "at different distances and heights" | ❌ Omer twice |
| [control-idonly.png](../logs/scene-probe/control-idonly.png) | + "the portraits are identity references only: draw each person once, never copy a portrait's pose or framing" | ❌ Omer twice |
| [control-shrink.png](../logs/scene-probe/control-shrink.png) | every reference scaled to 0.02 MP (nearest) | ❌ Omer twice (the copy is softer but still there) |
| [control-names.png](../logs/scene-probe/control-names.png) | headcount + names tied to images ("Omer, the person from image 1 (…)") | ⚠️ Omer once, but **Maya twice** |
| [control-cut.png](../logs/scene-probe/control-cut.png) | names + headcount + **shot only** (premise and raw dialogue removed) | ✅ **2 people**: Maya serving steaming soup, Omer seated and looking up |
| [control-cut2.png](../logs/scene-probe/control-cut2.png) | the same, seed + 5 | ❌ 3 people (a standing copy of Omer's reference) |
| [combo-5.png](../logs/scene-probe/combo-5.png), [combo-9.png](../logs/scene-probe/combo-9.png), [combo-13.png](../logs/scene-probe/combo-13.png) | names + shot only + references at 0.02 MP, 3 seeds | ❌ ❌ ❌ Omer twice in all three |
| [heads-5.png](../logs/scene-probe/heads-5.png), [heads-9.png](../logs/scene-probe/heads-9.png), [heads-13.png](../logs/scene-probe/heads-13.png) | names + shot only + person references cropped to head and shoulders (scale to 832×1216, crop the top 832×640) | ✅ ❌ ❌ 1 of 3 clean |
| [dinner-count.png](../logs/scene-probe/dinner-count.png) | first headcount try through `recount.mjs` | 💥 pure noise, twice, even with Ollama unloaded. **Unexplained.** The same change through `control.mjs` was fine, so don't trust `recount.mjs` (not kept). |

### What shipped before the matching-canvas fix

The code at the start of this investigation had the staging, names tied to images, the headcount line, and "shot instead of premise and dialogue" when the LLM gives a shot. Without a shot (mock mode or an LLM failure) the premise and dialogue are still used. Expect duplicates in roughly half of all images.

## What the evidence says

1. **The duplicate is usually a pasted reference.** The extra figure copies a reference image's framing and pose almost exactly, most often Omer's crisp 832×1216 waist-up outfit portrait. `TextEncodeQwenImage21` splices every reference into the sequence **as VAE latents**, which strongly invites a pixel copy.
2. **It isn't only the high-res references.** Prebaked 104×152 people were doubled too (Kai in pool-res384; Kai and Maya in pool.png).
3. **It isn't only the shot text.** pool-res384 doubled someone before the shot line existed. Naming and cutting text helped on some seeds only.
4. **Wording alone can't stop it** (headcount, "identity only", removing depth wording).
5. Speed: references at 512 halve the time for 7 references with the same faces. A cold model load adds about 25 s. An LLM resident next to ComfyUI made one job take minutes.

## Matching canvas investigation (2026-10-03)

The installed encoder's own source and [ComfyUI's encoder documentation](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/TextEncodeQwenImage21/en.md) require sampling at the first reference's encoded size. The old workflow used a portrait first, then sampled a separate landscape latent. Moving the room first without also fixing the sampling size (the earlier room-first test) did not test this requirement.

New evidence is in [logs/scene-probe/vision-only/](../logs/scene-probe/vision-only/). Saved PNG metadata contains the actual submitted prompt. Kitchen seeds: 22072, 22077, 22081, 22085, 22089; pool seeds start at 32548.

| Variant | Observed result | Decision |
|---|---|---|
| No encoder VAE; existing kitchen prompt | 2 people in all 5 seeds, but standing portraits instead of serving soup; player likeness weaker | Rejected |
| Room first at 1216×832; encoder resolution 0; identity refs at 0.262144 MP; sampler uses encoder latent | 2 people in all 5 soup-shot kitchen seeds; serving action preserved (one seed has Omer standing). Real API plate shot: 3 people | Shipped as a canvas-size correction, **not a duplicate-person fix** |
| Same matching canvas; old pool prompt | 9, 7, 8 people in the three completed seeds; fourth run stopped | Rejected for larger groups |
| Blank canvas first; room as an extra reference | 3 people in the kitchen | Rejected |
| Matching room canvas; concise pool staging | 7 people in both seeds, Maya duplicated | Rejected |
| Room plus one six-person reference sheet | 8 and 7 people | Rejected |
| Qwen Image Edit 2511 + reference sheet (already installed) | 7 people, mixed identities and swimwear | Rejected |
| No VAE + matching room canvas + concise pool staging | 10 and 7 people, actions/clothes ignored | Rejected |

Several initially concurrent probes hit the harness's queue-inclusive timeout; these are excluded from the results. Later probes ran sequentially. Timing with overlapping probes is not an inference-speed benchmark. No extra nodes, models, or dependencies were installed: every variant used existing native nodes and installed models.

The canvas correction keeps VAE identity conditioning. Removing it is not an acceptable general solution. Duplicates need a different composition/identity strategy, likely constrained placement followed by masked per-person face edits; the tested single-pass layouts do not justify claiming them fixed.

### Real API falsification and verification

- [canvas-live/dinner.png](../logs/scene-probe/canvas-live/dinner.png): a real Ollama + ComfyUI run through `POST /api/scene/:id/image`, seed 21, male player Omer. The final canvas graph was validated and rendered, but Omer appeared twice (3 people instead of 2). The complete submitted workflow is saved beside it in `dinner.json`.
- [canvas-live/concise-22072.png](../logs/scene-probe/canvas-live/concise-22072.png) and offsets +5, +9, +13, +17: same failing shot with redundant per-person appearance/framing removed. Counts were 3, 3, 2, 3, 3. Rejected; the prompt edit was reverted.
- Final code checks: 42 targeted server/image/API tests passed, build/type checking passed, and lint passed. The broader test suite exceeded the tool's 300-second response timeout and was stopped; no full-suite pass is claimed.
- Temporary harnesses and invalid/incomplete trials were removed. Complete images and their exact submitted JSON workflows are retained as investigation evidence in the ignored logs folder.
- Judge verdict: canvas correction verified with caveats; duplicate-person fix refuted by the real API image and the further seed sweep. ComfyUI's queue was empty at cleanup.
- INTENT: code sampled a portrait-conditioned landscape; the task expects each person once; the encoder's contract requires sampling at the first reference's encoded size.
- TWINS: searched the repository for TextEncodeQwenImage21 plus separate empty latents; the larger-group branch in the same workflow remains, documented as unresolved. No other workflow uses that encoder.

## Two-stage native-node experiment (2026-10-03)

**Result: not a complete fix.** Generating composition without identity portraits produced exactly two people in 9/10 fixed kitchen seeds. Native masked identity edits either damaged the head placement, inserted another portrait, or preserved composition at the cost of weak identity transfer. No game code or production workflow was changed, and no nodes, dependencies or models were installed.

Evidence: [logs/scene-probe/two-stage/](../logs/scene-probe/two-stage/). This is git-ignored; preserve it with the rest of the probe folder. The reproduction scripts are [two-stage.mjs](../logs/scene-probe/scripts/two-stage.mjs) and [two-stage-review.py](../logs/scene-probe/scripts/two-stage-review.py). Each completed trial retains its submitted API graph, prompt id, timings, image, and (for edits) crop and mask.

### Composition

The room remains image 1 at 1216×832 with encoder resolution 0 and matching canvas dimensions. Character portraits are omitted. A single narrative prompt retains the failing plate-serving action, describes the two adults and their clothes, and requests exactly two people. This tests the complete layout-first recipe, not the isolated effect of removing references: the prompt also changes.

| Seeds | People | Action |
|---|---|---|
| 22072, 22077, 22081, 22085, 22089, 22097, 22101, 22105, 22109 | 2 in each | Maya standing and offering a steaming plate; Omer seated |
| [22093](../logs/scene-probe/two-stage/base-22093.png) | **3** | Two seated copies of Omer; serving action remains |

Warm composition jobs took 26–28 s; the first took 38 s. No retries or seed selection were used to obtain the 9/10 count result. This is one kitchen shot, not evidence for other scenes or larger groups.

### Identity edits

For seeds 22072 and 22077, hand-selected 384×384 head-context crops were enlarged to 768×768. Each edit receives only the scene crop and that person's cropped portrait. The source crop is **VAE-encoded**, given a feathered rectangular noise mask, sampled, reduced back to the crop size, and composited through the same mask onto the full scene. Omer is edited first, then Maya.

| Variant | Observed result | Decision |
|---|---|---|
| Qwen 2.1 Turbo, denoise 1; 2 seeds, 2 people edited per seed | Both final scenes retain two people, but heads move and rectangular patches of room/background appear inside the edit regions ([example](../logs/scene-probe/two-stage/native-final-22072.png)) | Rejected |
| Installed Qwen-Image-Edit 2511 + Lightning, denoise 1; seed 22072 | Omer's edit reasonable; Maya's edit inserts an extra small portrait and torso inside the head region ([image](../logs/scene-probe/two-stage/edit2511-final-22072.png)) | Rejected |
| Qwen 2.1 Turbo, denoise 0.55 + tighter head references; same 2 seeds | No obvious pasted rectangles or added people; serving action stays intact, but reference likeness is still weak, especially Omer's hair ([22072](../logs/scene-probe/two-stage/gentle-final-22072.png), [22077](../logs/scene-probe/two-stage/gentle-final-22077.png)) | Unproven; not shipped |

These are visual judgments, not face-recognition scores. Identity edits were tested on only two clean layouts (one for 2511), not all ten seeds. Masks were chosen manually; automatic detection/assignment and the real game API were not tested. Qwen 2.1 head edits took about 28–36 s each; the two 2511 edits took 104 and 111 s under the current model/offload setup. These observations are not a general model-speed benchmark.

An initial four Qwen 2.1 edit jobs were **invalid harness trials** and excluded. `TextEncodeQwenImage21` output 2 is an empty latent matching the canvas size, not the encoded source image. Feeding that empty latent to `SetLatentNoiseMask` gives no source pixels to preserve during masked sampling. The harness was corrected to use `VAEEncode` of the scene crop. Invalid local trial artifacts were removed; the corrected submitted graphs above are retained.

### Verification and next candidate

- The runnable pixel check verifies dimensions, saved mask bounds, changes inside the requested regions, and **zero changed RGB pixels outside the requested head regions**, for every valid edit. Those checks do not establish identity fidelity or correct composition inside the masks.
- The verifier uses the configured mask support, because saving feathered masks as 8-bit PNG rounds tiny positive corner weights to zero. It does not use those rounded zeros to claim that positive-weight corners must be unchanged.
- Scripts passed syntax checks and the real ComfyUI jobs completed. Production code and workflows were untouched; no full app build/test pass is claimed for this experiment.
- Judge verdict: pixel protection verified; a complete duplicate-person/identity fix is not established. The ten-seed composition result itself refutes a guaranteed headcount fix.
- Next candidate at that point: [LanPaint's Qwen 2.1 masked edit workflow](https://github.com/scraed/LanPaint/blob/master/example_workflows/Qwen_Image_2.1_Edit_Masked_Inpaint.json). It has now been tested below. Civitai browsing was blocked by the browser's site-safety policy.

Reproduce layout trials (runs sequentially; refuses a nonempty queue):

```bash
node logs/scene-probe/scripts/two-stage.mjs base 22072 22077 22081 22085 22089 22093 22097 22101 22105 22109
node logs/scene-probe/scripts/two-stage.mjs edit logs/scene-probe/two-stage/edits-gentle.json
<ComfyUI>/python_embeded/python.exe logs/scene-probe/scripts/two-stage-review.py verify logs/scene-probe/two-stage/edits-gentle.json
```

## LanPaint trial and revised acceptance criteria (2026-10-03)

The user accepts the appearance and likeness of the initial kitchen layout ([base-22077](../logs/scene-probe/two-stage/base-22077.png), the image they attached). They explicitly said art-style changes are not a problem and that six different characters would be acceptable. **Matching pixel style is therefore not a rejection criterion.** The remaining test is whether each intended character appears once, especially in a six-person scene. The attached kitchen image was generated before any identity edit; it is not a LanPaint result.

[LanPaint](https://github.com/scraed/LanPaint) v2.1.0, commit `2d7912f9a5efe5ece8de334c7ca18317b8288c39`, loaded successfully with ComfyUI 0.37.4 and the installed Qwen 2.1 Turbo Q8 GGUF. Its source was cloned into the ignored probe folder and loaded via `--extra-model-paths-config` in a separate server on port 8189. No production custom-node installation, model download, dependency installation or game workflow change was made. Inputs, outputs, temporary files and the trial user directory were placed in the probe folder; the trial used an in-memory database. The first startup was stopped after a database-lock warning and restarted with that explicit database option.

The trial replaces the native encode/masked sampler/decode chain with `LanPaint_ImageEncode` → `LanPaint_KSampler` → `LanPaint_ImageDecode`, using a **binary** mask, five thinking iterations, Image First, Euler/simple, 8 steps, CFG 1 and decode blend overlap 9. Crops and cropped portrait references match the previous gentle native trials. The outer compositor still confines the result to the manually selected head rectangle. The [maintainer warns about reduced performance with distilled models](https://github.com/scraed/LanPaint#features); this test covers our Turbo model, not all Qwen variants.

| Trial | Observed result |
|---|---|
| Denoise 1, Omer then Maya, seeds 22072 and 22077 | Both final scenes contain two people. Omer's portrait traits transfer visibly, but heads shrink/move; Maya edits also change neck/shoulders and leave conspicuous rectangular room patches. Style differences alone do not invalidate these under the user's criteria. |
| Denoise 0.55, Omer then Maya, seed 22072 | Both people remain; original placement is preserved more closely. Changes are much weaker than at full denoise. No additional person appears. |
| Pixel verification, all six edits | Dimensions and mask bounds verified; changes inside the masks; **zero changed RGB pixels outside each requested rectangle**. This establishes protection, not identity accuracy or a headcount guarantee for new compositions. |

Full-strength edits took 82–88 seconds each; the two lower-denoise edits took about 60 seconds each. Actual graphs, prompt IDs, timings, crops, masks and final images are retained. The [comparison sheet](../logs/scene-probe/two-stage/lanpaint-review-sheet.png) shows bases, full-strength edits and the gentle result. The four-job shell wrapper exceeded its 300-second response timeout, but the child continued; completion and artifacts for all four jobs were verified from ComfyUI history and saved results.

Reproduce against a server that has LanPaint loaded:

```powershell
$env:SCENE_COMFY_URL='http://127.0.0.1:8189'
node logs/scene-probe/scripts/two-stage.mjs edit logs/scene-probe/two-stage/edits-lanpaint.json
node logs/scene-probe/scripts/two-stage.mjs edit logs/scene-probe/two-stage/edits-lanpaint-gentle.json
<ComfyUI>/python_embeded/python.exe logs/scene-probe/scripts/two-stage-review.py verify logs/scene-probe/two-stage/edits-lanpaint.json
<ComfyUI>/python_embeded/python.exe logs/scene-probe/scripts/two-stage-review.py verify logs/scene-probe/two-stage/edits-lanpaint-gentle.json
```

### Six-person layout-only follow-up

Because the initial kitchen layout's likeness is acceptable to the user, the six-person test first omits identity edits entirely. It uses the same Qwen 2.1 Turbo Q8 model, 8 steps, CFG 1, room-first 1216×832 canvas, resolution 0, and only the empty pool reference plus descriptive text. The cast is Omer, Kai, Maya, Noga, Ron and Shira. Hair, clothing and accessories distinguish the six; portraits are not supplied to the encoder. This does not promise exact portrait matching.

The first prompt lists each character from left to right, then separately says "The blonde woman laughs and gestures as the others look toward her and react naturally." Ten fixed seeds produced counts **6, 6, 7, 8, 7, 7, 7, 7, 7, 7**: only 2/10 have six people. Most failures add a blonde woman in white swimwear; one adds two women. All ten images were inspected individually. See [the complete sheet](../logs/scene-probe/two-stage/pool-review-sheet.png) and [visual observations](../logs/scene-probe/two-stage/lanpaint-observations.json). A clean six-person example is [32548](../logs/scene-probe/two-stage/pool-base-32548.png).

The next prompt attaches the action to Noga's existing description ("wearing a yellow bikini, laughing and gesturing while the others listen") and deletes the separate blonde-woman sentence. Everything else stays the same. This tests a concrete prompt variant; even if it improves the counts, it does not prove how the model internally interprets the extra sentence.

**Result: 10/10 revised images contain six distinct characters**, based on individual visual inspection of the same ten seeds, with the specified hair/swimwear cues and Noga laughing/gesturing. The [complete revised sheet](../logs/scene-probe/two-stage/pool-inline-review-sheet.png) retains every seed. Compare the earlier eight-person [32561](../logs/scene-probe/two-stage/pool-base-32561.png) against the revised six-person [32561](../logs/scene-probe/two-stage/pool-inline-32561.png). Revised warm jobs took about 28–34 seconds, with a first job at 44 seconds.

The [candidate API workflow](../logs/scene-probe/two-stage/pool-candidate.api.json) is prepared for the original ComfyUI server: it uses the existing pool reference filename and a separate output prefix. It needs the existing GGUF loader and Qwen encoder; it does not need LanPaint. This is a fixed six-person pool prototype, **not game integration or proof for other scenes, casts or exact portrait fidelity**. The approved kitchen appearance is represented by the separate kitchen layout trials, whose count was 9/10.

The candidate also rendered successfully on the original server at port 8188 in 38 seconds after the isolated LanPaint server was stopped. Its [six-person output](../logs/scene-probe/two-stage/pool-candidate-main.png) is RGB-identical to revised seed 32557. Submitted graph, PNG metadata and completed history agree. The original server's queue was empty at cleanup; the isolated process was stopped. The game continues to use its existing workflow.

Verification checked all 20 pool jobs against their real ComfyUI histories and PNG prompt metadata: successful completion, expected model/seed/settings/dimensions, a single room reference, encoder latent sampling, matching saved output descriptors, and only the stated prompt change between each paired seed. Runtime history is archived in [lanpaint-runtime-history.json](../logs/scene-probe/two-stage/lanpaint-runtime-history.json), so these checks can be rerun after the trial server stops. Counts and resemblance are visual judgments, not an automated detector or face-recognition score. All six LanPaint mask checks were rerun and passed. No production files or tests were changed by this trial, and no full app test/build pass is claimed.

```powershell
$env:SCENE_COMFY_URL='http://127.0.0.1:8189'
node logs/scene-probe/scripts/two-stage.mjs pool 32548 32553 32557 32561 32565
node logs/scene-probe/scripts/two-stage.mjs pool 32569 32573 32577 32581 32585
node logs/scene-probe/scripts/two-stage.mjs pool-inline 32548 32553 32557 32561 32565
node logs/scene-probe/scripts/two-stage.mjs pool-inline 32569 32573 32577 32581 32585
<ComfyUI>/python_embeded/python.exe logs/scene-probe/scripts/two-stage-review.py pool-verify logs/scene-probe/two-stage/lanpaint-runtime-history.json
```

## Earlier proposals (results above supersede the tested ones)

1. **Drop the VAE splice for people.** `vae` is an *optional* input of `TextEncodeQwenImage21`. Without it, references are only "seen" by the text encoder and not spliced as latents, so there should be nothing to paste. Identity may weaken. Try it on `kitchen-2people.json` and `pool-7refs.json` over 5+ seeds each. Option: keep the VAE only for the room background (a second encoder, or the room as the latent init).
2. **One composite reference:** tile every portrait into a single "character sheet" image (one ComfyUI node chain or a server-side composite), so the model sees one reference instead of N.
3. **Two passes:** draw the scene from text only (names, staging, room reference), then fix each face with a per-person edit or inpaint pass using their portrait.
4. **Same-sized head references for everyone:** use the base portrait cropped to the face, never the waist-up outfit portrait, and describe the outfit in text. The `heads-*` test only cropped, so try it with matching pixel scale too.
5. Score properly: run every variant over the same 10 seeds and count people per image, because one seed proved nothing (control-cut was clean on seed 0 and doubled on seed 5).

## How to reproduce

ComfyUI on :8188 with the reference files in its `input/` folder (they are still there; copies are in `logs/scene-probe/references/`). **Unload Ollama first**, or results are slow or broken:

```bash
curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"gemma4:12b\",\"keep_alive\":0}"
```

Resubmit a saved workflow with variants (`logs/scene-probe/scripts/control.mjs`). The arguments are: workflow file (or a prompt id still in ComfyUI's history), output png, seed offset, then optional flags: add the headcount line, drop the depth wording, add the "identity only" line. Environment switches:

- `NAMES=Omer,Maya` ties names to images 1 and 2.
- `CUT=1` keeps the shot only. It cuts at the kitchen premise text, so it is kitchen-specific.
- `SHRINK=0.02` scales every reference to that many megapixels.
- `HEADS=ref1,ref2` crops those references to head and shoulders.

```bash
node logs/scene-probe/scripts/control.mjs logs/scene-probe/workflows/kitchen-2people.json logs/scene-probe/test.png 0 1
```

The other scripts:

- `bench-group.mjs`: one job at several encoder resolutions. It reads a prompt id from history, so edit it to read a saved file.
- `bench-swap.mjs`: a location job, then a group job.
- `roomfirst.mjs`: the room as image 1.

A full live run through the game's real API (male player, real Ollama + ComfyUI, throwaway database):

```bash
npx tsx logs/scene-probe.ts logs/scene-probe pool
```

```bash
npx tsx logs/scene-probe.ts logs/scene-probe dinner
```

Note: `pool` and `dinner` overwrite `pool.png` and `dinner.png`. The dinner run usually lands on "cooking for someone" (2 people), not the 3-person group dinner.
