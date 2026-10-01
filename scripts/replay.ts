// Deterministic replay of a saved game's event log: `npm run replay -- <saveId>`
// Rebuilds the state from the "new" event and every logged step, then compares it with the save.
import { stableStringify } from '@shared-roof/shared';
import { openDb, Store } from '../apps/server/src/db';
import { replayEvents } from '../apps/server/src/game/replay';

const id = Number(process.argv[2]);
const store = new Store(openDb());
if (!Number.isFinite(id)) {
  console.log('usage: npm run replay -- <saveId>\n\nsaves:');
  for (const s of store.list()) console.log(`  ${s.id}\tslot ${s.slot}\t${s.name}\t(${s.game_id}, log ${s.log_seq})`);
  process.exit(1);
}
const save = store.load(id);
if (!save) {
  console.error(`save ${id} not found`);
  process.exit(1);
}
const events = store.events(save.state.gameId, save.row.log_seq);
console.log(`replaying ${events.length} events for ${save.state.gameId} (episode ${save.state.world.episode})`);
const t = Date.now();
const replayed = replayEvents(events);
const same = stableStringify(replayed) === stableStringify(save.state);
console.log(`${same ? 'identical' : 'DIVERGED'} after ${Date.now() - t} ms — episode ${replayed.world.episode} ${replayed.world.slot}, tick ${replayed.world.tick}`);
if (!same) {
  for (const k of Object.keys(save.state) as (keyof typeof save.state)[])
    if (stableStringify(save.state[k]) !== stableStringify(replayed[k])) console.log(`  differs: ${k}`);
}
process.exit(same ? 0 : 1);
