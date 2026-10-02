# Tel Aviv artwork verification — 2 October 2026

The complete default artwork set is present: **84 of 84 files**, comprising **79 newly generated images and five retained panel avatars**. All 83 manifest keys resolve; the title image is loaded separately. Pillow verified every PNG, and SHA-256 checks found 84 distinct images. No placeholders were counted as generated artwork.

| Coverage | Files |
| --- | ---: |
| Default cast and player portraits | 6 |
| City backgrounds, day and evening | 36 |
| House backgrounds, morning, day and night | 36 |
| Title illustration | 1 |
| Retained panel avatars | 5 |

The durable sources are `scripts/assets/jobs.json`, its builder `scripts/assets/build-jobs.ts`, and the shared runtime scenery prompts in `apps/server/src/image/requests.ts`. Generation used the existing local ComfyUI endpoint at `http://127.0.0.1:8188`, `workflows/txt2img.api.json`, its mapping, Qwen Image FP8 with the eight-step Lightning workflow, and ComfyUI's embedded Python/Pillow. No dependency was installed. Our rendering passes were serialized, with no concurrent Ollama inference or ComfyUI model-unload request from this agent.

The background pilot at 832×576 with pixel factor four took 19.1 seconds, compared with 26.1 seconds for the inspected 1216×832/factor-six variant. The smaller source retained the required geometry and produced comparable pixel detail. `build-jobs.ts` and `jobs.json` now explicitly use the smaller background dimensions. Portrait sources remain 832×1216/factor eight. Earlier successful city files were preserved.

| Final pixel dimensions | Files |
| --- | ---: |
| 104×152 portraits | 6 |
| 85×85 retained panel avatars | 5 |
| 202×138 earlier city backgrounds | 7 |
| 208×144 backgrounds and title | 66 |

The initial fast batch generated 65 files with an 18.1-second median. Visual review then identified house exteriors being used for room backgrounds, pool corners in two garden variants, and overlay captions in several city frames. Explicit room-interior and lawn/paving prompts corrected those problems. The same scenery descriptions now live in the server's shared request builder for both prebaked and runtime images. Four corrected pilot images were accepted directly; the remaining 38 replacements completed with a 23.1-second median. One final balcony night image was rerendered in 17.4 seconds to remove a corner caption.

There were **130 successful ComfyUI renders**, including 51 pilot or replacement renders beyond the 79 distinct new final assets, and **zero image-generation job failures**. Shell wrappers reached their 300-second tool timeout while their generation clients continued normally; completed outputs were preserved. One completed in-flight image was recovered from its exact ComfyUI history entry after the first client was paused between jobs.

Visual inspection covered all six portraits, the title, all 36 city day/evening backgrounds, and all 36 house time variants. Rooms now show interiors; the garden shows a ground-level lawn, paving, shared table, barbecue and the rear of a two-story house, without a pool or rooftop deck. The reviewed replacement promenade, beach and hospital images have no overlay captions. Incidental market vendors and venue musicians remain credible scenery. AI composition can vary in minor furnishings and bed counts; the playable house layout remains the authored map.

The accepted `balconyW-night` image uses the normal seed and dimensions with two targeted prompt substitutions: `wide game background` → `clean architectural pixel illustration`, and `night lighting` → `moonlight through an unlettered balcony railing`. This removes the observed TV-style corner caption without changing other approved frames.

The first final verification at approximately 10:39 local time found no missing manifest files, all PNGs valid and distinct, and zero running or pending ComfyUI jobs. Further full-set review caught an ascending-stair perspective in the three upstairs landings and captions in one flea-market evening and two harbor-boardwalk frames. Those six frames were replaced after the model benchmark released the GPU. The upper landing now shows stairs descending through a floor opening beneath a same-level bedroom corridor, consistent with a two-story house. All six replacements passed inspection. Three landing jobs took 155.5, 128.8 and 184.7 seconds including waits behind unrelated ComfyUI workflows, which were left untouched. 

The final file audit at approximately 11:01 local time again passed all 84 files and 83 manifest entries. Our generation client exited with no own jobs remaining; an unrelated blank-client ComfyUI workflow was still running. 

Logs, superseded pilots, job subsets and the detailed hash/dimension audit are retained locally under ignored `logs/artwork/`; transient files and the generated Python bytecode cache were removed from the working diff. This coverage describes the default clear-weather artwork set; custom character portraits and additional weather variants use the existing runtime generation path.
