// Verify the actual outfit -> walk-sheet workflow against the local ComfyUI instance.
import { resolve } from 'node:path';
import { createGame, outfitFor } from '@shared-roof/shared';
import { ComfyBackend } from '../../apps/server/src/image/comfy';
import { config } from '../../apps/server/src/config';
import { outfitPortraitRequest, spriteRequest } from '../../apps/server/src/image/requests';

const out = resolve('logs/house-upgrade/swimwear');
const backend = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, out, 300_000, fetch,
  { workflowPath: resolve(config.comfyRefWorkflow), mappingPath: config.comfyRefMapping },
  { sprite: { workflowPath: resolve('workflows/sprite_edit.api.json'), mappingPath: resolve('workflows/sprite_mapping.json') } });
if (!(await backend.health())) throw new Error('ComfyUI is unavailable');
const state = createGame({ seed: 11 });
const c = Object.values(state.characters).find(c => c.gender === 'woman' && outfitFor(c, 'beach').includes('bikini'))!;
const outfit = outfitFor(c, 'beach');
console.log(`Verifying ${c.id}: ${outfit}`);
const portrait = await backend.generate(outfitPortraitRequest(c, outfit, resolve(`apps/web/public/assets/portraits/tel-aviv-${c.id}.png`)));
console.log('outfit portrait', resolve(out, portrait.path));
const sheet = await backend.generate(spriteRequest(c, resolve(out, portrait.path), outfit));
console.log('swim sheet', resolve(out, sheet.path));
