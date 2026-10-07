"""Bake the house furniture sprites with ComfyUI (Qwen-Image 2.1 turbo), one image per (type, footprint) in house.json.

Each piece is drawn alone on white, keyed out, cropped and reduced to 32 px per tile (the characters' pixel density),
then saved to apps/web/public/assets/house/<type>_<w>x<h>.png. The house falls back to procedural art for anything
missing. Run with ComfyUI's embedded python:  python scripts/assets/house_assets.py [type ...] [--force]
"""
import io, json, sys, time, uuid, urllib.parse, urllib.request, hashlib
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/assets/house'
COMFY = 'http://127.0.0.1:8188'
PX = 32  # pixels per tile in the baked sprite

STYLE = ('Handheld Game Boy Advance RPG style like Zelda Minish Cap: bold dark brown outline, flat cel shading with crisp highlights. '
         'Palette of a sleek Tokyo share house (Terrace House 2019): natural light oak, warm white, cream, sage, muted mustard, soft grey fabric. '
         'Lived-in, slightly imperfect details. The object fills the whole image. Plain white background, no floor, no shadow, no text.')
# what each furniture type is, as the camera sees it (top-down 3/4 view, north wall at the top).
# Not listed = procedural only (stairs: the model draws them isometric; door, railing, void: they are drawn by the renderer).
SUBJECT = {
    'bath': 'a deep white bathtub filled with light blue water, a folded towel on the rim',
    'bed': 'a single bed with a light oak frame, rumpled white linen duvet, a grey knitted throw folded at the foot and a white pillow at the top',
    'bench': 'a long light oak slatted bench with a folded blanket on it',
    'bookshelf': 'a low light oak bookshelf full of books, vinyl records, a small cactus and a framed photo on top',
    'chair': 'a mid-century light oak dining chair with a woven seat',
    'counter': 'a kitchen counter with a light oak top over matte white cabinets, a chopping board, a kettle and a jar of utensils on top',
    'desk': 'a small light oak desk with an open laptop, a desk lamp and a coffee mug',
    'diningtable': 'a long natural oak dining table with mismatched mugs, a bowl of fruit, a vase of flowers and a few plates',
    'fridge': 'a tall white refrigerator covered in photos, notes and colourful magnets',
    'lowtable': 'a low light oak coffee table with a stack of magazines, a mug and a small air plant',
    'plant': 'a leafy green houseplant in a white ceramic pot',
    'planter': 'a wooden planter box with herbs and small pink flowers',
    'rug': 'a large rectangular cream wool rug, lying flat',
    'shoerack': 'a low light oak shoe rack crowded with sneakers, sandals and boots',
    'sink': 'a kitchen sink with a steel basin, a tap and a few dishes drying, set in a light oak counter',
    'sofa': 'a long soft light grey fabric sofa seen from behind, backrest at the bottom of the image, a mustard cushion and a knitted throw on the seat',
    'stove': 'a black kitchen gas stove with two burners and a small pot on one of them',
    'table': 'a long outdoor wooden picnic table',
    'tv': 'a flat screen TV on a low light oak media console with a game console and a small plant',
    'umbrella': 'a ceramic umbrella stand with two umbrellas',
    'washbasin': 'a white washbasin with a round mirror above it, toothbrushes in a cup',
    'whiteboard': 'a whiteboard with a chore rota written in coloured markers and polaroid photos stuck around it',
    # Terrace House revamp
    'pool': 'a rectangular indoor swimming pool with clear turquoise water and a pale stone edge, a pool ladder at one end',
    'lounger': 'a white wooden sun lounger with a blue striped towel on it',
    'sheepskin': 'a large shaggy cream sheepskin rug, lying flat, soft fluffy texture, irregular natural edge',
    'pouf': 'a round knitted mustard yellow pouf',
    'floorlamp': 'a brass arc floor lamp with a white dome shade, seen from above',
    'sidetable': 'a small round light oak side table with a mug and a paperback book',
    'bigplant': 'a tall fiddle leaf fig tree in a woven seagrass basket',
    'guitar': 'an acoustic guitar leaning on a stand',
    'island': 'a kitchen island with a white marble top over light oak cabinets, a fruit bowl and a cookbook on top',
    'stool': 'a light oak bar stool with a round seat, seen from above',
    'trashbin': 'two small white recycling bins side by side',
    'floorcushions': 'two large round linen floor cushions in cream and blush pink with a folded throw blanket',
    'clothesrack': 'a clothing rail with colourful shirts and a jacket hanging on it, a tote bag at the bottom',
    'washer': 'a white front-loading washing machine with a wicker laundry basket on top',
    'weights': 'a rolled up yoga mat and a pair of dumbbells on the floor',
    'beanbag': 'a slouchy sage green beanbag chair',
    'lantern': 'a black metal lantern with a glowing candle inside',
    'coatrack': 'a wooden coat stand with jackets, a scarf and a cap hanging on it',
    'sneakers': 'two pairs of sneakers kicked off on the floor, untidy',
    'magazines': 'a small messy stack of three magazines with a vinyl record on top, a single isolated object',
    # fuller rooms
    'toilet': 'a white ceramic toilet with the lid closed, seen from above, the cistern at the top, a roll of toilet paper on a small holder beside it',
    'towelrail': 'a light oak towel ladder leaning on the wall with fluffy white and sage green towels hanging on its rungs',
    'laundrybasket': 'a round woven wicker laundry basket full of folded clothes',
    'pantry': 'a tall narrow light oak open pantry shelf stocked with glass jars of pasta and rice, spice tins, olive oil and a bag of onions',
    'vanity': 'a light oak dressing table with a round mirror on top, makeup, perfume bottles, a hairbrush and a small vase of flowers',
    'bbq': 'a black round kettle charcoal barbecue grill on three legs with tongs hanging from the side',
    'patiotable': 'a small round white metal outdoor bistro table with two glasses of iced lemonade on it',
    'patioset': 'a round teak outdoor patio table with two teak folding chairs tucked in, a jug of iced tea and two glasses on the table',
    'towelstack': 'a low wooden crate stacked with rolled blue and white striped pool towels',
}

