"""ComfyUI sprite experiments; leaves the game's procedural sprites unchanged.

Run with ComfyUI's embedded Python: sprite_tests.py [character-id | --check].
Outputs: public/assets/sprite-tests/{references,raw,sheets}, manifest and preview.
"""
import hashlib
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comfy_gen as comfy

ROOT = Path(comfy.ROOT)
OUT = ROOT / 'apps/web/public/assets/sprite-tests/reference-style'
DIRS = ['down', 'up', 'left', 'right']
JOBS = ROOT / 'scripts/assets/sprite-jobs.json'


def upload(path):
    boundary = uuid.uuid4().hex
    name = 'roof_sprite_' + hashlib.sha256(path.read_bytes()).hexdigest()[:16] + '.png'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            'Content-Type: image/png\r\n\r\n').encode() + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(comfy.COMFY + '/upload/image', data=body,
                                 headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.load(response)
    return '/'.join(filter(None, [data.get('subfolder'), data['name']]))


def characters():
    return json.loads(JOBS.read_text())


def prompt(character):
    return character['request']['prompt']


def render(character):
    wf = json.loads((ROOT / 'workflows/sprite_edit.api.json').read_text())
    wf['12']['inputs']['image'] = upload(Path(character['request']['reference']))
    wf['17']['inputs']['image'] = upload(Path(character['request']['reference2']))
    wf['7']['inputs']['prompt'] = prompt(character)
    wf['8']['inputs']['prompt'] = character['request']['negative']
    wf['9']['inputs'].update(width=1024, height=384)
    wf['10']['inputs']['seed'] = character['request']['seed']
    wf['16']['inputs']['filename_prefix'] = 'shared_roof_sprite_tests/' + character['id']
    pid = comfy.post('/prompt', {'prompt': wf, 'client_id': str(uuid.uuid4())})['prompt_id']
    print('queued', character['id'], pid, flush=True)
    (OUT / 'raw' / (character['id'] + '.workflow.json')).write_text(json.dumps(wf, indent=2))
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        entry = json.loads(comfy.get('/history/' + pid)).get(pid, {})
        if entry.get('status', {}).get('status_str') == 'error':
            raise RuntimeError(json.dumps(entry['status']))
        images = entry.get('outputs', {}).get('16', {}).get('images')
        if images:
            query = urllib.parse.urlencode(images[0])
            image = Image.open(io.BytesIO(comfy.get('/view?' + query))).convert('RGB')
            image.save(OUT / 'raw' / (character['id'] + '.png'))
            (OUT / 'raw' / (character['id'] + '.history.json')).write_text(json.dumps({'prompt_id': pid, 'status': entry.get('status'), 'image': images[0]}, indent=2))
            return image
        time.sleep(2)
    raise TimeoutError('ComfyUI still running; recover output using saved prompt id ' + pid)


def extract(image, size=(32, 40)):
    # ponytail: white key assumes clean studio backgrounds; use segmentation if backgrounds vary.
    sheet = Image.new('RGBA', (size[0] * 4, size[1]))
    for index in range(4):
        frame = image.crop((image.width * index // 4, 0, image.width * (index + 1) // 4, image.height)).convert('RGB')
        alpha = Image.new('L', frame.size)
        alpha.putdata([255 if min(rgb) < 225 else 0 for rgb in frame.get_flattened_data()])
        for point in [(0, 0), (0, frame.height - 1), (frame.width - 1, 0), (frame.width - 1, frame.height - 1)]:
            if alpha.getpixel(point) == 0:
                ImageDraw.floodfill(alpha, point, 128)
        alpha = alpha.point(lambda value: 0 if value == 128 else 255)
        box = alpha.getbbox()
        if not box:
            raise ValueError('empty sprite column ' + str(index))
        frame.putalpha(alpha)
        frame = frame.crop(box)
        frame.thumbnail((size[0] - 4, size[1] - 4), Image.Resampling.BOX)
        rgb = frame.convert('RGB').quantize(colors=32, dither=Image.Dither.NONE).convert('RGBA')
        rgb.putalpha(frame.getchannel('A').point(lambda value: 255 if value >= 128 else 0))
        sheet.paste(rgb, (index * size[0] + (size[0] - rgb.width) // 2, size[1] - 2 - rgb.height))
    # Matches spritePixels: draw the left profile once and mirror it for right.
    left = sheet.crop((size[0] * 2, 0, size[0] * 3, size[1]))
    sheet.paste(left.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (size[0] * 3, 0))
    return sheet


def preview(entries):
    canvas = Image.new('RGB', (960, 120 + len(entries) * 215), '#fffaf3')
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 19)
    small = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 15)
    draw.text((24, 20), 'COMFYUI SPRITE TESTS / Qwen-Image-Edit 2511 + Lightning 8 steps', fill='#3a2e3f', font=font)
    draw.text((24, 53), '32 x 40 detailed candidates (4x) | 16 x 20 game-size check (4x)', fill='#6b5d70', font=small)
    draw.text((24, 78), 'Directions: down / up / left / right. Idle only; review before game integration.', fill='#6b5d70', font=small)
    for index, entry in enumerate(entries):
        y = 120 + index * 215
        draw.rounded_rectangle((16, y, 944, y + 202), radius=5, fill='#efe9df', outline='#c8bbc5')
        draw.text((30, y + 10), entry['name'], fill='#3a2e3f', font=font)
        for filename, x, scale in [(entry['sheet'], 30, 4), (entry['gameSizeSheet'], 650, 4)]:
            im = Image.open(OUT / filename)
            im = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
            canvas.paste(im, (x, y + 38), im)
    canvas.save(OUT / 'preview.png')


def main():
    if '--check' in sys.argv:
        image = Image.new('RGB', (160, 60), 'white')
        draw = ImageDraw.Draw(image)
        for index in range(4):
            draw.rectangle((index * 40 + 12, 8, index * 40 + 27, 52), fill='black')
            draw.rectangle((index * 40 + 15, 20, index * 40 + 24, 30), fill='white')
        result = extract(image)
        assert result.size == (128, 40)
        for index in range(4):
            box = result.crop((index * 32, 0, (index + 1) * 32, 40)).getbbox()
            assert box and box[1] >= 2 and box[3] <= 38
            assert result.getpixel((index * 32 + 16, 18))[3] == 255, 'white clothing must remain opaque'
        assert result.crop((96, 0, 128, 40)).tobytes() == result.crop((64, 0, 96, 40)).transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes()
        print('PASS: four nonempty aligned transparent frames, no clipped edges')
        return
    for folder in ['raw', 'sheets']:
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    entries = []
    for character in characters():
        raw = OUT / 'raw' / (character['id'] + '.png')
        if any(not arg.startswith('--') for arg in sys.argv[1:]) and character['id'] not in sys.argv[1:] and not raw.exists():
            continue
        image = Image.open(raw) if raw.exists() and '--force' not in sys.argv else render(character)
        name = 'sheets/' + character['id']
        extract(image).save(OUT / (name + '-32x40.png'))
        extract(image, (16, 20)).save(OUT / (name + '-16x20.png'))
        entries.append({'id': character['id'], 'name': character['name'], 'directions': DIRS,
                        'sheet': name + '-32x40.png', 'gameSizeSheet': name + '-16x20.png',
                        'raw': 'raw/' + character['id'] + '.png', 'rightProfile': 'mirrored left, matching procedural renderer',
                        'prompt': prompt(character)})
        print('saved', character['id'], flush=True)
        (OUT / 'manifest.json').write_text(json.dumps(entries, indent=2))
        preview(entries)


if __name__ == '__main__':
    main()
