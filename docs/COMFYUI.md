# ComfyUI setup

Shared Roof talks to ComfyUI over its HTTP API. It loads an **API-format workflow** (`workflows/txt2img.api.json`),
patches a few inputs, queues it, follows progress over the websocket and downloads the result. Any workflow works, as
long as `workflows/mapping.json` says which node inputs to patch. You never need to change code to swap models.

## 1. Run ComfyUI

Use any recent ComfyUI (the Windows portable build is fine) and start it normally, for example:

```
run_nvidia_gpu.bat
```

The game expects it at `COMFY_URL` (default `http://127.0.0.1:8188`). Check `http://127.0.0.1:8188/system_stats` answers.

## 2. The default workflow (Qwen-Image + Lightning)

`workflows/txt2img.api.json` is a minimal text-to-image graph for **Qwen-Image** (Apache-2.0) with the 8-step
Lightning LoRA, which draws clean pixel art at about 30 s per image on a 16 GB card. Put these files in your ComfyUI
`models` folders (names must match, or edit the workflow):

| node | file | folder |
|---|---|---|
| UNETLoader | `Qwen\qwen_image_fp8_e4m3fn.safetensors` | `models/diffusion_models/Qwen/` |
| CLIPLoader (type `qwen_image`) | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `models/text_encoders/` |
| VAELoader | `qwen_image_vae.safetensors` | `models/vae/` |
| LoraLoaderModelOnly | `Qwen\Qwen-Image-Lightning-8steps-V1.1-bf16.safetensors` | `models/loras/Qwen/` |

All are on Hugging Face (Comfy-Org `Qwen-Image_ComfyUI` repackage and `lightx2v/Qwen-Image-Lightning`).

Prefer an SDXL checkpoint? Build that graph in ComfyUI instead (Load Checkpoint → CLIP Text Encode ×2 → Empty Latent →
KSampler → VAE Decode → Save Image), export it as described below and update `mapping.json`. A pixel-art LoRA plus the
default `IMAGE_STYLE_PREFIX` gives similar results.

## 3. Use your own workflow

1. Build and test the graph in the ComfyUI web UI.
2. Settings (gear) → enable **Dev mode** options, then use **Export (API)** / "Save (API Format)". Save it as
   `workflows/txt2img.api.json` (or point `COMFY_WORKFLOW` at another file).
3. Open the exported JSON and note the **node ids** (the top-level keys such as `"6"`) of:
   positive prompt text, negative prompt text, seed, width, height, batch size, checkpoint/model name, and the
   SaveImage node.
4. Edit `workflows/mapping.json`:

```json
{
  "positive":   { "node": "6", "input": "text" },
  "negative":   { "node": "7", "input": "text" },
  "seed":       { "node": "9", "input": "seed" },
  "width":      { "node": "8", "input": "width" },
  "height":     { "node": "8", "input": "height" },
  "batch":      { "node": "8", "input": "batch_size" },
  "checkpoint": { "node": "1", "input": "unet_name" },
  "output":     { "node": "11" }
}
```

Leave a key out to keep that input as saved in the workflow. `output` is the node whose images are downloaded (if it
is missing, the first node with images is used). The cache key includes a hash of the workflow and the mapping, so
changing either regenerates images instead of reusing old ones.

## 4. Sizes, style and safety

- Default sizes: portrait 832×1216, scene/freeze/location 1216×832, panel avatar 512×512 (`apps/server/src/config.ts`).
- `IMAGE_STYLE_PREFIX` is prepended to every prompt. Prompts are compiled by pure functions in
  `packages/shared/src/appearance.ts`: they always include an adult tag (`adult, age 20+`), strip minors-coded words,
  and use a global negative prompt with safety terms.
- Character consistency comes from a fixed `portraitSeed` per character and an identical tag order.
- Generated images are displayed pixelated in the browser (drawn into a 1/8-size canvas and scaled with
  nearest-neighbour), so a "nearly pixel art" model output still looks crisp.

