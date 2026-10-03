"""Experiment: restyle the B2W2 ref sheet one row (one direction) per pass.

Row 0 (down) is text-only; up/left passes also get the down result as identity reference.
Right row = mirrored left. usage: python exp_rows.py cfg_rows.json
"""
import io, json, sys, urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))  # embedded python ignores the script dir
from PIL import Image, ImageOps
from exp import n, upload, post, get, HERE, OUT
import exp

ROWS = ['down', 'up', 'left']


def ref_rows():
    ref = Image.open(HERE / 'ref8x.png').convert('RGBA')
    flat = Image.new('RGB', ref.size, 'white')
    flat.paste(ref, mask=ref.getchannel('A'))
    rh = ref.height // 4
    paths = []
    for i, name in enumerate(ROWS):
        row = flat.crop((0, i * rh, ref.width, (i + 1) * rh))
        canvas = Image.new('RGB', (row.width, 400), 'white')  # 800x400: less extreme aspect than 800x244
        canvas.paste(row, (0, (400 - rh) // 2))
        p = OUT / f'refrow_{name}.png'
        canvas.save(p)
        paths.append(p)
    return paths


def build(row, ident, prompt, seed, key):
    imgs = {'image1': ['row', 0], **({'image2': ['ident', 0]} if ident else {})}
    wf = {
        'unet': n('UNETLoader', unet_name='qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype='default'),
        'clip': n('CLIPLoader', clip_name='qwen_2.5_vl_7b_fp8_scaled.safetensors', type='qwen_image', device='default'),
        'vae': n('VAELoader', vae_name='qwen_image_vae.safetensors'),
        'light': n('LoraLoaderModelOnly', model=['unet', 0], lora_name='Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors', strength_model=1),
        'ms': n('ModelSamplingAuraFlow', model=['light', 0], shift=3.1),
        'model': n('CFGNorm', model=['ms', 0], strength=1),
        'row': n('LoadImage', image=row),
        **({'ident': n('LoadImage', image=ident)} if ident else {}),
        'latent': n('EmptySD3LatentImage', width=800, height=400, batch_size=1),
        'p': n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt=prompt, vae=['vae', 0], **imgs),
        'neg': n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt='', vae=['vae', 0], **imgs),
        'pm': n('FluxKontextMultiReferenceLatentMethod', conditioning=['p', 0], reference_latents_method='index_timestep_zero'),
        'nm': n('FluxKontextMultiReferenceLatentMethod', conditioning=['neg', 0], reference_latents_method='index_timestep_zero'),
        'k': n('KSampler', model=['model', 0], positive=['pm', 0], negative=['nm', 0], latent_image=['latent', 0], seed=seed, steps=8, cfg=1, sampler_name='euler', scheduler='simple', denoise=1),
        key: n('VAEDecode', samples=['k', 0], vae=['vae', 0]),
        key + '_save': n('SaveImage', images=[key, 0], filename_prefix='rows_' + key),
    }
    return wf


def run_one(wf, key, tag):
    exp.run(wf, [key], tag)  # saves OUT/{tag}_{key}.png
    return OUT / f'{tag}_{key}.png'


if __name__ == '__main__':
    cfg = json.loads(Path(sys.argv[1]).read_text('utf-8-sig'))
    rows = [upload(p) for p in ref_rows()]
    for c in cfg['chars']:
        tag = cfg['tag'] + '_' + c['id']
        outs = {}
        for i, name in enumerate(ROWS):
            ident = upload(outs['down']) if name != 'down' else None
            prompt = cfg['prompt'].replace('{who}', c['who']).replace('{dir}', cfg['dirs'][name])
            outs[name] = run_one(build(rows[i], ident, prompt, c['seed'], name), name, tag)
        ims = [Image.open(outs[k]).convert('RGB') for k in ROWS]
        ims.append(ImageOps.mirror(ims[2]))
        sheet = Image.new('RGB', (800, 1600), 'white')
        for i, im in enumerate(ims):
            sheet.paste(im, (0, i * 400))
        sheet.save(OUT / f'{tag}_rows.png')
