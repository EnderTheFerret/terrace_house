// Headless season run: `npm run sim -- [seed] [idle|active] [random]`
import { activePolicy, idlePolicy, simulateSeason, housemates } from '@shared-roof/shared';

const seed = Number(process.argv[2] ?? 1);
const mode = process.argv[3] ?? 'idle';
const randomizeCast = process.argv[4] === 'random';
const t0 = Date.now();
const r = simulateSeason({ seed, policy: mode === 'active' ? activePolicy(seed) : idlePolicy, randomizeCast });
const s = r.state;
console.log(`seed ${seed} (${mode}${randomizeCast ? ', random cast' : ''}): ${r.slots} slots, ${r.events.length} scenes, ${Date.now() - t0} ms`);
console.log('episode', s.world.episode, 'seasonOver', s.seasonOver);
console.log('couples', s.couples.map((c) => `${c.a}+${c.b}(${c.status}, ep${c.since})`).join(', ') || 'none');
console.log('left', Object.values(s.characters).filter((c) => c.status === 'left').map((c) => `${c.id}@${c.leftEp}: ${c.leftReason}`).join('; ') || 'none');
console.log('in house', housemates(s).map((c) => c.id).join(', '));
console.log('arcs', Object.entries(s.arcs).map(([k, v]) => `${k}:${v.done.length}`).join(' '));
console.log('predictions', s.predictions.map((p) => `${p.condition.kind}:${p.resolved}`).join(' '));
console.log('gossip logs', s.log.filter((l) => l.kind === 'gossip').length);
const counts: Record<string, number> = {};
for (const e of r.events) counts[e.templateId] = (counts[e.templateId] ?? 0) + 1;
console.log('templates', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
for (const e of Object.values(s.epilogues ?? {})) console.log(' -', e);
