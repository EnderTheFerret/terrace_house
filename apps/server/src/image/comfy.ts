// ComfyUI backend: load an API-format workflow, patch inputs via mapping.json, POST /prompt,
// follow progress over /ws, then fetch /history/{id} and /view. Swap the workflow without code changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ImageBackend, ImageRequest, ImageResult } from '@shared-roof/shared';

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
  output?: { node: string };
}

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Pure: patch a workflow copy with request values according to the mapping. */
export function patchWorkflow(wf: Workflow, map: Mapping, req: ImageRequest, checkpoint?: string, referenceName?: string, reference2Name?: string): Workflow {
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
  private ref: { wf: Workflow; map: Mapping } | null = null;
  private sprites: { wf: Workflow; map: Mapping } | null = null;
  readonly workflowHash: string;

  constructor(
    private url: string,
    workflowPath: string,
    mappingPath: string,
    private outDir: string,
    private timeoutMs: number,
    private fetchImpl: typeof fetch = fetch,
    reference?: { workflowPath: string; mappingPath: string },
    sprites?: { workflowPath: string; mappingPath: string },
  ) {
    const base = loadPair(workflowPath, mappingPath);
    this.wf = base.wf;
    this.map = base.map;
    let hash = base.hash;
    if (reference) {
      const r = loadPair(reference.workflowPath, reference.mappingPath);
      if (!r.map.reference) throw new Error('reference mapping needs a "reference" entry');
      this.ref = r;
      hash = createHash('sha256').update(hash).update(r.hash).digest('hex');
    }
    if (sprites) {
      const r = loadPair(sprites.workflowPath, sprites.mappingPath);
      if (!r.map.reference || !r.map.reference2) throw new Error('sprite mapping needs both references');
      this.sprites = r;
      hash = createHash('sha256').update(hash).update(r.hash).digest('hex');
    }
    this.workflowHash = hash;
    mkdirSync(outDir, { recursive: true });
  }

  /** Unload ComfyUI's models from VRAM so Ollama can keep the whole card (one consumer GPU). */
  async free(): Promise<void> {
    await this.fetchImpl(`${this.url}/free`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(5000) }).catch(() => {});
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
    const clientId = randomUUID();
    const reference = req.kind === 'sprite' && this.sprites ? this.sprites : this.ref;
    const useRef = !!(reference && req.reference);
    const map = useRef ? reference!.map : this.map;
    const wf = useRef ? patchWorkflow(reference!.wf, map, req, undefined, await this.upload(req.reference!, sig), req.reference2 ? await this.upload(req.reference2, sig) : undefined) : patchWorkflow(this.wf, map, req);
    let pid: string | null = null;
    let wsSettled = false;
    // ws is best effort (it only shortens the wait); history polling is authoritative
    const wsDone = this.waitWs(clientId, () => pid, sig, onProgress).catch(() => null).finally(() => (wsSettled = true));
    const r = await this.fetchImpl(`${this.url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: clientId }), signal: sig });
    if (!r.ok) throw new Error(`comfy /prompt ${r.status}: ${(await r.text()).slice(0, 300)}`);
    pid = ((await r.json()) as { prompt_id: string }).prompt_id;
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
