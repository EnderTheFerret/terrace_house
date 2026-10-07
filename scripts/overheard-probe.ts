// Run: npx tsx scripts/overheard-probe.ts [seed]  (needs Ollama with OLLAMA_MODEL_LINES pulled)
// Voices each background interaction type for a few pairs and prints the result; null means the game would show nothing.
import { createGame, firstName, rel } from '@shared-roof/shared';
import { config } from '../apps/server/src/config';
import { Generator } from '../apps/server/src/game/generate';
import { OllamaClient } from '../apps/server/src/llm/ollama';
import { OVERHEARD_TYPES } from '../apps/server/src/prompts/studio';

const s = createGame({ seed: Number(process.argv[2] ?? 11) });
const llm = new OllamaClient(config.ollamaUrl, config.ollamaModelLines, config.llmTimeoutMs, fetch, config.ollamaKeepAlive);
const gen = new Generator(llm, llm);
const ids = Object.values(s.characters).filter((c) => !c.isPlayer && c.status === 'inHouse').map((c) => c.id);
let failures = 0;
for (const [i, type] of OVERHEARD_TYPES.entries()) {
  const a = ids[i % ids.length];
  const b = ids[(i + 1) % ids.length];
  if (type === 'bicker') rel(s, a, b).tension = 35;
  if (type === 'flirt' || type === 'confess') { rel(s, a, b).romance = 40; rel(s, b, a).romance = 25; }
  const start = Date.now();
  const lines = await gen.overheard(s, a, b, type, 'kitchen');
  console.log(`\n[${type}] ${firstName(s, a)} → ${firstName(s, b)} (${Date.now() - start} ms)${lines ? '' : '  NULL'}`);
  for (const l of lines ?? []) console.log(`  ${firstName(s, l.speaker)}: ${l.text}`);
  if (!lines) failures++;
}
console.log(failures ? `\n${failures} unusable` : '\nall usable');
