"""Rasterize actual EnergyRenderer geometry exported by tests/energy-grid-preview.ts."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

panels = json.loads(Path('node_modules/.tmp/energy-grid-preview.json').read_text())
image = Image.new('RGB', (1240, 960), '#eee9db')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 22)
small = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 14)
draw.text((24, 12), 'GODBOX / persistent electrical infrastructure', font=font, fill='#243c37')
for i, panel in enumerate(panels):
    ox, oy = 20 + i % 2 * 610, 60 + i // 2 * 435
    draw.rounded_rectangle((ox, oy, ox + 600, oy + 425), 9, fill='#d4d8bd')
    draw.text((ox + 12, oy + 8), panel['title'], font=font, fill='#243c37')
    layer = Image.new('RGB', (580, 380), '#d4d8bd')
    painter = ImageDraw.Draw(layer)
    for shape in panel['shapes']:
        points = [(x, y) for x, y in zip(shape['xy'][::2], shape['xy'][1::2])]
        if shape['line']:
            painter.line(points, fill=shape['color'], width=1)
        else:
            painter.polygon(points, fill=shape['color'])
    image.paste(layer, (ox + 10, oy + 40))
draw.text((24, 937), 'Actual renderer geometry; controlled simulation fixture, flat ground. Close-ups use a different scale from network views.', font=small, fill='#243c37')
image.save('docs/energy-grid-review.png')
