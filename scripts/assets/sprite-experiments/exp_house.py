"""Experiment: restyle the procedural house layout render (keeps geometry) with Qwen 2511 edit and Klein 4B edit.

usage: python exp_house.py <layout.png> <tag>
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))  # embedded python ignores the script dir
from PIL import Image
from exp import n, upload, run, OUT

PROMPT = ('Repaint this top-down video game house interior map as polished handheld RPG pixel art, like a Game Boy Advance '
          'Zelda Minish Cap interior: warm saturated colours, golden wooden plank floors, thick dark brown outlines on every '
          'object, soft drop shadows, 3/4 view walls with wainscoting, detailed furniture with highlights. Keep every room, wall, '
          'doorway, rug, table, bed, sofa, counter, plant and staircase exactly where it is, with the same size and shape. '
          'Do not add, remove or move any object; empty floor stays empty floor. Every room keeps its floor material. '
          'Top-down orthographic view, no people, no text.')


def qwen(img, seed=7, w=1344, h=768, denoise=1.0):
    return {
        'unet': n('UNETLoader', unet_name='qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype='default'),
        'clip': n('CLIPLoader', clip_name='qwen_2.5_vl_7b_fp8_scaled.safetensors', type='qwen_image', device='default'),
        'vae': n('VAELoader', vae_name='qwen_image_vae.safetensors'),
        'light': n('LoraLoaderModelOnly', model=['unet', 0], lora_name='Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors', strength_model=1),
        'ms': n('ModelSamplingAuraFlow', model=['light', 0], shift=3.1),
        'model': n('CFGNorm', model=['ms', 0], strength=1),
        'img': n('LoadImage', image=img),
        'latent': n('EmptySD3LatentImage', width=w, height=h, batch_size=1) if denoise >= 1 else n('VAEEncode', pixels=['img', 0], vae=['vae', 0]),
        'p': n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt=PROMPT, vae=['vae', 0], image1=['img', 0]),
        'neg': n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt='', vae=['vae', 0], image1=['img', 0]),
        'pm': n('FluxKontextMultiReferenceLatentMethod', conditioning=['p', 0], reference_latents_method='index_timestep_zero'),
        'nm': n('FluxKontextMultiReferenceLatentMethod', conditioning=['neg', 0], reference_latents_method='index_timestep_zero'),
        'k': n('KSampler', model=['model', 0], positive=['pm', 0], negative=['nm', 0], latent_image=['latent', 0], seed=seed, steps=8, cfg=1, sampler_name='euler', scheduler='simple', denoise=denoise),
        'out': n('VAEDecode', samples=['k', 0], vae=['vae', 0]),
        'out_save': n('SaveImage', images=['out', 0], filename_prefix='house_q'),
    }


def klein(img, seed=7, w=1344, h=768):
    return {
        'unet': n('UNETLoader', unet_name='flux-2-klein-base-4b-fp8.safetensors', weight_dtype='default'),
        'clip': n('CLIPLoader', clip_name='qwen_3_4b.safetensors', type='flux2', device='default'),
        'vae': n('VAELoader', vae_name='flux2-vae.safetensors'),
        'img': n('LoadImage', image=img),
        'refl': n('VAEEncode', pixels=['img', 0], vae=['vae', 0]),
        'p': n('CLIPTextEncode', clip=['clip', 0], text=PROMPT),
        'neg': n('CLIPTextEncode', clip=['clip', 0], text=''),
        'pr': n('ReferenceLatent', conditioning=['p', 0], latent=['refl', 0]),
        'nr': n('ReferenceLatent', conditioning=['neg', 0], latent=['refl', 0]),
        'latent': n('EmptyFlux2LatentImage', width=w, height=h, batch_size=1),
        'sched': n('Flux2Scheduler', steps=20, width=w, height=h),
        'sampler': n('KSamplerSelect', sampler_name='euler'),
        'noise': n('RandomNoise', noise_seed=seed),
        'guider': n('CFGGuider', model=['unet', 0], positive=['pr', 0], negative=['nr', 0], cfg=5),
        'k': n('SamplerCustomAdvanced', noise=['noise', 0], guider=['guider', 0], sampler=['sampler', 0], sigmas=['sched', 0], latent_image=['latent', 0]),
        'out': n('VAEDecode', samples=['k', 0], vae=['vae', 0]),
        'out_save': n('SaveImage', images=['out', 0], filename_prefix='house_k'),
    }


if __name__ == '__main__':
    src, tag = Path(sys.argv[1]), sys.argv[2]
    big = OUT / f'{tag}_layout3x.png'
    im = Image.open(src).convert('RGB')
    im.resize((im.width * 3, im.height * 3), Image.Resampling.NEAREST).save(big)
    name = upload(big)
    for d in [float(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '1').split(',')]:
        run(qwen(name, denoise=d), ['out'], f'{tag}_q{int(d * 100)}')
