#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HRV / 体温 / 血氧 —— Oura 各指标的粒度与画法对照预览。
结论：Oura 只给心率做了「全天柱状小条」，其余三个各有独立画法。
输出：单文件 HTML（自包含）。
"""
import math
import random
from pathlib import Path

random.seed(77)

OUT = Path(__file__).with_name("preview_hrv_temp_spo2.html")

INK = "#1F1D1A"
INK_SOFT = "#5C574F"
INK_FAINT = "#9C968C"
BORDER = "rgba(31,29,26,0.09)"
GRID = "rgba(31,29,26,0.06)"
SKY = "#7EA6F8"
SKY_DEEP = "#4C74C9"
PURPLE = "#9D8AF0"
LIME = "#BCCB62"
ROSE = "#C9598A"
HONEY = "#F0C46E"

W = 340
PAD_L, PAD_R = 30, 12


def frame(inner, h, extra=""):
    return f'''<svg width="100%" viewBox="0 0 {W} {h}" xmlns="http://www.w3.org/2000/svg" role="img">{inner}{extra}</svg>'''


def axis_labels(hh_list, y, size=9.5):
    return "".join(
        f'<text x="{PAD_L + (W-PAD_L-PAD_R)*(hh/24):.2f}" y="{y}" font-size="{size}" fill="{INK_FAINT}" '
        f'text-anchor="middle" font-family="-apple-system,sans-serif">{hh}:00</text>'
        for hh in hh_list
    )


# ══════════════════════════════════════════════════════════
# 1. HRV —— Oura：只在睡眠里，5 分钟一点的 rMSSD，叠在睡眠分期条下
# ══════════════════════════════════════════════════════════
def build_hrv():
    # 睡眠 23:10 → 次日 06:40（约 7.5 小时）
    sleep_start, sleep_end = 0, 0          # 用「睡眠相对起点」0 点开始
    dur_min = 450                # 7.5h
    hrv, stage = [], []
    t = 0.0
    while t < dur_min:
        # 睡眠分期：浅→深→REM 循环，各 5 分钟一个点
        cyc = int(t // 90) % 3
        if t < 25:
            st = "awake"
        elif cyc == 0:
            st = "light"
        elif cyc == 1:
            st = "deep"
        else:
            st = "rem"
        stage.append((t, st))
        # rMSSD：入睡略低 → 后半夜升高，REM 抖动大
        base = 52 + (t / dur_min) * 22
        if st == "awake":
            base = 38
        elif st == "deep":
            base *= 1.02
        elif st == "rem":
            base += random.gauss(0, 6)
        # 150–163 分钟：真实缺口（不插值、不连线），注意 continue 前必须先推进 t
        if not (150 < t < 163):
            hrv.append((t, max(18, base + random.gauss(0, 3.2))))
        t += 5

    HT = 150
    H_TOP, H_STAGE, H_HRV = 14, 26, 74
    PLOT_W = W - PAD_L - PAD_R

    def x_of(m):
        return PAD_L + PLOT_W * (m / dur_min)

    # 睡眠分期条（5 分钟一格）
    STAGE_C = {"awake": "#F0C46E", "light": "#B9CCF9", "deep": "#4C74C9", "rem": "#9D8AF0"}
    sw = PLOT_W / (dur_min / 5.0)
    stage_r = "".join(
        f'<rect x="{x_of(m):.2f}" y="{H_TOP}" width="{sw+0.4:.2f}" height="{H_STAGE}" '
        f'fill="{STAGE_C[s]}" rx="1.5"/>'
        for m, s in stage
    )

    # HRV 柱（5 分钟一根，与分期条同槽位）
    vals = [v for _, v in hrv]
    vmin, vmax = 15, 100

    def y_of(v):
        return H_TOP + H_STAGE + 10 + (H_HRV - 10) * (1 - (v - vmin) / (vmax - vmin))

    bw = max(1.0, sw - 0.9)
    bars = "".join(
        f'<rect x="{x_of(m):.2f}" y="{y_of(v):.2f}" width="{bw:.2f}" '
        f'height="{max(1.0, H_TOP+H_STAGE+10+H_HRV-4 - y_of(v)):.2f}" rx="{bw/2:.2f}" '
        f'fill="{ROSE}" opacity="0.9"/>'
        for m, v in hrv
    )

    grid = "".join(
        f'<line x1="{PAD_L}" y1="{y_of(g):.2f}" x2="{W-PAD_R}" y2="{y_of(g):.2f}" stroke="{GRID}" stroke-width="1"/>'
        f'<text x="{PAD_L-5}" y="{y_of(g)+3:.2f}" font-size="9.5" fill="{INK_FAINT}" text-anchor="end" '
        f'font-family="-apple-system,sans-serif">{g}</text>'
        for g in (30, 50, 70, 90)
    )

    # 时间轴：睡眠相对时间 → 映射成钟点（23:00 起）
    ticks = [(0, "23:00"), (150, "01:30"), (300, "04:00"), (450, "06:30")]
    tl = "".join(
        f'<text x="{x_of(m):.2f}" y="{HT-4}" font-size="9.5" fill="{INK_FAINT}" text-anchor="middle" '
        f'font-family="-apple-system,sans-serif">{lb}</text>'
        for m, lb in ticks
    )

    inner = f'''
<text x="{PAD_L}" y="{H_TOP-4}" font-size="9.5" fill="{INK_SOFT}" font-family="-apple-system,sans-serif">睡眠分期 5 分钟一格</text>
{stage_r}
<text x="{PAD_L}" y="{H_TOP+H_STAGE+20}" font-size="9.5" fill="{INK_SOFT}" font-family="-apple-system,sans-serif">HRV rMSSD（ms）</text>
{grid}{bars}{tl}'''
    return frame(inner, HT + H_STAGE + H_HRV + 12), sum(vals) / len(vals), len(hrv)


# ══════════════════════════════════════════════════════════
# 2. 体温 —— Oura：不给绝对体温，只给「偏离个人基线」，全天节律曲线
# ══════════════════════════════════════════════════════════
def build_temp():
    pts = []
    for i in range(97):                        # 15 分钟一点
        h = i * 0.25
        # 昼夜节律：凌晨低、傍晚高、黄体期整体上移
        v = 0.18 * math.sin((h - 4) / 24 * 2 * math.pi) + 0.05
        if h < 6:
            v -= 0.10# 睡眠中继续下降
        if 15.0 < h < 15.5:
            continue                           # 真实缺口
        pts.append((h, v))
    HT = 150
    TOP, PLOT_H = 18, 96
    PLOT_W = W - PAD_L - PAD_R

    def y_of(v):
        return TOP + PLOT_H * (1 - (v + 0.5) / 1.0)     # 域 -0.5 ~ +0.5

    band = f'<rect x="{PAD_L}" y="{y_of(0.5):.2f}" width="{PLOT_W}" height="{y_of(-0.5)-y_of(0.5):.2f}" fill="#F6F7DC" opacity="0.55"/>'
    zero = f'<line x1="{PAD_L}" y1="{y_of(0):.2f}" x2="{W-PAD_R}" y2="{y_of(0):.2f}" stroke="{INK_FAINT}" stroke-width="0.8" stroke-dasharray="4 3"/>'

    d = "M " + " L ".join(f"{PAD_L + PLOT_W*(h/24):.2f} {y_of(v):.2f}" for h, v in pts)
    area = d + f" L {PAD_L + PLOT_W*(pts[-1][0]/24):.2f} {y_of(-0.5):.2f} L {PAD_L} {y_of(-0.5):.2f} Z"

    grid = "".join(
        f'<line x1="{PAD_L}" y1="{y_of(g):.2f}" x2="{W-PAD_R}" y2="{y_of(g):.2f}" stroke="{GRID}" stroke-width="1"/>'
        f'<text x="{PAD_L-5}" y="{y_of(g)+3:.2f}" font-size="9.5" fill="{INK_FAINT}" text-anchor="end" '
        f'font-family="-apple-system,sans-serif">{g:+.1f}</text>'
        for g in (-0.5, 0.0, 0.5)
    )
    dot = f'<circle cx="{PAD_L + PLOT_W*(pts[-1][0]/24):.2f}" cy="{y_of(pts[-1][1]):.2f}" r="3.2" fill="{ROSE}" stroke="#FFF" stroke-width="1.6"/>'
    tl = axis_labels([0, 4, 8, 12, 16, 20, 24], HT - 6)
    inner = f'{band}{grid}{zero}<path d="{area}" fill="{ROSE}" opacity="0.12"/>' \
            f'<path d="{d}" fill="none" stroke="{ROSE}" stroke-width="2.2" stroke-linejoin="round"/>{dot}{tl}'
    return frame(inner, HT), pts[-1][1]


# ══════════════════════════════════════════════════════════
# 3. 血氧 —— Oura：只在睡眠测；夜间均值 + 最低值；呼吸规律性 15 分钟一格
# ══════════════════════════════════════════════════════════
def build_spo2():
    dur_min = 450
    pts = []
    for t in range(0, dur_min, 5):
        v = 96.6 + random.gauss(0, 0.5)
        if 200 < t < 232:                        # 一次呼吸事件掉氧
            v -= random.uniform(1.5, 3.4)
        pts.append((t, max(88, v)))
    HT = 138
    TOP, PLOT_H = 20, 78
    PLOT_W = W - PAD_L - PAD_R

    def x_of(m):
        return PAD_L + PLOT_W * (m / dur_min)

    def y_of(v):
        return TOP + PLOT_H * (1 - (v - 84) / 16)   # 域 84~100（留出上方余量，掉氧才看得出来）

    bw = max(1.0, PLOT_W / (dur_min / 5.0) - 0.9)
    bars = "".join(
        f'<rect x="{x_of(m):.2f}" y="{y_of(v):.2f}" width="{bw:.2f}" '
        f'height="{max(1.0, TOP+PLOT_H-y_of(v)):.2f}" rx="{bw/2:.2f}" fill="{SKY}" opacity="0.9"/>'
        for m, v in pts
    )
    # 95% 参考线
    ref = (f'<line x1="{PAD_L}" y1="{y_of(95):.2f}" x2="{W-PAD_R}" y2="{y_of(95):.2f}" '
           f'stroke="{INK_FAINT}" stroke-width="0.8" stroke-dasharray="4 3"/>'
           f'<text x="{W-PAD_R}" y="{y_of(95)-4:.2f}" font-size="9" fill="{INK_FAINT}" '
           f'text-anchor="end" font-family="-apple-system,sans-serif">95%</text>')
    grid = "".join(
        f'<line x1="{PAD_L}" y1="{y_of(g):.2f}" x2="{W-PAD_R}" y2="{y_of(g):.2f}" stroke="{GRID}" stroke-width="1"/>'
        for g in (86, 90, 94, 98)
    ) + "".join(
        f'<text x="{PAD_L-5}" y="{y_of(g)+3:.2f}" font-size="9.5" fill="{INK_FAINT}" text-anchor="end" '
        f'font-family="-apple-system,sans-serif">{g}</text>' for g in (86, 90, 94, 98)
    )
    tl = "".join(
        f'<text x="{x_of(m):.2f}" y="{HT-4}" font-size="9.5" fill="{INK_FAINT}" text-anchor="middle" '
        f'font-family="-apple-system,sans-serif">{lb}</text>'
        for m, lb in ((0, "23:00"), (150, "01:30"), (300, "04:00"), (450, "06:30"))
    )
    inner = f'{grid}{bars}{ref}{tl}'
    vals = [v for _, v in pts]
    return frame(inner, HT), sum(vals) / len(vals), min(vals)


hrv_svg, hrv_avg, hrv_n = build_hrv()
temp_svg, temp_last = build_temp()
spo2_svg, spo2_avg, spo2_min = build_spo2()

HTML = f'''<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HRV / 体温 / 血氧 —— Oura 画法对照</title>
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;padding:28px 20px 46px;background:#FFF;color:{INK};
       font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}}
  .wrap{{max-width:680px;margin:0 auto}}
  h1{{font-size:20px;font-weight:500;margin:0 0 6px}}
  .sub{{font-size:13px;color:{INK_SOFT};line-height:1.7;margin:0 0 24px}}
  .card{{border:1px solid {BORDER};border-radius:18px;padding:18px 18px 12px;margin-bottom:18px}}
  .head{{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}}
  .title{{font-size:16px;font-weight:500}}
  .meta{{font-size:12px;color:{INK_FAINT}}}
  .row{{display:flex;gap:14px;margin-bottom:12px}}
  .stat{{flex:1;border:1px solid {BORDER};border-radius:12px;padding:10px 12px}}
  .lab{{font-size:11px;color:{INK_FAINT};margin-bottom:3px}}
  .val{{font-size:22px;font-weight:300;letter-spacing:-.5px}}
  .unit{{font-size:12px;color:{INK_SOFT};margin-left:3px}}
  .legend{{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;font-size:12px;color:{INK_SOFT}}}
  .legend i{{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}}
  .note{{font-size:12px;color:{INK_SOFT};line-height:1.75;border-top:1px solid {BORDER};margin-top:12px;padding-top:11px}}
  .note b{{font-weight:500;color:{INK}}}
  .tag{{display:inline-block;font-size:11px;border:1px solid {BORDER};border-radius:999px;padding:2px 8px;color:{INK_SOFT};margin-left:6px}}
  .lead{{font-size:13px;line-height:1.7;color:{INK_SOFT};background:#FAFAF8;border:1px solid {BORDER};
         border-radius:12px;padding:12px 14px;margin:0 0 20px}}
</style></head><body><div class="wrap">

<h1>HRV / 体温 / 血氧 —— Oura 各自怎么画<span class="tag">结论：不是所有指标都用柱状小条</span></h1>
<p class="sub">
  查完 Oura API 与官方文档后的结论：<b>只有心率做了「全天柱状小条」</b>。
  HRV、体温、血氧各有独立形态，照搬心率那套会错。
</p>

<div class="lead">
  <b>HRV</b>：只在睡眠时段测，<b>5 分钟一点</b>，而且是<b>叠在睡眠分期条下面的一层</b>，不做全天图。<br/>
  <b>体温</b>：Oura <b>不给绝对体温</b>，只给「偏离个人基线的度数」，画成一条<b>昼夜节律曲线</b>（含黄体期整体上移）。<br/>
  <b>血氧</b>：<b>只在睡眠时测</b>，白天没有曲线；给的是<b>整夜均值 + 整夜最低值</b>，呼吸规律性按<b>15 分钟</b>一格。
</div>

<div class="card">
  <div class="head"><div class="title">心率变异性 HRV</div><div class="meta">睡眠时段 · 5 分钟一点</div></div>
  <div class="row">
    <div class="stat"><div class="lab">整夜均值</div><div class="val">{hrv_avg:.0f}<span class="unit">ms</span></div></div>
    <div class="stat"><div class="lab">有效点</div><div class="val">{hrv_n}<span class="unit">点</span></div></div>
    <div class="stat"><div class="lab">采样段</div><div class="val">23:00<span class="unit">→06:30</span></div></div>
  </div>
  {hrv_svg}
  <div class="legend">
    <span><i style="background:#B9CCF9"></i>浅睡</span>
    <span><i style="background:#4C74C9"></i>深睡</span>
    <span><i style="background:#9D8AF0"></i>REM</span>
    <span><i style="background:#F0C46E"></i>清醒</span>
    <span><i style="background:{ROSE}"></i>rMSSD</span>
  </div>
  <div class="note">
    <b>为什么 HRV 不能全天画：</b>白天的 HRV 被运动、说话、环境干扰得厉害，医学上只在<b>睡眠静止期</b>才有意义。
    Oura 的 HRV 就是「睡眠分期条的第二层曲线」，离开睡眠段的 HRV 干脆不给。<br/>
    <b>对我们的意义：</b>HRV 详情页应该跟睡眠详情页合并成一张图（上分期 + 下 HRV），而不是单独做一个全天 HRV 页。
  </div>
</div>

<div class="card">
  <div class="head"><div class="title">体温<span class="tag">偏离基线，不是绝对值</span></div><div class="meta">全天 · 15 分钟一点</div></div>
  <div class="row">
    <div class="stat"><div class="lab">当前偏离</div><div class="val">{temp_last:+.2f}<span class="unit">°C</span></div></div>
    <div class="stat"><div class="lab">正常带</div><div class="val">±0.5<span class="unit">°C</span></div></div>
  </div>
  {temp_svg}
  <div class="note">
    <b>关键差异：</b>Oura 明确<b>不报绝对皮肤温度</b>，只报「和你的个人基线差多少」。原因写在官方文档里：
    白天体温被吃喝、运动、环境干扰，<b>只有睡眠时的体温才有意义</b>。<br/>
    <b>对我们的意义：</b>Mira 女性周期定位，体温正是「黄体期上移」的关键信号——
    用偏离基线 + 昼夜曲线才对，写「体温 36.5°C」既不准也没信息量。
  </div>
</div>

<div class="card">
  <div class="head"><div class="title">血氧 SpO₂</div><div class="meta">睡眠时段 · 5 分钟一点（呼吸规律性 15 分钟）</div></div>
  <div class="row">
    <div class="stat"><div class="lab">整夜均值</div><div class="val">{spo2_avg:.1f}<span class="unit">%</span></div></div>
    <div class="stat"><div class="lab">整夜最低</div><div class="val">{spo2_min:.0f}<span class="unit">%</span></div></div>
    <div class="stat"><div class="lab">参考下限</div><div class="val">95<span class="unit">%</span></div></div>
  </div>
  {spo2_svg}
  <div class="legend"><span><i style="background:{SKY}"></i>SpO₂</span><span><i style="background:{INK_FAINT}"></i>95% 下限</span></div>
  <div class="note">
    <b>关键差异：</b>Oura <b>白天不测血氧</b>（红光红外 LED 只在判定睡眠时亮），所以血氧<b>没有全天图</b>，
    只有夜间曲线 + 整夜均值/最低值。这对我们的意义是<b>诚实</b>：没数据就写「睡眠时段测量」，别画一条白天的假线。<br/>
    中段那根明显掉下去的就是呼吸事件的信号——这正是它比「整夜均值 97%」更有价值的地方。
  </div>
</div>

</div></body></html>'''

OUT.write_text(HTML, encoding="utf-8")
print("written:", OUT)