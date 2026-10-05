// ComfyUI backend: load an API-format workflow, patch inputs via mapping.json, POST /prompt,
// follow progress over /ws, then fetch /history/{id} and /view. Swap the workflow without code changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ImageBackend, ImageKind, ImageRequest, ImageResult } from '@shared-roof/shared';

export interface Mapping {
  positive?: { node: string; input: string };
  negative?: { node: string; input: string };
  seed?: { node: string; input: string };
  width?: { node: string; input: string };
  height?: { node: string; input: string };
  batch?: { node: string; input: string };
  checkpoint?: { node: string; input: string };
  /** LoadImage input that receives the uploaded reference portrait (reference workflows only) */
  reference?: { node: string; input: string };
  reference2?: { node: string; input: string };
  /** group workflows: one LoadImage per participant; slots beyond the request's references are removed */
  references?: { node: string; input: string }[];
  /** group workflows: the encoder's per-reference resolution (lowered for a full house) */
  resolution?: { node: string; input: string };
  /** Qwen 2.1: optional room canvas supplied in reference2, sampled at the encoder's own size. */
  canvas?: { encoder: string; sampler: string };
  output?: { node: string };
}

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Pure: patch a workflow copy with request values according to the mapping. */
export function patchWorkflow(wf: Workflow, map: Mapping, req: ImageRequest, checkpoint?: string, referenceName?: string, reference2Name?: string, referenceNames: string[] = []): Workflow {
  const out: Workflow = structuredClone(wf);
  const put = (m: { node: string; input: string } | undefined, v: unknown) => {
    if (!m) return;
    if (!out[m.node]) throw new Error(`mapping refers to missing node ${m.node}`);
    out[m.node].inputs[m.input] = v;
  };
  put(map.positive, req.prompt);
  put(map.negative, req.negative);
  put(map.seed, req.seed);
  put(map.width, req.width);
  put(map.height, req.height);
  put(map.batch, 1);
  if (checkpoint) put(map.checkpoint, checkpoint);
  if (referenceName) put(map.reference, referenceName);
  if (reference2Name) put(map.reference2, reference2Name);
  if (req.framing === 'knees' && map.output) {
    const saved = out[map.output.node];
    if (!saved?.inputs.images) throw new Error('knees-up framing needs an image output');
    // ponytail: upright, frame-filling figures put knees near 80%; use pose landmarks if arbitrary poses are supported.
    out.portraitCrop = { class_type: 'ImageCropV2', inputs: { image: saved.inputs.images, crop_region: { x: 0, y: 0, width: req.width, height: Math.round(req.height * 0.8) } } };
    out.portraitScale = { class_type: 'ImageScale', inputs: { image: ['portraitCrop', 0], upscale_method: 'nearest-exact', width: req.width, height: req.height, crop: 'center' } };
    out.portraitRemBg = { class_type: 'easy imageRemBg', inputs: { images: ['portraitScale', 0], rem_mode: 'BEN2', image_output: 'Hide', save_prefix: 'rembg', torchscript_jit: false, add_background: 'none', refine_foreground: false } };
    out.portraitSolid = { class_type: 'ThresholdMask', inputs: { mask: ['portraitRemBg', 1], value: 0.5 } };
    out.portraitContours = { class_type: 'MaskToSEGS', inputs: { mask: ['portraitSolid', 0], combined: false, crop_factor: 1.0, bbox_fill: false, drop_size: 32, contour_fill: true } };
    out.portraitMask = { class_type: 'SegsToCombinedMask', inputs: { segs: ['portraitContours', 0] } };
    out.portraitBackground = { class_type: 'EmptyImage', inputs: { width: req.width, height: req.height, batch_size: 1, color: 0xf4eee4 } };
    out.portraitMatte = { class_type: 'ImageCompositeMasked', inputs: { destination: ['portraitBackground', 0], source: ['portraitScale', 0], mask: ['portraitMask', 0], x: 0, y: 0, resize_source: false } };
    saved.inputs.images = ['portraitMatte', 0];
  }
  if (req.editRegion === 'face' && referenceName && map.reference && map.output) {
    const saved = out[map.output.node];
    if (!saved?.inputs.images) throw new Error('face editing needs an image output');
    out.faceDetector = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: 'bbox/face_yolov8m.pt' } };
    out.faceSegments = { class_type: 'BboxDetectorSEGS', inputs: { bbox_detector: ['faceDetector', 0], image: [map.reference.node, 0], threshold: 0.25, dilation: 0, crop_factor: 1.0, drop_size: 10, labels: 'all' } };
    out.faceMask = { class_type: 'SegsToCombinedMask', inputs: { segs: ['faceSegments', 0] } };
    if (reference2Name) {
      out.faceGuide = { class_type: 'LoadImage', inputs: { image: reference2Name } };
      out.faceGuideSegments = { class_type: 'BboxDetectorSEGS', inputs: { ...out.faceSegments.inputs, image: ['faceGuide', 0] } };
      out.faceFound = { class_type: 'ImpactIsNotEmptySEGS', inputs: { segs: ['faceSegments', 0] } };
      out.faceChoice = { class_type: 'ImpactConditionalBranch', inputs: { cond: ['faceFound', 0], tt_value: ['faceSegments', 0], ff_value: ['faceGuideSegments', 0] } };
      out.faceMask.inputs.segs = ['faceChoice', 0];
    }
    out.faceForeground = { class_type: 'easy imageRemBg', inputs: { images: [map.reference.node, 0], rem_mode: 'BEN2', image_output: 'Hide', save_prefix: 'rembg', torchscript_jit: false, add_background: 'none', refine_foreground: false } };
    out.faceSolid = { class_type: 'ThresholdMask', inputs: { mask: ['faceForeground', 1], value: 0.5 } };
    out.faceEditMask = { class_type: 'MaskComposite', inputs: { destination: ['faceMask', 0], source: ['faceSolid', 0], x: 0, y: 0, operation: 'multiply' } };
    out.faceComposite = { class_type: 'ImageCompositeMasked', inputs: { destination: [map.reference.node, 0], source: saved.inputs.images, mask: ['faceEditMask', 0], x: 0, y: 0, resize_source: true } };
    saved.inputs.images = ['faceComposite', 0];
  }
  // a full house (5+ references) at 512 keeps faces as well as 768 and runs twice as fast (36 s vs 77 s for 7)
  if (referenceNames.length > 4) put(map.resolution, 512);
  if (map.references && (referenceNames.length || (map.canvas && reference2Name))) {
    map.references.forEach((m, i) => {
      if (i < referenceNames.length) return put(m, referenceNames[i]);
      // drop the unused LoadImage and every input wired to it
      delete out[m.node];
      for (const n of Object.values(out)) for (const [k, v] of Object.entries(n.inputs)) if (Array.isArray(v) && v[0] === m.node) delete n.inputs[k];
    });
  }
  if (map.canvas && reference2Name) {
    const enc = out[map.canvas.encoder];
    const sampler = out[map.canvas.sampler];
    if (!enc || !sampler) throw new Error('canvas mapping refers to a missing node');
    out.sceneCanvas = { class_type: 'LoadImage', inputs: { image: reference2Name } };
    out.sceneCanvasScale = { class_type: 'ImageScale', inputs: { image: ['sceneCanvas', 0], upscale_method: 'nearest-exact', width: req.width, height: req.height, crop: 'disabled' } };
    const images = Object.entries(enc.inputs).filter(([k]) => k.startsWith('images.'));
    for (const [k] of images) delete enc.inputs[k];
    enc.inputs['images.image_1'] = ['sceneCanvasScale', 0];
    images.forEach(([, image], i) => {
      const node = `sceneRef${i + 1}Scale`;
      out[node] = { class_type: 'ImageScaleToTotalPixels', inputs: { image, upscale_method: 'lanczos', megapixels: 0.262144, resolution_steps: 32 } };
      enc.inputs[`images.image_${i + 2}`] = [node, 0];
    });
    // Preserve the canvas dimensions exactly; changing them after encoding shifts the edit onto the portraits.
    enc.inputs.resolution = 0;
    sampler.inputs.latent_image = [map.canvas.encoder, 2];
  }
  return out;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const loadPair =(wfPath: string, mapPath: string) => {
  const wfText = readFileSync(wfPath, 'utf8');
  const mapText = readFileSync(mapPath, 'utf8');
  return { wf: JSON.parse(wfText) as Workflow, map: JSON.parse(mapText) as Mapping, hash: createHash('sha256').update(wfText).update(mapText).digest('hex') };
};

