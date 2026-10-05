import { expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { replayEvents } from './replay';
import { FEELING_SCALE } from '@shared-roof/shared';

it("re-reads a finished scene once: only the difference is applied, memories are added, and replay reproduces it", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-reread-'));
  const store = new Store(openDb(':memory:'));
  const { session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  await session.newGame({ seed: 7 });
  const first = await session.act({ type: 'idle' });
  const scene = first.scenes.find((sc) => sc.participants.includes(session.state!.playerId) && sc.participants.length > 1) ?? first.scenes[0];
  await session.stream(scene.id, () => {});
  session.choose(scene.id, { text: 'Your coffee smells amazing, honestly.' });
  await session.stream(scene.id, () => {});
  session.choose(scene.id, { done: true });
  await session.stream(scene.id, () => {});
  const s = session.state!;
  const other = scene.participants.find((id) => id !== s.playerId)!;
  const logged = session.dayLog().scenes.find((x) => x.id === scene.id);
  expect(logged).toBeDefined();
  const before = s.rel[other][s.playerId].affinity;
  const applied = store.events(s.gameId).find((e) => e.kind === 'scene' && e.payload.eventId === scene.id)!.payload.proposal.affinityDeltas.find((d: { from: string; to: string }) => d.from === other && d.to === s.playerId)?.delta ?? 0;
  // the model reads a compliment as worth +20 toward the player
  vi.spyOn(session.gen, 'deltas').mockResolvedValue({ affinityDeltas: [{ from: other, to: s.playerId, delta: 12 }], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], newMemories: [{ charId: other, text: 'They complimented my coffee.', salience: 0.6 }], moodDeltas: [] });
  const r = await session.reread(scene.id);
  expect(session.state!.rel[other][s.playerId].affinity).toBeCloseTo(Math.min(100, before + FEELING_SCALE * (12 - applied)), 5);
  expect(session.state!.memory[other].some((m) => m.text === 'They complimented my coffee.')).toBe(true);
  expect(r.log.scenes.find((x) => x.id === scene.id)!.reread).toBe(true);
  await expect(session.reread(scene.id)).rejects.toThrow(/already re-read/);
  expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
});
