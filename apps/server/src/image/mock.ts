// Mock image backend: procedurally generated pixel-art SVG placeholders (palette from character/location hash).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { freezePixels, keyColor, locationSvg, pixelsToSvg, portraitPixels, spritePixels, type ImageBackend, type ImageRequest, type ImageResult } from '@shared-roof/shared';

export function placeholderSvg(req: ImageRequest): string {
  const m = req.meta ?? {};
  if (req.kind === 'sprite' && m.appearance) {
    // same 4x4 layout as the generated sheets: rows down/left/right/up, walk frames 0-2, then standing
    const rows = (['down', 'left', 'right', 'up'] as const).map(dir => [0, 1, 2, 1].map(f => spritePixels(m.appearance!, dir, f)));
    return pixelsToSvg(rows.flatMap(row => row[0].map((_, y) => row.flatMap(frame => frame[y]))), 1);
  }
  if (req.kind === 'cutout' && m.appearance) return pixelsToSvg(portraitPixels(m.appearance, m.gender ?? 'woman', req.seed), 12);
  if ((req.kind === 'portrait' || req.kind === 'avatar') && m.appearance) {
    return pixelsToSvg(portraitPixels(m.appearance, m.gender ?? 'woman', req.seed), 12, keyColor(req.subjectKey));
  }
  const tod = m.timeOfDay ?? 'day';
  if (req.kind === 'freeze' && m.people?.length) return pixelsToSvg(freezePixels(req.subjectKey, tod, m.people), 12);
  return locationSvg(req.subjectKey, tod, m.weather ?? 'sunny');
}

export class MockImageBackend implements ImageBackend {
  readonly name = 'mock';
  constructor(private outDir: string) {
    mkdirSync(outDir, { recursive: true });
  }
  async health() {
    return true;
  }
  async generate(req: ImageRequest): Promise<ImageResult> {
    const id = createHash('sha256').update(`${req.subjectKey}|${req.seed}|${req.kind}|${JSON.stringify(req.meta ?? {})}`).digest('hex').slice(0, 24);
    const file = `ph-${id}.svg`;
    writeFileSync(resolve(this.outDir, file), placeholderSvg(req));
    return { id, path: file, mime: 'image/svg+xml', placeholder: true };
  }
}
