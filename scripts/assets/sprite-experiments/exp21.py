"""Qwen-Image 2.1 experiments. cfg: {tag, refs:[paths], steps, unet, res, chars:[{id,seed,who}], passes:[{key, prompt, refs:[ 'ref0' | passKey ]}]}"""
import json, sys, time, uuid, urllib.parse, io
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
from exp import post, get, upload, n, OUT


def build(cfg, c):
    wf = {
        'unet': n('UnetLoaderGGUF', unet_name=cfg.get('unet', 'qwen_image_2.1_turbo_Q8_0.gguf')),
        'clip': n('CLIPLoader', clip_name='qwen3vl_8b_int8_convrot.safetensors', type='qwen_image', device='default'),
        'vae': n('VAELoader', vae_name='qwen_image_2.1_vae_bf16.safetensors'),
    }
    model = 'unet'
    for i, (name, s) in enumerate(cfg.get('loras', [])):
        wf[f'lora{i}'] = n('LoraLoaderModelOnly', model=[model, 0], lora_name=name, strength_model=s)
        model = f'lora{i}'
    for i, r in enumerate(cfg['uploaded']):
        wf[f'ref{i}'] = n('LoadImage', image=r)
    for p in cfg['passes']:
        k = p['key']
        imgs = {f'images.image_{j + 1}': [r, 0] for j, r in enumerate(p['refs'])}
        wf[k + '_enc'] = n('TextEncodeQwenImage21', clip=['clip', 0], vae=['vae', 0], prompt=p['prompt'].replace('{who}', c['who']), negative_prompt='', resolution=p.get('res', cfg.get('res', 1024)), **imgs)
        lat = [k + '_enc', 2]
        if 'size' in p:
            wf[k + '_lat'] = n('EmptyLatentImage', width=p['size'][0], height=p['size'][1], batch_size=1)
            lat = [k + '_lat', 0]
        wf[k + '_k'] = n('KSampler', model=[model, 0], positive=[k + '_enc', 0], negative=[k + '_enc', 1], latent_image=lat, seed=c['seed'], steps=cfg.get('steps', 8), cfg=1, sampler_name='euler', scheduler='simple', denoise=1)
        wf[k] = n('VAEDecode', samples=[k + '_k', 0], vae=['vae', 0])
        wf[k + '_save'] = n('SaveImage', images=[k, 0], filename_prefix=f"exp21_{cfg['tag']}_{k}")
    return wf


def run(wf, keys, tag):
    pid = post('/prompt', {'prompt': wf, 'client_id': str(uuid.uuid4())})['prompt_id']
    t = time.monotonic()
    while True:
        e = json.loads(get('/history/' + pid)).get(pid)
        if e and e.get('status', {}).get('status_str') == 'error':
            raise RuntimeError(json.dumps(e['status'])[:3000])
        if e and e.get('status', {}).get('completed'):
            break
        time.sleep(2)
    print(tag, 'done in', round(time.monotonic() - t), 's', flush=True)
    for k in keys:
        im = e['outputs'][k + '_save']['images'][0]
        img = Image.open(io.BytesIO(get('/view?' + urllib.parse.urlencode(im))))
        print(' ', k, img.size, img.mode)
        img.save(OUT / f'{tag}_{k}.png')


if __name__ == '__main__':
    cfg = json.loads(Path(sys.argv[1]).read_text('utf-8-sig'))
    cfg['uploaded'] = [upload(r) for r in cfg['refs']]
    for c in cfg['chars']:
        run(build(cfg, c), [p['key'] for p in cfg['passes']], cfg['tag'] + '_' + c['id'])
