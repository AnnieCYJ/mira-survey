#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Regenerate a Chinese survey poster from the English design base.
- Input:  mira-survey-dist/mira-cover-design.png (1376x1378)
- Output: mira-survey-dist/mira-cover-reduced-zh.png
- QR target: mira-survey-reduced.html?lang=zh (the independent reduced 24-Q survey)
Uses system Chinese fonts (Songti.ttc serif, Hiragino Sans GB.ttc sans).
"""
from PIL import Image, ImageDraw, ImageFont
import qrcode, os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, 'mira-cover-design.png')
OUT  = os.path.join(HERE, 'mira-cover-reduced-zh.png')
# Points to the INDEPENDENT reduced survey file (24 Q), not the full live survey.
URL  = 'https://AnnieCYJ.github.io/mira-survey/mira-survey-reduced.html?lang=zh'

# --- Colors (sampled from base image) ---
BG_EYEBROW = (249, 245, 238)
BG_BODY    = (246, 239, 229)
CORAL      = (184, 133, 106)
INK        = (58, 47, 40)      # dark headline ink
MUTE       = (122, 105, 88)    # softer body/quote ink (estimated)
WHITE      = (255, 255, 255)
PILL_BG    = (255, 248, 238)
PILL_BD    = (231, 218, 201)

# --- Fonts ---
SONG = '/System/Library/Fonts/Supplemental/Songti.ttc'
HIRA = '/System/Library/Fonts/Supplemental/Hiragino Sans GB.ttc'

def F(path, size, idx):
    return ImageFont.truetype(path, size=size, index=idx)

serif_light = lambda s: F(SONG, s, 3)   # 衬线细
serif_bold  = lambda s: F(SONG, s, 1)   # 衬线粗（"懂你"强调）
sans_reg    = lambda s: F(HIRA, s, 0)   # 无衬线常规
sans_bold   = lambda s: F(HIRA, s, 2)   # 无衬线粗

im = Image.open(BASE).convert('RGB')
d  = ImageDraw.Draw(im)

# ===== 1) Mask English text regions =====
# Robust gradient fill: the right text column has a subtle horizontal
# gradient (left ~245, right ~253). We reconstruct it per-row by lerping
# between two clean bg samples outside the mask (x=695 gutter, x=1350
# far-right), so the fill exactly matches the surrounding at every pixel.
px = im.load()
def fill_bg(x0, y0, x1, y1):
    W, H = x1 - x0, y1 - y0
    bg = Image.new('RGB', (W, H))
    bp = bg.load()
    for y in range(H):
        L = px[695, y0 + y]
        R = px[1350, y0 + y]
        for x in range(W):
            t = x / (W - 1) if W > 1 else 0
            bp[x, y] = (
                int(L[0] * (1 - t) + R[0] * t + 0.5),
                int(L[1] * (1 - t) + R[1] * t + 0.5),
                int(L[2] * (1 - t) + R[2] * t + 0.5),
            )
    im.paste(bg, (x0, y0))

fill_bg(720,  30, 1330, 108)   # eyebrow band
fill_bg(720, 120, 1330, 365)   # headline
fill_bg(720, 375, 1330, 625)   # body paragraph
fill_bg(738, 635, 1330, 855)   # quote (keep coral bar at x=734..737)
fill_bg(720, 870, 1330, 1030)  # pills band

# QR card: wipe right text area (inside the card) with white
d.rounded_rectangle([(948, 1076), (1316, 1302)], radius=14, fill=WHITE)
# Wipe left QR area so the old QR leaves no residue under the new one
d.rectangle([(730, 1078), (952, 1302)], fill=WHITE)

# ===== 2) Redraw Chinese copy =====
# Eyebrow: short coral dash + "产品共创调研"
d.rectangle([(724, 78), (760, 81)], fill=CORAL)   # dash
d.text((776, 64), '产品共创调研', font=sans_bold(24), fill=INK)

# Headline: line1 "懂你的" (懂你 coral)  line2 "智能戒指"
# Draw with mixed color by chunks. Measure widths.
def tw(text, font):
    b = d.textbbox((0,0), text, font=font); return b[2]-b[0], b[3]-b[1]

hs = 108  # headline serif size (pt)
f_h = serif_light(hs)
f_hb= serif_bold(hs)
# line1 "懂你的": 懂(coral) 你(coral) 的(ink)
w_dong, _ = tw('懂', f_hb); w_ni,_=tw('你', f_hb); w_de,_=tw('的', f_h)
x = 730
d.text((x, 130), '懂', font=f_hb, fill=CORAL); x += w_dong
d.text((x, 130), '你', font=f_hb, fill=CORAL); x += w_ni
d.text((x, 130), '的', font=f_h,  fill=INK)
# line2 "智能戒指"
d.text((730, 255), '智能戒指', font=f_h, fill=INK)

# Body paragraph: tokenized greedy wrap to fit column width, with bold
# + coral emphasis on the brand phrases.
# Step 1: pre-split any oversized token into sub-tokens that fit MAX_W
# Step 2: greedy-pack sub-tokens into lines so no content is dropped and
# bold/coral emphasis is preserved per sub-token.
bs = 33
f_b  = sans_reg(bs)
f_bb = sans_bold(bs)
MAX_W = 600
TOKENS = [
    ('Mira 是全球首款专为女性', f_b, MUTE),
    ('周期与情绪压力', f_bb, INK),
    ('打造的 AI 智能戒指。默默感知你的身体信号，转化为温柔、', f_b, MUTE),
    ('懂你', f_bb, CORAL),
    ('的陪伴——无屏幕、无打扰。', f_b, MUTE),
]
def wof(t, fnt): return tw(t, fnt)[0]

sub_tokens = []
for t, fnt, col in TOKENS:
    if wof(t, fnt) <= MAX_W:
        sub_tokens.append((t, fnt, col))
    else:
        chunk = ''
        for ch in t:
            if wof(chunk + ch, fnt) > MAX_W and chunk:
                sub_tokens.append((chunk, fnt, col)); chunk = ch
            else:
                chunk += ch
        if chunk: sub_tokens.append((chunk, fnt, col))

lines, cur, cur_w = [], [], 0
for st, sf, sc in sub_tokens:
    w = wof(st, sf)
    if cur_w + w > MAX_W and cur:
        lines.append(cur); cur, cur_w = [], 0
    cur.append((st, sf, sc)); cur_w += w
if cur: lines.append(cur)

y = 390
for ln in lines:
    x = 730
    for t, fnt, col in ln:
        d.text((x, y), t, font=fnt, fill=col)
        x += wof(t, fnt)
    y += bs + 14

# Quote paragraph (under the preserved coral bar)
qs = 30
f_q = sans_reg(qs)
quote = '我们正在依据像你这样的真实声音打磨下一代产品。3–5 分钟告诉我们你最在意什么——这份问卷将直接进入产品决策。'
# wrap manually to fit width ~1280-745=... text width. Use simple wrap by chars.
def wrap_cjk(text, font, max_w):
    lines, cur= [], ''
    for ch in text:
        w,_ = tw(cur+ch, font)
        if w>max_w and cur:
            lines.append(cur); cur=ch
        else:
            cur+=ch
    if cur: lines.append(cur)
    return lines
qlines = wrap_cjk(quote, f_q, 600)
y = 650
for ln in qlines:
    d.text((758, y), ln, font=f_q, fill=MUTE)
    y += qs + 12

# Pills (outlined rounded rect + text)
def pill(x, y, text):
    f = sans_reg(25)
    pad_x, pad_y = 18, 10
    tw_, th_ = tw(text, f)
    w = tw_ + pad_x*2; h = 52
    d.rounded_rectangle([(x, y), (x+w, y+h)], radius=h//2, fill=PILL_BG, outline=PILL_BD, width=1)
    d.text((x+pad_x, y+ (h-th_)//2 -3), text, font=f, fill=INK)
    return x+w
# row 1
x = 740
x = pill(x, 886, '约需 3–5 分钟')
x += 12
x = pill(x, 886, '匿名收集')
# row 2
pill(740, 966, '仅用于改进产品')

# ===== 3) QR card text + real QR =====
# Real QR pointing to ?lang=zh (the reduced live survey)
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=3)
qr.add_data(URL)
qr.make(fit=True)
qimg = qr.make_image(fill_color='black', back_color='white').convert('RGB').resize((210, 210))
im.paste(qimg, (750, 1084))

# Card text (right of QR)
f_qt_big = sans_bold(30)
f_qt_sm  = sans_reg(20)
d.text((980, 1130), '扫码填写', font=f_qt_big, fill=INK)
d.text((980, 1175), '分享给朋友 · 一起被听见', font=f_qt_sm, fill=MUTE)

im.save(OUT, 'PNG', optimize=True)
print('saved', OUT, im.size)