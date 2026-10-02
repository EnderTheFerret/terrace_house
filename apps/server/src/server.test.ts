import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BeatSheet, createGame, makeEvent, eventTemplate, passTime, stableStringify, type ImageBackend, type ImageRequest, type LlmClient, type LlmRequest } from '@shared-roof/shared';
import { openDb, Store, migrateState } from './db';
import { MockLlm } from './llm/mock';
import { OllamaClient } from './llm/ollama';
import { Budget, extractJson, structured } from './llm/structured';
import { approxTokens, assemble, TOKEN_BUDGET } from './prompts/common';
import { beatSheetPrompt, linesPrompt, parseLines } from './prompts/scene';
import { ComfyBackend, patchWorkflow } from './image/comfy';
import { cacheKey, ImageQueue, PRIORITY } from './image/queue';
import { MockImageBackend } from './image/mock';
import { buildApp } from './app';
import { GameSession } from './game/session';
import { Generator } from './game/generate';
import { replayEvents } from './game/replay';
import { ROOT } from './config';
import { freezeRequest, locationRequest } from './image/requests';

class DownLlm implements LlmClient {
  readonly name = 'ollama';
  calls = 0;
  async health() {
    return false;
  }
  async complete(_r: LlmRequest): Promise<string> {
    this.calls++;
    throw new TypeError('fetch failed');
  }
  // eslint-disable-next-line require-yield
  async *stream(_r: LlmRequest): AsyncIterable<string> {
    this.calls++;
    throw new TypeError('fetch failed');
  }
}

class DownImages implements ImageBackend {
  readonly name = 'comfyui';
  async health() {
    return false;
  }
  async generate(): Promise<never> {
    throw new Error('ECONNREFUSED');
  }
}

const tmp = () => mkdtempSync(join(tmpdir(), 'sr-'));

describe('prompt builder', () => {
  const s = createGame({ seed: 3 });
  const ev = makeEvent(s, eventTemplate('late-night-kitchen'), { a: 'ren', b: 'mio' }, 'kitchen');
  it('keeps room viewpoints grounded in both location art and freeze frames', () => {
    const room = locationRequest('kitchen', 'lateNight', 'rain');
    expect(room.prompt).toContain('interior of a shared kitchen');
    expect(room.prompt).not.toContain('reality show still');
    expect(room.prompt).toContain('night lighting, rain weather');
    expect(room.subjectKey).toBe('location:kitchen:night:rain');
    expect(freezeRequest(s, ev).prompt).toContain('interior of a shared kitchen');
    expect(locationRequest('backyard', 'evening', 'sunny').prompt).toContain('entire ground covered by lawn');
  });
  it('respects the hard token budget per call type', () => {
    expect(approxTokens(beatSheetPrompt(s, ev))).toBeLessThanOrEqual(TOKEN_BUDGET.beats);
    expect(approxTokens(linesPrompt(s, ev, [{ speaker: 'ren', intent: 'x', emotion: 'neutral', beatType: 'open', subtext: '', depth: 'smalltalk', topic: 't' }], [], [undefined]))).toBeLessThanOrEqual(TOKEN_BUDGET.lines);
  });
  it('prioritizes typed words over an unrelated scripted topic', () => {
    const reply = 'No, I do not want to go on a date. Please respect that.';
    const prompt = linesPrompt(s, ev, [{ speaker: 'ren', intent: 'answer the player', emotion: 'neutral', beatType: 'comfort', subtext: '', depth: 'smalltalk', topic: 'irrelevant scripted topic' }], [], [undefined], reply);
    expect(prompt).toContain(`answer the player's exact words: ${JSON.stringify(reply)}`);
    expect(prompt).not.toContain('topic "irrelevant scripted topic"');
    expect(prompt).toContain('Acknowledge refusals without bargaining');
  });
  it('assembles in order: rules → persona → relationship → memories → premise → output', () => {
    const p = beatSheetPrompt(s, ev);
    const order = ['dialogue for a calm', `## ${s.characters.ren.name}`, s.characters.ren.name.split(' ')[0], 'Scene:', 'Output JSON only'];
    let last = -1;
    for (const marker of order) {
      const i = p.indexOf(marker, last + 1);
      expect(i, marker).toBeGreaterThan(last);
      last = i;
    }
    expect(p).toContain(s.characters.ren.persona.speech.exemplars[0]);
    expect(p).toContain(s.characters.ren.persona.backstory.slice(0, 240));
  });
  it('drops low-priority sections first when over budget', () => {
    const out = assemble(
      [
        { text: 'RULES', priority: 100, required: true },
        { text: 'x'.repeat(400), priority: 10 },
        { text: 'OUTPUT', priority: 100, required: true },
      ],
      20,
    );
    expect(out).toContain('RULES');
    expect(out).toContain('OUTPUT');
    expect(out).not.toContain('xxxx');
  });
  it('never includes facts the speaker does not know', () => {
    const p = beatSheetPrompt(s, ev);
    expect(p).not.toContain(s.characters.kaito.persona.secret!.content);
  });
  it('parses streamed speaker lines', () => {
    const beats = [
      { speaker: 'ren', intent: '', emotion: 'neutral' as const, beatType: 'open' as const, subtext: '', depth: 'smalltalk' as const, topic: '' },
      { speaker: 'mio', intent: '', emotion: 'neutral' as const, beatType: 'smalltalk' as const, subtext: '', depth: 'smalltalk' as const, topic: '' },
    ];
    expect(parseLines('ren: Rice is ready...\n**mio**: "Oh! Thank you."', beats)).toEqual(['Rice is ready...', 'Oh! Thank you.']);
  });
});

