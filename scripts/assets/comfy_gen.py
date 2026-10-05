"""Batch asset generator: renders prompts through ComfyUI (workflows/txt2img.api.json +
mapping.json), then pixelates + palette-quantizes into true pixel art.

usage: python scripts/assets/comfy_gen.py jobs.json
jobs.json: [{"out": "apps/web/public/assets/portraits/ren.png", "prompt": "...",
             "negative": "...", "seed": 1, "width": 832, "height": 1216,
             "pixel": 6, "colors": 32}]
Uses only the stdlib + Pillow (ComfyUI's embedded python ships Pillow).
"""
import json, sys, time, uuid, urllib.request, urllib.parse, os, io
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
COMFY = os.environ.get('COMFY_URL', 'http://127.0.0.1:8188')
WF = json.load(open(os.path.join(ROOT, 'workflows', 'txt2img.api.json')))
MAP = json.load(open(os.path.join(ROOT, 'workflows', 'mapping.json')))


def patch(wf, key, value):
    m = MAP.get(key)
    if m and 'input' in m:
        wf[m['node']]['inputs'][m['input']] = value


def post(path, data):
    req = urllib.request.Request(COMFY + path, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))


def get(path):
    return urllib.request.urlopen(COMFY + path).read()


def free_ollama():
    """Unload the game server's warm LLM so the image model is not pushed into slow offloading on a 16 GB card."""
    try:
        for m in json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/ps', timeout=3)).get('models', []):
            urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:11434/api/generate', data=json.dumps({'model': m['name'], 'keep_alive': 0}).encode(), headers={'Content-Type': 'application/json'}), timeout=10).read()
    except OSError:
        pass


def generate(job):
    free_ollama()
    wf = json.loads(json.dumps(WF))
    patch(wf, 'positive', job['prompt'])
    patch(wf, 'negative', job.get('negative', ''))
    patch(wf, 'seed', job.get('seed', 1))
    patch(wf, 'width', job.get('width', 1024))
    patch(wf, 'height', job.get('height', 1024))
    patch(wf, 'batch', 1)
    if job.get('framing') == 'knees':
        saved = wf[MAP['output']['node']]
        width, height = job['width'], job['height']
        wf['portraitCrop'] = {'class_type': 'ImageCropV2', 'inputs': {'image': saved['inputs']['images'], 'crop_region': {'x': 0, 'y': 0, 'width': width, 'height': round(height * 0.8)}}}
        wf['portraitScale'] = {'class_type': 'ImageScale', 'inputs': {'image': ['portraitCrop', 0], 'upscale_method': 'nearest-exact', 'width': width, 'height': height, 'crop': 'center'}}
        wf['portraitRemBg'] = {'class_type': 'easy imageRemBg', 'inputs': {'images': ['portraitScale', 0], 'rem_mode': 'BEN2', 'image_output': 'Hide', 'save_prefix': 'rembg', 'torchscript_jit': False, 'add_background': 'none', 'refine_foreground': False}}
        wf['portraitSolid'] = {'class_type': 'ThresholdMask', 'inputs': {'mask': ['portraitRemBg', 1], 'value': 0.5}}
        wf['portraitContours'] = {'class_type': 'MaskToSEGS', 'inputs': {'mask': ['portraitSolid', 0], 'combined': False, 'crop_factor': 1, 'bbox_fill': False, 'drop_size': 32, 'contour_fill': True}}
        wf['portraitMask'] = {'class_type': 'SegsToCombinedMask', 'inputs': {'segs': ['portraitContours', 0]}}
        wf['portraitBackground'] = {'class_type': 'EmptyImage', 'inputs': {'width': width, 'height': height, 'batch_size': 1, 'color': 0xf4eee4}}
        wf['portraitMatte'] = {'class_type': 'ImageCompositeMasked', 'inputs': {'destination': ['portraitBackground', 0], 'source': ['portraitScale', 0], 'mask': ['portraitMask', 0], 'x': 0, 'y': 0, 'resize_source': False}}
        saved['inputs']['images'] = ['portraitMatte', 0]
    pid = post('/prompt', {'prompt': wf, 'client_id': str(uuid.uuid4())})['prompt_id']
    while True:
        h = json.loads(get('/history/' + pid))
        if pid in h and h[pid].get('outputs'):
            break
        time.sleep(1)
    imgs = h[pid]['outputs'][MAP['output']['node']]['images']
    im = imgs[0]
    q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im['subfolder'], 'type': im['type']})
    return Image.open(io.BytesIO(get('/view?' + q))).convert('RGB')


def pixelate(img, factor, colors):
    w, h = img.size
    small = img.resize((max(1, w // factor), max(1, h // factor)), Image.Resampling.BOX)
    small = small.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    return small


def main():
    jobs = json.load(open(sys.argv[1]))
    only = set(sys.argv[2:])
    for job in jobs:
        out = os.path.join(ROOT, job['out'])
        if only and not any(o in job['out'] for o in only):
            continue
        if os.path.exists(out) and not only:
            print('skip', job['out'])
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        t = time.time()
        img = generate(job)
        if job.get('raw_out'):
            img.save(os.path.join(ROOT, job['raw_out']))
        pix = pixelate(img, job.get('pixel', 6), job.get('colors', 32))
        pix.save(out, optimize=True)
        print('ok', job['out'], pix.size, f'{time.time() - t:.1f}s', flush=True)


if __name__ == '__main__':
    main()
