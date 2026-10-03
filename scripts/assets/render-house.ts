// Renders the procedural house floors (layout guide for the ComfyUI restyle) from the running Vite dev server.
// npx tsx scripts/assets/render-house.ts [out-dir]   (needs `npm run dev` on :5173)
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const out = resolve(process.argv[2] ?? 'scripts/assets/house');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage();
await page.goto('http://localhost:5173');
const urls = await page.evaluate(async () => {
  const m = await import('/src/pixel/house.ts' as string);
  await m.loadHouseAssets(); // baked ComfyUI furniture
  return [0, 1].map((f) => m.renderHouse(f).toDataURL('image/png') as string);
});
urls.forEach((u, f) => writeFileSync(resolve(out, `floor${f}_layout.png`), Buffer.from(u.split(',')[1], 'base64')));
await browser.close();
console.log('wrote', urls.length, 'floors to', out);
