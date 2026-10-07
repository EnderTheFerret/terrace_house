import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BeatSheet, createGame, makeEvent, outfitFor, eventTemplate, passTime, stableStringify, type ImageBackend, type ImageRequest, type LlmClient, type LlmRequest } from '@shared-roof/shared';
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
import { cutoutRequest, expressionRequest, freezeRequest, locationRequest, outfitPortraitRequest, portraitRequest } from './image/requests';

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
    expect(room.prompt).toContain('interior of a modern open kitchen');
    expect(room.prompt).not.toContain('reality show still');
    // rain never falls indoors: rooms keep their clear art, open-air places get the rainy variant
    expect(room.prompt).not.toContain('rain');
    expect(room.subjectKey).toBe('location:kitchen:night');
    expect(locationRequest('backyard', 'lateNight', 'rain').prompt).toContain('night lighting, rain weather');
    expect(freezeRequest(s, ev).prompt).toContain('interior of a modern open kitchen');
    expect(locationRequest('backyard', 'evening', 'sunny').prompt).toContain('glass wall separating it from the living room');
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
  it('preserves output instructions when required context exceeds the budget', () => {
    const output = 'Return exactly one line for each allowed speaker: ren, mio.';
    const result = assemble([
      { text: 'RULES', priority: 100, required: true },
      { text: 'BACKGROUND ' + 'x'.repeat(2000), priority: 90, required: true },
      { text: output, priority: 100, required: true },
    ], 100);
    expect(approxTokens(result)).toBeLessThanOrEqual(100);
    expect(result).toContain(output);
  });
  it('keeps every group responder on the latest typed topic without cutting the output contract', () => {
    const speakers = Object.keys(s.characters).filter(id => id !== s.playerId);
    const group = { ...ev, participants: [s.playerId, ...speakers] };
    const beats = speakers.map(speaker => ({ speaker, intent: 'answer the player', emotion: 'neutral' as const, beatType: 'smalltalk' as const, subtext: '', depth: 'smalltalk' as const, topic: 'unrelated scripted topic' }));
    const words = 'Anyone want coffee before I sit outside?';
    const prompt = linesPrompt(s, group, beats, [{ speaker: s.playerId, text: words }], beats.map(() => undefined), words);
    expect(approxTokens(prompt)).toBeLessThanOrEqual(TOKEN_BUDGET.lines);
    expect(prompt).not.toContain('unrelated scripted topic');
    expect(prompt).toContain(`Allowed speaker ids: ${speakers.join(', ')}`);
    expect(prompt).toContain(`Return all ${speakers.length} required lines`);
    expect(prompt).toContain('Only an actual refusal needs a boundary acknowledgment');
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
  it('answers an explicit refusal with a boundary-respecting template without an LLM call', async () => {
    const down = new DownLlm();
    const gen = new Generator(down);
    const budget = new Budget(6);
    const beat = { speaker: 'shun', intent: 'respect the boundary', emotion: 'neutral' as const, beatType: 'comfort' as const, subtext: '', depth: 'smalltalk' as const, topic: '' };
    const lines = await gen.lines(s, ev, [beat], [], ['decline'], { place: ev.location, catchphraseUses: {}, lineCounts: {}, replyTo: { text: 'No, I do not want to go on a date.', intent: 'decline' } }, budget, () => {}, () => {});
    expect(down.calls).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ speaker: 'shun', source: 'mock' });
    expect(lines[0].text).toMatch(/Oh|understand|Sorry/);
    expect(lines[0].text).not.toMatch(/try again|say.*real|why not|change.*mind/i);
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
    expect(body.options.top_k).toBe(64); // gemma preset
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
  it('crops standing portraits to knees before outfit edits without stretching or recropping references', () => {
    const out = patchWorkflow(wf, map, { ...req, framing: 'knees' });
    expect(out.portraitCrop.inputs).toEqual({ image: wf[map.output.node].inputs.images, crop_region: { x: 0, y: 0, width: 832, height: 973 } });
    expect(out.portraitScale.inputs).toMatchObject({ image: ['portraitCrop', 0], width: 832, height: 1216, upscale_method: 'nearest-exact', crop: 'center' });
    expect(out.portraitMatte.inputs).toMatchObject({ destination: ['portraitBackground', 0], source: ['portraitScale', 0], mask: ['portraitMask', 0], resize_source: false });
    expect(out[map.output.node].inputs.images).toEqual(['portraitMatte', 0]);
    const outfit = outfitPortraitRequest(createGame({ seed: 1 }).characters.ren, 'navy suit', '/approved.png');
    expect(patchWorkflow(wf, map, outfit, undefined, 'approved.png').portraitCrop).toBeUndefined();
    expect(cacheKey('w', req)).not.toBe(cacheKey('w', { ...req, framing: 'knees' }));
  });
  it('group workflow has no portrait references or placeholder image dependencies', () => {
    const wf = JSON.parse(readFileSync(resolve(ROOT, 'workflows/group_ref.api.json'), 'utf8'));
    const map = JSON.parse(readFileSync(resolve(ROOT, 'workflows/group_ref_mapping.json'), 'utf8'));
    const req: ImageRequest = { kind: 'freeze', prompt: 'p', negative: 'n', seed: 3, width: 1024, height: 768, subjectKey: 'freeze:x' };
    const out = patchWorkflow(wf, map, req);
    expect(Object.values(out).filter((n) => n.class_type === 'LoadImage')).toHaveLength(0);
    expect(Object.keys(out.enc.inputs).filter((k) => k.startsWith('images.'))).toEqual([]);
    expect(out.enc.inputs.resolution).toBe(0);
    expect(out.unet.inputs.unet_name).toBe('qwen_image_2.1_turbo_Q8_0.gguf');
    expect(out.lat.inputs).toMatchObject({ width: 1024, height: 768 });
  });
  it('samples scenes of any cast size on the room canvas at the requested size', () => {
    const wf = JSON.parse(readFileSync(resolve(ROOT, 'workflows/group_ref.api.json'), 'utf8'));
    const map = JSON.parse(readFileSync(resolve(ROOT, 'workflows/group_ref_mapping.json'), 'utf8'));
    const scene = { ...req, kind: 'freeze' as const, width: 1216, height: 832 };
    const out = patchWorkflow(wf, map, scene, undefined, undefined, 'kitchen.png');
    expect(out.sceneCanvas.inputs.image).toBe('kitchen.png');
    expect(out.sceneCanvasScale.inputs).toMatchObject({ width: 1216, height: 832 });
    expect(out.enc.inputs['images.image_1']).toEqual(['sceneCanvasScale', 0]);
    expect(Object.values(out).filter((n) => n.class_type === 'LoadImage')).toHaveLength(1);
    expect(Object.keys(out.enc.inputs).filter((k) => k.startsWith('images.'))).toEqual(['images.image_1']);
    expect(out.enc.inputs.resolution).toBe(0);
    expect(out.k.inputs.latent_image).toEqual(['enc', 2]);
    expect(out.enc.inputs.vae).toEqual(['vae', 0]);
    expect(wf.k.inputs.latent_image).toEqual(['lat', 0]);
    const withoutRoom = patchWorkflow(wf, map, scene);
    expect(withoutRoom.sceneCanvas).toBeUndefined();
    expect(withoutRoom.k.inputs.latent_image).toEqual(['lat', 0]);
    const roomOnly = patchWorkflow(wf, map, scene, undefined, undefined, 'kitchen.png');
    expect(roomOnly.ref1).toBeUndefined();
    expect(Object.keys(roomOnly.enc.inputs).filter((k) => k.startsWith('images.'))).toEqual(['images.image_1']);
  });
  it('rejects mappings that point at missing nodes', () => {
    expect(() => patchWorkflow(wf, { positive: { node: '999', input: 'text' } }, req)).toThrow(/missing node/);
  });
  it('copies expression edits only inside the detected face and preserves the approved reference body', () => {
    const workflow = JSON.parse(readFileSync(resolve(ROOT, 'workflows/ref_edit.api.json'), 'utf8'));
    const mapping = JSON.parse(readFileSync(resolve(ROOT, 'workflows/ref_mapping.json'), 'utf8'));
    const out = patchWorkflow(workflow, mapping, { ...req, reference: '/approved.png', editRegion: 'face' }, undefined, 'approved.png');
    expect(out.faceSegments.inputs.image).toEqual([mapping.reference.node, 0]);
    expect(out.faceForeground.inputs.images).toEqual([mapping.reference.node, 0]);
    expect(out.faceSolid.inputs).toEqual({ mask: ['faceForeground', 1], value: 0.5 });
    expect(out.faceEditMask.inputs).toMatchObject({ destination: ['faceMask', 0], source: ['faceSolid', 0], operation: 'multiply' });
    expect(out.faceComposite.inputs).toMatchObject({ destination: [mapping.reference.node, 0], source: workflow[mapping.output.node].inputs.images, mask: ['faceEditMask', 0] });
    expect(out[mapping.output.node].inputs.images).toEqual(['faceComposite', 0]);
    expect(patchWorkflow(workflow, mapping, req, undefined, 'approved.png').faceComposite).toBeUndefined();
    expect(cacheKey('w', req)).not.toBe(cacheKey('w', { ...req, editRegion: 'face' }));
    const fallback = patchWorkflow(workflow, mapping, { ...req, editRegion: 'face' }, undefined, 'outfit.png', 'original.png');
    expect(fallback.faceGuide.inputs.image).toBe('original.png');
    expect(fallback.faceChoice.inputs).toEqual({ cond: ['faceFound', 0], tt_value: ['faceSegments', 0], ff_value: ['faceGuideSegments', 0] });
    expect(fallback.faceMask.inputs.segs).toEqual(['faceChoice', 0]);
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
  it('routes scenes to Qwen 2.1 with or without a room, uploads only the room and hashes that workflow', async () => {
    const dir = tmp();
    const room = join(dir, 'room.png');
    writeFileSync(room, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const prompts: any[] = [];
    let uploads = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (j: unknown) => new Response(JSON.stringify(j));
      if (u.endsWith('/upload/image')) { uploads++; return json({ name: 'room.png' }); }
      if (u.endsWith('/prompt')) { prompts.push(JSON.parse(String(init!.body)).prompt); return json({ prompt_id: `p${prompts.length}` }); }
      if (u.includes('/history/')) return json({ [u.split('/history/')[1]]: { outputs: { save: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const comfy = new ComfyBackend('http://comfy', resolve(ROOT, 'workflows/txt2img.api.json'), resolve(ROOT, 'workflows/mapping.json'), dir, 5000, fake, undefined, {
      freeze: { workflowPath: resolve(ROOT, 'workflows/group_ref.api.json'), mappingPath: resolve(ROOT, 'workflows/group_ref_mapping.json') },
    });
    const scene = { ...req, kind: 'freeze' as const, width: 1216, height: 832 };
    expect(comfy.workflowHashFor(scene)).not.toBe(comfy.workflowHashFor(req));
    expect(comfy.workflowHashFor(scene)).toBe(comfy.workflowHashFor({ ...scene, reference2: room }));
    await comfy.generate(scene);
    await comfy.generate({ ...scene, reference2: room });
    expect(uploads).toBe(1);
    expect(prompts.map((p) => p.unet.inputs.unet_name)).toEqual(Array(2).fill('qwen_image_2.1_turbo_Q8_0.gguf'));
    expect(Object.values(prompts[0]).filter((n: any) => n.class_type === 'LoadImage')).toHaveLength(0);
    expect(Object.values(prompts[1]).filter((n: any) => n.class_type === 'LoadImage')).toHaveLength(1);
    expect(prompts[1].enc.inputs['images.image_1']).toEqual(['sceneCanvasScale', 0]);
  });
  it('a job that times out is cancelled in ComfyUI instead of left hogging the GPU', async () => {
    const posts: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') posts.push(`${u.replace('http://comfy', '')} ${init.body ?? ''}`);
      if (u.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'slow' }));
      return new Response('{}'); // history: never finishes
    }) as typeof fetch;
    const comfy = new ComfyBackend('http://comfy', resolve(ROOT, 'workflows/txt2img.api.json'), resolve(ROOT, 'workflows/mapping.json'), tmp(), 300, fake);
    await expect(comfy.generate(req)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toContain('/interrupt {"prompt_id":"slow"}');
    expect(posts).toContain('/queue {"delete":["slow"]}');
  });
});

describe('image queue', () => {
  const req = (key: string, seed = 1): ImageRequest => ({ kind: 'location', prompt: `p-${key}`, negative: 'n', seed, width: 64, height: 64, subjectKey: key, meta: { timeOfDay: 'day' } });
  it('cache key is stable and sensitive to every input', () => {
    expect(cacheKey('w', req('a'))).toBe(cacheKey('w', req('a')));
    expect(cacheKey('w', req('a'))).not.toBe(cacheKey('w', req('a', 2)));
    expect(cacheKey('w', req('a'))).not.toBe(cacheKey('w2', req('a')));
  });
  it('migrates legacy cached images and reuses them after an unrelated workflow changes', () => {
    const dir = tmp();
    const store = new Store(openDb(':memory:'));
    const image = req('existing');
    writeFileSync(join(dir, 'existing.png'), Buffer.from([1, 2, 3]));
    store.imagePut(cacheKey('old-combined', image), 'existing.png', image.kind, image.prompt, image.seed, false);
    const backend: ImageBackend = { name: 'comfyui', health: async () => true, workflowHashFor: () => 'location-only', generate: async () => { throw new Error('must reuse cache'); } };
    const first = new ImageQueue(backend, new MockImageBackend(dir), store, 'old-combined', dir, null);
    expect(first.request(image, PRIORITY.location)).toMatchObject({ status: 'ready', placeholder: false, url: '/images/existing.png' });
    const afterHouseChange = new ImageQueue(backend, new MockImageBackend(dir), store, 'changed-sprite-workflow', dir, null);
    expect(afterHouseChange.request(image, PRIORITY.location)).toMatchObject({ status: 'ready', placeholder: false });
    expect(afterHouseChange.localFile(image)).toBe(join(dir, 'existing.png'));
    expect(afterHouseChange.generated).toBe(0);
  });
  it('reuses the whole portrait → outfit → expression → cutout chain after a restart, and offline', async () => {
    const dir = tmp();
    let made = 0;
    const real: ImageBackend = { name: 'comfyui', health: async () => true, generate: async () => { const path = `${++made}.png`; writeFileSync(join(dir, path), Buffer.from([made])); return { id: path, path, mime: 'image/png', placeholder: false }; } };
    const c = createGame({ seed: 3 }).characters.ren;
    const outfit = outfitFor(c, 'daily', 1);
    const chain = async (q: ImageQueue) => {
      const keys: string[] = [];
      const step = async (r: ImageRequest) => { const st = q.request(r, PRIORITY.currentScene); keys.push((await q.settle(st.key)).status); return q.localFile(r)!; };
      const base = await step(portraitRequest(c));
      const dressedReq = outfitPortraitRequest(c, outfit, base);
      const dressed = await step(dressedReq);
      const happy = expressionRequest({ ...c, appearance: { ...c.appearance, outfit } }, 'happy', dressed);
      await step(cutoutRequest(await step(happy), happy));
      return keys;
    };
    expect(await chain(new ImageQueue(real, new MockImageBackend(dir), new Store(openDb(join(dir, 'db.sqlite'))), 'w', dir, null))).toEqual(['ready', 'ready', 'ready', 'ready']);
    expect(made).toBe(4);
    // server restart: a new queue over the same database and cache folder enqueues nothing
    const restarted = new ImageQueue(real, new MockImageBackend(dir), new Store(openDb(join(dir, 'db.sqlite'))), 'w', dir, null);
    expect(await chain(restarted)).toEqual(['ready', 'ready', 'ready', 'ready']);
    expect(made).toBe(4);
    expect(restarted.pending().queued).toBe(0);
    // ComfyUI offline: saved art still comes back real, not placeholders
    const offline = new ImageQueue(new DownImages(), new MockImageBackend(dir), new Store(openDb(join(dir, 'db.sqlite'))), 'w', dir, null);
    const happy = expressionRequest({ ...c, appearance: { ...c.appearance, outfit } }, 'happy', offline.localFile(outfitPortraitRequest(c, outfit, offline.localFile(portraitRequest(c))!)));
    expect(offline.request(cutoutRequest(offline.localFile(happy)!, happy), PRIORITY.currentScene)).toMatchObject({ status: 'ready', placeholder: false });
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
    expect(q.activity()).toMatchObject({ label: 'Generating scenery', waiting: 'Waiting for dialogue to finish', queued: 1, estimatedMs: 45000 });
    const me = q.request(req('me'), PRIORITY.playerPortrait);
    await q.settle(me.key);
    expect(ran).toEqual(['me']);
    release();
    await q.settle(bg.key);
    expect(ran).toEqual(['me', 'bg']);
    expect(q.activity()).toBeNull();
  });
  it('dialogue preempts a running background job, which is requeued and finishes afterwards', async () => {
    const dir = tmp();
    let interrupted = 0, attempts = 0, freed = 0;
    let stop: (() => void) | undefined;
    const backend: ImageBackend = {
      name: 'comfyui', health: async () => true,
      free: async () => { freed++; },
      interrupt: async () => { interrupted++; stop?.(); },
      generate: (r) => new Promise((res, rej) => {
        attempts++;
        if (attempts > 1) return res(new MockImageBackend(dir).generate(r));
        stop = () => rej(new Error('comfy reported an error')); // ComfyUI's interrupted prompt fails on its own
      }),
    };
    const q = new ImageQueue(backend, new MockImageBackend(dir), new Store(openDb(':memory:')), 'w', dir, null);
    const bg = q.request(req('sheet-today'), PRIORITY.currentSprite);
    await new Promise((r) => setTimeout(r, 10));
    const release = await q.holdClear(); // a model call starts: waits for the interrupted job to stop
    expect(interrupted).toBe(1);
    expect(freed).toBe(1); // the half-run job's models are unloaded before the LLM loads
    expect(q.status(bg.key).status).toBe('queued');
    release();
    expect((await q.settle(bg.key)).status).toBe('ready');
    expect(attempts).toBe(2);
  });
  it('a model call lets a scene image the player asked for finish instead of interrupting it', async () => {
    const dir = tmp();
    let interrupted = 0, freed = 0;
    let finish: (() => void) | undefined;
    const backend: ImageBackend = {
      name: 'comfyui', health: async () => true,
      free: async () => { freed++; },
      interrupt: async () => { interrupted++; },
      generate: (r) => new Promise((res) => { finish = () => res(new MockImageBackend(dir).generate(r)); }),
    };
    const q = new ImageQueue(backend, new MockImageBackend(dir), new Store(openDb(':memory:')), 'w', dir, null);
    const photo = q.request(req('scene'), PRIORITY.currentScene);
    await new Promise((r) => setTimeout(r, 10));
    const claim = q.holdClear();
    setTimeout(() => finish!(), 50);
    const release = await claim;
    expect(interrupted).toBe(0);
    expect(q.status(photo.key).status).toBe('ready');
    expect(freed).toBe(1);
    release();
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
    await session.act(action);
    for (let n = 0; n < 30; n++) {
      const sc = session.summaries().find(s => s.phase !== 'done');
      if (!sc) break;
      if (sc.phase === 'awaiting-response') session.respond(sc.id, 'join');
      if (!sc.rendered && sc.phase === 'done') continue;
      const events: string[] = [];
      for (let i = 0; i < 4 && session.runs.get(sc.id)!.phase !== 'done'; i++) {
        await session.stream(sc.id, (e) => events.push(e));
        const run = session.runs.get(sc.id)!;
        if (run.phase === 'awaiting-choice') session.choose(sc.id, run.said.length ? { done: true } : run.ev.intents[0]);
      }
      expect(session.runs.get(sc.id)!.phase).toBe('done');
    }
    await session.endSlot();
  }
}

describe('game session (mock + failing adapters)', () => {
  it('keeps brief texts before sundown instantaneous and blocks them during Shabbat', async () => {
    const dir = tmp();
    const store = new Store(openDb(':memory:'));
    const queue = new ImageQueue(new MockImageBackend(dir), new MockImageBackend(dir), store, 'mock', dir, null);
    const down = new DownLlm();
    let dialogueCalls = 0;
    const generatedKinds: string[] = [];
    const adapter: LlmClient = { name: 'test', health: async () => true, complete: async (r) => { generatedKinds.push(r.kind); return down.complete(r); }, stream: async function* (r) { dialogueCalls++; yield* down.stream(r); } };
    const session = new GameSession(store, new Generator(adapter), queue);
    await session.newGame({ seed: 7, moveInDay: false });
    for (let i = 0; i < 2; i++) { await session.act({ type: 'sleep' }); await session.endSlot(); }
    expect(session.state!.world.weekday).toBe(5);
    for (let i = 0; i < 3; i++) { await session.act({ type: 'skip' }); await session.endSlot(); }
    expect(session.state!.world.slot).toBe('slot3');
    // Texting just before sundown leaves the clock untouched; historical time logs use three minutes per line.
    session.state = passTime(session.state!, 105 / 3, [], 3);
    session.logSeq = store.appendEvent(session.state.gameId, 'time', { lines: 105 / 3 });
    const target = Object.values(session.state.characters).find(c => !c.isPlayer && c.status === 'inHouse' && c.persona.keepsShabbat)!;
    expect(target).toBeDefined();
    generatedKinds.length = 0;
    const { scenes } = await session.act({ type: 'text', target: target.id, text: 'Are you free tonight?' });
    expect(scenes).toEqual([]);
    expect(session.state.world.minutes).toBe(105);
    expect(session.state.chats[[session.state.playerId, target.id].sort().join('|')]).toHaveLength(2);
    expect(dialogueCalls).toBe(0);
    expect(generatedKinds).toEqual(['chat']);
    expect(replayEvents(store.events(session.state.gameId))).toEqual(session.state);
    session.state = passTime(session.state, 15 / 3, [], 3);
    session.logSeq = store.appendEvent(session.state.gameId, 'time', { lines: 15 / 3 });
    await expect(session.act({ type: 'text', target: target.id, text: 'Still there?' })).rejects.toThrow(/Shabbat/);
    expect(generatedKinds).toEqual(['chat']);
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
    // Studio still runs on templates, host first and last; recording it changes only the broadcast remarks.
    expect(session.pendingIntermission).toBe('end');
    const before = structuredClone(session.state!);
    const im = await session.intermission();
    expect(im.lines.length).toBeGreaterThanOrEqual(3);
    expect(im.lines[0].speaker).toBe('nagumo');
    expect(im.lines.at(-1)!.speaker).toBe('nagumo');
    expect({ ...session.state, panelRemarks: before.panelRemarks }).toEqual(before);
    expect(session.state!.panelRemarks.slice(before.panelRemarks.length).map(r => r.text)).toEqual(im.lines.map(l => l.text));
    expect(session.state!.panelRemarks.slice(before.panelRemarks.length).every(r => r.episode === 1)).toBe(true);
    expect(await session.intermission()).toEqual(im);
  });

  it('replaying the event log reproduces the exact state (deterministic replay)', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'db.sqlite')));
    const queue = new ImageQueue(new MockImageBackend(dir), new MockImageBackend(dir), store, 'mock', dir, null);
    const session = new GameSession(store, new Generator(new MockLlm()), queue);
    await session.newGame({ seed: 21, moveInDay: false });
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
    await session.newGame({ seed: 21, moveInDay: false });
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
    const next = { name: 'Aki Mori', age: 26, gender: 'woman' as const, interestedIn: ['man' as const], hometown: 'Kobe', occupation: 'barista', traits: [0.5, 0.5, 0.5, 0.5, 0.5], quirks: [], tastes: [0, 0, 0, 0, 0, 0], hobbies: ['surfing', 'film', 'running'], appearance: { hairStyle: 'short messy', hairColor: 'black', eyeColor: 'brown', build: 'average', outfit: 'linen shirt', accessory: 'none', skinTone: 'tan' } };
    // three men and three women: a woman graduated, so a woman takes her place
    expect(() => session.newPlayer({ ...next, gender: 'man' })).toThrow(/must be a woman/);
    const v = session.newPlayer(next);
    expect(v.playerId).not.toBe(before);
    await drive({ type: 'idle' });
    const replayed = replayEvents(store.events(session.state!.gameId));
    expect(stableStringify(replayed)).toBe(stableStringify(session.state));
  });

  it('keep listening: two housemates carry on without the player, then the player can end the talk', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'db.sqlite')));
    const queue = new ImageQueue(new MockImageBackend(dir), new MockImageBackend(dir), store, 'mock', dir, null);
    const session = new GameSession(store, new Generator(new MockLlm()), queue);
    await session.newGame({ seed: 21, moveInDay: false });
    const { scenes } = await session.act({ type: 'talk', target: 'ren' });
    const run = session.runs.get(scenes[0].id)!;
    const extra = Object.values(session.state!.characters).find((c) => !c.isPlayer && !run.ev.participants.includes(c.id))!;
    run.ev.participants.push(extra.id); // make it a group
    const events: { e: string; d: any }[] = [];
    while (run.phase !== 'awaiting-choice' && run.phase !== 'done') await session.stream(run.id, (e, d) => events.push({ e, d }));
    expect(events.filter((x) => x.e === 'choice').at(-1)?.d.canListen).toBe(true);
    session.choose(run.id, run.ev.intents[0]);
    await session.stream(run.id, (e, d) => events.push({ e, d }));
    expect(run.phase).toBe('awaiting-choice');
    expect(events.at(-1)).toMatchObject({ e: 'choice', d: { canType: true, canEnd: true, canListen: true } });
    session.choose(run.id, { text: 'Everyone, shall we cook together?' });
    await session.stream(run.id, (e, d) => events.push({ e, d }));
    expect(run.phase).toBe('awaiting-choice');
    expect(run.transcript.filter(l => l.source === 'player').at(-1)?.text).toBe('Everyone, shall we cook together?');
    const before = run.transcript.length;
    const prompts: string[] = [];
    session.gen.linesLlm = {
      name: 'test-lines', health: async () => true,
      complete: async () => '...',
      async *stream(req) {
        prompts.push(req.prompt);
        yield [...req.prompt.matchAll(/^\d+\. ([\w-]+) \(/gm)].map(m => `${m[1]}: Sounds good.`).join('\n');
      },
    };
    session.choose(run.id, { listen: true });
    await session.stream(run.id, (e, d) => events.push({ e, d }));
    const said = run.transcript.slice(before);
    expect(said).toHaveLength(2);
    expect(said.every((l) => l.speaker !== session.state!.playerId)).toBe(true);
    expect(said.every((l) => l.source === 'llm')).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('intent "answer them"');
    expect(prompts[0]).toContain('reacts to the preceding speaker');
    expect(said[0].speaker).not.toBe(said[1].speaker);
    expect(events.at(-1)).toMatchObject({ e: 'choice', d: { canEnd: true } });
    session.choose(run.id, { done: true });
    while (run.phase !== 'done') await session.stream(run.id, () => {});
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
  it('uses swimmer-specific outfits for streamed deck conversations and image requests', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'mixed-pool.sqlite')));
    let generated = 0;
    const image: ImageBackend = { name: 'comfyui', health: async () => true, generate: async () => {
      const path = `pool-${++generated}.png`;
      writeFileSync(join(dir, path), Buffer.from([generated]));
      return { id: path, path, mime: 'image/png', placeholder: false };
    } };
    const { app, session, queue } = await buildApp({ llm: new MockLlm(), image, store, workflowHash: 'w', cacheDir: dir, assetsDir: null });
    try {
      await session.newGame({ seed: 11, moveInDay: false });
      const s = session.state!;
      s.world.slot = 'slot1'; s.world.flags.startedBlock = '1:slot1';
      for (const c of Object.values(s.characters)) { c.persona.routine.jobSlots = []; c.activityUntil = 180; c.lastAction = 'hobby'; }
      s.characters.ren.location = 'backyard';
      await queue.settle(queue.request(portraitRequest(s.characters[s.playerId]), PRIORITY.portrait).key);
      await queue.settle(queue.request(portraitRequest(s.characters.ren), PRIORITY.portrait).key);
      await session.act({ type: 'pool', mode: 'enter' });
      const c = session.state!.characters[session.state!.playerId];
      const swimmerOutfit = outfitFor(c, 'beach', session.state!.world.day);
      const expectedSwimmer = queue.request(outfitPortraitRequest(c, swimmerOutfit, queue.localFile(portraitRequest(c))), PRIORITY.currentScene);
      const dressed = await app.inject({ method: 'GET', url: `/api/image/character/${c.id}/outfit?occasion=daily` });
      expect(dressed.statusCode).toBe(200);
      expect(dressed.json().key).toBe(expectedSwimmer.key);
      const dry = session.state!.characters.ren;
      const expectedDry = queue.request(outfitPortraitRequest(dry, outfitFor(dry, 'daily', session.state!.world.day), queue.localFile(portraitRequest(dry))), PRIORITY.currentScene);
      const ordinary = await app.inject({ method: 'GET', url: '/api/image/character/ren/outfit?occasion=daily' });
      expect(ordinary.json().key).toBe(expectedDry.key);
      const { scenes } = await session.act({ type: 'talk', target: 'ren' });
      const playerScene = scenes.find((sc) => sc.isPlayerScene)!;
      session.runs.get(playerScene.id)!.ev = makeEvent(session.state!, eventTemplate('casual-chat'), { a: c.id, b: 'ren' }, 'backyard');
      const output: { event: string; data: any }[] = [];
      await session.stream(playerScene.id, (event, data) => output.push({ event, data }));
      const header = output.find((event) => event.event === 'scene')!.data;
      expect(header.occasion).toBe('daily');
      expect(header.participants).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: c.id, occasion: 'beach' }),
        expect.objectContaining({ id: 'ren', occasion: 'daily' }),
      ]));
    } finally { await app.close(); }
  });

  it('enters the pool with multiple guests without starting a scene, rejects duplicate invitations, and replays exit', async () => {
    const dir = tmp();
    const store = new Store(openDb(join(dir, 'pool.sqlite')));
    const { app, session } = await buildApp({ llm: new MockLlm(), image: new DownImages(), store, workflowHash: 'w', cacheDir: dir, assetsDir: null });
    try {
      const started = await app.inject({ method: 'POST', url: '/api/game/new', payload: { seed: 11, moveInDay: false } });
      expect(started.statusCode).toBe(200);
      const s = session.state!;
      const guests = Object.values(s.characters).filter((c) => !c.isPlayer && !c.persona.routine.jobSlots.some((j) => j.slot === s.world.slot && j.weekdays.includes(s.world.weekday))).slice(0, 2).map((c) => c.id);
      expect(guests).toHaveLength(2);
      const entered = await app.inject({ method: 'POST', url: '/api/game/action', payload: { action: { type: 'pool', mode: 'enter', with: guests } } });
      expect(entered.statusCode).toBe(200);
      expect(entered.json().scenes).toEqual([]);
      expect(entered.json().view.characters.filter((c: any) => c.swimming)).toHaveLength(3);
      expect(entered.json().view.clock).toBe(started.json().view.clock);
      const invalid = await app.inject({ method: 'POST', url: '/api/game/action', payload: { action: { type: 'pool', mode: 'enter', with: [guests[0], guests[0]] } } });
      expect(invalid.statusCode).toBe(400);
      const left = await app.inject({ method: 'POST', url: '/api/game/action', payload: { action: { type: 'pool', mode: 'leave' } } });
      expect(left.statusCode).toBe(200);
      expect(left.json().view.characters.some((c: any) => c.swimming)).toBe(false);
      expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    } finally { await app.close(); }
  });

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
