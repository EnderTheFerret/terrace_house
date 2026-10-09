import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('change beat drops a mid-conversation arc scene and restarts it with the current premise', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-beat-'));
  const { session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store: new Store(openDb(':memory:')), workflowHash: 'mock', cacheDir: dir });
  await session.newGame({ seed: 7 });
  const first = await session.act({ type: 'idle' });
  const scene = first.scenes.find((sc) => sc.participants.includes(session.state!.playerId) && sc.participants.length > 1) ?? first.scenes[0];
  await session.stream(scene.id, () => {});
  session.choose(scene.id, { text: 'How was work?' });
  await session.stream(scene.id, () => {});
  const run = session.runs.get(scene.id)!;
  expect(run.transcript.length).toBeGreaterThan(0);
  // as an older save would hold it: an arc beat with the old mad-lib premise
  const other = scene.participants.find((id) => id !== session.state!.playerId)!;
  run.ev = { ...run.ev, type: 'career', templateId: 'job-service-closing-1', roles: { self: other, b: session.state!.playerId }, arcBeat: { charId: other, beatId: 'job-service-closing-1' }, premise: 'At the living room, X tells Y that the shop may close.' };

  expect(() => session.changeBeat('nope')).toThrow();
  const summary = session.changeBeat(scene.id)!;
  const fresh = session.runs.get(scene.id)!;
  expect(fresh.phase).toBe('new');
  expect(fresh.transcript).toEqual([]);
  expect(summary.title).toBe('news from the shop');
  expect(summary.premise).toContain('renovating');
  await session.stream(scene.id, () => {});
  expect(session.runs.get(scene.id)!.transcript.length).toBeGreaterThan(0);

  // an everyday scene restarts too, keeping its premise
  const plain = session.runs.get(scene.id)!;
  plain.ev = { ...plain.ev, arcBeat: undefined, premise: 'Two housemates at the makolet.' };
  expect(session.changeBeat(scene.id)!.premise).toBe('Two housemates at the makolet.');
  expect(session.runs.get(scene.id)!.transcript).toEqual([]);
});
