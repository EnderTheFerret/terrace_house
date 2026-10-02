// Mock image backend: procedurally generated pixel-art SVG placeholders (palette from character/location hash).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { freezePixels, keyColor, locationSvg, pixelsToSvg, portraitPixels, spritePixels, SPRITE_DIRECTIONS, type ImageBackend, type ImageRequest, type ImageResult } from '@shared-roof/shared';

export function placeholderSvg(req: ImageRequest): string {
  const m = req.meta ?? {};
  if (req.kind === 'sprite' && m.appearance) {
    const frames = SPRITE_DIRECTIONS.map(dir => spritePixels(m.appearance!, dir, 1));
    return pixelsToSvg(frames[0].map((_, y) => frames.flatMap(frame => frame[y])), 1);
  }
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
