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

## 6. Extension point: reference images / IP-Adapter

Not implemented. To add it: create a workflow with a LoadImage → IPAdapter (or Qwen-Image-Edit reference) branch, add a
`"reference": { "node": "<LoadImage id>", "input": "image" }` entry to `mapping.json`, upload the character's approved
portrait with ComfyUI's `/upload/image` endpoint inside `ComfyBackend.generate`, and set that input to the returned
filename. `patchWorkflow` in `apps/server/src/image/comfy.ts` is the only function that needs a new mapping key.

## 7. When ComfyUI is down

The game never waits on images. Failed or unreachable requests fall back to procedural pixel-art SVG placeholders, the
UI shows an "images offline" badge, and the backend is retried after a minute.