export class ComfyBackend implements ImageBackend {
  readonly name = 'comfyui';
  private wf: Workflow;
  private map: Mapping;
  /** optional reference-image workflow (e.g. Qwen-Image-Edit or IP-Adapter) for requests that carry a reference */
  private ref: { wf: Workflow; map: Mapping; hash: string } | null = null;
  /** dedicated image-to-image workflows per kind (walk sheets, cutouts); each needs the request's reference image */
  private kinds = new Map<string, { wf: Workflow; map: Mapping; hash: string }>();
  private baseHash: string;
  readonly workflowHash: string;
  /** runs before every job, e.g. unloading a resident LLM that shares the GPU */
  beforeJob: (() => Promise<unknown>) | null = null;

  constructor(
    private url: string,
    workflowPath: string,
    mappingPath: string,
    private outDir: string,
    private timeoutMs: number,
    private fetchImpl: typeof fetch = fetch,
    reference?: { workflowPath: string; mappingPath: string },
    kinds: Partial<Record<ImageKind, { workflowPath: string; mappingPath: string }>> = {},
  ) {
    const base = loadPair(workflowPath, mappingPath);
    this.wf = base.wf;
    this.map = base.map;
    this.baseHash = base.hash;
    let hash = base.hash;
    if (reference) {
      const r = loadPair(reference.workflowPath, reference.mappingPath);
      if (!r.map.reference) throw new Error('reference mapping needs a "reference" entry');
      this.ref = r;
      hash = createHash('sha256').update(hash).update(r.hash).digest('hex');
    }
    for (const [kind, p] of Object.entries(kinds)) {
      const r = loadPair(p.workflowPath, p.mappingPath);
      if (!r.map.reference && !r.map.canvas) throw new Error(`${kind} mapping needs a "reference" or "canvas" entry`);
      this.kinds.set(kind, r);
      hash = createHash('sha256').update(hash).update(r.hash).digest('hex');
    }
    this.workflowHash = hash;
    mkdirSync(outDir, { recursive: true });
  }

