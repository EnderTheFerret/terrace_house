// Freeze baseline prompts before editing; compare the revised production prompt with the same seeds.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGame, eventTemplate, makeEvent, voiceCheck, type Beat } from '@shared-roof/shared';
import { config } from '../apps/server/src/config';
import { samplerFor } from '../apps/server/src/llm/ollama';
import { linesPrompt, parseLines } from '../apps/server/src/prompts/scene';
import { contentCheck } from '../apps/server/src/game/personas';
import { dialogueCheck } from '../apps/server/src/prompts/dialogue';

const phase = process.argv.includes('--baseline') ? 'baseline' : process.argv.find(a => a.startsWith('--phase='))?.slice(8) ?? 'revised';
const path = resolve(config.logsDir, 'dialogue-grounding-comparison.json');
if (process.argv.includes('--summary')) {
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { samples: { phase: string; temperature: number; lines: (string | null)[]; checks: { content: boolean; voice: { ok: boolean }; spoken?: { ok: boolean } }[] }[] };
  const names = Object.values(createGame({ seed: 20 }).characters).map(c => c.name.split(' ')[0]);
  const groups: Record<string, { turns: number; expected: number; parsed: number; accepted: number }> = {};
  for (const sample of saved.samples) {
    const group = groups[`${sample.phase} T=${sample.temperature}`] ??= { turns: 0, expected: 0, parsed: 0, accepted: 0 };
    group.turns++;
    group.expected += sample.lines.length;
    group.parsed += sample.lines.filter(Boolean).length;
    for (const [i, c] of sample.checks.entries()) if (c && sample.lines[i]) c.spoken = dialogueCheck(sample.lines[i]!, names);
    group.accepted += sample.checks.filter(c => c?.content && c.voice.ok && c.spoken?.ok).length;
  }
  writeFileSync(path, JSON.stringify(saved, null, 2));
  console.log(JSON.stringify(groups, null, 2));
  process.exit(0);
}
const fixtures = [
  { id: 'arrival-crowding', speakers: ['kaito', 'mio'], words: '"Nice to meet you too. The place is already getting crowded. There should be one guy and there won\'t be a corner in the house without some drama going on" I chuckle', history: [
    { speaker: 'hana', text: "Welcome Maya! We're so excited to have you here. Come in, come in!" },
    { speaker: 'mio', text: "Thank you... it's really nice to meet you all." },
    { speaker: 'kaito', text: 'Bro, welcome to Tel Aviv! This house is gonna be insane.' },
  ] },
  { id: 'kai-coffee', speakers: ['kaito'], words: "Why do you need a vlog if we're already filmed for the show? Just wanted to ask if anyone wants coffee.", history: [] },
  { id: 'ren-toast', speakers: ['ren'], words: "I burned the toast. Please tell me you're better at breakfast than I am.", history: [] },
  { id: 'maya-unknown-sister', speakers: ['mio'], words: "Have you met my sister before?", history: [] },
  { id: 'jaffa-plan', speakers: ['sora'], words: "Would you rather walk around Jaffa's flea market or sit by the old port?", history: [] },
  { id: 'shabbat-dinner', speakers: ['mio'], words: "Should I cook something vegetarian for Friday dinner? I don't know how you keep Shabbat or kosher.", history: [] },
];
const s = createGame({ seed: 20 });
const inputs = fixtures.map(f => {
  const ev = makeEvent(s, eventTemplate('backyard-talk'), { a: f.speakers[0], b: s.playerId }, 'backyard', {
    participants: [s.playerId, ...f.speakers],
    premise: f.id === 'arrival-crowding' ? 'Maya has just arrived at the shared house. The housemates welcome her and the player jokes about crowding.' : 'The housemates are getting to know each other at home in Tel Aviv.',
  });
  const beats: Beat[] = f.speakers.map(speaker => ({ speaker, intent: 'answer the player', emotion: 'neutral', beatType: 'smalltalk', subtext: '', depth: 'smalltalk', topic: 'getting to know each other' }));
  const transcript = [...f.history, { speaker: s.playerId, text: f.words }];
  return { ...f, beats, prompt: linesPrompt(s, ev, beats, transcript, beats.map(() => undefined), f.words) };
});
type Sample = { phase: string; fixture: string; temperature: number; seed: number; raw: string; lines: (string | null)[]; checks: unknown[]; elapsedMs: number; doneReason?: string };
type Report = { model: string; at: string; caveat: string; inputs: Record<string, typeof inputs>; samples: Sample[] };
const report: Report = phase === 'baseline' ? {
  model: config.ollamaModelLines, at: new Date().toISOString(),
  caveat: 'Six reconstructed single-turn fixtures, two seeds per temperature. No template repair. Mechanical acceptance is not semantic accuracy or naturalness. The arrival uses the screenshot transcript but not its unavailable original request.',
  inputs: {}, samples: [],
} : JSON.parse(readFileSync(path, 'utf8'));
if (report.model !== config.ollamaModelLines) throw new Error('Model changed between phases');
report.inputs[phase] = inputs;
report.samples = report.samples.filter(x => x.phase !== phase);
const check = (lines: (string | null)[], beats: Beat[]) => lines.map((line, i) => line ? {
  content: contentCheck(line), voice: voiceCheck(line, s.characters[beats[i].speaker].persona.speech),
  spoken: dialogueCheck(line, Object.values(s.characters).map(c => c.name.split(' ')[0])),
} : null);
for (const sample of report.samples) sample.checks = check(sample.lines, report.inputs[sample.phase].find(f => f.id === sample.fixture)!.beats);
mkdirSync(config.logsDir, { recursive: true });
const save = () => writeFileSync(path, JSON.stringify(report, null, 2));
save();
const temperatures = process.argv.includes('--verify') ? [0.9] : [0.9, 0.4];
const seeds = process.argv.includes('--verify') ? [41] : [41, 42];
for (const temperature of temperatures) for (const seed of seeds) for (const f of inputs) {
  const start = Date.now();
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.llmTimeoutMs),
    body: JSON.stringify({ model: report.model, messages: [{ role: 'user', content: f.prompt }], stream: false, think: false,
      keep_alive: config.ollamaKeepAlive, options: { ...samplerFor(report.model), temperature, seed, num_predict: 160 * f.beats.length, num_ctx: 8192, use_mmap: true } }),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  const data = await response.json() as { message?: { content?: string }; error?: string; done_reason?: string };
  if (data.error) throw new Error(data.error);
  const raw = data.message?.content ?? '';
  const lines = parseLines(raw, f.beats);
  report.samples.push({ phase, fixture: f.id, temperature, seed, raw, lines, checks: check(lines, f.beats), elapsedMs: Date.now() - start, doneReason: data.done_reason });
  save();
  console.log(`${phase} T=${temperature} seed=${seed} ${f.id}: ${lines.filter(Boolean).length}/${lines.length} parsed (${Date.now() - start} ms)`);
}
console.log(`Report: ${path}`);
