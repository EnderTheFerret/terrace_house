"""Refit existing ComfyUI raw furniture to authored footprints, preserving proportions (no generation)."""
import json
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
from house_assets import reduce, SUBJECT, ROOT, OUT, FILL_WIDTH

raw = Path(__file__).parent / 'house/raw'
house = json.loads((ROOT / 'content/house.json').read_text('utf-8'))
for kind, w, h in sorted({(f['type'], f['w'], f['h']) for f in house['furniture']}):
    if kind not in SUBJECT or kind in {'rug', 'sofa', 'chair', 'counter', 'sink'}:
        continue
    candidates = sorted(raw.glob(f'{kind}_*x*_????????.png'))
    if not candidates:
        continue
    reduce(Image.open(candidates[0]).convert('RGB'), w, h, kind in FILL_WIDTH).save(OUT / f'{kind}_{w}x{h}.png')
print('refitted existing furniture')
