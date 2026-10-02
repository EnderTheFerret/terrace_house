import { writeFileSync } from 'node:fs';
import { createGame, DEFAULT_PLAYER, playerFromSetup, type Appearance } from '@shared-roof/shared';
import { spriteRequest } from '../../apps/server/src/image/requests';

const characters = Object.values(createGame({ seed: 1 }).characters);
const tests: [string, string, Appearance][] = [
  ['tamar', 'Tamar / newcomer test', { hairStyle: 'long wavy', hairColor: 'dark brown', eyeColor: 'brown', build: 'slim', outfit: 'olive utility jacket over cream shirt and rust trousers', accessory: 'gold hoop earrings', skinTone: 'brown' }],
  ['eli', 'Eli / custom player test', { hairStyle: 'short messy', hairColor: 'black', eyeColor: 'brown', build: 'lean', outfit: 'burgundy overshirt and charcoal trousers', accessory: 'thin round glasses', skinTone: 'tan' }],
  ['dana', 'Dana / replacement player test', { hairStyle: 'short cropped', hairColor: 'silver-dyed', eyeColor: 'grey', build: 'petite', outfit: 'lilac hoodie and black shorts', accessory: 'silver ear cuffs', skinTone: 'fair' }],
];
for (const [id, name, appearance] of tests) characters.push(playerFromSetup({ ...DEFAULT_PLAYER, name, appearance, portraitSeed: 2300 + characters.length }, `test-${id}`));
writeFileSync('scripts/assets/sprite-jobs.json', JSON.stringify(characters.map(c => ({ id: c.id, name: c.name, request: spriteRequest(c) })), null, 2));
console.log(`Prepared ${characters.length} sprite tests using the runtime request builder.`);
