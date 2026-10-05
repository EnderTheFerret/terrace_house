import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PLAYER, type ImageRequest } from '@shared-roof/shared';
import { buildApp } from '../app';
import { Store, openDb } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from './mock';
import { replayEvents } from '../game/replay';

it('previews draft sprites from their portrait, keeps variations separate, and preserves them on move-in and save', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-creator-art-'));
  const store = new Store(openDb(':memory:'));
  const mock = new MockImageBackend(dir);
  const requests: ImageRequest[] = [];
  const image = { name: 'comfyui', health: async () => true, generate: async (req: ImageRequest) => {
    requests.push(req);
    return { ...await mock.generate(req), placeholder: false };
  } };
  const { app, session } = await buildApp({ llm: new MockLlm(), image, store, workflowHash: 'test', cacheDir: dir, assetsDir: null });
  const setup = { ...DEFAULT_PLAYER, portraitSeed: 42, spriteSeed: 123, spriteInstructions: 'Keep the glasses visible' };
  const body = { id: 'player', ...setup };
  const settled = async (status: any) => {
    for (let n = 0; n < 100 && ['queued', 'running'].includes(status.status); n++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      status = (await app.inject({ method: 'GET', url: `/api/image/status/${status.key}` })).json();
    }
    expect(status.status).toBe('ready');
    return status;
  };
  try {
    const early = await app.inject({ method: 'POST', url: '/api/image/sprite', payload: body });
    expect(early.statusCode).toBe(409);
    const portrait = await settled((await app.inject({ method: 'POST', url: '/api/image/portrait', payload: body })).json());
    const first = await settled((await app.inject({ method: 'POST', url: '/api/image/sprite', payload: body })).json());
    const second = await settled((await app.inject({ method: 'POST', url: '/api/image/sprite', payload: { ...body, spriteSeed: 456, spriteInstructions: 'Fix the feet' } })).json());
    expect(first.key).not.toBe(second.key);
    expect(requests.filter(r => r.kind === 'portrait')).toHaveLength(1);
    expect(requests.filter(r => r.kind === 'sprite').map(r => r.seed)).toEqual([123, 456]);
    expect(requests.filter(r => r.kind === 'sprite').every(r => r.reference?.endsWith(portrait.url.split('/').at(-1)))).toBe(true);
    expect(session.state).toBeNull();
    const invalid = await app.inject({ method: 'POST', url: '/api/image/sprite', payload: { ...body, spriteInstructions: 'x'.repeat(501) } });
    expect(invalid.statusCode).toBe(400);
    const game = await app.inject({ method: 'POST', url: '/api/game/new', payload: { seed: 7, player: setup } });
    expect(game.statusCode).toBe(200);
    expect(game.json().view.characters.find((c: any) => c.isPlayer)).toMatchObject({ spriteSeed: 123, spriteInstructions: setup.spriteInstructions });
    const saved = session.save(1);
    session.load(saved);
    expect(session.state!.characters.player).toMatchObject({ spriteSeed: 123, spriteInstructions: setup.spriteInstructions });
    const inGame = await app.inject({ method: 'GET', url: '/api/image/character/player/sprite?day=0&occasion=daily' });
    expect(inGame.statusCode).toBe(200);
    expect(inGame.json().key).toBe(first.key);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