  workflowHashFor(req: ImageRequest): string {
    const own = this.kinds.get(req.kind);
    if (own?.map.canvas) return own.hash;
    return req.reference || req.reference2 || req.references?.length ? (this.kinds.get(req.kind) ?? this.ref)?.hash ?? this.baseHash : this.baseHash;
  }

  /** Unload ComfyUI's models from VRAM so Ollama can keep the whole card (one consumer GPU). */
  async free(): Promise<void> {
    await this.fetchImpl(`${this.url}/free`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(5000) }).catch(() => {});
  }

  async interrupt(): Promise<void> {
    await this.fetchImpl(`${this.url}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
  }

  /** Stop one prompt, running or still queued, without touching anyone else's. */
  private async cancelPrompt(pid: string): Promise<void> {
    const post = (path: string, body: unknown) => this.fetchImpl(`${this.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }).catch(() => {});
    await Promise.all([post('/interrupt', { prompt_id: pid }), post('/queue', { delete: [pid] })]);
  }

  /** Upload a local image to ComfyUI's input folder; returns the name LoadImage expects. */
  private async upload(file: string, signal: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([readFileSync(file)], { type: 'image/png' }), `shared_roof_${createHash('sha256').update(file).digest('hex').slice(0, 12)}${extname(file) || '.png'}`);
    form.append('overwrite', 'true');
    const r = await this.fetchImpl(`${this.url}/upload/image`, { method: 'POST', body: form, signal });
    if (!r.ok) throw new Error(`comfy /upload/image ${r.status}`);
    const j = (await r.json()) as { name: string; subfolder?: string };
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.fetchImpl(`${this.url}/system_stats`, { signal: AbortSignal.timeout(2500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  private waitWs(clientId: string, promptId: () => string | null, signal: AbortSignal, onProgress?: (p: number) => void): Promise<void> {
    return new Promise((res, rej) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${this.url.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
      } catch (e) {
        rej(e);
        return;
      }
      const done = (err?: Error) => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        if (err) rej(err);
        else res();
      };
      signal.addEventListener('abort', () => done(new Error('aborted')));
      ws.onerror = () => done(new Error('comfy websocket error'));
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return; // binary previews
        const msg = JSON.parse(ev.data) as { type: string; data: any };
        const pid = promptId();
        if (msg.type === 'progress' && msg.data?.prompt_id === pid) onProgress?.(msg.data.value / Math.max(1, msg.data.max));
        if (msg.type === 'execution_error' && msg.data?.prompt_id === pid) done(new Error('comfy execution error'));
        if ((msg.type === 'executing' && msg.data?.node === null && msg.data?.prompt_id === pid) || (msg.type === 'execution_success' && msg.data?.prompt_id === pid)) done();
      };
    });
  }

  async generate(req: ImageRequest, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<ImageResult> {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    await this.beforeJob?.();
    const clientId = randomUUID();
    const own = this.kinds.get(req.kind);
    const reference = own ?? this.ref;
    const useRef = !!(reference && (own?.map.canvas || req.reference || (own?.map.references && req.references?.length)));
    // txt2img cannot draw a sheet or a cutout; let the queue fall back instead
    if ((req.kind === 'sprite' || req.kind === 'cutout') && !(own && req.reference)) throw new Error(`${req.kind} needs its workflow and a reference image`);
    const map = useRef ? reference!.map : this.map;
    const refs = useRef && map.references && req.references?.length ? await Promise.all(req.references.slice(0, map.references.length).map((f) => this.upload(f, sig))) : [];
    const wf = useRef ? patchWorkflow(reference!.wf, map, req, undefined, req.reference ? await this.upload(req.reference, sig) : refs[0], req.reference2 ? await this.upload(req.reference2, sig) : undefined, refs) : patchWorkflow(this.wf, map, req);
    let pid: string | null = null;
    let wsSettled = false;
    // ws is best effort (it only shortens the wait); history polling is authoritative
    const wsDone = this.waitWs(clientId, () => pid, sig, onProgress).catch(() => null).finally(() => (wsSettled = true));
    const r = await this.fetchImpl(`${this.url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: clientId }), signal: sig });
    if (!r.ok) throw new Error(`comfy /prompt ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const promptId = ((await r.json()) as { prompt_id: string }).prompt_id;
    pid = promptId;
    // a timed-out job must not keep the GPU busy (it slowed the next LLM calls to minutes): cancel only ours.
    // Preemption (the caller's signal) already interrupts through the queue.
    sig.addEventListener('abort', () => { if (!signal?.aborted) void this.cancelPrompt(promptId); }, { once: true });
    const outNode = map.output?.node;
    let images: { filename: string; subfolder: string; type: string }[] | undefined;
    for (;;) {
      if (sig.aborted) throw new Error('image generation timed out');
      const h = await this.fetchImpl(`${this.url}/history/${pid}`, { signal: sig });
      if (h.ok) {
        const j = (await h.json()) as Record<string, { outputs?: Record<string, { images?: typeof images }>; status?: { status_str?: string } }>;
        const entry = j[pid];
        if (entry?.status?.status_str === 'error') throw new Error('comfy reported an error');
        const outs = entry?.outputs ?? {};
        images = outNode ? outs[outNode]?.images : Object.values(outs).find((o) => o.images?.length)?.images;
        if (images?.length) break;
      }
      // once the socket is gone (finished or failed) keep polling, but never in a tight loop
      await (wsSettled ? sleep(250) : Promise.race([wsDone, sleep(1000)]));
    }
    const im = images[0];
    const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder, type: im.type });
    const v = await this.fetchImpl(`${this.url}/view?${q}`, { signal: sig });
    if (!v.ok) throw new Error(`comfy /view ${v.status}`);
    const buf = Buffer.from(await v.arrayBuffer());
    const id = createHash('sha256').update(buf).digest('hex').slice(0, 24);
    const file = `cf-${id}.png`;
    writeFileSync(resolve(this.outDir, file), buf);
    return { id, path: file, mime: 'image/png', placeholder: false };
  }
}
