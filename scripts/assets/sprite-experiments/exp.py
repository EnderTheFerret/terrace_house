"""Experiment: front view from style ref, then angle-LoRA back/side views from that front."""
import io, json, sys, time, uuid, urllib.request, urllib.parse, hashlib
from pathlib import Path
from PIL import Image

COMFY = 'http://127.0.0.1:8188'
HERE = Path(__file__).parent
OUT = HERE / 'out'
OUT.mkdir(exist_ok=True)


def post(path, data):
    r = urllib.request.Request(COMFY + path, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r))


def get(path):
    return urllib.request.urlopen(COMFY + path).read()


def upload(path):
    b = uuid.uuid4().hex
    data = Path(path).read_bytes()
    name = 'exp_' + hashlib.sha256(data).hexdigest()[:12] + '.png'
    body = (f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode() + data + f'\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(COMFY + '/upload/image', data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + b})
    return json.load(urllib.request.urlopen(r))['name']


def n(cls, **inputs):
    return {'class_type': cls, 'inputs': inputs}


def build(style, front_prompt, negative, seed, views, w=768, h=960, angle_strength=0.9, prefix='exp'):
    wf = {
        'unet': n('UNETLoader', unet_name='qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype='default'),
        'clip': n('CLIPLoader', clip_name='qwen_2.5_vl_7b_fp8_scaled.safetensors', type='qwen_image', device='default'),
        'vae': n('VAELoader', vae_name='qwen_image_vae.safetensors'),
        'light': n('LoraLoaderModelOnly', model=['unet', 0], lora_name='Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors', strength_model=1),
        'ms': n('ModelSamplingAuraFlow', model=['light', 0], shift=3.1),
        'model': n('CFGNorm', model=['ms', 0], strength=1),
        'angle': n('LoraLoaderModelOnly', model=['light', 0], lora_name='qwen-image-edit-2511-multiple-angles-lora.safetensors', strength_model=angle_strength),
        'ams': n('ModelSamplingAuraFlow', model=['angle', 0], shift=3.1),
        'amodel': n('CFGNorm', model=['ams', 0], strength=1),
        'style': n('LoadImage', image=style),
        'stylescaled': n('ImageScaleToTotalPixels', image=['style', 0], upscale_method='nearest-exact', megapixels=1, resolution_steps=8),
        'latent': n('EmptySD3LatentImage', width=w, height=h, batch_size=1),
    }

    def sample(key, model, prompt, neg, image, s):
        wf[key + '_p'] = n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt=prompt, vae=['vae', 0], image1=image)
        wf[key + '_n'] = n('TextEncodeQwenImageEditPlus', clip=['clip', 0], prompt=neg, vae=['vae', 0], image1=image)
        wf[key + '_pm'] = n('FluxKontextMultiReferenceLatentMethod', conditioning=[key + '_p', 0], reference_latents_method='index_timestep_zero')
        wf[key + '_nm'] = n('FluxKontextMultiReferenceLatentMethod', conditioning=[key + '_n', 0], reference_latents_method='index_timestep_zero')
        wf[key + '_k'] = n('KSampler', model=[model, 0], positive=[key + '_pm', 0], negative=[key + '_nm', 0], latent_image=['latent', 0], seed=s, steps=8, cfg=1, sampler_name='euler', scheduler='simple', denoise=1)
        wf[key] = n('VAEDecode', samples=[key + '_k', 0], vae=['vae', 0])
        wf[key + '_save'] = n('SaveImage', images=[key, 0], filename_prefix=f'{prefix}_{key}')

    sample('front', 'model', front_prompt, negative, ['stylescaled', 0], seed)
    for key, p in views.items():
        p, src, m = ([p] if isinstance(p, str) else p) + ['front', 'amodel'][len([p] if isinstance(p, str) else p) - 1:]
        sample(key, m, p, '', [src, 0], seed)
    return wf


def run(wf, keys, tag):
    pid = post('/prompt', {'prompt': wf, 'client_id': str(uuid.uuid4())})['prompt_id']
    t = time.monotonic()
    while True:
        e = json.loads(get('/history/' + pid)).get(pid)
        if e and e.get('status', {}).get('completed') is not None or (e and e.get('status', {}).get('status_str') == 'error'):
            if e['status'].get('status_str') == 'error':
                raise RuntimeError(json.dumps(e['status'])[:2000])
            break
        time.sleep(2)
    print(tag, 'done in', round(time.monotonic() - t), 's')
    ims = []
    for k in keys:
        im = e['outputs'][k + '_save']['images'][0]
        img = Image.open(io.BytesIO(get('/view?' + urllib.parse.urlencode(im)))).convert('RGB')
        img.save(OUT / f'{tag}_{k}.png')
        ims.append(img)
    sheet = Image.new('RGB', (sum(i.width for i in ims), max(i.height for i in ims)), 'white')
    x = 0
    for i in ims:
        sheet.paste(i, (x, 0)); x += i.width
    sheet.thumbnail((1600, 600))
    sheet.save(OUT / f'{tag}_sheet.png')


if __name__ == '__main__':
    cfg = json.loads(Path(sys.argv[1]).read_text('utf-8-sig'))
    style = upload(cfg['style'])
    for c in cfg['chars']:
        wf = build(style, cfg['front'].replace('{who}', c['who']), cfg['negative'], c['seed'], cfg['views'], angle_strength=cfg.get('angle', 0.9), w=cfg.get('w', 768), h=cfg.get('h', 960))
        run(wf, ['front', *cfg['views']], cfg['tag'] + '_' + c['id'])
