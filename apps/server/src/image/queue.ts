// Image queue: priority (player portrait > current scene > prefetch), concurrency 1, cancellation,
// persistent disk cache keyed by sha256(workflowHash + prompt + negative + seed + size), SQLite index,
// prebaked asset lookup, and placeholder fallback when the backend fails ("images offline").
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ImageBackend, ImageRequest } from '@shared-roof/shared';
import type { Store } from '../db';

export const PRIORITY = { playerPortrait: 100, portrait: 60, currentScene: 50, freeze: 45, location: 30, prefetch: 10 } as const;

export function cacheKey(workflowHash: string, r: ImageRequest): string {
  return createHash('sha256').update(`${workflowHash}\n${r.prompt}\n${r.negative}\n${r.seed}\n${r.width}x${r.height}`).digest('hex');
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
  /** URL of a prebaked asset for a subject key, if the file exists. */
  lookup(subjectKey: string): string | null {
    this.reload();
    const rel = this.manifest[subjectKey];
    if (!rel) return null;
    return existsSync(resolve(this.assetsDir, rel)) ? `/assets/${rel}` : null;
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

  /** Request an image. Returns immediately: ready (cached/prebaked) or queued. */
  request(req: ImageRequest, priority: number): ImageStatus {
    const pre = this.assets?.lookup(req.subjectKey);
    if (pre) return { key: req.subjectKey, status: 'ready', url: pre, placeholder: false };
    const key = cacheKey(this.workflowHash, req);
    const st = this.state.get(key);
    if (st && (st.status === 'ready' || st.status === 'running')) return st;
    const row = this.store.imageGet(key);
    // cached real images are reused; cached placeholders are retried when the real backend is up
    if (row && existsSync(resolve(this.cacheDir, row.path)) && (!row.placeholder || this.backend.name === 'mock')) {
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

  status(key: string): ImageStatus {
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

  private next(): Job | undefined {
    this.jobs.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    return this.jobs.shift();
  }

  private async pump() {
    if (this.running) return;
    const job = this.next();
    if (!job) return;
    this.running = job;
    this.state.set(job.key, { key: job.key, status: 'running', progress: 0 });
    try {
      let res;
      try {
        if (this.backend.name !== 'mock' && this.offline) throw new Error('backend recently failed');
        res = await this.backend.generate(job.req, job.abort.signal);
        this.generated++;
      } catch (e) {
        if (job.abort.signal.aborted) throw e;
        if (this.backend.name !== 'mock') this.lastFailure = Date.now();
        res = await this.fallback.generate(job.req);
      }
      this.store.imagePut(job.key, res.path, job.req.kind, job.req.prompt, job.req.seed, res.placeholder);
      this.state.set(job.key, { key: job.key, status: 'ready', url: `/images/${res.path}`, placeholder: res.placeholder });
    } catch {
      this.state.set(job.key, { key: job.key, status: job.abort.signal.aborted ? 'cancelled' : 'failed' });
    } finally {
      this.running = null;
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
