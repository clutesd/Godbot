"""Rasterize exported BuildingComposer triangles without a browser or WebGL."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

panels = json.loads(Path('node_modules/.tmp/development-preview.json').read_text())
scale = 2
img = Image.new('RGB', (1240 * scale, 1100 * scale), '#f3efe5')
draw = ImageDraw.Draw(img)


def font(size):
    for path in ['C:/Windows/Fonts/segoeui.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(path).exists():
            return ImageFont.truetype(path, size * scale)
    return ImageFont.load_default()


def text(x, y, message, size, color='#243c37'):
    draw.text((x * scale, y * scale), message, fill=color, font=font(size))


text(30, 20, 'Settlement development / 50 simulated years', 30)
text(30, 62, 'Equal populations, distinct institutions and values. Actual plot positions and generated building geometry.', 15)
for i, panel in enumerate(panels):
    ox, oy = 20 + (i % 2) * 610, 106 + (i // 2) * 480
    draw.rounded_rectangle((ox * scale, oy * scale, (ox + 600) * scale, (oy + 465) * scale), radius=12 * scale, fill='#e1e2ce')
    text(ox + 18, oy + 14, panel['title'], 23)
    text(ox + 18, oy + 46, panel['description'], 15)
    for triangle in panel['triangles']:
        points = list(zip(triangle['xy'][::2], triangle['xy'][1::2]))
        points = [((x + ox + 10) * scale, (y + oy + 40) * scale) for x, y in points]
        draw.polygon(points, fill=triangle['color'])
    names = sorted(set(p['name'] for p in panel['structures'] if p['status'] == 'active'))
    text(ox + 18, oy + 432, f"{len(panel['structures'])} persistent sites / {len(names)} distinct functions", 14)
text(30, 1075, 'Offline geometry audit; controlled development fixture, not a screenshot of the running world.', 13)
img.resize((1240, 1100), Image.Resampling.LANCZOS).save('docs/settlement-development-comparison.png')
print('Wrote docs/settlement-development-comparison.png')
