// Image queue: priority (player portrait > current scene > prefetch), concurrency 1, cancellation,
// persistent disk cache keyed by sha256(workflowHash + prompt + negative + seed + size), SQLite index,
// prebaked asset lookup, and placeholder fallback when the backend fails ("images offline").
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ImageBackend, ImageRequest } from '@shared-roof/shared';
import type { Store } from '../db';

const imageStep = (req: ImageRequest) => req.kind === 'portrait' ? req.subjectKey.includes(':expression:') ? 'expression' : req.subjectKey.includes(':outfit:') ? 'outfit' : req.kind : req.kind;

export const PRIORITY = { playerPortrait: 100, currentSprite: 80, portrait: 60, currentScene: 50, freeze: 45, location: 30, prefetch: 10 } as const;

export function cacheKey(workflowHash: string, r: ImageRequest): string {
  return createHash('sha256').update(`${workflowHash}\n${r.prompt}\n${r.negative}\n${r.seed}\n${r.width}x${r.height}${r.reference ? `\n${r.reference}` : ''}${r.reference2 ? `\n${r.reference2}` : ''}${r.references?.length ? `\n${r.references.join('\n')}` : ''}${r.editRegion ? `\nedit:${r.editRegion}` : ''}${r.framing ? `\nframe:${r.framing}` : ''}`).digest('hex');
}

export interface ImageStatus {
  key: string;
  status: 'ready' | 'queued' | 'running' | 'failed' | 'cancelled';
  url?: string;
  placeholder?: boolean;
  progress?: number;
}

interface Job {
  key: string;
  req: ImageRequest;
  priority: number;
  seq: number;
  abort: AbortController;
}

export class AssetLibrary {
  private manifest: Record<string, string> = {};
  private mtime = 0;
  constructor(private assetsDir: string) {
    this.reload();
  }
  /** Re-read manifest.json when it changes (assets can be generated while the server runs). */
  private reload() {
    const f = resolve(this.assetsDir, 'manifest.json');
    try {
      const m = statSync(f).mtimeMs;
      if (m !== this.mtime) {
        this.manifest = JSON.parse(readFileSync(f, 'utf8'));
        this.mtime = m;
      }
    } catch {
      this.manifest = {};
    }
  }
  /** Path of a prebaked asset for a subject key, if the file exists. */
  file(subjectKey: string): string | null {
    this.reload();
    const rel = this.manifest[subjectKey];
    return rel && existsSync(resolve(this.assetsDir, rel)) ? resolve(this.assetsDir, rel) : null;
  }
  /** URL of a prebaked asset for a subject key, if the file exists. */
  lookup(subjectKey: string): string | null {
    return this.file(subjectKey) ? `/assets/${this.manifest[subjectKey]}` : null;
  }
  keys() {
    return Object.keys(this.manifest);
  }
}

export class ImageQueue {
  private jobs: Job[] = [];
  private state = new Map<string, ImageStatus>();
  private running: Job | null = null;
  private seq = 0;
  private held = 0;
  private gpuDirty = false;
  private freeing: Promise<unknown> = Promise.resolve();
  private preempted: Job | null = null;
  private startedAt = 0;
  private durations = new Map<string, number>();
  lastFailure = 0;
  generated = 0;

  constructor(
    private backend: ImageBackend,
    private fallback: ImageBackend,
    private store: Store,
    private workflowHash: string,
    private cacheDir: string,
    private assets: AssetLibrary | null,
  ) {}

  get offline() {
    return this.backend.name === 'mock' || Date.now() - this.lastFailure < 60_000;
  }

  private key(req: ImageRequest) {
    return cacheKey(this.backend.workflowHashFor?.(req) ?? this.workflowHash, req);
  }

  /** Inspect a cached image without starting generation. */
  peek(req: ImageRequest): ImageStatus | null {
    const pre = this.assets?.lookup(req.subjectKey);
    if (pre) return { key: req.subjectKey, status: 'ready', url: pre, placeholder: false };
    const key = this.key(req);
    const row = this.store.imageGet(key) ?? this.store.imageGet(cacheKey(this.workflowHash, req));
    if (row && existsSync(resolve(this.cacheDir, row.path))) return { key, status: 'ready', url: `/images/${row.path}`, placeholder: !!row.placeholder };
    return this.state.get(key) ?? null;
  }

