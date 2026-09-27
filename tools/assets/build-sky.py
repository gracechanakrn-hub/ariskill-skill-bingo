"""Pack the cinematic sky layers for the apps: sky as JPEG, the three alpha layers as WebP.
    python3 tools/assets/build-sky.py [--stage]
  default: the portrait mobile set (D-41) -> apps/employee-mobile/art/sky*.{jpg,webp}
  --stage: the landscape set rendered with --prefix stage- (D-47) -> apps/stage-dashboard/art/sky*.{jpg,webp}
"""
import sys
import os
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STAGE = '--stage' in sys.argv
SRC = os.path.join(ROOT, 'assets-src/generated/mobile-sky')
OUT = os.path.join(ROOT, 'apps/stage-dashboard/art' if STAGE else 'apps/employee-mobile/art')
PRE = 'stage-' if STAGE else ''
os.makedirs(OUT, exist_ok=True)
# phone set is downscaled to 720 px wide (soft nebula / aurora, no visible loss; D-49 web budget)
def fit(im):
    return im if STAGE else im.resize((720, round(720 * im.height / im.width)), Image.LANCZOS)
fit(Image.open(os.path.join(SRC, f'{PRE}sky.png')).convert('RGB')).save(os.path.join(OUT, 'sky.jpg'), 'JPEG', quality=76, optimize=True, progressive=True)
for n in ('aurora', 'meteors', 'ground'):
    fit(Image.open(os.path.join(SRC, f'{PRE}{n}.png')).convert('RGBA')).save(os.path.join(OUT, f'sky-{n}.webp'), 'WEBP', quality=72, method=6)
for n in ('sky.jpg', 'sky-aurora.webp', 'sky-meteors.webp', 'sky-ground.webp'):
    print(n, os.path.getsize(os.path.join(OUT, n)))
