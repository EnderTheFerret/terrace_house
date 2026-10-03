// Experiment: run the game's spriteSheetPixels on raw RGBA dumps; writes frames JSON for preview rendering.
// npx tsx slice_preview.ts <name.rgba> <w> <h> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { spriteSheetPixels } from '@shared-roof/shared';

const [file, w, h, out] = process.argv.slice(2);
writeFileSync(out, JSON.stringify(spriteSheetPixels(new Uint8ClampedArray(readFileSync(file)), Number(w), Number(h))));
