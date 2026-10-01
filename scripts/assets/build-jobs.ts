// Builds the prebaked asset job list + manifest from the same request builders the server uses,
// so subject keys always match. Then run: python scripts/assets/comfy_gen.py scripts/assets/jobs.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { content, defaultCast, playerFromSetup, DEFAULT_PLAYER, type ImageRequest } from '@shared-roof/shared';
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
}

const jobs: Job[] = [];
const manifest: Record<string, string> = {};
const add = (r: ImageRequest, rel: string, pixel: number, colors: number) => {
  jobs.push({ out: `apps/web/public/assets/${rel}`, prompt: r.prompt, negative: r.negative, seed: r.seed, width: r.width, height: r.height, pixel, colors });
  manifest[r.subjectKey] = rel;
};

for (const c of [...defaultCast(), playerFromSetup(DEFAULT_PLAYER)]) add(portraitRequest(c), `portraits/${c.id}.png`, 8, 32);
for (const p of content().panel) add(avatarRequest(p.id), `panel/${p.id}.png`, 6, 32);
const slotFor = { morning: 'morning', day: 'slot1', evening: 'slot3', night: 'evening' } as const;
for (const n of content().city.nodes) {
  if (n.id === 'house') continue;
  for (const tod of ['day', 'evening'] as const) add(locationRequest(n.id, slotFor[tod], 'sunny'), `locations/${n.id}-${tod}.png`, 6, 40);
}
for (const r of content().house.rooms) for (const tod of ['morning', 'day', 'night'] as const) add(locationRequest(r.id, slotFor[tod], 'sunny'), `locations/${r.id}-${tod}.png`, 6, 40);

jobs.push({
  out: 'apps/web/public/assets/title.png',
  prompt: `${config.stylePrefix}, wide establishing shot of a white two-story share house with a rooftop terrace in a small japanese seaside town at golden hour, cherry blossom trees, the sea and a lighthouse in the distance, calm, no people, no text`,
  negative: 'text, letters, watermark, logo, people, blurry, photo, 3d render',
  seed: 777,
  width: 1216,
  height: 832,
  pixel: 6,
  colors: 40,
});

mkdirSync(resolve(ROOT, 'apps/web/public/assets'), { recursive: true });
writeFileSync(resolve(ROOT, 'scripts/assets/jobs.json'), JSON.stringify(jobs, null, 1));
writeFileSync(resolve(ROOT, 'apps/web/public/assets/manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${jobs.length} jobs, ${Object.keys(manifest).length} manifest keys`);