describe('structured LLM calls', () => {
  const s = createGame({ seed: 5 });
    const ev = makeEvent(s, eventTemplate('backyard-talk'), { a: 'shun', b: 'mio' }, 'backyard');
  const req: LlmRequest = { kind: 'beats', prompt: 'p', temperature: 0.7, context: { kind: 'beats', state: s, event: ev } };
  it('falls back to the mock when the service is down (no retry storm)', async () => {
    const down = new DownLlm();
    const r = await structured(down, new MockLlm(), req, BeatSheet, new Budget(6));
    expect(r.source).toBe('mock');
    expect(BeatSheet.safeParse(r.value).success).toBe(true);
    expect(down.calls).toBe(1);
  });
  it('retries once with the validation error, then accepts valid output', async () => {
    let n = 0;
    const flaky: LlmClient = {
      name: 'ollama',
      health: async () => true,
      complete: async (r) => {
        n++;
        return n === 1 ? '{"beats": "nope"}' : r.prompt.includes('previous answer was invalid') ? JSON.stringify({ beats: [{ speaker: 'shun', intent: 'open', emotion: 'neutral', beatType: 'open' }, { speaker: 'mio', intent: 'reply', emotion: 'shy', beatType: 'smalltalk' }] }) : '{}';
      },
      stream: async function* () {},
    };
    const r = await structured(flaky, new MockLlm(), req, BeatSheet, new Budget(6));
    expect(r.source).toBe('llm');
    expect(n).toBe(2);
  });
  it('budget exhaustion routes to templates without calling the LLM', async () => {
    const down = new DownLlm();
    const b = new Budget(0);
    const r = await structured(down, new MockLlm(), req, BeatSheet, b);
    expect(r.source).toBe('mock');
    expect(down.calls).toBe(0);
  });
  it('extracts JSON wrapped in prose or fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
  });
});

describe('OllamaClient', () => {
  it('sends one user message (gemma folds system into user) with schema + options, and streams NDJSON', async () => {
    let body: any = null;
    const fake = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      const chunks = ['{"message":{"content":"ren: hel"}}\n', '{"message":{"content":"lo"}}\n{"done":true}\n'];
      return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))); c.close(); } }));
    }) as typeof fetch;
    const c = new OllamaClient('http://x', 'gemma3:12b', 1000, fake);
    let out = '';
    for await (const t of c.stream({ kind: 'lines', prompt: 'hi', temperature: 0.9, schema: { type: 'object' } })) out += t;
    expect(out).toBe('ren: hello');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.format).toEqual({ type: 'object' });
    expect(body.options.temperature).toBe(0.9);
  });
});

