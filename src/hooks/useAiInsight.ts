import { useEffect, useRef, useState } from 'react';
import {
  getAiInsight,
  peekInsight,
  insightTag,
  parseInsightRows,
  type AiInsightRow,
  type InsightKind,
} from '../ai/insight';

/**
 * 订阅「AI 分析」的生成结果。
 *
 * 行为：
 *  - 若今天已生成过（模块级/磁盘缓存命中）→ 首帧直接返回，不闪烁、不重复推理。
 *  - 否则异步触发端侧大模型生成；**生成完成前 text 为 null**，由调用方回落到规则文案。
 *  - 组件卸载后不再 setState（避免无效渲染）。
 *  - 失败/模型未打包 → text 保持 null（静默降级，不抛错、不空白）。
 *
 * @param kind 'overview'（洞察页顶部综合分析）| 'cycle'（周期 tab 的 AI 分析）| 'recovery'（身体恢复详情页）
 * @param dayDk 可选：按「某历史日」生成/读取（当前仅 recovery 支持）。缺省=今天。
 *              传历史日时走该日的事实串与 `kind@dk` 缓存，切日即重新生成该日分析。
 */
export function useAiInsight(
  kind: InsightKind,
  dayDk?: string,
  extraTag?: string,
  enabled: boolean = true
): {
  text: string | null;
  rows: AiInsightRow[] | null;
  loading: boolean;
} {
  /**
   * ★ 结论级状态指纹（recovery = 皮质醇 正常/偏高/紊乱 + 连续天数；circadian = 调用方传入的 extraTag）。
   * 它是 effect 的依赖：数据补齐导致结论翻转时（正常 → 偏高），缓存作废、重新生成，
   * 否则会一直显示早上生成的那版文案（大字已变、AI 未变）。
   */
  const tag = insightTag(kind, dayDk, extraTag);
  const initial = enabled ? peekInsight(kind, dayDk, extraTag) : null;
  const [text, setText] = useState<string | null>(initial);
  const [loading, setLoading] = useState<boolean>(initial == null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;

    // ★ 未启用（如首页同名卡片不需要昼夜节律 AI）→ 直接清空，不生成、不占模型。
    if (!enabled) {
      setText(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    // 切日：先同步取该日缓存（有则秒显），无则清空并重新生成
    const cached = peekInsight(kind, dayDk, extraTag);
    if (cached) {
      setText(cached);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setText(null);

    setLoading(true);
    // ★ 延后启动：端侧模型约 1.1GB，加载 + 推理会占用内存与主线程，
    //   必须让首屏渲染/滚动先跑完，否则进页面就卡。
    const timer = setTimeout(() => {
      getAiInsight(kind, dayDk, extraTag)
        .then((t) => {
          if (cancelled || !alive.current) return;
          setText(t);
        })
        .catch(() => {
          if (!cancelled && alive.current) setText(null);
        })
        .finally(() => {
          if (!cancelled && alive.current) setLoading(false);
        });
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // tag 进依赖：结论翻转（例：皮质醇 正常 → 偏高）→ 旧文案作废并重新生成
  }, [kind, dayDk, tag, enabled, extraTag]);

  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  return {
    text,
    rows:
      kind === 'cycle' || kind === 'recovery' || kind === 'overview' || kind === 'circadian'
        ? parseInsightRows(text)
        : null,
    loading,
  };
}

export default useAiInsight;
