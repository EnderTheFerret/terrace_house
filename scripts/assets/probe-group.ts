// Live check of the group freeze-frame workflow: three default housemates, one image, every face from its portrait.
// npx tsx scripts/assets/probe-group.ts   (needs ComfyUI on :8188; prints the output file)
import { resolve } from 'node:path';
import { content, createGame, makeEvent } from '@shared-roof/shared';
import { ComfyBackend } from '../../apps/server/src/image/comfy';
import { AssetLibrary } from '../../apps/server/src/image/queue';
import { freezeRequest } from '../../apps/server/src/image/requests';
import { config, ROOT } from '../../apps/server/src/config';

const s = createGame({ seed: 1 });
const ids = Object.keys(s.characters).filter((id) => !s.characters[id].isPlayer).slice(0, 3);
const ev = makeEvent(s, content().eventById.get('casual-chat')!, { a: ids[0], b: ids[1] }, 'living');
ev.participants = ids;
const assets = new AssetLibrary(config.assetsDir);
const req = freezeRequest(s, ev, (r) => assets.file(r.subjectKey));
console.log('references:', req.references?.length, '\n', req.prompt.slice(0, 400));
const comfy = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, resolve(ROOT, 'cache', 'probe'), 600_000, fetch, undefined, {
  freeze: { workflowPath: resolve(ROOT, 'workflows/group_ref.api.json'), mappingPath: resolve(ROOT, 'workflows/group_ref_mapping.json') },
});
const t = Date.now();
const out = await comfy.generate(req);
console.log('wrote', resolve(ROOT, 'cache', 'probe', out.path), `${Math.round((Date.now() - t) / 1000)} s`);
