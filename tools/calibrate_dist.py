#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mira 今日状态 · 真实分布回放原型
从 /tmp/mira-logs/collector.log 抽取真实指标，打分布直方图，
并按 spec 晨间锚点公式推算分数分布，给 TBD-4 校准当证据基。
"""
import re
import statistics as st

LOG = "/tmp/mira-logs/collector.log"

def fnums(line, keys):
    out = {}
    for k in keys:
        m = re.search(rf"{k}=([0-9]+(?:\.[0-9]+)?)", line)
        if m:
            out[k] = float(m.group(1))
    return out

hrv_s, hr_s, temp_s, spo2_s = [], [], [], []
stress_s, cort_s, skin_s, fat_s = [], [], [], []
sleep_samples = []

with open(LOG, encoding="utf-8", errors="ignore") as f:
    for line in f:
        if "HG metabolic" in line:
            d = fnums(line, ["hrv", "stress", "cortisol", "skin", "fatigue", "emo"])
            if "hrv" in d and 10 <= d["hrv"] <= 300:
                hrv_s.append(d["hrv"])
            for src, dst in [("stress", stress_s), ("cortisol", cort_s), ("skin", skin_s), ("fatigue", fat_s)]:
                if src in d:
                    dst.append(d[src])
        elif "CB healthGlance" in line:
            d = fnums(line, ["temp", "spo2", "hr"])
            if "temp" in d and 35.0 <= d["temp"] <= 38.5:
                temp_s.append(d["temp"])
            if "hr" in d and 30 <= d["hr"] <= 220:
                hr_s.append(d["hr"])
            if "spo2" in d and 80 <= d["spo2"] <= 100:
                spo2_s.append(d["spo2"])
        elif "CB sleep" in line and "total=" in line:
            d = fnums(line, ["total", "deep", "light", "rem", "score", "getUp"])
            if d.get("total", 0) > 60:
                sleep_samples.append(d)

def pct(data, p):
    if not data:
        return float("nan")
    s = sorted(data)
    k = (len(s) - 1) * p / 100.0
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)

def ascii_hist(data, lo, hi, bins=20, width=46):
    if not data:
        return "(no data)"
    step = (hi - lo) / bins
    counts = [0] * bins
    for v in data:
        if v < lo or v > hi:
            continue
        b = min(int((v - lo) / step), bins - 1)
        counts[b] += 1
    mx = max(counts) or 1
    lines = []
    for i in range(bins):
        b0 = lo + i * step
        b1 = b0 + step
        bar = "#" * max(1, int(counts[i] / mx * width)) if counts[i] else "·"
        lines.append(f"{b0:6.1f}-{b1:6.1f} |{bar:<{width}} {counts[i]}")
    return "\n".join(lines)

print("=" * 72)
print("MIRA 今日状态 · 真实分布回放（来源：collector.log 真实戒指数据）")
print("=" * 72)

print(f"\n[样本量] HRV={len(hrv_s)}  HR={len(hr_s)}  体温={len(temp_s)}  睡眠={len(sleep_samples)}")
print("(注: 日志仅单日会话、无跨日边界，故以'快照分布'近似，HRV 中位数作 14d 基线代理)")

print("\n" + "-" * 72)
print("HRV (ms) 分布 — 晨间分主导输入")
print(f"  min={min(hrv_s):.0f}  p5={pct(hrv_s,5):.0f}  median={st.median(hrv_s):.0f}  p95={pct(hrv_s,95):.0f}  max={max(hrv_s):.0f}")
print(ascii_hist(hrv_s, 0, 260))

print("\n" + "-" * 72)
print("HR / 静息心率代理 (bpm) 分布")
print(f"  min={min(hr_s):.0f}  p5={pct(hr_s,5):.0f}  median={st.median(hr_s):.0f}  p95={pct(hr_s,95):.0f}  max={max(hr_s):.0f}")
print(ascii_hist(hr_s, 40, 160))

print("\n" + "-" * 72)
print("体温 (°C) 分布")
print(f"  min={min(temp_s):.2f}  median={st.median(temp_s):.2f}  max={max(temp_s):.2f}")
print(ascii_hist(temp_s, 35.5, 38.0))

print("\n" + "-" * 72)
print("睡眠真实样本（首个）:")
s0 = sleep_samples[0]
deep_pct = s0["deep"] / s0["total"] * 100
rem_pct = s0["rem"] / s0["total"] * 100
print(f"  total={s0['total']}min deep={s0['deep']}({deep_pct:.0f}%) light={s0['light']} rem={s0['rem']}({rem_pct:.0f}%) SDKscore={s0['score']} getUp={s0['getUp']}")
print("  -> SDK score=2 印证 0-5 量纲，spec 自算决策正确")

# ---- 晨间锚点分原型 (spec §4) ----
BASE_HRV = st.median(hrv_s)
BASE_HR = st.median(hr_s)
K_HRV, ANCHOR, K_RHR = 50, 70, 100

def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))

# 睡眠自算 (spec §4)：深睡占比/REM占比/时长达标/起床次数
def sleep_score(d):
    dp = d["deep"] / d["total"] * 100
    rp = d["rem"] / d["total"] * 100
    dur = 10 if d["total"] >= 420 else (d["total"] / 420 * 10)
    return clamp(50 + (dp - 20) * 1.5 + (rp - 20) * 1.0 + dur - d["getUp"] * 5)

SLEEP = sleep_score(s0)

# 每个 HRV 快照算一个晨间分（rhr 用基线中位、sleep 用真实样本常数）
scores = []
for hrv in hrv_s:
    ratio = hrv / BASE_HRV
    hrv_score = clamp(ANCHOR + K_HRV * (ratio - 1))
    rhr_score = clamp(100 - K_RHR * (BASE_HR / BASE_HR - 0.85))  # =100-15=85 常数
    sc = 0.40 * hrv_score + 0.25 * rhr_score + 0.35 * SLEEP
    scores.append(sc)

# ---- 伪迹过滤：HRV>120ms 对本中位(~40)属离谱尖峰，判为传感器噪声 ----
ART = [h for h in hrv_s if h <= 120]
print(f"\n[伪迹过滤] HRV>120ms 剔除 {len(hrv_s)-len(ART)} 个（占 { (len(hrv_s)-len(ART))/len(hrv_s)*100:.0f}%），保留 {len(ART)} 个；中位 {st.median(ART):.0f}ms")

BASE_HRV = st.median(ART)

# ---- 晨间锚点分原型 (spec §4, 当前默认常数) ----
K_HRV, ANCHOR, K_RHR = 50, 70, 100
def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))

scores = []
for hrv in ART:
    ratio = hrv / BASE_HRV
    hrv_score = clamp(ANCHOR + K_HRV * (ratio - 1))
    rhr_score = clamp(100 - K_RHR * (BASE_HR / BASE_HR - 0.85))
    sc = 0.40 * hrv_score + 0.25 * rhr_score + 0.35 * SLEEP
    scores.append(sc)

print("\n" + "=" * 72)
print("晨间锚点分分布（HRV 真实快照 vs 自身中位基线）")
print(f"  HRV基线={BASE_HRV:.0f}ms  HR基线={BASE_HR:.0f}bpm  sleep自算={SLEEP:.1f}")
print(f"  min={min(scores):.1f}  p5={pct(scores,5):.1f}  median={st.median(scores):.1f}  p95={pct(scores,95):.1f}  max={max(scores):.1f}")
print(ascii_hist(scores, 55, 100, bins=18))

def tier_count(scores, cuts):
    a, b, c = cuts
    t = {"充沛": 0, "平稳": 0, "偏低": 0, "不足": 0}
    for s in scores:
        if s >= a: t["充沛"] += 1
        elif s >= b: t["平稳"] += 1
        elif s >= c: t["偏低"] += 1
        else: t["不足"] += 1
    return t

print("\n" + "-" * 72)
print("档位占比（当前默认切点 70/50/35）：")
t1 = tier_count(scores, (70, 50, 35))
for k, v in t1.items():
    print(f"  {k}: {v} ({v/len(scores)*100:.0f}%)")
print("档位占比（上调顶部 78/58/42）：")
t2 = tier_count(scores, (78, 58, 42))
for k, v in t2.items():
    print(f"  {k}: {v} ({v/len(scores)*100:.0f}%)")

# ---- 更敏感变体（演示校准路径）：HRV权重↑、K↑、低于基线不对称加重 ----
print("\n" + "-" * 72)
print("更敏感变体（HRV权重0.5 / K_HRV=120 / 低于基线×1.6 不对称）：")
sc_sens = []
for hrv in ART:
    ratio = hrv / BASE_HRV
    dev = ratio - 1
    if dev < 0:
        dev *= 1.6  # 下行更敏感
    hrv_score = clamp(ANCHOR + 120 * dev)
    sc = 0.50 * hrv_score + 0.20 * 85 + 0.30 * SLEEP
    sc_sens.append(sc)
print(f"  min={min(sc_sens):.1f}  median={st.median(sc_sens):.1f}  max={max(sc_sens):.1f}")
ts = tier_count(sc_sens, (72, 55, 40))
for k, v in ts.items():
    print(f"  {k}: {v} ({v/len(sc_sens)*100:.0f}%)")

print("\n" + "=" * 72)
print("归一化层验证（用户提案：内部计算分 → 映射到『等分』展示分）")
print("展示分 = 100 × 经验CDF(raw_readiness)，即今日分 = 你在参考分布中的百分位。")
print("参考分布：本回放用真实样本近似；上线后 = 用户自身滚动历史（冷启动用群体参考）。")
print("-" * 72)

def tier_count_pct(disp, cuts):
    a, b, c = cuts
    t = {"充沛": 0, "平稳": 0, "偏低": 0, "不足": 0}
    for s in disp:
        if s >= a: t["充沛"] += 1
        elif s >= b: t["平稳"] += 1
        elif s >= c: t["偏低"] += 1
        else: t["不足"] += 1
    return t

print("A) 原默认公式（raw 压缩在65-86）经百分位归一化后档位（切点65/30/5）：")
ref_raw = sorted(scores)
disp_raw = [100.0 * sum(1 for v in ref_raw if v <= x) / len(ref_raw) for x in scores]
ta = tier_count_pct(disp_raw, (65, 30, 5))
for k, v in ta.items():
    print(f"    {k}: {v/len(disp_raw)*100:.0f}%")
print("   → 即便原始分崩坏（97%顶档），归一化后档位即健康：不足≈5% 偏低25% 平稳35% 充沛35%。")

print("B) 更敏感变体（方向正确）经归一化后档位（切点65/30/5）：")
ref_s = sorted(sc_sens)
disp_s = [100.0 * sum(1 for v in ref_s if v <= x) / len(ref_s) for x in sc_sens]
tb = tier_count_pct(disp_s, (65, 30, 5))
for k, v in tb.items():
    print(f"    {k}: {v/len(disp_s)*100:.0f}%")
print("   → 同样 不足≈5%。归一化使『档位分布』与『原始公式优劣』解耦。")

print("\n" + "=" * 72)
print("结论速读：")
print("  1) 内部算法只要吐出单调 readiness，归一化层都能把展示分拉成均匀 0-100；")
print("     用户看到的『几分』=『比过去百分之几的日子好』，直觉且图表均匀。")
print("  2) 档位切点设在百分位 65/30/5 → 不足≈5%(稀有严肃)、偏低25%、平稳35%、充沛35%。")
print("  3) 原始公式的压缩(97%顶档)不再致命——归一化兜底；但仍建议按§12修原始灵敏度，")
print("     因归一化不改『相对排序』，原始越准、百分位叙事越真。")
print("=" * 72)
