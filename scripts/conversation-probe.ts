// Run: npx tsx scripts/conversation-probe.ts --label=before gemma4:12b [terrace-stheno:8b-q4]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGame, eventTemplate, makeEvent, voiceCheck, type Beat } from '@shared-roof/shared';
import { config } from '../apps/server/src/config';
import { samplerFor } from '../apps/server/src/llm/ollama';
import { linesPrompt, parseLines } from '../apps/server/src/prompts/scene';
import { contentCheck } from '../apps/server/src/game/personas';

const args = process.argv.slice(2);
const label = args.find(a => a.startsWith('--label='))?.slice(8) ?? 'current';
const models = args.filter(a => !a.startsWith('--'));
if (!models.length) models.push(config.ollamaModelLines);
const fixtures = [
  {
    id: 'kai-coffee', speakers: ['kaito'],
    transcript: [
      { speaker: 'kaito', text: "Yo! You're actually out here? This morning grind is wild, bro." },
      { speaker: 'kaito', text: "Let's go, man! This is gonna be epic for the vlog!" },
    ],
    words: [
      "Why do you need a vlog if we're already filmed for the show? Just wanted to ask if anyone wants coffee. I need my morning smoke by the pool.",
      "One sugar? I'm making mine strong. You can leave your phone inside for five minutes.",
    ],
  },
  {
    id: 'ren-disagreement', speakers: ['ren'], transcript: [],
    words: ["I burned the toast. Please tell me you're better at breakfast than I am.", "You don't have to fix it for me. I was just complaining."],
  },
  {
    id: 'group-coffee', speakers: ['mio', 'sora'], transcript: [],
    words: ["Anyone want coffee before I go sit outside?", "Two coffees then. Who's carrying them? I've only got two hands."],
  },
];
const reports = [];
for (const model of models) {
  const samples = [];
  for (const [fi, fixture] of fixtures.entries()) {
    const s = createGame({ seed: 20 });
    const ev = makeEvent(s, eventTemplate('backyard-talk'), { a: fixture.speakers[0], b: s.playerId }, 'backyard', {
      participants: [s.playerId, ...fixture.speakers],
      premise: 'The housemates are having coffee by the pool on their first morning. They are just getting to know each other.',
    });
    const transcript = [...fixture.transcript];
    for (const [turn, words] of fixture.words.entries()) {
      transcript.push({ speaker: s.playerId, text: words });
      const beats: Beat[] = fixture.speakers.map(speaker => ({ speaker, intent: 'answer the player', emotion: 'neutral', beatType: 'smalltalk', subtext: '', depth: 'smalltalk', topic: 'morning routine' }));
      const prompt = linesPrompt(s, ev, beats, transcript, beats.map(() => undefined), words);
      const options = { ...samplerFor(model), seed: 20 + fi * 2 + turn, temperature: /stheno/i.test(model) ? 1.15 : config.temps.lines, num_predict: 160 * beats.length, num_ctx: 8192, use_mmap: true };
      const start = Date.now();
      const response = await fetch(`${config.ollamaUrl}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.llmTimeoutMs),
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, think: false, keep_alive: '30m', options }),
      });
      if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
      const data = await response.json() as { message?: { content?: string }; error?: string };
      if (data.error) throw new Error(data.error);
      const raw = data.message?.content ?? '';
      const lines = parseLines(raw, beats);
      samples.push({ fixture: fixture.id, turn, words, options, prompt, raw, elapsedMs: Date.now() - start, lines, checks: lines.map((line, i) => line ? { content: contentCheck(line), voice: voiceCheck(line, s.characters[beats[i].speaker].persona.speech) } : null) });
      lines.forEach((text, i) => { if (text) transcript.push({ speaker: beats[i].speaker, text }); });
      console.log(JSON.stringify({ model, fixture: fixture.id, turn, raw, elapsedMs: Date.now() - start }));
    }
  }
  reports.push({ model, samples });
}
mkdirSync(config.logsDir, { recursive: true });
const path = resolve(config.logsDir, `conversation-probe-${label.replace(/[^a-z0-9-]/gi, '')}-${Date.now()}.json`);
writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), label, reports, caveat: 'Six fixed turns per model; raw output without production fallback. Mechanical checks do not measure naturalness. Read all outputs before choosing a model.' }, null, 2));
console.log(`Report: ${path}`);
