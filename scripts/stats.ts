// Tuning stats across seeds: `npx tsx scripts/stats.ts [n] [idle|active]`
import { activePolicy, idlePolicy, simulateSeason, type GameState } from '@shared-roof/shared';

const n = Number(process.argv[2] ?? 30);
const mode = process.argv[3] ?? 'idle';
let mutual = 0, couples = 0, departures = 0, arrivals = 0, gossip = 0, confess = 0, rejected = 0;
let maxRomSum = 0;
const t0 = Date.now();
for (let seed = 1; seed <= n; seed++) {
  let found = false;
  let maxRom = 0;
  const check = (s: GameState) => {
    const ids = Object.values(s.characters).filter((c) => c.status === 'inHouse' && !c.isPlayer).map((c) => c.id);
    for (const a of ids) for (const b of ids) {
      if (a >= b) continue;
      const r1 = s.rel[a][b].romance, r2 = s.rel[b][a].romance;
      maxRom = Math.max(maxRom, Math.min(r1, r2));
      if (r1 > 60 && r2 > 60) found = true;
    }
  };
  const r = simulateSeason({ seed, policy: mode === 'active' ? activePolicy(seed) : idlePolicy, hooks: { onSlotEnd: check } });
  if (found) mutual++;
  maxRomSum += maxRom;
  couples += r.state.couples.length;
  departures += Object.values(r.state.characters).filter((c) => c.status === 'left').length;
  arrivals += Object.values(r.state.characters).filter((c) => c.arrivedEp > 1).length;
  gossip += r.state.log.filter((l) => l.kind === 'gossip').length;
  confess += r.state.budgets.confessions;
  rejected += r.state.log.filter((l) => l.kind === 'confession').length;
}
console.log({ n, mode, mutualFrac: mutual / n, avgMaxMutualRom: maxRomSum / n, couples: couples / n, departures: departures / n, arrivals: arrivals / n, gossip: gossip / n, confess: confess / n, rejected: rejected / n, ms: Date.now() - t0 });
