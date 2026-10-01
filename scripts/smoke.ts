// Smoke test against real services: one dialogue (beat sheet + streamed lines), one commentary, one image.
// `npm run smoke` — requires Ollama with OLLAMA_MODEL pulled and ComfyUI running with the default workflow.
import { mkdirSync } from 'node:fs';
import { createGame, makeEvent, eventTemplate, type LineContext } from '@shared-roof/shared';
import { config } from '../apps/server/src/config';
import { OllamaClient } from '../apps/server/src/llm/ollama';
import { Budget } from '../apps/server/src/llm/structured';
import { Generator } from '../apps/server/src/game/generate';
import { ComfyBackend } from '../apps/server/src/image/comfy';
import { portraitRequest } from '../apps/server/src/image/requests';

const ok = (b: boolean) => (b ? 'OK  ' : 'FAIL');
let failures = 0;

const llm = new OllamaClient(config.ollamaUrl, config.ollamaModel, Math.max(config.llmTimeoutMs, 120000));
console.log(`ollama ${config.ollamaUrl} model ${config.ollamaModel}`);
const llmUp = await llm.health();
console.log(`${ok(llmUp)} ollama health`);
if (!llmUp) failures++;

if (llmUp) {
  const gen = new Generator(llm);
  const s = createGame({ seed: 7 });
  const ev = makeEvent(s, eventTemplate('late-night-kitchen'), { a: 'ren', b: 'mio' }, 'kitchen');
  const budget = new Budget(10);
  let t = Date.now();
  const sheet = await gen.beatSheet(s, ev, budget);
  console.log(`${ok(sheet.source === 'llm')} beat sheet (${sheet.source}, ${sheet.beats.length} beats, ${Date.now() - t} ms)`);
  if (sheet.source !== 'llm') failures++;
  t = Date.now();
  const ctx: LineContext = { place: 'kitchen', listener: 'Mio', catchphraseUses: {}, lineCounts: {} };
  let streamed = 0;
  const lines = await gen.lines(s, ev, sheet.beats, [], sheet.beats.map(() => undefined), ctx, budget, () => {}, () => streamed++);
  const fromLlm = lines.filter((l) => l.source === 'llm').length;
  console.log(`${ok(fromLlm > 0)} dialogue: ${fromLlm}/${lines.length} lines from the LLM, ${streamed} streamed tokens, ${Date.now() - t} ms`);
  for (const l of lines) console.log(`       ${l.speaker}: ${l.text}${l.source === 'mock' ? '   (template fallback)' : ''}`);
  if (!fromLlm) failures++;
  t = Date.now();
  const cm = await gen.commentary(s, ev, lines, undefined, null, budget);
  console.log(`${ok(cm.source === 'llm')} commentary (${cm.source}, ${Date.now() - t} ms)`);
  for (const l of cm.commentary.lines) console.log(`       [${l.speaker}] ${l.text} (${l.reaction})`);
  if (cm.source !== 'llm') failures++;
}

const comfy = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, config.cacheDir, Math.max(config.imageTimeoutMs, 600000));
mkdirSync(config.cacheDir, { recursive: true });
const imgUp = await comfy.health();
console.log(`${ok(imgUp)} comfyui health (${config.comfyUrl})`);
if (!imgUp) failures++;
if (imgUp) {
  const s = createGame({ seed: 7 });
  const t = Date.now();
  try {
    const r = await comfy.generate({ ...portraitRequest(s.characters.sora), seed: 123 });
    console.log(`OK   image ${r.path} (${Date.now() - t} ms) in ${config.cacheDir}`);
  } catch (e) {
    failures++;
    console.log(`FAIL image: ${(e as Error).message}`);
  }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nsmoke test passed');
process.exit(failures ? 1 : 0);
