#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「心率全天柱状小条」预览图（对齐 Oura 24h 心率图口径）。
Oura 结构：X 轴每 30 分钟一格刻度线，格内 6 根 5 分钟一根的小柱；
白色趋势线 = 全天平均；颜色分段 = 睡眠 / 日常 / 活动。
输出：单文件 HTML（自包含，无外部依赖），供 WorkBuddy 预览面板打开。
"""
import math
import random
from pathlib import Path

random.seed(20261010)

OUT = Path(__file__).with_name("preview.html")

# ── Mira 色板 ──────────────────────────────────────────────
INK = "#1F1D1A"
INK_SOFT = "#5C574F"
INK_FAINT = "#9C968C"
SKY = "#7EA6F8"      # 睡眠段（Oura 用蓝）
SKY_DEEP = "#4C74C9"
PURPLE = "#9D8AF0"   # 日常清醒
LIME = "#BCCB62"     # 放松 / 低强度
HONEY = "#F0C46E"    # 活动
BORDER = "rgba(31,29,26,0.09)"
GRID = "rgba(31,29,26,0.06)"

W = 340          # 详情页全宽图
H = 200
PAD_L, PAD_R, PAD_T, PAD_B = 30, 12, 16, 26
PLOT_W = W - PAD_L - PAD_R
PLOT_H = H - PAD_T - PAD_B

# ── 造一天真实感的数据：5 分钟一点，全天 288点 ────────────
def build():
    pts = []
    for i in range(288):
        h = i * 5 / 60.0
        if h < 6.9:                     # 睡眠
            base, sd, state = 54, 1.6, "sleep"
        elif h < 12:                   # 上午清醒
            base, sd, state = 71, 3.0, "awake"
        elif h < 13.2:                 # 午休/饭后
            base, sd, state = 78, 2.6, "awake"
        elif h < 17.6:                 # 下午
            base, sd, state = 74, 3.4, "awake"
            if 15.1 < h < 15.5:base, sd = 96, 4.0        # 会议
        elif h < 18.4:                 # 运动（跑步）
            base, sd, state = 104, 5.5, "active"
        elif h < 19.3:                 # 运动后回落
            base, sd, state = 88, 4.0, "active"
        else:                          # 晚间
            base, sd, state = 68, 3.2, "awake"
            if h > 22.2:
                base, sd = 61, 2.0
        v = base + random.gauss(0, sd)
        # 偶发缺口：Oura 也会有空洞，不插值
        if 10.6 < h < 11.0:
            continue
        pts.append((i * 5 / 60.0, max(44, min(132, v)), state))
    return pts

PTS = build()
vals = [v for _, v, _ in PTS]
VMIN, VMAX = 44, 132
avg = sum(vals) / len(vals)

def y_of(v):
    return PAD_T + PLOT_H * (1 - (v - VMIN) / (VMAX - VMIN))

# ── 柱体 ───────────────────────────────────────────────────
slot_w = PLOT_W / 288.0
BAR_W = max(1.0, slot_w - 0.55)

COLORS = {"sleep": SKY, "awake": PURPLE, "active": HONEY}

bars = []
for idx, (t, v, state) in enumerate(PTS):
    x = PAD_L + idx * slot_w
    y = y_of(v)
    bars.append(
        f'<rect x="{x:.2f}" y="{y:.2f}" width="{BAR_W:.2f}" '
        f'height="{max(1.0, PAD_T + PLOT_H - y):.2f}" rx="{BAR_W/2:.2f}" '
        f'fill="{COLORS[state]}" opacity="{0.95 if state != "awake" else 0.9}"/>'
    )

# ── 30 分钟一格刻度线（Oura 的 division）───────────────────
div_lines, div_labels = [], []
for k in range(0, 9):                      # 0,30,60...240 时
    hh = k * 0.5
    x = PAD_L + PLOT_W * (hh / 24.0)
    div_lines.append(
        f'<line x1="{x:.2f}" y1="{PAD_T}" x2="{x:.2f}" y2="{PAD_T+PLOT_H}" '
        f'stroke="{GRID}" stroke-width="1"/>'
    )
    if k % 2 == 0:                          # 0 / 2 / 4 / 6 / 8时 → 0/4/8/12/16/20/24
        div_labels.append(
            f'<text x="{x:.2f}" y="{H-8}" font-size="9.5" fill="{INK_FAINT}" '
            f'text-anchor="middle" font-family="-apple-system,sans-serif">{int(hh)}:00</text>'
        )

# 刻度线标签对齐：4 小时一标 → 0/4/8/12/16/20/24
div_labels = []
for hh in (0, 4, 8, 12, 16, 20, 24):
    x = PAD_L + PLOT_W * (hh / 24.0)
    div_labels.append(
        f'<text x="{x:.2f}" y="{H-8}" font-size="9.5" fill="{INK_FAINT}" '
        f'text-anchor="middle" font-family="-apple-system,sans-serif">{hh}:00</text>'
    )

# ── Y 刻度 ─────────────────────────────────────────────────
grid = []
for v in (50, 70, 90, 110, 130):
    y = y_of(v)
    grid.append(
        f'<line x1="{PAD_L}" y1="{y:.2f}" x2="{W-PAD_R}" y2="{y:.2f}" '
        f'stroke="{GRID}" stroke-width="1"/>'
        f'<text x="{PAD_L-5}" y="{y+3:.2f}" font-size="9.5" fill="{INK_FAINT}" '
        f'text-anchor="end" font-family="-apple-system,sans-serif">{v}</text>'
    )

# ── 白色平均趋势线（Oura 的 solid white trendline）────────
avg_pts = [(PAD_L, y_of(avg))]
step = 12
for i in range(step, 288, step):
    # PTS 里 t 的单位是小时（idx*5/60），换算回 5 分钟索引应该用 t*12，而不是 t/60*12
    seg = [v for t, v, _ in PTS if i - step < t * 12 <= i]
    if seg:
        avg_pts.append((PAD_L + i * slot_w, y_of(sum(seg) / len(seg))))
avg_d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in avg_pts)

svg = f'''<svg width="100%" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img">
<title>心率全天柱状小条图（对齐 Oura 口径）</title>
{''.join(grid)}
{''.join(div_lines)}
{''.join(bars)}
<path d="{avg_d}" fill="none" stroke="{INK}" stroke-width="4" stroke-linejoin="round" opacity="0.28"/>
<path d="{avg_d}" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round"/>
{''.join(div_labels)}
</svg>'''

LEGEND = f'''
<div class="legend">
  <span><i style="background:{SKY}"></i>睡眠</span>
  <span><i style="background:{PURPLE}"></i>日常清醒</span>
  <span><i style="background:{HONEY}"></i>活动</span>
  <span><i class="line"></i>全天均值 {avg:.0f}</span>
</div>'''

HTML = f'''<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>心率柱状小条 · Oura 口径预览</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 28px 20px 44px;
    background: #FFFFFF; color: {INK};
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  }}
  .wrap {{ max-width: 680px; margin: 0 auto; }}
  h1 {{ font-size: 20px; font-weight: 500; margin: 0 0 6px; }}
  .sub {{ font-size: 13px; color: {INK_SOFT}; line-height: 1.65; margin: 0 0 26px; }}
  .card {{
    border: 1px solid {BORDER}; border-radius: 18px; padding: 20px 18px 14px;
    margin-bottom: 20px;
  }}
  .head {{ display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }}
  .title {{ font-size: 16px; font-weight: 500; }}
  .meta {{ font-size: 12px; color: {INK_FAINT}; }}
  .big {{ display: flex; align-items: baseline; gap: 8px; margin-bottom: 14px; }}
  .bigv {{ font-size: 40px; font-weight: 300; letter-spacing: -1.5px; line-height: 1; }}
  .bigu {{ font-size: 13px; color: {INK_SOFT}; }}
  .bigs {{ font-size: 13px; color: {SKY_DEEP}; margin-left: 4px; }}
  .legend {{
    display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px;
    font-size: 12px; color: {INK_SOFT};
  }}
  .legend i {{
    display: inline-block; width: 10px; height: 10px; border-radius: 3px;
    margin-right: 5px; vertical-align: -1px;
  }}
  .legend i.line {{ width: 16px; height: 2px; border-radius: 1px; background: {INK}; opacity: .45; vertical-align: 3px; }}
  .note {{
    font-size: 12px; color: {INK_SOFT}; line-height: 1.7;
    border-top: 1px solid {BORDER}; margin-top: 14px; padding-top: 12px;
  }}
  .note b {{ font-weight: 500; color: {INK}; }}
  .cap {{ font-size: 12px; color: {INK_FAINT}; margin: -8px 0 18px; }}
  .cols {{ display: flex; gap: 14px; flex-wrap: wrap; }}
  .cols > div {{ flex: 1 1 300px; }}
  .pill {{
    display: inline-block; font-size: 11px; color: {INK_SOFT};
    border: 1px solid {BORDER}; border-radius: 999px; padding: 2px 8px; margin-left: 6px;
  }}
</style>
</head><body><div class="wrap">

<h1>心率 · 全天柱状小条<span class="pill">对齐 Oura 24h心率图口径</span></h1>
<p class="sub">
  横轴每 <b>30 分钟</b>一条刻度线（Oura 的 division），每条刻度线内含 <b>6 根 5 分钟一根的小柱</b>。
  白线是全天平均。10:36–11:00 那段是<b>真实缺口</b>——照实留白，不插值、不连线。
</p>

<div class="card">
  <div class="head">
    <div class="title">心率</div>
    <div class="meta">近 24 小时 · 全天</div>
  </div>
  <div class="big">
    <span class="bigv">{avg:.0f}</span><span class="bigu">bpm</span>
    <span class="bigs">全天均值</span>
  </div>
  {svg}
  {LEGEND}
  <div class="note">
    <b>为什么用柱不用平滑线：</b>5 分钟一点、全天 288 根柱，柱状能一眼看出「哪段时间密、哪段时间空」；
    换成平滑线会把288 个点连成一片噪点，反而看不出趋势。<br/>
    <b>和现在 30 分钟平滑线的差别：</b>现在 30 个点，丢失了午休那次的回落、15:20 会议那段的尖峰；
    柱状版能把这些起伏还原出来。
  </div>
</div>

<p class="cap">下面两栏是同一份数据、两种画法，放在一起看密度差异：</p>
<div class="cols">
  <div class="card" style="margin-bottom:0">
    <div class="head"><div class="title">柱状小条（5 分钟）</div><div class="meta">288 点</div></div>
    {svg}
    {LEGEND}
  </div>
  <div class="card" style="margin-bottom:0">
    <div class="head"><div class="title">现状平滑线（30 分钟）</div><div class="meta">48 点</div></div>
    <svg width="100%" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img">
      <title>现状 30 分钟平滑线对照</title>
      {''.join(grid)}
      {''.join(div_lines)}
      <path d="{avg_d}" fill="none" stroke="{PURPLE}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      {''.join(div_labels)}
    </svg>
    <div class="legend"><span><i style="background:{PURPLE}"></i>心率</span></div>
    <div class="note" style="margin-top:12px">峰谷被抹平，看不到会议和运动的尖峰。</div>
  </div>
</div>

</div></body></html>'''

OUT.write_text(HTML, encoding="utf-8")
print("written:", OUT)
print("avg:", round(avg, 1), "| points:", len(PTS))