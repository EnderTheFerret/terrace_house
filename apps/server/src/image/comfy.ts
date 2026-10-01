// ComfyUI backend: load an API-format workflow, patch inputs via mapping.json, POST /prompt,
// follow progress over /ws, then fetch /history/{id} and /view. Swap the workflow without code changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
  output?: { node: string };
}

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Pure: patch a workflow copy with request values according to the mapping. */
export function patchWorkflow(wf: Workflow, map: Mapping, req: ImageRequest, checkpoint?: string): Workflow {
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
  return out;
}

export class ComfyBackend implements ImageBackend {
  readonly name = 'comfyui';
  private wf: Workflow;
  private map: Mapping;
  readonly workflowHash: string;

  constructor(
    private url: string,
    workflowPath: string,
    mappingPath: string,
    private outDir: string,
    private timeoutMs: number,
    private fetchImpl: typeof fetch = fetch,
  ) {
    const wfText = readFileSync(workflowPath, 'utf8');
    const mapText = readFileSync(mappingPath, 'utf8');
    this.wf = JSON.parse(wfText);
    this.map = JSON.parse(mapText);
    this.workflowHash = createHash('sha256').update(wfText).update(mapText).digest('hex');
    mkdirSync(outDir, { recursive: true });
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
    const wf = patchWorkflow(this.wf, this.map, req);
    let pid: string | null = null;
    const wsDone = this.waitWs(clientId, () => pid, sig, onProgress).catch(() => null); // ws is best effort; history polling is authoritative
    const r = await this.fetchImpl(`${this.url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: clientId }), signal: sig });
    if (!r.ok) throw new Error(`comfy /prompt ${r.status}: ${(await r.text()).slice(0, 300)}`);
    pid = ((await r.json()) as { prompt_id: string }).prompt_id;
    const outNode = this.map.output?.node;
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
      await Promise.race([wsDone, new Promise((res) => setTimeout(res, 1000))]);
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