## 5. Prebaked assets

`scripts/assets/build-jobs.ts` builds the job list for the default cast, the panel, every location and the title art,
using the same request builders as the server (so the subject keys match). Generate them with ComfyUI's own Python:

```
npx tsx scripts/assets/build-jobs.ts
<ComfyUI>/python_embeded/python.exe scripts/assets/comfy_gen.py scripts/assets/jobs.json
```

The script downsamples and palette-quantizes each image into true pixel art and writes
`apps/web/public/assets/manifest.json`. The server serves these before queueing anything, in both modes. Pass a
substring to regenerate only some files, for example `... jobs.json portraits/kaito`.

## 6. Scene and portrait references

Scene images and freeze-frames use `workflows/group_ref.api.json`: Qwen-Image 2.1 Turbo Q8 GGUF,
`TextEncodeQwenImage21`, 8 steps, CFG 1. The room is the only image reference and is scaled to 1216×832;
character identities, current clothes and actions are described inline. With no room image, the same model
generates from text. This reduces duplicate people; exact likeness and character count remain model limits.
See [Generate Scene](GENERATE-SCENE.md) for the tested images and results.

Portrait clothing/expression edits still use the approved portrait. The default portrait reference workflow is
`workflows/ref_edit.api.json` (Qwen-Image-Edit 2511 + its Lightning 8-step LoRA, `TextEncodeQwenImageEditPlus` with
the portrait as `image1`). It needs, in addition to the files above:

| node | file | folder |
|---|---|---|
| UNETLoader | `qwen_image_edit_2511_fp8mixed.safetensors` | `models/diffusion_models/` |
| LoraLoaderModelOnly | `Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors` | `models/loras/` |

How it works: when an image request carries a `reference` file, `ComfyBackend.generate` uploads it with
`POST /upload/image`, writes the returned name into the node named by `"reference"` in `workflows/ref_mapping.json`,
and runs the reference workflow. Requests with their own workflow, including scenes, use that workflow.
Cache keys include the selected workflow and its reference inputs.

Standing figures use `workflows/cutout.api.json`: Easy Use's BEN2 removal mask is thresholded and passed through Impact Pack's `MaskToSEGS` contour fill and `SegsToCombinedMask` before alpha is attached. This keeps skin and clothing opaque and removes enclosed mask holes. Easy Use and Impact Pack must be installed; both are present on the development machine. Updated cutout keys bypass earlier soft, perforated figures.

Expression requests set `editRegion: 'face'`. The backend adds Impact Pack's face detector (`models/ultralytics/bbox/face_yolov8m.pt`, provided through Impact Subpack) and composites the generated face onto the approved reference. If an outfit hides the face from detection, the original approved portrait supplies its face position as a fallback. Clothing and body pixels outside the selected face stay unchanged. The detector and model are already installed on the development machine; custom reference workflows must expose an image output for this step.

- Disable it with `COMFY_REF_WORKFLOW=off`.
- Prefer SDXL + IP-Adapter (FaceID)? Export an API-format graph with a `LoadImage` → IPAdapter branch, point
  `COMFY_REF_WORKFLOW` / `COMFY_REF_MAPPING` at it, and give the mapping a `"reference": { "node", "input" }` entry.
- Cost: switching between Qwen-Image and Qwen-Image-Edit reloads a model (first edit image ≈ 50 s on a 16 GB card).
- Scene identities rely on hair, skin, clothes and character descriptions rather than portrait matching.

## 6b. Sharing one GPU with Ollama

While a scene's dialogue is streaming, the image queue starts no new jobs (the player's own portrait in the creator
is the exception) and asks ComfyUI to unload its models (`POST /free`), so the LLM gets the whole card. Queued images
continue as soon as the segment ends. The trade-off is a model reload for the next image.

## 7. When ComfyUI is down

The game never waits on images. Failed or unreachable requests fall back to procedural pixel-art SVG placeholders, the
UI shows an "images offline" badge, and the backend is retried after a minute.
