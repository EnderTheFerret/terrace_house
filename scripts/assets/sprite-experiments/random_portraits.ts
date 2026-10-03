// Experiment: real procedural cast -> real portrait pipeline; writes cfg_random.json for exp_klein.py.
// npx tsx scripts/assets/sprite-experiments/random_portraits.ts [seed]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileAppearanceTags, createGame } from '@shared-roof/shared';
import { config } from '../../../apps/server/src/config';
import { ComfyBackend } from '../../../apps/server/src/image/comfy';
import { portraitRequest } from '../../../apps/server/src/image/requests';

const seed = Number(process.argv[2] ?? Math.floor(Math.random() * 1e6));
const s = createGame({ seed, randomizeCast: true, gameId: `sprite-random-${seed}` });
const comfy = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, config.cacheDir, config.imageTimeoutMs);
const npcs = Object.values(s.characters).filter((c) => !c.isPlayer);
const picks = [npcs.find((c) => c.gender === 'woman'), npcs.find((c) => c.gender === 'man')].filter((c) => c !== undefined);
const chars = [];
for (const c of picks) {
  const r = await comfy.generate(portraitRequest(c));
  const who = compileAppearanceTags(c).join(', ');
  console.log(c.name, '|', who, '|', r.path);
  chars.push({ id: `${seed}_${c.id}`, seeds: [c.portraitSeed], portrait: resolve(config.cacheDir, r.path), extra: `The character is ${who}.` });
}
writeFileSync(resolve(import.meta.dirname, 'cfg_random.json'), JSON.stringify({ tag: 'rnd', chars }, null, 2));
