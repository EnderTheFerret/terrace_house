// Isolated live probe; creates no save. Run only after the GPU is released:
// npx tsx scripts/generation-probe.ts --run-real
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Appearance, Character, createGame, stableStringify, type LlmClient, type LlmRequest } from '@shared-roof/shared';
import { config } from '../apps/server/src/config';
import { OllamaClient } from '../apps/server/src/llm/ollama';
import { applyCharacterSnapshot, describeAppearance, enrichCharacter } from '../apps/server/src/game/personas';
import { replayEvents } from '../apps/server/src/game/replay';

if (!process.argv.includes('--run-real')) throw new Error('Pass --run-real only after the artwork GPU batch is finished');
const opts = { seed: 811, randomizeCast: true, gameId: 'isolated-generation-probe' };
const state = createGame(opts);
const seed = Object.values(state.characters).find(c => !c.isPlayer)!;
const client = new OllamaClient(config.ollamaUrl, config.ollamaModel, config.llmTimeoutMs, fetch, 0);
if (!await client.health()) throw new Error('Configured structured model is unavailable');
const calls: { kind: string; elapsedMs: number; raw?: string; error?: string }[] = [];
const adapter: LlmClient = {
  name: client.name, health: () => client.health(), stream: req => client.stream(req),
  complete: async (req: LlmRequest) => {
    const started = Date.now();
    try {
      const raw = await client.complete(req);
      calls.push({ kind: req.kind, elapsedMs: Date.now() - started, raw });
      return raw;
    } catch (error) {
      calls.push({ kind: req.kind, elapsedMs: Date.now() - started, error: (error as Error).message });
      throw error;
    }
  },
};
const generated = await enrichCharacter(adapter, seed, Object.values(state.characters).filter(c => c.id !== seed.id));
applyCharacterSnapshot(state, generated);
const replay = replayEvents([{ seq: 1, kind: 'new', payload: opts }, { seq: 2, kind: 'generated-character', payload: { character: generated } }]);
const description = 'Straight auburn shoulder-length hair, green eyes, pale skin, slim build, light blue hoodie and round glasses. Everyday fully clothed adult.';
const appearance = await describeAppearance(adapter, description, seed.appearance);
const checks = {
  characterSchema: Character.safeParse(generated).success,
  generationApplied: generated !== seed && (generated.persona.backstory !== seed.persona.backstory || stableStringify(generated.persona.speech) !== stableStringify(seed.persona.speech)),
  identityPinned: generated.id === seed.id && generated.name === seed.name && generated.age === seed.age && generated.age >= 20,
  traitsPinned: stableStringify(generated.traits) === stableStringify(seed.traits),
  schedulePinned: stableStringify(generated.persona.routine.jobSlots) === stableStringify(seed.persona.routine.jobSlots),
  replayExact: stableStringify(replay) === stableStringify(state),
  appearanceSchema: Appearance.safeParse(appearance).success,
  appearanceChanged: stableStringify(appearance) !== stableStringify(seed.appearance),
  requestedAppearanceApplied: /auburn/i.test(appearance.hairColor) && /green/i.test(appearance.eyeColor) && /blue/i.test(appearance.outfit) && /glasses/i.test(appearance.accessory),
  allCallsCompleted: calls.length >= 2 && calls.every(call => !!call.raw && !call.error),
};
mkdirSync(config.logsDir, { recursive: true });
const path = resolve(config.logsDir, `generation-probe-${Date.now()}.json`);
writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), model: config.ollamaModel, checks, calls, seed, generated, description, appearance, caveat: 'One generated persona and one appearance description. Field-level fallbacks remain permitted; this is not a cast-quality benchmark. No game save or database was opened.' }, null, 2));
console.log(JSON.stringify({ model: config.ollamaModel, checks, path }, null, 2));
if (Object.values(checks).some(value => !value)) process.exitCode = 1;
