# Session handoff — detailed character sprites

Updated: 2026-10-02 (Asia/Jerusalem). Work paused at the user's request. **The sprite work is incomplete; do not claim the generated art is ready.**

## Requested outcome

Use local ComfyUI to make detailed pixel sprites matching the supplied handheld RPG chibi reference: large expressive hair, readable faces, shaded clothing, crisp outlines. This must cover the original cast, procedurally generated NPCs, newcomers after graduation, and user-created/replacement players. Generate a few extra characters for testing. Investigate a compatible image model or Qwen LoRA if useful.

## Where we stopped

The shared sprite renderer and runtime generation path are implemented, with test batches saved. The remaining blocker is **visual reliability**: the four-view ComfyUI sheet sometimes puts the wrong pose in a column or changes a character's appearance between views.

The last attempted fix added a second reference image for layout alongside the user's style reference. It improved some samples but did not solve direction errors consistently. A possible next approach was to generate one front view, then generate back/left views from that character, mirror left for right, and stitch the sheet. **That redesign was only being investigated; it has not been implemented or validated.**

## Stop status

- Stopped our Python generation client, PID `37872`, running `scripts/assets/sprite_tests.py shun --force`.
- Its last submitted ComfyUI job was Dana: `d51bc23b-4d4c-4d8e-bf10-b3268e4aa455`. It completed before targeted cancellation; cancellation returned `false`.
- ComfyUI queue was checked after stopping: no running or pending jobs. ComfyUI itself remains running.
- Dana's latest completed output remains in ComfyUI: `shared_roof_sprite_tests/test-dana_00003_.png`. The stopped client did not download it into this repository.
- No commits or pushes were made. The repository already had substantial unrelated changes; preserve them and do not reset the working tree.

## Implemented changes

### Shared sprites and rendering

- `packages/shared/src/pixel.ts`: detailed **32 × 40** procedural sprites for any character appearance, adding hair shading, face detail, clothing seams/buttons/pockets and accessories. These provide an immediate fallback for every character type.
- `packages/shared/src/sprite-sheet.ts`: imports four-column generated sheets, removes border-connected white background while preserving enclosed white clothing, normalizes frames to 32 × 40, and mirrors the left profile for right. Adds simple alternating foot-lift walk frames.
- `packages/shared/src/interfaces.ts`: adds image kind `sprite` and optional second reference.
- `packages/shared/src/index.ts`: exports the sheet helpers.
- House and City canvases use double backing resolution while retaining the existing 16 × 20 logical sprite footprint and movement/collision layout.
- Creator has a live four-direction procedural sprite preview.

### Runtime generation

- `apps/server/src/image/requests.ts`: shared `spriteRequest` derives appearance and custom description, with a stable appearance-based subject key. Uses the saved style/layout references and a 1024 × 384 four-view prompt.
- `apps/server/src/app.ts`: adds `GET /api/image/character/:id/sprite`, using the existing image queue.
- `apps/server/src/image/comfy.ts` and `main.ts`: select a dedicated sprite workflow and upload/patch both reference images.
- `apps/server/src/image/queue.ts`: includes the second reference path in the cache key.
- `apps/server/src/image/mock.ts`: four-view procedural SVG fallback.
- `apps/web/src/api.ts` and `pixel/sprites.ts`: request/poll sheets for visible characters, load them into a cache, and use detailed procedural sprites while waiting. Cached sprites can still load when ComfyUI is offline.
- `House.tsx` requests visible residents; `CityMap.tsx` requests the player. Arrival generation is therefore triggered on display, rather than proactively while offscreen.

The Creator preview is procedural. There is no ComfyUI preview before joining. Generated walk frames are simple foot lifts, not separately rendered walk poses.

### Workflow and test assets

- `workflows/sprite_edit.api.json` and `sprite_mapping.json`: Qwen-Image-Edit 2511 with existing Lightning 8-step LoRA; two image references; still a single-pass four-view sheet.
- `workflows/sprite-style.jpg`: permanent copy of the user's desired style reference.
- `workflows/sprite-layout.png`: four-direction guide extracted from the original sprite screenshot.
- `scripts/assets/build-sprite-tests.ts`: produces jobs for six original characters and three custom examples (Tamar, Eli, Dana).
- `scripts/assets/sprite-jobs.json`: generated runtime-compatible requests.
- `scripts/assets/sprite_tests.py`: submits the same workflow to ComfyUI, saves raw images/workflows/history, extracts sheets and builds a preview. Has a runnable `--check`.

## Generated assets and provenance

Current experiments: `apps/web/public/assets/sprite-tests/reference-style/` with `raw/`, `sheets/`, `manifest.json`, and `preview.png`. Earlier experiments remain under `apps/web/public/assets/sprite-tests/`.

**The reference-style directory contains mixed versions.** The last two-reference rerender saved through Eli. Dana's local PNG/history/sheets are from an earlier pass, while its workflow JSON was overwritten by the latest submission. The manifest/preview from the interrupted run omit Dana. Do not treat that directory as a consistent final batch or rely on Dana's local workflow JSON as provenance for its existing PNG.

The test candidates were not registered as prebaked sprites in the game's main asset manifest. The runtime path requests/caches sheets automatically.

Generation logs in the project root: `sprite-generation.log`, `sprite-style-generation.log`, `sprite-layout-generation.log` and their error-log companions. `sprite-generation.stop` is a scratch flag; the Python script does not read it.

