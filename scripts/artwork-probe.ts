// Opt-in real GPU probe. Isolated in-memory game; output includes genuine generated PNGs and browser screenshots.
// npx tsx scripts/artwork-probe.ts --run-real
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createGame, defaultCast, DEFAULT_PLAYER, outfitFor, playerFromSetup, type Emotion, type Occasion } from '@shared-roof/shared';
import { config, ROOT } from '../apps/server/src/config';
import { buildApp } from '../apps/server/src/app';
import { openDb, Store } from '../apps/server/src/db';
import { MockLlm } from '../apps/server/src/llm/mock';
import { unloadOllama } from '../apps/server/src/llm/ollama';
import { ComfyBackend } from '../apps/server/src/image/comfy';
import { expressionRequest, outfitPortraitRequest, portraitRequest } from '../apps/server/src/image/requests';
import { AssetLibrary } from '../apps/server/src/image/queue';

if (!process.argv.includes('--run-real')) throw new Error('Pass --run-real to use the configured image service');
const output = resolve(ROOT, 'artwork', 'expression-outfit-original-style');
mkdirSync(output, { recursive: true });
const backend = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, output, 300_000, fetch,
  { workflowPath: resolve(ROOT, config.comfyRefWorkflow), mappingPath: config.comfyRefMapping },
  { cutout: { workflowPath: resolve(ROOT, 'workflows/cutout.api.json'), mappingPath: resolve(ROOT, 'workflows/cutout_mapping.json') } });
