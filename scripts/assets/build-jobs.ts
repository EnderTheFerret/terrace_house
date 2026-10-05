// Builds the prebaked asset job list + manifest from the same request builders the server uses,
// so subject keys always match. Then run: python scripts/assets/comfy_gen.py scripts/assets/jobs.json
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { content, defaultCast, playerFromSetup, DEFAULT_PLAYER, TRIPS, type ImageRequest } from '@shared-roof/shared';
import { avatarRequest, locationRequest, portraitRequest } from '../../apps/server/src/image/requests';
import { config, ROOT } from '../../apps/server/src/config';

interface Job {
  out: string;
  prompt: string;
  negative: string;
  seed: number;
  width: number;
  height: number;
  pixel: number;
  colors: number;
  framing?: ImageRequest['framing'];
}

const jobs: Job[] = [];
const manifestPath = resolve(ROOT, 'apps/web/public/assets/manifest.json');
const manifest: Record<string, string> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const add = (r: ImageRequest, rel: string, pixel: number, colors: number) => {
  const background = r.kind === 'location';
  jobs.push({ out: `apps/web/public/assets/${rel}`, prompt: r.prompt, negative: r.negative, seed: r.seed, width: background ? 832 : r.width, height: background ? 576 : r.height, pixel: background ? 4 : pixel, colors, framing: r.framing });
  manifest[r.subjectKey] ??= rel;
};

for (const c of [...defaultCast(), playerFromSetup(DEFAULT_PLAYER)]) add(portraitRequest(c), `portraits/tel-aviv-${c.id}-knees-up-v3.png`, 8, 32);
for (const p of content().panel) add(avatarRequest(p.id), `panel/${p.id}.png`, 6, 32);
const slotFor = { morning: 'morning', day: 'slot1', evening: 'slot3', night: 'evening' } as const;
for (const n of content().city.nodes) {
  if (n.id === 'house') continue;
  for (const tod of ['day', 'evening'] as const) add(locationRequest(n.id, slotFor[tod], 'sunny'), `locations/tel-aviv-${n.id}-${tod}.png`, 6, 40);
}
// overnight-trip destinations (engine/trips.ts) are not city nodes but still need scenery
for (const id of Object.keys(TRIPS)) for (const tod of ['day', 'evening', 'night'] as const) add(locationRequest(id, slotFor[tod], 'sunny'), `locations/tel-aviv-${id}-${tod}.png`, 6, 40);
for (const r of content().house.rooms) for (const tod of ['morning', 'day', 'night'] as const) add(locationRequest(r.id, slotFor[tod], 'sunny'), `locations/tel-aviv-${r.id}-${tod}.png`, 6, 40);

jobs.push({
  out: 'apps/web/public/assets/tel-aviv-title.png',
  prompt: `${config.stylePrefix}, wide establishing shot of a white two-story Tel Aviv share house with bedroom balconies and a small backyard with string lights, Mediterranean Bauhaus neighborhood at golden hour, date palms, bougainvillea and the sea in the distance, calm, no people, no text`,
  negative: 'text, letters, watermark, logo, people, blurry, photo, 3d render',
  seed: 777,
  width: 832,
  height: 576,
  pixel: 4,
  colors: 40,
});

mkdirSync(resolve(ROOT, 'apps/web/public/assets'), { recursive: true });
writeFileSync(resolve(ROOT, 'scripts/assets/jobs.json'), JSON.stringify(jobs, null, 1));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`${jobs.length} jobs, ${Object.keys(manifest).length} manifest keys`);
