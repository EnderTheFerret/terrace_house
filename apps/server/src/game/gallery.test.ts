import { expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';

it('keeps original scene images across restarts, newest first, without duplicates or missing previews', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-gallery-'));
  const dbFile = join(dir, 'gallery.sqlite');
  const store = new Store(openDb(dbFile));
  const originalFile = resolve('apps/web/public/assets/portraits/finished-ren-thigh-up-v1.png');
  for (const file of ['scene.png', 'older.png', 'preview.png', 'portrait.png']) copyFileSync(originalFile, join(dir, file));
  store.imagePut('scene', 'scene.png', 'freeze', 'conversation', 1, false);
  store.imagePut('legacy-alias', 'scene.png', 'freeze', 'conversation', 1, false);
  store.imagePut('older', 'older.png', 'freeze', 'previous season', 2, false);
  store.db.prepare("UPDATE images SET created_at = '2025-01-01 00:00:00' WHERE key = 'older'").run();
  store.imagePut('missing', 'missing.png', 'freeze', '', 1, false);
  store.imagePut('placeholder', 'preview.png', 'freeze', '', 1, true);
  store.imagePut('portrait', 'portrait.png', 'portrait', '', 1, false);
  store.db.close();

  const resumed = new Store(openDb(dbFile));
  const image = { name: 'mock', health: async () => true, generate: async () => {
    copyFileSync(originalFile, join(dir, 'new-scene.png'));
    return { id: 'new-scene', path: 'new-scene.png', mime: 'image/png', placeholder: false };
  } };
  const { app, queue } = await buildApp({ llm: new MockLlm(), image, store: resumed, workflowHash: 'mock', cacheDir: dir });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/gallery' });
    expect(res.statusCode).toBe(200);
    const scenes = res.json().scenes;
    expect(scenes.map((s: { url: string }) => s.url)).toEqual(['/images/scene.png', '/images/older.png']);
    const original = await app.inject({ method: 'GET', url: scenes[0].url });
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload.equals(readFileSync(originalFile))).toBe(true);
    const next = queue.request({ kind: 'freeze', subjectKey: 'gallery-check', prompt: 'a new conversation', negative: '', seed: 3, width: 1216, height: 832 }, 100);
    await queue.settle(next.key);
    const updated = (await app.inject({ method: 'GET', url: '/api/gallery' })).json().scenes;
    expect(updated).toHaveLength(3);
    expect(updated.map((s: { url: string }) => s.url)).toContain('/images/new-scene.png');
  } finally {
    await app.close();
    resumed.db.close();
  }
});
