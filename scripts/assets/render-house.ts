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
  const frames = [0, 1].map((f) => ({ name: `floor${f}_layout`, data: m.renderHouse(f).toDataURL('image/png') as string }));
  for (const [name, floor, hour, weather] of [['day', 0, 9, 'sunny'], ['night', 0, 22, 'sunny'], ['rain', 0, 14, 'rain'], ['balcony-snow', 1, 14, 'snow']] as const) {
    const c = m.renderHouse(floor), ctx = c.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    m.drawWater(ctx, floor, 1200); m.drawLighting(ctx, floor, hour, weather); m.drawWeather(ctx, floor, weather, 1200);
    frames.push({ name, data: c.toDataURL('image/png') });
  }
  return frames;
});
urls.forEach(({ name, data }) => writeFileSync(resolve(out, `${name}.png`), Buffer.from(data.split(',')[1], 'base64')));
await browser.close();
console.log('wrote', urls.length, 'floors to', out);