def post(path, data):
    r = urllib.request.Request(COMFY + path, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r))


def get(path):
    return urllib.request.urlopen(COMFY + path).read()


def n(cls, **inputs):
    return {'class_type': cls, 'inputs': inputs}


def workflow(prompt, w, h, seed):
    return {
        'unet': n('UnetLoaderGGUF', unet_name='qwen_image_2.1_turbo_Q8_0.gguf'),
        'clip': n('CLIPLoader', clip_name='qwen3vl_8b_int8_convrot.safetensors', type='qwen_image', device='default'),
        'vae': n('VAELoader', vae_name='qwen_image_2.1_vae_bf16.safetensors'),
        'enc': n('TextEncodeQwenImage21', clip=['clip', 0], vae=['vae', 0], prompt=prompt, negative_prompt='', resolution=1024),
        'lat': n('EmptyLatentImage', width=w, height=h, batch_size=1),
        'k': n('KSampler', model=['unet', 0], positive=['enc', 0], negative=['enc', 1], latent_image=['lat', 0], seed=seed, steps=8, cfg=1, sampler_name='euler', scheduler='simple', denoise=1),
        'img': n('VAEDecode', samples=['k', 0], vae=['vae', 0]),
        'save': n('SaveImage', images=['img', 0], filename_prefix='house_asset'),
    }


def free_ollama():
    """The game server warms its LLM on every restart; on a 16 GB card that pushes Qwen-Image into slow offloading."""
    try:
        for m in json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/ps', timeout=3)).get('models', []):
            urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:11434/api/generate', data=json.dumps({'model': m['name'], 'keep_alive': 0}).encode(), headers={'Content-Type': 'application/json'}), timeout=10).read()
    except OSError:
        pass  # no Ollama: nothing to free


def generate(prompt, w, h, seed):
    free_ollama()
    pid = post('/prompt', {'prompt': workflow(prompt, w, h, seed), 'client_id': str(uuid.uuid4())})['prompt_id']
    while True:
        e = json.loads(get('/history/' + pid)).get(pid)
        if e and e.get('status', {}).get('status_str') == 'error':
            raise RuntimeError(json.dumps(e['status'])[:2000])
        if e and e.get('status', {}).get('completed'):
            break
        time.sleep(2)
    im = e['outputs']['save']['images'][0]
    return Image.open(io.BytesIO(get('/view?' + urllib.parse.urlencode(im)))).convert('RGB')


