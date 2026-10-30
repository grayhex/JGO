"""Export original artwork using the measured layout.json beside each source.png.

Only technical masks, crops, resizing and format conversion happen here. The handset
illustration/legends come from the immutable image-generator original, not Pillow.
All source-space coordinates (including the silhouette mask) remain reviewable.
"""
from pathlib import Path
import argparse
import json
import math
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'design/phones'
PUBLIC = ROOT / 'apps/web/public/phones'


def contour_points(segments):
    """Sample the measured cubic outline at subpixel precision for an alpha mask."""
    points = []
    current = (0, 0)
    for command in segments:
        op, *v = command
        if op in ('M', 'L'):
            current = tuple(v)
            points.append(current)
        elif op == 'C':
            start = current
            for i in range(1, 49):
                t = i / 48
                q = 1 - t
                points.append(tuple(q**3 * start[k] + 3*q*q*t*v[k] + 3*q*t*t*v[k+2] + t**3*v[k+4] for k in (0, 1)))
            current = tuple(v[4:6])
        elif op != 'Z':
            raise ValueError(op)
    return points


def export(folder):
    layout = json.loads((folder / 'layout.json').read_text())
    original = Image.open(folder / 'source.png').convert('RGBA')
    assert list(original.size) == layout['sourceSize'], folder
    image = original.copy()
    multiplier = 4
    mask = Image.new('L', (image.width * multiplier, image.height * multiplier))
    ImageDraw.Draw(mask).polygon([(round(x * multiplier), round(y * multiplier)) for x, y in contour_points(layout['outline'])], fill=255)
    mask = mask.resize(image.size, Image.Resampling.LANCZOS)
    image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    # The generator's irregular LCD hole is technical transparency, never artwork.
    # Restore its small fringe to the dark bezel, then punch the measured aperture.
    ImageDraw.Draw(image).rectangle(layout['apertureCleanup'], fill=(12, 13, 14, 255))
    sx, sy, sw, sh = layout['screenRect']
    ImageDraw.Draw(image).rectangle((sx, sy, sx + sw - 1, sy + sh - 1), fill=(0, 0, 0, 0))
    cx, cy, right, bottom = layout['crop']
    image = image.crop((cx, cy, right, bottom))
    width, height = image.size
    output_height = 2048
    output_width = round(width * output_height / height)
    output = image.resize((output_width, output_height), Image.Resampling.LANCZOS)
    resolution = layout['screen']
    divisor = math.gcd(*resolution)
    u, v = [n // divisor for n in resolution]
    units = round(min(sw * output_width / width / u, sh * output_height / height / v))
    ew, eh = units * u, units * v
    ex = round((sx - cx + sw / 2) * output_width / width - ew / 2)
    ey = round((sy - cy + sh / 2) * output_height / height - eh / 2)
    # Resampling may never leave opaque pixels on the LCD.
    ImageDraw.Draw(output).rectangle((ex, ey, ex + ew - 1, ey + eh - 1), fill=(0, 0, 0, 0))
    dest = PUBLIC / folder.name
    dest.mkdir(exist_ok=True)
    output.save(dest / 'body.png')
    output.save(dest / 'body.webp', lossless=True, method=6)
    Image.new('RGBA', output.size).save(dest / 'glass.png')
    preview = output.copy()
    preview.thumbnail((400, 600))
    preview.save(dest / 'preview.webp', lossless=True, method=6)
    zoom_height = round((layout['zoomBottom'] - cy) * output_height / height)
    assert ey + eh < zoom_height < output_height
    zoom = output.crop((0, 0, output_width, zoom_height))
    zoom.save(dest / 'zoom.png')
    zoom.save(dest / 'zoom.webp', lossless=True, method=6)
    Image.new('RGBA', zoom.size).save(dest / 'zoom-glass.png')
    buttons, mappings = [], {}
    for button in layout['buttons']:
        buttons.append({'id': button['id'], 'label': button['label'], 'polygon': [[round((x-cx)/width, 8), round((y-cy)/height, 8)] for x, y in button['polygon']]})
        mappings[button['id']] = button['action']
    rect = {'x': ex/output_width, 'y': ey/output_height, 'width': ew/output_width, 'height': eh/output_height}
    config = {
        'id': folder.name, 'manufacturer': layout['manufacturer'], 'model': layout['model'],
        'year': layout['year'], 'variant': layout['variant'], 'status': 'review-draft',
        'coordinateSystem': 'normalized-0-1',
        'screen': {'width': resolution[0], 'height': resolution[1], 'rect': rect},
        'body': {'width': output_width, 'height': output_height, 'aspectRatio': output_width/output_height,
                 'sourceWidth': original.width, 'sourceHeight': original.height, 'sourceCrop': layout['crop']},
        'input': layout['input'], 'buttons': buttons, 'keyMappings': mappings,
        'assets': {'body': 'body.webp', 'png': 'body.png', 'glass': 'glass.png', 'hitboxes': 'hitboxes.svg', 'preview': 'preview.webp'},
        'views': {
            'full': {'body': 'body.webp', 'glass': 'glass.png', 'width': output_width, 'height': output_height, 'screenRect': rect, 'controls': 'buttons'},
            'screen': {'body': 'zoom.webp', 'png': 'zoom.png', 'glass': 'zoom-glass.png', 'width': zoom.width, 'height': zoom.height,
                       'aspectRatio': zoom.width/zoom.height, 'cropInFull': {'x': 0, 'y': 0, 'width': 1, 'height': zoom.height/output_height},
                       'screenRect': {'x': ex/zoom.width, 'y': ey/zoom.height, 'width': ew/zoom.width, 'height': eh/zoom.height}, 'buttons': [], 'controls': 'external'},
        },
        'notes': ['Original generated illustration; historical/typography acceptance pending.',
                  '2048px export; native resolution and measured masks are retained in design/phones.',
                  'Zoom is the same upper shell cropped above the hardware controls; it never changes emulation.'] + layout['notes'],
    }
    (dest / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    svg = ET.Element('{http://www.w3.org/2000/svg}svg', {'viewBox': '0 0 1 1', 'preserveAspectRatio': 'none'})
    for b in buttons:
        element = ET.SubElement(svg, 'polygon', {'id': b['id'], 'points': ' '.join(f'{x},{y}' for x, y in b['polygon']), 'fill': 'transparent', 'pointer-events': 'all'})
        ET.SubElement(element, 'title').text = b['label']
    (dest / 'hitboxes.svg').write_bytes(ET.tostring(svg, encoding='utf-8') + b'\n')
    # Keep the exact technical outline alongside the source for visual review.
    path = ' '.join(str(token) for segment in layout['outline'] for token in segment)
    (folder / 'silhouette.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {original.width} {original.height}"><path fill="white" d="{path}"/></svg>\n')
    print(folder.name, original.size, '->', output.size, len(buttons), 'buttons')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', nargs='*', help='model directories with a measured layout.json; default all measured models')
    args = parser.parse_args()
    folders = [SOURCE / model for model in args.models] if args.models else sorted(p.parent for p in SOURCE.glob('*/layout.json'))
    for folder in folders:
        export(folder)
