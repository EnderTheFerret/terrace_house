"""Prototype: views -> 4x4 hi-res sheet -> 32x40-per-frame pixel sheet. usage: pix.py tag char"""
import sys
from collections import Counter
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

OUT = Path(__file__).parent / 'out'
FW, FH, CH = 32, 40, 36  # frame size, target character height


def hires_sheet(tag, c):
    v = {k: Image.open(OUT / f'{tag}_{c}_{k}.png').convert('RGB') for k in ['front', 'back', 'side', 'wfront', 'wback', 'wside', 'wside2']}
    m = ImageOps.mirror
    rows = [[v['front'], v['wfront'], v['front'], m(v['wfront'])],
            [v['back'], v['wback'], v['back'], m(v['wback'])],
            [v['side'], v['wside'], v['side'], v['wside2']]]
    rows.append([m(i) for i in rows[2]])
    w, h = v['front'].size
    sheet = Image.new('RGB', (w * 4, h * 4), 'white')
    for r, row in enumerate(rows):
        for col, im in enumerate(row):
            sheet.paste(im.resize((w, h)), (col * w, r * h))
    return sheet


def mask(cell):
    """Foreground = not border-connected near-background."""
    bg = cell.getpixel((2, 2))
    a = Image.new('L', cell.size, 255)
    px, ap = cell.load(), a.load()
    W, H = cell.size
    near = lambda p: sum(abs(p[i] - bg[i]) for i in range(3)) < 110 or min(p) >= 200
    stack = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    while stack:
        x, y = stack.pop()
        if 0 <= x < W and 0 <= y < H and ap[x, y] and near(px[x, y]):
            ap[x, y] = 0
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    # keep only the largest blob (drops background speckle)
    seen, best = set(), []
    for y0 in range(0, H, 2):
        for x0 in range(0, W, 2):
            if ap[x0, y0] and (x0, y0) not in seen:
                comp, st = [], [(x0, y0)]
                seen.add((x0, y0))
                while st:
                    x, y = st.pop(); comp.append((x, y))
                    for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= q[0] < W and 0 <= q[1] < H and ap[q] and q not in seen:
                            seen.add(q); st.append(q)
                if len(comp) > len(best): best = comp
    out = Image.new('L', cell.size, 0)
    op = out.load()
    for q in best: op[q] = 255
    return out


def pixelize(sheet, cols=4, rows=4):
    w, h = sheet.width // cols, sheet.height // rows
    out = Image.new('RGBA', (FW * cols, FH * rows))
    for r in range(rows):
        cells = [sheet.crop((c * w, r * h, (c + 1) * w, (r + 1) * h)) for c in range(cols)]
        masks = [mask(c) for c in cells]
        for c, (cell, a) in enumerate(zip(cells, masks)):
            l, t, rr, b = a.getbbox()
            s = (b - t) / (CH if c % 2 == 0 else CH - 1)  # steps bob down 1px
            hl, _, hr, _ = a.crop((0, t, w, t + int((b - t) * 0.4))).getbbox()  # head centre: strides widen the legs
            cx = (hl + hr) / 2
            cp, ap = cell.load(), a.load()
            for y in range(FH):
                for x in range(FW):
                    x0, y0 = cx + (x - FW / 2) * s, b - (FH - 2 - y) * s
                    votes = Counter()
                    total = 0
                    for yy in range(int(y0), int(y0 + s)):
                        for xx in range(int(x0), int(x0 + s)):
                            if 0 <= xx < w and 0 <= yy < h:
                                total += 1
                                if ap[xx, yy]:
                                    p = cp[xx, yy]
                                    votes[(p[0] >> 3, p[1] >> 3, p[2] >> 3)] += 1
                    if total and sum(votes.values()) * 2 > total:
                        dark = [(k, n) for k, n in votes.items() if k[0] + k[1] + k[2] < 18]
                        q = max(dark, key=lambda d: d[1])[0] if dark and sum(n for _, n in dark) * 4 >= total else votes.most_common(1)[0][0]
                        out.putpixel((c * FW + x, r * FH + y), (q[0] << 3, q[1] << 3, q[2] << 3, 255))
    alpha = out.getchannel('A')
    pal = out.convert('RGB').quantize(colors=24, dither=Image.Dither.NONE).convert('RGBA')
    pal.putalpha(alpha)
    return pal


if __name__ == '__main__':
    tag = sys.argv[1]
    previews = []
    for c in sys.argv[2:]:
        hs = hires_sheet(tag, c)
        hs.resize((hs.width // 4, hs.height // 4)).save(OUT / f'{tag}_{c}_hires.png')
        px = pixelize(hs)
        px.save(OUT / f'{tag}_{c}_px.png')
        previews.append(px.resize((px.width * 4, px.height * 4), Image.NEAREST))
    W = sum(p.width for p in previews) + 20 * len(previews)
    canvas = Image.new('RGBA', (W, previews[0].height), (232, 240, 220, 255))
    x = 0
    for p in previews:
        canvas.alpha_composite(p, (x, 0)); x += p.width + 20
    canvas.save(OUT / f'{tag}_px_preview.png')
