// Run: npx tsx scripts/roleplay-benchmark.ts gemma4:12b [candidate-name ...]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { content, createGame, makeEvent, mockBeatSheet, mulberry32, voiceCheck, voiceDistanceMatrix } from '@shared-roof/shared';
import { config } from '../apps/server/src/config';
import { linesPrompt, parseLines } from '../apps/server/src/prompts/scene';
import { contentCheck } from '../apps/server/src/game/personas';

const args = process.argv.slice(2);
const replyOnly = args.includes('--reply-only');
const models = args.filter(arg => !arg.startsWith('--'));
const keepAlive = args.find(arg => arg.startsWith('--keep-alive='))?.slice('--keep-alive='.length) ?? '0';
if (!/^-?\d+$|^\d+[smh]$/.test(keepAlive)) throw new Error('Use --keep-alive=0 or a duration such as 30m');
if (!models.length) models.push(config.ollamaModel, ...new Set([config.ollamaModelLines].filter(m => m !== config.ollamaModel)));
const tags = await fetch(`${config.ollamaUrl}/api/tags`).then(r => r.json()) as { models: { name: string }[] };
const s = createGame({ seed: 20 });
const ids = Object.values(s.characters).filter(c => !c.isPlayer).map(c => c.id);
const templates = content().events.filter(t => Object.keys(t.roles).length === 2 && !Object.values(t.roles).some(r => r.outsider)).slice(0, 20);
if (templates.length < 20) throw new Error('Need 20 two-person templates');
const vram = (): number | null => {
  try {
    const rows = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/);
    return Math.max(...rows.map(Number));
  } catch { return null; }
};
const comfyAvailable = await fetch(`${config.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(2500) }).then(r => r.ok).catch(() => false);
const memorySnapshot = async () => ({
  at: new Date().toISOString(), deviceVramMiB: vram(),
  ollama: await fetch(`${config.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(2500) }).then(r => r.json()).catch(() => null),
  comfy: await fetch(`${config.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(2500) }).then(r => r.json()).catch(() => null),
  comfyLogs: await fetch(`${config.comfyUrl}/internal/logs`, { signal: AbortSignal.timeout(2500) }).then(r => r.json()).catch(() => null),
});
const reports = [];
for (const model of [...new Set(models)]) {
  if (!tags.models.some(m => m.name === model || m.name === `${model}:latest`)) {
    console.log(`${model}: unavailable; pull/import it before evaluating`);
    reports.push({ model, unavailable: true });
    continue;
  }
  const samples: Record<string, { lines: string[]; fillers: string[] }> = {};
  let total = 0, passed = 0, unsafe = 0, missing = 0, wrongSpeaker = 0, playerLines = 0, tokens = 0, evaluationNs = 0, elapsedMs = 0;
  let peakVramMiB = vram();
  const memory = [await memorySnapshot()];
  let failure: string | undefined;
  const scenes = [];
  for (const [i, t] of templates.entries()) {
    if (replyOnly && i % 4 !== 0) continue;
    const replyTo = i % 4 === 0 ? 'No, I do not want to go on a date. Please respect that.' : undefined;
    const roles = Object.fromEntries(Object.keys(t.roles).map((r, j) => [r, replyTo && j === 1 ? s.playerId : ids[(i + j) % ids.length]]));
    const scenario = structuredClone(s);
    const ev = makeEvent(scenario, t, roles, t.location.startsWith('type:') || ['any', 'player-node'].includes(t.location) ? 'living' : t.location);
    const scripted = mockBeatSheet(scenario, mulberry32(i), ev).sheet.beats.filter(b => b.speaker !== s.playerId);
    const beats = replyOnly ? [{ ...scripted[0], intent: 'answer the player', emotion: 'neutral' as const, beatType: 'reject' as const, subtext: '', depth: ev.depthCeiling, topic: scripted[0].topic }] : scripted;
    const transcript = replyOnly ? [{ speaker: s.playerId, text: replyTo! }] : [];
    const prompt = linesPrompt(scenario, ev, beats, transcript, beats.map(() => undefined), replyTo);
    const fixture = { roles, replyTo, prompt, expectedSpeakers: beats.map(beat => beat.speaker) };
    const started = Date.now();
    const poll = setInterval(() => { const used = vram(); if (used !== null) peakVramMiB = Math.max(peakVramMiB ?? 0, used); }, 1000);
    let response: { message?: { content?: string }; eval_count?: number; eval_duration?: number; error?: string };
    try {
      const r = await fetch(`${config.ollamaUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.llmTimeoutMs), body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, think: false, keep_alive: keepAlive, options: { seed: 20 + i, temperature: config.temps.lines, num_predict: 160 * beats.length, num_ctx: 8192 } }) });
      if (!r.ok) throw new Error(`Ollama ${r.status}`);
      response = await r.json() as typeof response;
      if (response.error) throw new Error(response.error);
    } catch (error) {
      failure = (error as Error).message;
      scenes.push({ template: t.id, ...fixture, elapsedMs: Date.now() - started, error: failure });
      console.log(`${model}: failed at scene ${i + 1}: ${failure}`);
      process.exitCode = 1;
      break;
    } finally { clearInterval(poll); }
    memory.push(await memorySnapshot());
    const ms = Date.now() - started;
    elapsedMs += ms;
    tokens += response.eval_count ?? 0;
    evaluationNs += response.eval_duration ?? 0;
    const raw = response.message?.content ?? '';
    const lines = parseLines(raw, beats);
    const labels = raw.split('\n').map(row => row.match(/^\**\s*(?:\d+[.)]\s*)?([\w-]+)\**\s*(?:\([^)]*\))?\s*[:：]/)?.[1]).filter(Boolean);
    const playerLabels = new Set([s.playerId, s.characters[s.playerId].name, s.characters[s.playerId].name.split(' ')[0]].map(id => id.toLowerCase()));
    playerLines += labels.filter(id => id && playerLabels.has(id.toLowerCase())).length;
    wrongSpeaker += labels.filter(id => !beats.some(b => b.speaker === id)).length;
    for (const [j, line] of lines.entries()) {
      total++;
      if (!line) { missing++; continue; }
      const c = s.characters[beats[j].speaker];
      if (!contentCheck(line)) unsafe++;
      if (contentCheck(line) && voiceCheck(line, c.persona.speech).ok) passed++;
      (samples[c.id] ??= { lines: [], fillers: c.persona.speech.fillers }).lines.push(line);
    }
    scenes.push({ template: t.id, ...fixture, elapsedMs: ms, raw });
    console.log(`${model}: ${scenes.length}/${replyOnly ? 5 : 20} ${t.id} ${ms}ms`);
  }
  memory.push(await memorySnapshot());
  const unload = await fetch(`${config.ollamaUrl}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.llmTimeoutMs), body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 }) });
  if (!unload.ok) throw new Error(`Could not unload ${model}: Ollama ${unload.status}`);
  const afterUnload = await memorySnapshot();
  if ((afterUnload.ollama as { models?: { name: string }[] } | null)?.models?.some(m => m.name === model)) throw new Error(`${model} is still resident after unload; refusing a contaminated comparison`);
  reports.push({ model, scenes, failure, completedScenes: scenes.filter(scene => !('error' in scene)).length, total, voiceContentPassRate: passed / Math.max(1, total), unsafe, missing, wrongSpeaker, playerLines, tokensPerSecond: evaluationNs ? tokens / (evaluationNs / 1e9) : null, elapsedMs, peakVramMiB, memory, afterUnload, comfyAvailable, comfyModelsLoaded: 'not verified: ComfyUI system_stats reports allocator memory, not named model residency', voiceDistance: voiceDistanceMatrix(samples) });
}
mkdirSync(config.logsDir, { recursive: true });
const path = resolve(config.logsDir, `roleplay-benchmark-${Date.now()}.json`);
writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), seed: 20, keepAlive, mode: replyOnly ? 'single-reply' : '20-scenes', reports, caveat: 'Raw dialogue, no repair or template fallback. Device-wide VRAM includes other processes. Ollama /api/ps verifies its model residency; ComfyUI system_stats alone does not verify named image models. Mechanical voice/content checks need human review for realism, consent and knowledge correctness.' }, null, 2));
console.log(`Report: ${path}`);
if (reports.every(r => 'unavailable' in r)) process.exitCode = 1;