def canvas_size(w, h):
    """About one megapixel with the footprint's aspect, in multiples of 64 (wide pieces get a little extra room)."""
    a = w / h
    W = (1024 * a ** 0.5) // 64 * 64
    H = (1024 / a ** 0.5) // 64 * 64
    return int(min(1792, max(256, W))), int(min(1792, max(256, H)))


def key_out(im):
    """RGBA with border-connected near-white removed (white objects inside an outline survive)."""
    w, h = im.size
    px = im.load()
    bg = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        q.extend([(x, 0), (x, h - 1)])
    for y in range(h):
        q.extend([(0, y), (w - 1, y)])
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or bg[y][x] or min(px[x, y]) < 205:  # catches the grey halo too
            continue
        bg[y][x] = True
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    out = im.convert('RGBA')
    o = out.load()
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                o[x, y] = (0, 0, 0, 0)
    return out


def drop_specks(rgba):
    """Clear opaque islands under 2% of the biggest one (sparkles, stray marks the model scatters around)."""
    w, h = rgba.size
    a = rgba.getchannel('A').load()
    seen, blobs = set(), []
    for sy in range(h):
        for sx in range(w):
            if a[sx, sy] == 0 or (sx, sy) in seen:
                continue
            blob, q = [], deque([(sx, sy)])
            seen.add((sx, sy))
            while q:
                x, y = q.popleft()
                blob.append((x, y))
                for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= n[0] < w and 0 <= n[1] < h and n not in seen and a[n] != 0:
                        seen.add(n)
                        q.append(n)
            blobs.append(blob)
    big = max((len(b) for b in blobs), default=0)
    px = rgba.load()
    for b in blobs:
        if len(b) < big * 0.02:
            for p in b:
                px[p] = (0, 0, 0, 0)
    return rgba


# runs of furniture that should meet the next piece or the wall: allowed to stretch sideways to fill their footprint
FILL_WIDTH = {'counter', 'island', 'sofa', 'bench', 'shoerack', 'bookshelf', 'tv', 'stove', 'whiteboard', 'lowtable'}


def reduce(im, w, h, fill=False):
    """Crop to the object and fit it into w x h tiles at PX px/tile, bottom-centred; hard alpha, small palette."""
    rgba = drop_specks(key_out(im))
    box = rgba.getbbox()
    if not box:
        raise ValueError('empty asset')
    obj = rgba.crop(box)
    tw, th = w * PX, h * PX
    s = min(tw / obj.width, th / obj.height)
    sx = min(tw / obj.width, s * 1.5) if fill else s  # ponytail: plain stretch, capped so pieces don't look smeared
    small = obj.resize((max(1, round(obj.width * sx)), max(1, round(obj.height * s))), Image.Resampling.BOX)
    alpha = small.getchannel('A').point(lambda a: 255 if a >= 128 else 0)
    rgb = small.convert('RGB').quantize(32, method=Image.Quantize.MEDIANCUT).convert('RGB')
    small = Image.merge('RGBA', (*rgb.split(), alpha))
    out = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    out.paste(small, ((tw - small.width) // 2, th - small.height))
    return out


if __name__ == '__main__':
    force = '--force' in sys.argv
    only = {a for a in sys.argv[1:] if not a.startswith('--')}
    house = json.loads((ROOT / 'content/house.json').read_text('utf-8-sig'))
    sizes = sorted({(f['type'], f.get('w', 1), f.get('h', 1)) for f in house['furniture'] if f['type'] in SUBJECT})
    RAW = Path(__file__).parent / 'house/raw'  # full-size generations, reused so re-reducing costs no GPU time
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    for t, w, h in sizes:
        if only and t not in only:
            continue
        prompt = f'A single pixel art game asset: {SUBJECT[t]}, seen from above in top-down 3/4 RPG view. {STYLE}'
        dest, raw_path = OUT / f'{t}_{w}x{h}.png', RAW / f'{t}_{w}x{h}_{hashlib.sha256(prompt.encode()).hexdigest()[:8]}.png'  # new prompt = new bake
        t0 = time.monotonic()
        if force or not raw_path.exists():
            cw, ch = canvas_size(w, h)
            generate(prompt, cw, ch, int(hashlib.sha256(t.encode()).hexdigest()[:6], 16)).save(raw_path)
        reduce(Image.open(raw_path).convert('RGB'), w, h, t in FILL_WIDTH).save(dest)
        print(f'{dest.name} {round(time.monotonic() - t0)} s', flush=True)