## Current issues

1. **Wrong facing directions:** a two-reference Kai sample had another front view in column two and the actual back in column four. Extraction assumes down/up/left/right column order, so it accepts the wrong up frame. Earlier Shai samples also showed a face in the back view.
2. **Identity/style consistency:** earlier Shai profiles adopted blue hair from the style reference. Some newer results look closer to the requested proportions, but the full latest batch has not been visually approved. Procedural fallback is more detailed but is not equivalent to the requested generated style.
3. **No semantic sheet validation:** extraction rejects empty/malformed images and checks geometry, but cannot detect incorrect poses, reference-character leakage or identity changes.
4. **Test-script filtering bug:** `sprite_tests.py shun --force` regenerates other characters that already have raw files. The character filter only excludes nonselected characters when their raw file is absent. Fix this before another targeted forced run.
5. **Mixed artifacts/provenance:** reconcile the interrupted batch, especially Dana, before comparing or distributing samples.
6. **Runtime verification pending:** real ComfyUI jobs were exercised through the Python script, but the production `ComfyBackend` sprite path with both references has not been verified end to end through the browser.
7. **Visual verification pending:** no final live House/City inspection of generated sheets or their walk frames. Browser flow tests do not prove the art looks correct.
8. **Limited animation/asymmetry:** right is mirrored left, so asymmetric outfit details switch sides. Walking is a foot-lift approximation.
9. **Cache/reference limitations:** reference cache keys use file paths rather than content hashes. Editing references in place may require invalidating old sprite cache entries. The combined workflow hash also affects other uncached image cache keys.

## Verification completed

| Check | Result / scope |
|---|---|
| `npm run typecheck` | Passed during implementation; latest build also includes type checking. |
| `npm run lint` | Passed before the latest two-reference backend/workflow changes; rerun when resuming. |
| `npm run build` | Passed after the two-reference changes. |
| `npx vitest run packages/shared/src/sprite-sheet.test.ts apps/server/src/image/sprite.test.ts apps/server/src/server.test.ts` | Latest run: **28 passed**. |
| `npx playwright test e2e/creator-portrait.spec.ts e2e/house-life.spec.ts e2e/game.spec.ts` | **8 passed** before the latest backend/workflow edits. Covered creator preview changes, graduation/reentry, city job and house stairs/doors. |
| Embedded Python `scripts/assets/sprite_tests.py --check` | Passed background transparency, preserved white clothing, frame alignment, margins and profile mirroring. |
| Real ComfyUI test generation | Generated original and extra custom candidates; visual failures remain as described above. |

Tests added in `packages/shared/src/sprite-sheet.test.ts` and `apps/server/src/image/sprite.test.ts`. Creator/House E2E files were adjusted for the preview and doubled canvas backing. Review fixes already applied: allow cached sprites when backend offline, distinguish both side walk frames, and remove contradictory portrait/medium-shot framing from sprite prompts.

The full repository test suite was not run. No claim of completed visual acceptance is warranted.

## Local setup and model research

ComfyUI: `http://127.0.0.1:8188`, RTX 5060 Ti with 16 GB VRAM.

Embedded Python: `C:/Projects/ComfyUI_windows_portable/ComfyUI_windows_portable/python_embeded/python.exe`.

The current workflow uses installed `qwen_image_edit_2511_fp8mixed.safetensors`, Qwen text encoder/VAE and the existing Edit Lightning 8-step LoRA. Original `Qwen/qwen_image_fp8_e4m3fn.safetensors` is also installed. **No new models, LoRAs or dependencies were installed.**

Research found [PixelArt Redmond Qwen](https://huggingface.co/artificialguybr/PIXELART-REDMOND-QWENIMAGE) and [Qwen-Image-2512 Pixel Art LoRA](https://huggingface.co/prithivMLmods/Qwen-Image-2512-Pixel-Art-LoRA). Their documented base is Qwen-Image 2512; compatibility with the installed original Qwen or Edit 2511 was not established. [Limbicnation pixel-art-lora](https://huggingface.co/Limbicnation/pixel-art-lora) targets FLUX.2 klein 4B, so it does not directly fit this Qwen workflow.

## Suggested resume order

1. Fix the Python selected-character/`--force` filter. Reconcile Dana's artifacts and label/version batches before new runs.
2. Address pose and identity consistency with a small representative sample. Consider generating views from a single generated front character, then stitching them; this remains an untested proposal. Native ComfyUI `ImageCrop`, `ImageFlip`, and `ImageStitch` nodes are available.
3. Inspect all four directions against the user's reference before accepting sheets. Then verify both default and custom/newcomer characters through the actual runtime endpoint and House/City rendering.
4. Rerun lint, focused unit/browser tests and build after fixes. Run broader tests only as needed for subsequent code changes.
5. Update this handoff with accepted results and any remaining limitations. Preserve unrelated dirty files.

Useful commands (PowerShell, project root):

```powershell
npx tsx scripts/assets/build-sprite-tests.ts
& 'C:/Projects/ComfyUI_windows_portable/ComfyUI_windows_portable/python_embeded/python.exe' scripts/assets/sprite_tests.py --check
npx vitest run packages/shared/src/sprite-sheet.test.ts apps/server/src/image/sprite.test.ts apps/server/src/server.test.ts
```

Do not restart generation until the user resumes the task. Do not rerun a targeted `--force` command until its filtering bug is fixed.
