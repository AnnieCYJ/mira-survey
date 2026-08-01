#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Regenerate the ENGLISH reduced survey poster.
- Input:  mira-survey-dist/mira-cover-design.png (1376x1378, English artwork)
- Output: mira-survey-dist/mira-cover-reduced-en.png
- Strategy: keep the original high-quality English typography untouched;
  only wipe the old QR image region and paste a fresh QR pointing to the
  INDEPENDENT reduced survey file (24 Q).
- QR target: mira-survey-reduced.html?lang=en
"""
from PIL import Image, ImageDraw
import qrcode, os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, 'mira-cover-design.png')
OUT  = os.path.join(HERE, 'mira-cover-reduced-en.png')
# Points to the INDEPENDENT reduced survey file (24 Q), not the full live survey.
URL  = 'https://AnnieCYJ.github.io/mira-survey/mira-survey-reduced.html?lang=en'

WHITE = (255, 255, 255)

im = Image.open(BASE).convert('RGB')
d  = ImageDraw.Draw(im)

# Wipe only the QR image region (keep original English card text on the right untouched)
d.rectangle([(745, 1082), (962, 1296)], fill=WHITE)

# Real QR pointing to the independent reduced survey (?lang=en)
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=3)
qr.add_data(URL)
qr.make(fit=True)
qimg = qr.make_image(fill_color='black', back_color='white').convert('RGB').resize((210, 210))
im.paste(qimg, (750, 1084))

im.save(OUT, 'PNG', optimize=True)
print('saved', OUT, im.size, '->', URL)