  /** Request an image. Returns immediately: ready (cached/prebaked) or queued. */
  request(req: ImageRequest, priority: number): ImageStatus {
    const pre = this.assets?.lookup(req.subjectKey);
    if (pre) return { key: req.subjectKey, status: 'ready', url: pre, placeholder: false };
    const key = this.key(req);
    const st = this.state.get(key);
    if (st && (st.status === 'running' || (st.status === 'ready' && (!st.placeholder || this.backend.name === 'mock')))) return st;
    const row = this.store.imageGet(key) ?? this.store.imageGet(cacheKey(this.workflowHash, req));
    // cached real images are reused; cached placeholders are retried when the real backend is up
    if (row && existsSync(resolve(this.cacheDir, row.path)) && (!row.placeholder || this.backend.name === 'mock')) {
      this.store.imagePut(key, row.path, req.kind, req.prompt, req.seed, !!row.placeholder);
      const ready: ImageStatus = { key, status: 'ready', url: `/images/${row.path}`, placeholder: !!row.placeholder };
      this.state.set(key, ready);
      return ready;
    }
    const existing = this.jobs.find((j) => j.key === key);
    if (existing) existing.priority = Math.max(existing.priority, priority);
    else this.jobs.push({ key, req, priority, seq: this.seq++, abort: new AbortController() });
    const queued: ImageStatus = { key, status: 'queued' };
    this.state.set(key, queued);
    void this.pump();
    return queued;
  }

  /** Local file of a finished, non-placeholder image for this request (prebaked or generated), if there is one. */
  localFile(req: ImageRequest): string | null {
    const pre = this.assets?.file(req.subjectKey);
    if (pre) return pre;
    const key = this.key(req);
    const row = this.store.imageGet(key) ?? this.store.imageGet(cacheKey(this.workflowHash, req));
    const f = row && !row.placeholder ? resolve(this.cacheDir, row.path) : null;
    if (row && f && existsSync(f)) this.store.imagePut(key, row.path, req.kind, req.prompt, req.seed, false);
    return f && existsSync(f) ? f : null;
  }

  status(key: string): ImageStatus {
    const pre = this.assets?.lookup(key);
    if (pre) return { key, status: 'ready', url: pre, placeholder: false };
    return this.state.get(key) ?? { key, status: 'failed' };
  }

  cancel(key: string): boolean {
    const i = this.jobs.findIndex((j) => j.key === key);
    if (i >= 0) {
      this.jobs.splice(i, 1);
      this.state.set(key, { key, status: 'cancelled' });
      return true;
    }
    if (this.running?.key === key) {
      this.running.abort.abort();
      return true;
    }
    return false;
  }

  /** Cancel all queued prefetch work below a priority (e.g. when the scene changes). */
  cancelBelow(priority: number) {
    for (const j of [...this.jobs]) if (j.priority < priority) this.cancel(j.key);
  }

  pending() {
    return { queued: this.jobs.length, running: this.running?.key ?? null };
  }

  /** Current image step; dependency steps are requested later, so this is not a whole-cast ETA. */
  activity() {
    const job = this.running ?? [...this.jobs].sort((a, b) => b.priority - a.priority || a.seq - b.seq)[0];
    if (!job) return null;
    const step = imageStep(job.req);
    const labels: Record<string, string> = { portrait: 'Generating portrait', expression: 'Generating expression', outfit: 'Generating outfit', sprite: 'Generating walk sprite', cutout: 'Removing portrait background', location: 'Generating scenery', scene: 'Generating scene image', freeze: 'Generating scene image', avatar: 'Generating panel portrait' };
    const initial: Record<string, number> = { portrait: 45000, expression: 120000, outfit: 120000, sprite: 35000, cutout: 8000, location: 45000, scene: 120000, freeze: 120000, avatar: 35000 };
    return {
      label: labels[step], characterId: /portrait:([^:]+)/.exec(job.req.subjectKey)?.[1],
      startedAt: this.running ? this.startedAt : Date.now(),
      estimatedMs: this.durations.get(step) ?? initial[step],
      progress: this.state.get(job.key)?.progress,
      queued: this.jobs.length,
      waiting: !this.running ? this.held > 0 && this.backend.name !== 'mock' ? 'Waiting for dialogue to finish' : 'Waiting for image service' : undefined,
    };
  }

  private next(): Job | undefined {
    this.jobs.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    return this.jobs.shift();
  }

