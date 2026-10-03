import { expect, it } from 'vitest';
import type { LlmClient, ImageBackend, ImageRequest } from '@shared-roof/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TextActivity } from './activity';
import { MockImageBackend } from './image/mock';
import { openDb, Store } from './db';
import { buildApp } from './app';
import { MockLlm } from './llm/mock';

it('reports actual model stages and clears after success, errors and a closed stream', async () => {
  const activity = new TextActivity();
  let release!: (value: string) => void;
  const client: LlmClient = {
    name: 'test', health: async () => true,
    complete: () => new Promise<string>(r => { release = r; }),
    stream: async function* () { yield 'reply'; throw new Error('offline'); },
  };
  const llm = activity.wrap(client);
  const call = llm.complete({ kind: 'beats', prompt: '', temperature: 0 });
  expect(activity.current()).toMatchObject([{ label: 'Planning the conversation', estimatedMs: 15000 }]);
  release('valid');
  await call;
  expect(activity.current()).toEqual([]);
  const stream = llm.stream({ kind: 'lines', prompt: '', temperature: 0 })[Symbol.asyncIterator]();
  await stream.next();
  expect(activity.current()).toMatchObject([{ label: 'Generating response', estimatedMs: 8000 }]);
  await expect(stream.next()).rejects.toThrow('offline');
  expect(activity.current()).toEqual([]);
  const closed = llm.stream({ kind: 'lines', prompt: '', temperature: 0 })[Symbol.asyncIterator]();
  await closed.next();
  await closed.return?.();
  expect(activity.current()).toEqual([]);
});

it('exposes image progress, queue wait and learned timing without leaking prompts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-activity-'));
  const store = new Store(openDb(':memory:'));
  const mock = new MockImageBackend(dir);
  let finish!: () => void;
  let reportProgress: ((p: number) => void) | undefined;
  const image: ImageBackend = {
    name: 'test', health: async () => true,
    generate: async (req, _signal, progress) => {
      reportProgress = progress;
      progress?.(0.5);
      await new Promise<void>(r => { finish = r; });
      return { ...await mock.generate(req), placeholder: false };
    },
  };
  const { app, queue } = await buildApp({ llm: new MockLlm(), image, store, cacheDir: dir, assetsDir: null, workflowHash: 'w' });
  const req: ImageRequest = { kind: 'sprite', subjectKey: 'sprite:portrait:kai:1', prompt: 'private prompt', negative: '', seed: 1, width: 64, height: 64 };
  const running = queue.request(req, 60);
  const extra = queue.request({ ...req, seed: 2 }, 60);
  const status = (await app.inject('/api/activity')).json();
  expect(status.text).toEqual([]);
  expect(status.image).toMatchObject({ label: 'Generating walk sprite', characterId: 'kai', progress: 0.5, estimatedMs: 35000, queued: 1 });
  expect(JSON.stringify(status)).not.toContain(req.prompt);
  queue.cancel(extra.key);
  finish();
  await queue.settle(running.key);
  reportProgress?.(0.9); // a late websocket callback must not resurrect a completed image
  expect(queue.status(running.key).status).toBe('ready');
  expect(queue.activity()).toBeNull();
  const cutout = queue.request({ ...req, kind: 'cutout', subjectKey: 'cutout:portrait:kai:1:expression:happy', seed: 4 }, 60);
  expect(queue.activity()).toMatchObject({ label: 'Removing portrait background', estimatedMs: 8000 });
  finish();
  await queue.settle(cutout.key);
  const next = queue.request({ ...req, seed: 3 }, 60);
  expect(queue.activity()!.estimatedMs).toBeLessThan(35000);
  finish();
  await queue.settle(next.key);
  expect((await app.inject('/api/activity')).json()).toEqual({ text: [], image: null });
  await app.close();
});
