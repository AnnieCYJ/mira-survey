---
name: "algorithmic-semantics-align"
description: "Post-algorithm-rewrite workflow: align product semantics with computation factors. Invoke after changing a scoring algorithm (weights, inputs, formula) to ensure UI labels, explanations, charts, and terminology all reflect the correct abstraction layer."
---

# Algorithmic Semantics Align

## Trigger
Invoke immediately after rewriting a scoring/weighting algorithm — when the computation pipeline (inputs, weights, formula) has changed and UI copy may still carry old or misleading semantics.

## Core Principle: Three Layers, No Leaks

```
┌──────────────────────────────────────┐
│  Layer 1 — Product Semantics         │  ← OUTPUT: what user sees
│  (认知负荷 / 焦虑水平 / 恢复力)      │     must stay in the problem domain
├──────────────────────────────────────┤
│  Layer 2 — Computation Factors       │  ← INPUT: what drives the number
│  (睡眠债 / 节律相位 / HRV 偏离)       │     predictors, not outputs
├──────────────────────────────────────┤
│  Layer 3 — UI Explanation            │  ← TRANSLATION: causal clarity
│  "昨晚恢复不足 → 认知储备不足 +28"   │     factor → output, not factor IS output
└──────────────────────────────────────┘
```

**Rule**: Never expose Layer 2 terms as Layer 1 labels. "生理需求" is a leak if the product domain is "认知". Sleep debt drives cognitive load; it is not itself cognitive load.

## Checklist

### After Algorithm Rewrite

1. **UI label audit**: Grep all screen/component files for old metric names. If algorithm now weights sleep 60%+, do NOT rename the output card "生理需求" — rename the formula explanation instead.

2. **Chart honesty audit**:
   - For trend charts: every hourly bin with `score=0` must have `hasData: false` flag
   - Catmull-Rom / Bezier paths must **segment on `hasData` boundaries**, not interpolate across gaps
   - Sleep/no-data windows get an explicit overlay + label, not just natural zero-height bars

3. **Formula card**: The big number (e.g., "84") must be followed by a 1-line breakdown in UI:
   ```
   40 基线 + 28（昨晚恢复不足 → 认知储备不足）
          + 16（睡眠债 2.7h → 认知吃力）≈ 84 / 100
   ```
   This card bridges Layer 2 → Layer 1 causally.

4. **Home/preview sub-text**: The mini-card subtitle must use Layer 1 semantics:
   - ✅ "睡眠债 2.3h · 认知吃力"
   - ❌ "睡眠债 2.3h · 需求偏高" (需求=生理层 leak)

5. **Algorithm comment block**: In the detail screen's inline explanation block, explicitly state that "X/Y/Z  are prediction factors, not the output itself" — guards against future semantic drift.

### Common Leak Patterns to Catch

| Old leak | Fix |
|----------|-----|
| Card title says "生理需求" | Revert to domain term "认知负荷" |
| Subtext says "节律偏高 · 状态好" | → "节律偏高 · 认知窗口偏移" |
| Chart interpolates across sleep hours | → segment path on hasData, sleep overlay |
| Formula says "生理需求 = sleepRecovery × 35" | → "认知负荷 = 40 基线 + (1-sleepRecovery) × 35" + explain the factor → output link |

## Files Typically Touched in This Repo

- `src/lib/<algo>.ts` — interface update (`hasData`, prediction confidence)
- `src/screens/*DetailScreen.tsx` — formula card, chart title, AI banner wording
- `src/components/*Card.tsx` — HourHistogram → gap-aware trend
- `src/screens/TodayScreen.tsx` — mini-chart, sub-text, BigStatCard title
