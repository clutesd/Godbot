"""Software rasterization of the actual tree/flower meshes for offline visual QA."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

panels = json.loads(Path('node_modules/.tmp/vegetation-preview.json').read_text())
scale = 2
image = Image.new('RGB', (1200 * scale, 1420 * scale), '#f2eee3')
draw = ImageDraw.Draw(image)


def text(x, y, value, size, color='#29463c'):
    font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', size * scale)
    draw.text((x * scale, y * scale), value, fill=color, font=font)


text(32, 22, 'GODBOX / a living botanical calendar', 32)
text(32, 70, 'Actual generated geometry, seasonal colors and flower instances.', 17)
for index, panel in enumerate(panels):
    x = 24 + index % 2 * 588
    y = 112 + index // 2 * 424
    draw.rounded_rectangle((x * scale, y * scale, (x + 576) * scale, (y + 408) * scale),
                           radius=16 * scale, fill='#dce1cc')
    text(x + 18, y + 14, panel['title'], 23)
    text(x + 18, y + 48, panel['description'], 14)
    for triangle in panel['triangles']:
        if any(px < 0 or px > 560 or py < 0 or py > 310
               for px, py in zip(triangle['xy'][::2], triangle['xy'][1::2])):
            continue
        points = [((px + x + 8) * scale, (py + y + 76) * scale)
                  for px, py in zip(triangle['xy'][::2], triangle['xy'][1::2])]
        draw.polygon(points, fill=triangle['color'])
text(32, 1390, 'Offline geometry QA / controlled fixture. Browser lighting, wind and shadows require a live visual pass.', 13)
image.resize((1200, 1420), Image.Resampling.LANCZOS).save('docs/vegetation-seasonal-preview.png')
print('Wrote docs/vegetation-seasonal-preview.png')