backend.beforeJob = () => unloadOllama(config.ollamaUrl);
assert(await backend.health(), 'ComfyUI must be online');
if (process.argv.includes('--prepare-portraits')) {
  const assets = new AssetLibrary(config.assetsDir);
  const manifestPath = resolve(config.assetsDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const people = [...defaultCast(), playerFromSetup(DEFAULT_PLAYER)].sort((a, b) => Number(b.id === 'sora') - Number(a.id === 'sora'));
  for (const c of people) {
    const req = portraitRequest(c);
    if (assets.file(req.subjectKey)) continue;
    const original = assets.file(req.subjectKey.replace(':knees-up-v3', ':thigh-up-v1'));
    assert(original, `${c.id}: original portrait is required to preserve the art style`);
    console.log(`PREPARING ${c.id} from its original pixel-art portrait`);
    const image = await backend.generate(portraitRequest(c, false, original));
    assert.equal(image.placeholder, false);
    const rel = `portraits/finished-${c.id}-knees-up-v3.png`;
    copyFileSync(resolve(output, image.path), resolve(config.assetsDir, rel));
    manifest[req.subjectKey] = rel;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.log(`PREPARED ${c.id}: ${rel}`);
  }
}
const store = new Store(openDb(resolve(output, 'probe.sqlite')));
const { app, session, queue } = await buildApp({ llm: new MockLlm(), image: backend, store, workflowHash: backend.workflowHash, cacheDir: output, serveWeb: true });
session.state = createGame({ seed: 21, moveInDay: false, gameId: 'isolated-artwork-probe' });
const before = JSON.stringify(session.state);
const secondWoman = Object.values(session.state.characters).find(c => c.gender === 'woman' && c.id !== 'mio' && !c.isPlayer)!;
const cases: { id: string; occasion: Occasion; emotion: Emotion; custom?: string }[] = [
  { id: 'ren', occasion: 'beach', emotion: 'sad' },
  { id: 'kaito', occasion: 'beach', emotion: 'excited' },
  { id: 'ren', occasion: 'formal', emotion: 'happy', custom: 'tailored navy two-piece suit with matching suit jacket and trousers, white dress shirt and dark tie' },
  { id: 'kaito', occasion: 'date', emotion: 'annoyed' },
  { id: 'mio', occasion: 'date', emotion: 'shy' },
  { id: secondWoman.id, occasion: 'date', emotion: 'nervous' },
  { id: 'mio', occasion: 'beach', emotion: 'tender' },
  { id: secondWoman.id, occasion: 'beach', emotion: 'angry' },
];
const results: Record<string, unknown>[] = [];
async function generated(id: string, occasion: Occasion, emotion: Emotion, outfit?: string) {
  const query = `occasion=${occasion}&day=0${outfit ? `&outfit=${encodeURIComponent(outfit)}` : ''}`;
  for (let step = 0; step < 5; step++) {
    const response = await app.inject({ method: 'POST', url: `/api/image/character/${id}/artwork/generate`, payload: { kind: 'expression', emotion, occasion, day: 0, outfit } });
    assert.equal(response.statusCode, 200);
    const result = response.json();
    const image = result.image.status === 'ready' ? result.image : await queue.settle(result.image.key);
    assert.equal(image.status, 'ready'); assert.equal(image.placeholder, false, `${id}/${occasion}/${emotion} returned a placeholder`);
    if (result.complete) {
      const stand = (await app.inject(`/api/image/character/${id}/stand?${query}&emotion=${emotion}`)).json();
      assert.equal(stand.url, image.url, 'Conversation must use the generated expression');
      const library = (await app.inject(`/api/image/library?${query}`)).json();
      assert.equal(library.characters.find((c: { id: string }) => c.id === id).expressions.find((e: { emotion: string }) => e.emotion === emotion).image.url, image.url);
      return image;
    }
  }
  throw new Error('Dependency chain did not complete');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  await app.listen({ port: 8792, host: '127.0.0.1' });
  for (const sample of cases) {
    const c = session.state.characters[sample.id];
    const outfit = sample.custom ?? outfitFor(c, sample.occasion, 0);
    console.log(`START ${c.name}: ${outfit} / ${sample.emotion}`);
    const start = Date.now();
    const neutral = await generated(c.id, sample.occasion, 'neutral', sample.custom);
    const expression = await generated(c.id, sample.occasion, sample.emotion, sample.custom);
    assert.notEqual(neutral.url, expression.url);
    const portraitFile = queue.localFile(portraitRequest(c)); assert(portraitFile);
    const outfitRequest = outfitPortraitRequest(c, outfit, portraitFile);
    const outfitFile = queue.localFile(outfitRequest); assert(outfitFile);
    const faceFile = queue.localFile(expressionRequest({ ...c, appearance: { ...c.appearance, outfit, accessory: outfit === c.appearance.outfit ? c.appearance.accessory : 'none' } }, sample.emotion, outfitFile, outfitRequest.reference)); assert(faceFile);
    const record = { ...sample, name: c.name, outfit, neutral: neutral.url, expression: expression.url, sourcePortrait: `/images/${basename(portraitFile)}`, sourceNeutral: `/images/${basename(outfitFile)}`, sourceExpression: `/images/${basename(faceFile)}`, elapsedMs: Date.now() - start, placeholder: false, routeVerified: true };
    results.push(record);
    writeFileSync(resolve(output, 'results.json'), JSON.stringify({ at: new Date().toISOString(), backend: backend.name, dialogue: 'scripted only for reproducible browser screenshots; all artwork uses real ComfyUI', results }, null, 2));
    console.log(`PASS ${c.name}/${sample.occasion}/${sample.emotion} ${record.elapsedMs}ms`);
  }
  assert.equal(JSON.stringify(session.state), before, 'Artwork generation must not change the game');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  await page.addInitScript('window.__name = fn => fn'); // tsx annotates nested functions passed to browser evaluation.
  await page.goto('http://127.0.0.1:8792');
  const bodyChecks = await page.evaluate(async samples => {
    const pixels = async (url: string) => {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    return Promise.all(samples.map(async r => {
      const a = await pixels(String(r.sourceNeutral)), b = await pixels(String(r.sourceExpression));
      if (a.width !== b.width || a.height !== b.height) throw new Error('Expression changed image size');
      let faceChanges = 0, bodyChanges = 0;
      for (let i = 0; i < a.width * a.height; i++) {
        if ([0, 1, 2].some(ch => a.data[i * 4 + ch] !== b.data[i * 4 + ch])) {
          if (i < a.width * Math.floor(a.height * 0.45)) faceChanges++; else bodyChanges++;
        }
      }
      return { id: r.id, occasion: r.occasion, faceChanges, bodyChanges };
    }));
  }, results);
  writeFileSync(resolve(output, 'expression-body-checks.json'), JSON.stringify(bodyChecks, null, 2));
  bodyChecks.forEach(c => { assert(c.faceChanges > 10, `${c.id}/${c.occasion}: expression did not change the face`); assert.equal(c.bodyChanges, 0, `${c.id}/${c.occasion}: expression changed body pixels`); });
  for (const group of ['date', 'beach']) {
    const samples = results.filter(r => group === 'beach' ? r.occasion === 'beach' : r.occasion !== 'beach');
    const cards = samples.map(r => `<article><h2>${r.name}</h2><p>${r.outfit}</p><div class="pair"><figure><img src="${String(r.neutral).replace('/images/', '')}"><figcaption>neutral</figcaption></figure><figure><img src="${String(r.expression).replace('/images/', '')}"><figcaption>${r.emotion}</figcaption></figure></div></article>`).join('');
    const html = `<!doctype html><meta charset="utf-8"><title>Real artwork probe — ${group}</title><style>body{margin:24px;background:#f4eee4;color:#342d32;font:16px system-ui}h1{margin:0 0 8px}main{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}article{background:#fffaf2;border:1px solid #c9bba8;border-radius:8px;padding:14px}h2{margin:0;font-size:22px}p{margin:6px 0 12px;min-height:40px}.pair{display:flex;justify-content:center;gap:12px}figure{margin:0;text-align:center}img{height:340px;width:240px;object-fit:contain;background:linear-gradient(45deg,#e4ddd2 25%,transparent 25%) 0 0/16px 16px,#f3eadc;image-rendering:pixelated}figcaption{padding:6px;font-weight:600}</style><h1>${group === 'date' ? 'Suits, date clothes and dresses' : 'Swimwear'} — real ComfyUI results</h1><p>Four adult characters · neutral versus generated expression · no placeholder artwork</p><main>${cards}</main>`;
    writeFileSync(resolve(output, `${group}-results.html`), html);
    await page.route('**/artwork-check/*', route => route.fulfill({ contentType: 'text/html', body: html.replaceAll('src="cf-', 'src="/images/cf-') }));
    await page.goto(`http://127.0.0.1:8792/artwork-check/${group}`);
    await page.unroute('**/artwork-check/*');
    await page.locator('img').evaluateAll(async imgs => { await Promise.all(imgs.map(i => (i as HTMLImageElement).decode())); });
    assert(await page.locator('img').evaluateAll(imgs => imgs.every(i => (i as HTMLImageElement).naturalWidth > 0)));
    const masks = await page.locator('img').evaluateAll(imgs => imgs.map(element => {
      const img = element as HTMLImageElement;
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const width = canvas.width, height = canvas.height, count = width * height;
      const visited = new Uint8Array(count), stack: number[] = [];
      let opaque = 0, soft = 0;
      const visit = (i: number) => { if (!visited[i] && pixels[i * 4 + 3] === 0) { visited[i] = 1; stack.push(i); } };
      for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
      for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
      while (stack.length) {
        const i = stack.pop()!; const x = i % width, y = Math.floor(i / width);
        if (x) visit(i - 1); if (x + 1 < width) visit(i + 1);
        if (y) visit(i - width); if (y + 1 < height) visit(i + width);
      }
      let holes = 0;
      for (let i = 0; i < count; i++) {
        const alpha = pixels[i * 4 + 3];
        if (alpha === 255) opaque++; else if (alpha) soft++; else if (!visited[i]) holes++;
      }
      return { file: img.getAttribute('src'), opaque, soft, holes, count };
    }));
    masks.forEach(m => { assert.equal(m.soft, 0, `${m.file}: soft alpha`); assert.equal(m.holes, 0, `${m.file}: enclosed transparent holes`); assert(m.opaque > m.count * 0.05 && m.opaque < m.count * 0.95); });
    writeFileSync(resolve(output, `${group}-mask-checks.json`), JSON.stringify(masks, null, 2));
    await page.screenshot({ path: resolve(output, `${group}-results.png`), fullPage: true });
  }
  console.log('ARTWORK MATRIX COMPLETE; capturing real scene controls');
  queue.hold(); // Keep unrelated house prefetch off the GPU; the scene's tested artwork is already cached.
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
  const names = (id: string) => session.state!.characters[id].name;
  let turn = 0;
  await page.route('**/api/scene/*/choose', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/scene/*/stream', route => {
    const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const index = turn++ * 2;
    const body = event('scene', { title: 'A day at the beach', premise: 'Comparing plans for the afternoon.', location: 'beach', locationName: 'beach', occasion: 'beach', participants: ['ren', 'mio', 'player'].map(id => ({ id, name: names(id) })), outsiders: [], isPlayerScene: true, eavesdrop: false, chat: false, intro: null, background: { key: '', status: 'ready', url: '/assets/locations/finished-backyard-day.png' } }) +
      ['ren', 'mio'].map((id, i) => event('line-start', { index: index + i, speaker: id, name: names(id), caption: null, emotion: 'neutral' }) + event('line-end', { index: index + i, speaker: id, text: index ? 'Let us stay here a little longer.' : i ? 'I am glad we came here together.' : 'I wish everyone could have joined us.', caption: null, source: 'mock' })).join('') +
      event('choice', { intents: ['joke'], recipients: ['ren', 'mio'].map(id => ({ id, name: names(id) })), canType: true, canEnd: true }) + event('end', {});
    return route.fulfill({ contentType: 'text/event-stream', body });
  });
  await page.goto('http://127.0.0.1:8792');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  await page.getByRole('button', { name: 'talk to Kai', exact: true }).click();
  await page.getByRole('dialog', { name: 'talk to Kai?' }).getByRole('button', { name: 'yes', exact: true }).click();
  const stage = page.getByRole('group', { name: 'people in this conversation' });
  for (const id of ['ren', 'mio']) {
    const expected = results.find(r => r.id === id && r.occasion === 'beach')!.neutral;
    await page.waitForFunction(({ name, expected }) => [...document.querySelectorAll('img')].some(i => i.alt.includes(name) && i.getAttribute('src') === expected), { name: names(id), expected });
  }
  await page.getByRole('button', { name: 'character artwork', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'generate character artwork' });
  for (const id of ['ren', 'mio']) {
    const other = id === 'ren' ? 'mio' : 'ren';
    const otherBefore = await stage.getByRole('img', { name: new RegExp(names(other)) }).getAttribute('src');
    await dialog.getByRole('combobox', { name: 'character', exact: true }).selectOption(id);
    const sample = results.find(r => r.id === id && r.occasion === (id === 'ren' ? 'formal' : 'beach'))!;
    await dialog.getByRole('combobox', { name: 'outfit', exact: true }).selectOption(String(sample.occasion));
    await dialog.getByRole('textbox', { name: 'custom outfit (optional)', exact: true }).fill(String(sample.custom ?? ''));
    await dialog.getByRole('combobox', { name: 'expression', exact: true }).selectOption(String(sample.emotion));
    await dialog.getByRole('button', { name: 'generate clothing', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: `${names(id)}'s outfit is ready` }).waitFor();
    await dialog.getByRole('button', { name: 'generate expression', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: `${names(id)}'s expression is ready` }).waitFor();
    const expected = sample.expression;
    await page.waitForFunction(({ name, expected }) => [...document.querySelectorAll('img')].some(i => i.alt.includes(name) && i.getAttribute('src') === expected), { name: names(id), expected });
    assert.equal(await stage.getByRole('img', { name: new RegExp(names(other)) }).getAttribute('src'), otherBefore, 'Changing one character must not change the other');
  }
  await stage.locator('img').evaluateAll(async imgs => { await Promise.all(imgs.map(i => (i as HTMLImageElement).decode())); });
  queue.cancelBelow(Infinity);
  await page.getByRole('complementary', { name: 'Game activity', exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: resolve(output, 'scene-character-picker.png') });
  await dialog.getByRole('combobox', { name: 'character', exact: true }).selectOption('ren');
  assert.equal(await dialog.getByRole('combobox', { name: 'outfit', exact: true }).inputValue(), 'formal');
  assert.equal(await dialog.getByRole('textbox', { name: 'custom outfit (optional)', exact: true }).inputValue(), results.find(r => r.id === 'ren' && r.occasion === 'formal')!.custom);
  await page.screenshot({ path: resolve(output, 'scene-formal-controls.png') });
  await dialog.getByRole('button', { name: 'close', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'scene-expressions.png') });
  await page.getByRole('button', { name: '1. make a joke', exact: true }).click();
  for (const id of ['ren', 'mio']) {
    const expected = results.find(r => r.id === id && r.occasion === (id === 'ren' ? 'formal' : 'beach'))!.neutral;
    await stage.getByRole('img', { name: new RegExp(names(id)) }).waitFor();
    await page.waitForFunction(({ id, expected }) => [...document.querySelectorAll('img')].some(i => i.alt.includes(id) && i.getAttribute('src') === expected), { id: names(id), expected });
  }
  await stage.locator('img').evaluateAll(async imgs => { await Promise.all(imgs.map(i => (i as HTMLImageElement).decode())); });
  await page.screenshot({ path: resolve(output, 'scene-next-line.png') });
  console.log(`VERIFIED ${results.length} outfit/expression pairs, 4 characters, real scene controls and dialogue transition. Output: ${output}`);
} finally {
  await browser.close(); await app.close();
  queue.cancelBelow(Infinity);
  const running = queue.pending().running;
  if (running) await queue.settle(running);
  store.db.close();
}
