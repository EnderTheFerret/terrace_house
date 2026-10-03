// Real-mode check: one full move-in episode through the real API (Ollama + ComfyUI), on a throwaway database.
// Measures scene times, how many lines came from the LLM, the episode-card sprite gate, and whether tomorrow's
// outfits/sheets finish in the background while the LLM is using the GPU.
//   npx tsx scripts/real-episode.ts [seed]      -> report in logs/real-episode-<time>.md
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { config, ROOT } from '../apps/server/src/config';
import { openDb, Store } from '../apps/server/src/db';
import { buildApp } from '../apps/server/src/app';
import { OllamaClient, unloadOllama } from '../apps/server/src/llm/ollama';
import { ComfyBackend } from '../apps/server/src/image/comfy';
import { Recall } from '../apps/server/src/llm/recall';

const seed = Number(process.argv[2] ?? 4);
const store = new Store(openDb(resolve(tmpdir(), `real-episode-${Date.now()}.sqlite`)));
const llm = new OllamaClient(config.ollamaUrl, config.ollamaModel, config.llmTimeoutMs, fetch, config.ollamaKeepAlive);
const linesLlm = config.ollamaModelLines === config.ollamaModel ? llm : new OllamaClient(config.ollamaUrl, config.ollamaModelLines, config.llmTimeoutMs, fetch, config.ollamaKeepAlive);
const wf = (n: string) => resolve(ROOT, 'workflows', n);
const image = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, config.cacheDir, config.imageTimeoutMs, fetch,
  config.comfyRefWorkflow === 'off' ? undefined : { workflowPath: resolve(ROOT, config.comfyRefWorkflow), mappingPath: config.comfyRefMapping }, {
    sprite: { workflowPath: wf('sprite_edit.api.json'), mappingPath: wf('sprite_mapping.json') },
    cutout: { workflowPath: wf('cutout.api.json'), mappingPath: wf('cutout_mapping.json') },
    freeze: { workflowPath: wf('group_ref.api.json'), mappingPath: wf('group_ref_mapping.json') },
  });
image.beforeJob = () => unloadOllama(config.ollamaUrl);
const { app, health, queue } = await buildApp({ llm, linesLlm, image, store, workflowHash: image.workflowHash, recall: new Recall(config.ollamaUrl, config.embedModel, store) });
const h = await health();
const report: string[] = [`# Real-mode episode check (seed ${seed})`, '', `- ${new Date().toISOString()}; llm ${h.llm} (${h.model}), lines ${h.linesLlm} (${h.linesModel}), images ${h.image}`];
const T0 = Date.now();
const secs = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)} s`;
const api = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, payload: payload as object });
  if (r.statusCode >= 400 && r.statusCode !== 409) throw new Error(`${method} ${url} ${r.statusCode}: ${r.body.slice(0, 300)}`);
  return { status: r.statusCode, json: () => JSON.parse(r.body), body: r.body };
};

let view = (await api('POST', '/api/game/new', { seed })).json().view;
report.push(`- move-in day: the player arrives in block **${view.slot}**; ${view.characters.length} people in the house at the start`);

/** Sheets for `day` for everyone in the house: request until ready (the client does this behind the episode card). */
const sheetsReady = async (day: number) => {
  let ready = 0;
  for (const c of view.characters.filter((c: { status: string }) => c.status === 'inHouse')) {
    const r = await api('GET', `/api/image/character/${c.id}/sprite?day=${day}`);
    if (r.status === 200 && r.json().status === 'ready') ready++;
  }
  return ready;
};
// episode-card gate: today's sheets
const t = Date.now();
const total = view.characters.filter((c: { status: string }) => c.status === 'inHouse').length;
while ((await sheetsReady(view.day)) < total && Date.now() - t < 20 * 60_000) await new Promise((r) => setTimeout(r, 3000));
report.push(`- episode-card sprite gate (today's walk sheets, ${total} people): **${secs(t)}**`);

const scenes: { title: string; ms: number; llm: number; lines: number }[] = [];
const playScene = async (sc: { id: string; title: string; phase: string }) => {
  const t1 = Date.now();
  let llmLines = 0, lines = 0;
  if (sc.phase === 'awaiting-response') await api('POST', `/api/scene/${sc.id}/respond`, { response: 'join' });
  for (let i = 0; i < 12; i++) {
    const r = await api('GET', `/api/scene/${sc.id}/stream`);
    for (const block of r.body.split('\n\n')) {
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev === 'line-end' && data) { lines++; if (JSON.parse(data).source === 'llm') llmLines++; }
      if (ev === 'choice' && data) await api('POST', `/api/scene/${sc.id}/choose`, { intent: JSON.parse(data).intents[0] });
    }
    // each call streams one segment (it ends with "end"); the scene is over at "done"
    if (/event: done/.test(r.body) || /event: error/.test(r.body)) break;
  }
  scenes.push({ title: sc.title, ms: Date.now() - t1, llm: llmLines, lines });
};

const startEp = view.episode;
let blocks = 0;
let tomorrowAsked = false;
while (view.episode === startEp && !view.seasonOver && blocks < 14) {
  const someone = view.characters.find((c: { isPlayer: boolean; location: string | null; status: string }) => !c.isPlayer && c.status === 'inHouse' && c.location && c.location !== 'out');
  const action = blocks % 2 === 0 || !someone ? { type: 'house', activity: 'hangout' } : { type: 'talk', target: someone.id };
  let r;
  try { r = (await api('POST', '/api/game/action', { action })).json(); } catch { r = (await api('POST', '/api/game/action', { action: { type: 'idle' } })).json(); }
  for (const sc of r.scenes ?? []) if (sc.rendered) await playScene(sc);
  if (!tomorrowAsked) { await sheetsReady(view.day + 1); tomorrowAsked = true; } // prefetch tomorrow, as the client does
  const end = (await api('POST', '/api/game/end-slot')).json();
  view = end.view;
  if (end.intermission) await api('POST', '/api/studio/intermission');
  blocks++;
}
const tomorrow = await sheetsReady(view.day);
report.push(`- episode played in ${secs(T0)} (${blocks} blocks, ${scenes.length} rendered scenes)`);
report.push(`- tomorrow's sheets ready when episode 2 began: **${tomorrow}/${total}** (queue: ${JSON.stringify(queue.pending())})`);
report.push('', '| scene | time | LLM lines |', '|---|---|---|', ...scenes.map((s) => `| ${s.title} | ${(s.ms / 1000).toFixed(1)} s | ${s.llm}/${s.lines} |`));
const llmShare = scenes.reduce((a, s) => a + s.llm, 0) / Math.max(1, scenes.reduce((a, s) => a + s.lines, 0));
report.push('', `LLM share of lines: ${(llmShare * 100).toFixed(0)}%. Median scene: ${(scenes.map((s) => s.ms).sort((a, b) => a - b)[scenes.length >> 1] / 1000 || 0).toFixed(1)} s.`);
mkdirSync(config.logsDir, { recursive: true });
const out = resolve(config.logsDir, `real-episode-${Date.now()}.md`);
writeFileSync(out, report.join('\n') + '\n');
console.log(report.join('\n'));
console.log(`\nreport: ${out}`);
await app.close();
process.exit(0);
