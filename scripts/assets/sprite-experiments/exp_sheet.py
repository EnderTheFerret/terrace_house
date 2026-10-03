"""Experiment: restyle the B2W2 reference sheet itself into a new character (poses/layout inherited from the ref).

usage: python exp_sheet.py cfg_sheet.json
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))  # embedded python ignores the script dir
from exp import n, upload, run, HERE


def build(ref, portrait, prompt, seed, w=800, h=976, prefix='sheet', denoise=1.0):
    imgs = {'image1': ['ref', 0], **({'image2': ['portrait', 0]} if portrait else {})}
    wf = {
        'unet': n('UNETLoader', unet_name='qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype='default'),
        'clip': n('CLIPLoader', clip_name='qwen_2.5_vl_7b_fp8_scaled.safetensors', type='qwen_image', device='default'),
        'vae': n('VAELoader', vae_name='qwen_image_vae.safetensors'),
        'light': n('LoraLoaderModelOnly', model=['unet', 0], lora_name='Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors', strength_model=1),
        'ms': n('ModelSamplingAuraFlow', model=['light', 0], shift=3.1),
        'model': n('CFGNorm', model=['ms', 0], strength=1),
        'ref': n('LoadImage', image=ref),
        **({'portrait': n('LoadImage', image=portrait)} if portrait else {}),
        'latent': n('EmptySD3LatentImage', width=w, height=h, batch_size=1) if denoise >= 1 else n('VAEEncode', pixels=['ref', 0], vae=['vae', 0]),
        'p': n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt=prompt, vae=['vae', 0], **imgs),
        'neg': n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt='', vae=['vae', 0], **imgs),
        'pm': n('FluxKontextMultiReferenceLatentMethod', conditioning=['p', 0], reference_latents_method='index_timestep_zero'),
        'nm': n('FluxKontextMultiReferenceLatentMethod', conditioning=['neg', 0], reference_latents_method='index_timestep_zero'),
        'k': n('KSampler', model=['model', 0], positive=['pm', 0], negative=['nm', 0], latent_image=['latent', 0], seed=seed, steps=8, cfg=1, sampler_name='euler', scheduler='simple', denoise=denoise),
        'sheet': n('VAEDecode', samples=['k', 0], vae=['vae', 0]),
        'sheet_save': n('SaveImage', images=['sheet', 0], filename_prefix=prefix),
    }
    return wf


if __name__ == '__main__':
    cfg = json.loads(Path(sys.argv[1]).read_text('utf-8-sig'))
    ref = upload(HERE / 'ref8x.png')
    for d in cfg.get('denoise', [1.0]):
        for c in cfg['chars']:
            wf = build(ref, upload(c['portrait']) if cfg.get('portrait', True) else None, cfg['prompt'].replace('{who}', c['who']), c['seed'], denoise=d)
            run(wf, ['sheet'], f"{cfg['tag']}_{c['id']}_d{int(d * 100)}")