describe('ComfyUI workflow patching', () => {
  const wf = JSON.parse(readFileSync(resolve(ROOT, 'workflows/txt2img.api.json'), 'utf8'));
  const map = JSON.parse(readFileSync(resolve(ROOT, 'workflows/mapping.json'), 'utf8'));
  const req: ImageRequest = { kind: 'portrait', prompt: 'POS', negative: 'NEG', seed: 42, width: 832, height: 1216, subjectKey: 'k' };
  it('patches mapped node inputs without mutating the template', () => {
    const out = patchWorkflow(wf, map, req);
    expect(out[map.positive.node].inputs[map.positive.input]).toBe('POS');
    expect(out[map.negative.node].inputs[map.negative.input]).toBe('NEG');
    expect(out[map.seed.node].inputs[map.seed.input]).toBe(42);
    expect(out[map.width.node].inputs.width).toBe(832);
    expect(wf[map.positive.node].inputs.text).toBe('positive prompt');
  });
  it('rejects mappings that point at missing nodes', () => {
    expect(() => patchWorkflow(wf, { positive: { node: '999', input: 'text' } }, req)).toThrow(/missing node/);
  });
  it('requests with a reference portrait upload it and run the reference workflow; others use the base one', async () => {
    const dir = tmp();
    const refFile = join(dir, 'face.png');
    writeFileSync(refFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const prompts: any[] = [];
    let uploads = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
      if (u.endsWith('/upload/image')) {
        uploads++;
        return json({ name: 'shared_roof_face.png', subfolder: '' });
      }
      if (u.endsWith('/prompt')) {
        prompts.push(JSON.parse(String(init!.body)).prompt);
        return json({ prompt_id: `p${prompts.length}` });
      }
      if (u.includes('/history/')) {
        const pid = u.split('/history/')[1];
        const images = [{ filename: 'a.png', subfolder: '', type: 'output' }];
        return json({ [pid]: { outputs: { '11': { images }, '16': { images } } } }); // base / reference output nodes
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;
    const comfy = new ComfyBackend('http://comfy', resolve(ROOT, 'workflows/txt2img.api.json'), resolve(ROOT, 'workflows/mapping.json'), dir, 5000, fake, {
      workflowPath: resolve(ROOT, 'workflows/ref_edit.api.json'),
      mappingPath: resolve(ROOT, 'workflows/ref_mapping.json'),
    });
    await comfy.generate({ ...req, kind: 'freeze', reference: refFile });
    await comfy.generate(req);
    const refMap = JSON.parse(readFileSync(resolve(ROOT, 'workflows/ref_mapping.json'), 'utf8'));
    expect(uploads).toBe(1);
    expect(prompts[0][refMap.reference.node].inputs.image).toBe('shared_roof_face.png');
    expect(prompts[0][refMap.positive.node].inputs.prompt).toBe('POS');
    expect(prompts[1][map.positive.node].inputs.text).toBe('POS'); // no reference → plain txt2img
  });
});

describe('image queue', () => {
  const req = (key: string, seed = 1): ImageRequest => ({ kind: 'location', prompt: `p-${key}`, negative: 'n', seed, width: 64, height: 64, subjectKey: key, meta: { timeOfDay: 'day' } });
  it('cache key is stable and sensitive to every input', () => {
    expect(cacheKey('w', req('a'))).toBe(cacheKey('w', req('a')));
    expect(cacheKey('w', req('a'))).not.toBe(cacheKey('w', req('a', 2)));
    expect(cacheKey('w', req('a'))).not.toBe(cacheKey('w2', req('a')));
  });
  it('processes by priority with concurrency 1 and falls back to placeholders when the backend is down', async () => {
    const dir = tmp();
    const order: string[] = [];
    const slow: ImageBackend = {
      name: 'comfyui',
      health: async () => true,
      generate: async (r) => {
        order.push(r.subjectKey);
        if (r.subjectKey === 'boom') throw new Error('down');
        await new Promise((res) => setTimeout(res, 5));
        return new MockImageBackend(dir).generate(r);
      },
    };
    const q = new ImageQueue(slow, new MockImageBackend(dir), new Store(openDb(':memory:')), 'w', dir, null);
    q.request(req('first'), PRIORITY.prefetch); // starts immediately
    const low = q.request(req('low'), PRIORITY.prefetch);
    const high = q.request(req('high'), PRIORITY.playerPortrait);
    await q.settle(low.key);
    await q.settle(high.key);
    expect(order).toEqual(['first', 'high', 'low']);
    const b = q.request(req('boom'), PRIORITY.currentScene);
    const st = await q.settle(b.key);
    expect(st.status).toBe('ready');
    expect(st.placeholder).toBe(true);
    expect(q.offline).toBe(true);
  });
  it('holds queued work while dialogue streams (one GPU), except the player portrait', async () => {
    const dir = tmp();
    const ran: string[] = [];
    const backend: ImageBackend = { name: 'comfyui', health: async () => true, generate: async (r) => (ran.push(r.subjectKey), new MockImageBackend(dir).generate(r)) };
    const q = new ImageQueue(backend, new MockImageBackend(dir), new Store(openDb(':memory:')), 'w', dir, null);
    const release = q.hold();
    const bg = q.request(req('bg'), PRIORITY.prefetch);
    await new Promise((r) => setTimeout(r, 20));
    expect(ran).toEqual([]);
    const me = q.request(req('me'), PRIORITY.playerPortrait);
    await q.settle(me.key);
    expect(ran).toEqual(['me']);
    release();
    await q.settle(bg.key);
    expect(ran).toEqual(['me', 'bg']);
  });
  it('cancels queued jobs', () => {
    const dir = tmp();
    const q = new ImageQueue(new DownImages(), new MockImageBackend(dir), new Store(openDb(':memory:')), 'w', dir, null);
    q.request(req('a'), 1);
    const b = q.request(req('b'), 1);
    expect(q.cancel(b.key)).toBe(true);
    expect(q.status(b.key).status).toBe('cancelled');
  });
});

async function playEpisode(session: GameSession) {
  const s0 = session.state!;
  const ep = s0.world.episode;
  let guard = 0;
  while (session.state!.world.episode === ep && !session.state!.seasonOver && guard++ < 60) { // hangouts use part of a block, outings all of it
    const slot = session.state!.world.slot;
    const action = slot === 'morning' || slot === 'evening' ? { type: 'house', activity: 'hangout' } : { type: 'idle' };
    const { scenes } = await session.act(action);
    for (const sc of scenes) {
      if (sc.phase === 'awaiting-response') session.respond(sc.id, 'join');
      if (!sc.rendered && sc.phase === 'done') continue;
      const events: string[] = [];
      for (let i = 0; i < 4 && session.runs.get(sc.id)!.phase !== 'done'; i++) {
        await session.stream(sc.id, (e) => events.push(e));
        const run = session.runs.get(sc.id)!;
        if (run.phase === 'awaiting-choice') session.choose(sc.id, run.ev.intents[0]);
      }
      expect(session.runs.get(sc.id)!.phase).toBe('done');
    }
    await session.endSlot();
  }
}

describe('game session (mock + failing adapters)', () => {
  it('closes an observing phone conversation at sundown and logs the exact capped time for replay', async () => {
    const dir = tmp();
    const store = new Store(openDb(':memory:'));
    const queue = new ImageQueue(new MockImageBackend(dir), new MockImageBackend(dir), store, 'mock', dir, null);
    const down = new DownLlm();
    let dialogueCalls = 0;
    const generatedKinds: string[] = [];
    const adapter: LlmClient = { name: 'test', health: async () => true, complete: async (r) => { generatedKinds.push(r.kind); return down.complete(r); }, stream: async function* (r) { dialogueCalls++; yield* down.stream(r); } };
    const session = new GameSession(store, new Generator(adapter), queue);
    await session.newGame({ seed: 7 });
    for (let i = 0; i < 2; i++) { await session.act({ type: 'sleep' }); await session.endSlot(); }
    expect(session.state!.world.weekday).toBe(5);
    for (let i = 0; i < 3; i++) { await session.act({ type: 'skip' }); await session.endSlot(); }
    expect(session.state!.world.slot).toBe('slot3');
    // Clock fixture: advance to 17:50 with the same logged engine operation replay uses.
    session.state = passTime(session.state!, 110 / 3);
    session.logSeq = store.appendEvent(session.state.gameId, 'time', { lines: 110 / 3 });
    const target = Object.values(session.state.characters).find(c => !c.isPlayer && c.status === 'inHouse' && c.persona.keepsShabbat)!;
    expect(target).toBeDefined();
    generatedKinds.length = 0;
    const { scenes } = await session.act({ type: 'text', target: target.id, text: 'Are you free tonight?' });
    const phone = scenes.find(sc => sc.chat && sc.isPlayerScene)!;
    const output: { event: string; data: any }[] = [];
    await session.stream(phone.id, (event, data) => output.push({ event, data }));
    expect(session.runs.get(phone.id)!.phase).toBe('done');
    expect(session.state.world.minutes).toBe(120);
    expect(output.filter(e => e.event === 'line-end')).toHaveLength(1);
    expect(output.some(e => e.event === 'choice')).toBe(false);
    expect(output.find(e => e.event === 'outcome')?.data.cues.join(' ')).toContain('put away for Shabbat');
    expect(dialogueCalls).toBe(1);
    expect(generatedKinds).not.toContain('deltas');
    expect(generatedKinds).not.toContain('commentary');
    await session.stream(phone.id, () => {});
    expect(dialogueCalls).toBe(1);
    expect(replayEvents(store.events(session.state.gameId))).toEqual(session.state);
  });

  it('plays a full episode with Ollama and ComfyUI down: every call falls back, nothing blocks', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'db.sqlite')));
    const queue = new ImageQueue(new DownImages(), new MockImageBackend(dir), store, 'w', dir, null);
    const down = new DownLlm();
    const session = new GameSession(store, new Generator(down), queue);
    await session.newGame({ seed: 11 });
    await playEpisode(session);
    expect(session.state!.world.episode).toBe(2);
    expect(down.calls).toBeGreaterThan(0); // tried, failed, fell back
    // the end-of-episode studio intermission still runs on templates, host first and last, state untouched
    expect(session.pendingIntermission).toBe('end');
    const before = JSON.stringify(session.state);
    const im = await session.intermission();
    expect(im.lines.length).toBeGreaterThanOrEqual(3);
    expect(im.lines[0].speaker).toBe('nagumo');
    expect(im.lines.at(-1)!.speaker).toBe('nagumo');
    expect(JSON.stringify(session.state)).toBe(before);
    await expect(session.intermission()).rejects.toThrow(/no intermission/);
  });

  it('replaying the event log reproduces the exact state (deterministic replay)', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'db.sqlite')));
    const queue = new ImageQueue(new MockImageBackend(dir), new MockImageBackend(dir), store, 'mock', dir, null);
    const session = new GameSession(store, new Generator(new MockLlm()), queue);
    await session.newGame({ seed: 21 });
    await playEpisode(session);
    await playEpisode(session);
    const replayed = replayEvents(store.events(session.state!.gameId));
    expect(stableStringify(replayed)).toBe(stableStringify(session.state));
  });

  it('typed talk, phone messages, graduating and the next player all replay exactly', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'db.sqlite')));
    const queue = new ImageQueue(new MockImageBackend(dir), new MockImageBackend(dir), store, 'mock', dir, null);
    const session = new GameSession(store, new Generator(new MockLlm()), queue);
    await session.newGame({ seed: 21 });
    const drive = async (action: unknown, typed?: string) => {
      const events: { e: string; d: any }[] = [];
      const { scenes } = await session.act(action);
      for (const sc of scenes) {
        if (sc.phase === 'awaiting-response') session.respond(sc.id, 'ignore');
        for (let i = 0; i < 12 && session.runs.get(sc.id)!.phase !== 'done'; i++) {
          await session.stream(sc.id, (e, d) => events.push({ e, d }));
          const run = session.runs.get(sc.id)!;
          if (run.phase !== 'awaiting-choice') continue;
          if (typed && !run.said.length) session.choose(sc.id, { text: typed });
          else if (run.said.length) session.choose(sc.id, { done: true });
          else session.choose(sc.id, run.ev.intents[0]);
        }
      }
      await session.endSlot();
      return events;
    };
    // morning: talk to Ren and say something in your own words
    const ev = await drive({ type: 'talk', target: 'ren' }, 'I think the fridge is haunted, honestly');
    const mine = ev.find((x) => x.e === 'line-end' && x.d.source === 'player');
    expect(mine?.d.text).toBe('I think the fridge is haunted, honestly');
    const answer = ev[ev.indexOf(mine!) + 1];
    expect(ev.slice(ev.indexOf(mine!)).some((x) => x.e === 'line-end' && x.d.speaker !== session.state!.playerId)).toBe(true);
    expect(answer).toBeDefined();
    expect(ev.some((x) => x.e === 'choice' && x.d.canEnd)).toBe(true);
    const listener = Object.values(session.state!.memory).flat().some((m) => m.text.includes('fridge is haunted'));
    expect(listener).toBe(true);
    // a typed phone message opens the chat and lands in the thread
    await drive({ type: 'text', target: 'mio', text: 'are you home tonight?' });
    const thread = session.state!.chats[[session.state!.playerId, 'mio'].sort().join('|')];
    const sent = thread.findIndex((m) => m.from === session.state!.playerId && m.text === 'are you home tonight?');
    expect(sent).toBeGreaterThanOrEqual(0);
    expect(thread.slice(sent + 1).some((m) => m.from === 'mio')).toBe(true); // and she answered
    // graduate alone, the season goes on, a new player character moves in
    const before = session.state!.playerId;
    await drive({ type: 'graduate' });
    expect(session.state!.awaitingPlayer).toBe(true);
    await expect(session.act({ type: 'idle' })).rejects.toThrow(/move in first/);
    const v = session.newPlayer({ name: 'Aki Mori', age: 26, gender: 'man', interestedIn: ['woman'], hometown: 'Kobe', occupation: 'barista', traits: [0.5, 0.5, 0.5, 0.5, 0.5], quirks: [], tastes: [0, 0, 0, 0, 0, 0], hobbies: ['surfing', 'film', 'running'], appearance: { hairStyle: 'short messy', hairColor: 'black', eyeColor: 'brown', build: 'average', outfit: 'linen shirt', accessory: 'none', skinTone: 'tan' } });
    expect(v.playerId).not.toBe(before);
    await drive({ type: 'idle' });
    const replayed = replayEvents(store.events(session.state!.gameId));
    expect(stableStringify(replayed)).toBe(stableStringify(session.state));
  });

  it('saves and loads through SQLite with schema validation', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'db.sqlite')));
    const queue = new ImageQueue(new MockImageBackend(dir), new MockImageBackend(dir), store, 'mock', dir, null);
    const session = new GameSession(store, new Generator(new MockLlm()), queue);
    await session.newGame({ seed: 4 });
    const id = session.save(2, 'test');
    const loaded = store.load(id)!;
    expect(loaded.state.gameId).toBe(session.state!.gameId);
    expect(() => migrateState({ ...loaded.state, schemaVersion: 0, previously: undefined })).not.toThrow();
  });
});

describe('HTTP API', () => {
  it('health reports services down and the game still starts', async () => {
    const dir = tmp();
    const { app } = await buildApp({ llm: new DownLlm(), image: new DownImages(), store: new Store(openDb(join(dir, 'db.sqlite'))), workflowHash: 'w', cacheDir: dir, assetsDir: null });
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.json()).toMatchObject({ llm: 'down', image: 'down', imagesOffline: true });
    const g = await app.inject({ method: 'POST', url: '/api/game/new', payload: { seed: 1 } });
    expect(g.statusCode).toBe(200);
    expect(g.json().view.episode).toBe(1);
    const bad = await app.inject({ method: 'POST', url: '/api/game/action', payload: { action: { type: 'nope' } } });
    expect(bad.statusCode).toBe(400);
    const young = await app.inject({ method: 'POST', url: '/api/game/new', payload: { player: { name: 'x', age: 17 } } });
    expect(young.statusCode).toBe(400);
    await app.close();
  });
});