  /**
   * Keep the GPU free for the LLM while dialogue is streaming: queued jobs wait (except the player's own portrait)
   * until every hold is released. A job already running finishes. Returns the release function.
   */
  hold(): () => void {
    this.held++;
    // dialogue preempts background art: stop a running prefetch/scenery job and put it back in the queue
    // Explicit scene photos finish; daily outfits and walk sheets yield even when they have a high drawing priority.
    // ponytail: a player who never pauses between scenes starves freeze-frames; they finish once dialogue stops
    if (this.running && (this.running.priority < PRIORITY.currentScene || this.running.priority === PRIORITY.currentSprite || this.running.req.kind === 'sprite' || this.running.req.subjectKey.includes(':outfit:')) && this.backend.interrupt && this.backend.name !== 'mock') {
      // only ComfyUI is told to stop; aborting our own fetch mid-read crashes Node's undici (ERR_INVALID_STATE)
      this.preempted = this.running;
      void this.backend.interrupt();
    }
    if (!this.running) this.freeGpu();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held--;
      void this.pump();
    };
  }

  /** Models left in VRAM after a job (finished or interrupted) still crowd the LLM; unload them. The next image reloads. */
  private freeGpu() {
    if (!this.gpuDirty) return;
    this.gpuDirty = false;
    this.freeing = this.backend.free?.() ?? Promise.resolve();
  }

  /**
   * hold(), then wait until the running job has stopped (interrupted) or finished (scene photo, portrait) and ComfyUI
   * has unloaded, so the LLM loads onto a clear card. Without the wait, an LLM call ran beside a still-running image
   * and took 20-80 s instead of ~3 s.
   */
  async holdClear(): Promise<() => void> {
    const release = this.hold();
    for (let i = 0; i < 1200 && this.running; i++) await new Promise((r) => setTimeout(r, 100)); // ponytail: polls, gives up after 2 min
    await this.freeing;
    return release;
  }

  private async pump() {
    if (this.running) return;
    if (this.held > 0 && this.backend.name !== 'mock' && !this.jobs.some((j) => j.priority >= PRIORITY.playerPortrait)) return;
    const job = this.next();
    if (!job) return;
    this.running = job;
    this.startedAt = Date.now();
    this.state.set(job.key, { key: job.key, status: 'running', progress: 0 });
    try {
      let res;
      try {
        if (this.backend.name !== 'mock' && this.offline) throw new Error('backend recently failed');
        this.gpuDirty = true;
        res = await this.backend.generate(job.req, job.abort.signal, progress => {
          if (this.running?.key === job.key && !job.abort.signal.aborted) this.state.set(job.key, { key: job.key, status: 'running', progress: Math.max(0, Math.min(1, progress)) });
        });
        const step = imageStep(job.req);
        // ponytail: timings cover one image step per server run, not future outfit/expression dependency jobs.
        if (!res.placeholder) this.durations.set(step, Math.max(1000, (this.durations.get(step) ?? Date.now() - this.startedAt) * 0.7 + (Date.now() - this.startedAt) * 0.3));
        this.generated++;
      } catch (e) {
        if (job.abort.signal.aborted || this.preempted === job) throw e; // preempted jobs are requeued, not placeholdered
        if (this.backend.name !== 'mock') {
          // say why once; jobs skipped while offline would only repeat it
          if (!this.offline) console.warn(`[images] ${job.req.kind} failed, using a placeholder: ${(e as Error).message}`);
          this.lastFailure = Date.now();
        }
        res = await this.fallback.generate(job.req);
      }
      this.store.imagePut(job.key, res.path, job.req.kind, job.req.prompt, job.req.seed, res.placeholder);
      this.state.set(job.key, { key: job.key, status: 'ready', url: `/images/${res.path}`, placeholder: res.placeholder });
    } catch {
      if (this.preempted === job) {
        // interrupted for dialogue, not cancelled: back in line, it resumes when the GPU is free again
        this.preempted = null;
        this.jobs.push({ ...job, abort: new AbortController() });
        this.state.set(job.key, { key: job.key, status: 'queued' });
      } else this.state.set(job.key, { key: job.key, status: job.abort.signal.aborted ? 'cancelled' : 'failed' });
    } finally {
      this.running = null;
      if (this.held > 0) this.freeGpu();
      void this.pump();
    }
  }

  /** Wait until a key settles (tests / smoke). */
  async settle(key: string, timeoutMs = 300_000): Promise<ImageStatus> {
    const t0 = Date.now();
    for (;;) {
      const st = this.status(key);
      if (st.status === 'ready' || st.status === 'failed' || st.status === 'cancelled') return st;
      if (Date.now() - t0 > timeoutMs) return st;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
