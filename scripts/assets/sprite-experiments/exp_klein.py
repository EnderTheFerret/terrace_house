"""Experiment: svntax pixel_4walk LoRA on FLUX.2 Klein base 4B, portrait as reference (port of its edit workflow).

Sheet: 4x4 of 32x32 cells at 512 (4x). Rows down/left/right/up; cols 0-2 walk, col 3 extra pose.
usage: python exp_klein.py cfg_klein.json
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))  # embedded python ignores the script dir
from PIL import Image
from exp import n, upload, run, OUT

PROMPT = ('Create a pixel art spritesheet of the character in the image. The spritesheet is a 4 by 4 grid of four rows of frames - '
          'first row is 3 walking frames facing down and 1 frame both arms raised, second row is 3 walking frames facing left and 1 frame jumping left, '
          'third row is 3 walking frames facing right and 1 frame jumping right, fourth row is 3 walking frames back view facing up and 1 frame lying on floor.')


def build(portrait, extra, seed, lora_strength=1.0, cfg=5, steps=20):
    pos_ref = {'ref': n('LoadImage', image=portrait),
               'refs': n('ImageScaleToTotalPixels', image=['ref', 0], upscale_method='nearest-exact', megapixels=1, resolution_steps=1),
               'refl': n('VAEEncode', pixels=['refs', 0], vae=['vae', 0])} if portrait else {}
    wf = {
        'unet': n('UNETLoader', unet_name='flux-2-klein-base-4b-fp8.safetensors', weight_dtype='default'),
        'lora': n('LoraLoaderModelOnly', model=['unet', 0], lora_name='pixel_4walk_small_flux2_klein_base_4b_v1.safetensors', strength_model=lora_strength),
        'clip': n('CLIPLoader', clip_name='qwen_3_4b.safetensors', type='flux2', device='default'),
        'vae': n('VAELoader', vae_name='flux2-vae.safetensors'),
        **pos_ref,
        'p': n('CLIPTextEncode', clip=['clip', 0], text=PROMPT + (' ' + extra if extra else '')),
        'neg': n('CLIPTextEncode', clip=['clip', 0], text=''),
        'latent': n('EmptyFlux2LatentImage', width=512, height=512, batch_size=1),
        'sched': n('Flux2Scheduler', steps=steps, width=512, height=512),
        'sampler': n('KSamplerSelect', sampler_name='euler'),
        'noise': n('RandomNoise', noise_seed=seed),
    }
    pos, neg = ['p', 0], ['neg', 0]
    if portrait:
        wf['pr'] = n('ReferenceLatent', conditioning=pos, latent=['refl', 0])
        wf['nr'] = n('ReferenceLatent', conditioning=neg, latent=['refl', 0])
        pos, neg = ['pr', 0], ['nr', 0]
    wf['guider'] = n('CFGGuider', model=['lora', 0], positive=pos, negative=neg, cfg=cfg)
    wf['k'] = n('SamplerCustomAdvanced', noise=['noise', 0], guider=['guider', 0], sampler=['sampler', 0], sigmas=['sched', 0], latent_image=['latent', 0])
    wf['sheet'] = n('VAEDecode', samples=['k', 0], vae=['vae', 0])
    wf['sheet_save'] = n('SaveImage', images=['sheet', 0], filename_prefix='klein')
    return wf


if __name__ == '__main__':
    cfg = json.loads(Path(sys.argv[1]).read_text('utf-8-sig'))
    for c in cfg['chars']:
        portrait = upload(c['portrait']) if c.get('portrait') else None
        for seed in c['seeds']:
            tag = f"{cfg['tag']}_{c['id']}_{seed}"
            run(build(portrait, c.get('extra', ''), seed, cfg.get('lora', 1.0), cfg.get('cfg', 5)), ['sheet'], tag)
            # 4x box-down to the true 128x128 sheet, then nearest back up for viewing
            im = Image.open(OUT / f'{tag}_sheet.png').resize((128, 128), Image.Resampling.BOX).quantize(32).convert('RGB')
            im.resize((512, 512), Image.Resampling.NEAREST).save(OUT / f'{tag}_px.png')
