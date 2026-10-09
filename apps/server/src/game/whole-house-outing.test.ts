import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('an outing with the whole house plays as one six-person scene', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-whole-'));
  const { session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store: new Store(openDb(':memory:')), workflowHash: 'mock', cacheDir: dir });
  await session.newGame({ seed: 7, moveInDay: false });
  const s = session.state!;
  s.world.slot = 'slot1';
  const ids = Object.values(s.characters).filter((c) => !c.isPlayer && c.status === 'inHouse').map((c) => c.id);
  expect(ids).toHaveLength(5);
  for (const id of ids) s.characters[id].lastAction = undefined;

  const out = await session.act({ type: 'goOut', node: 'beach', activity: 'invite', invite: ids[0], guests: ids.slice(1) });
  const scene = out.scenes.find((sc) => sc.participants.includes(s.playerId) && sc.participants.length > 1)!;
  expect(scene.participants).toHaveLength(6);
  await session.stream(scene.id, () => {});
  const run = session.runs.get(scene.id)!;
  expect(new Set(run.transcript.map((l) => l.speaker)).size).toBeGreaterThan(1);
  expect(run.transcript.length).toBeGreaterThan(0);
});
