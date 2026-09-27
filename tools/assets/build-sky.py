"""Pack the cinematic mobile sky layers (D-41) for the app: sky as JPEG, the three alpha layers as WebP.
    python3 tools/assets/build-sky.py        (after tools/ai/blender/mobile_sky.py)
"""
import os
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets-src/generated/mobile-sky')
OUT = os.path.join(ROOT, 'apps/employee-mobile/art')
Image.open(os.path.join(SRC, 'sky.png')).convert('RGB').save(os.path.join(OUT, 'sky.jpg'), 'JPEG', quality=80, optimize=True, progressive=True)
for n in ('aurora', 'meteors', 'ground'):
    Image.open(os.path.join(SRC, f'{n}.png')).convert('RGBA').save(os.path.join(OUT, f'sky-{n}.webp'), 'WEBP', quality=78, method=6)
for n in ('sky.jpg', 'sky-aurora.webp', 'sky-meteors.webp', 'sky-ground.webp'):
    print(n, os.path.getsize(os.path.join(OUT, n)))
