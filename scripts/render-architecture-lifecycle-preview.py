"""Rasterize output/architecture-lifecycle-preview.json into docs/architecture-lifecycle/*.png."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

rows = json.loads(Path('output/architecture-lifecycle-preview.json').read_text())
SIZE = 280


def raster(panel):
    pixels = np.full((SIZE, SIZE, 3), 238, dtype=np.uint8)
    depth = np.full((SIZE, SIZE), np.inf)
    for s in panel['shapes']:
        xy = np.array(s['xy']).reshape(3, 2)
        zz = np.array(s['depths'])
        x0, y0 = np.maximum(0, np.floor(xy.min(axis=0)).astype(int))
        x1, y1 = np.minimum(SIZE - 1, np.ceil(xy.max(axis=0)).astype(int))
        if x1 < x0 or y1 < y0:
            continue
        den = (xy[1, 1] - xy[2, 1]) * (xy[0, 0] - xy[2, 0]) + (xy[2, 0] - xy[1, 0]) * (xy[0, 1] - xy[2, 1])
        if abs(den) < 1e-9:
            continue
        xx, yy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        a = ((xy[1, 1] - xy[2, 1]) * (xx - xy[2, 0]) + (xy[2, 0] - xy[1, 0]) * (yy - xy[2, 1])) / den
        b = ((xy[2, 1] - xy[0, 1]) * (xx - xy[2, 0]) + (xy[0, 0] - xy[2, 0]) * (yy - xy[2, 1])) / den
        c = 1 - a - b
        z = a * zz[0] + b * zz[1] + c * zz[2]
        old = depth[y0:y1 + 1, x0:x1 + 1]
        mask = (a >= -1e-7) & (b >= -1e-7) & (c >= -1e-7) & (z < old)
        old[mask] = z[mask]
        color = [int(v) for v in s['color'][4:-1].split(',')]
        pixels[y0:y1 + 1, x0:x1 + 1][mask] = color
    img = Image.fromarray(pixels)
    draw = ImageDraw.Draw(img)
    draw.text((6, SIZE - 30), panel['label'][:44], fill=(30, 30, 30))
    w, d, h = panel['extent']
    draw.text((6, SIZE - 16), f'x {w:.2f}  height {d:.2f}  z {h:.2f}', fill=(30, 30, 30))
    return img


out = Path('docs/architecture-lifecycle')
out.mkdir(parents=True, exist_ok=True)
for pair in range(0, len(rows), 2):
    group = rows[pair:pair + 2]
    cols = max(len(r['panels']) for r in group)
    sheet = Image.new('RGB', (cols * SIZE, len(group) * (SIZE + 22)), '#ffffff')
    draw = ImageDraw.Draw(sheet)
    for r, row in enumerate(group):
        top = r * (SIZE + 22)
        draw.text((6, top + 4), row['title'], fill=(0, 0, 0))
        for i, panel in enumerate(row['panels']):
            sheet.paste(raster(panel), (i * SIZE, top + 22))
    name = ['condition', 'housing-upgrades', 'manufacturing-upgrades', 'pathways'][pair // 2]
    sheet.save(out / f'{name}-before-after.png')
    print('wrote', out / f'{name}-before-after.png')
