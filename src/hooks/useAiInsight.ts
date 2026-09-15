import { useEffect, useRef, useState } from 'react';
import {
  getAiInsight,
  peekInsight,
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
 */
export function useAiInsight(kind: InsightKind): {
  text: string | null;
  rows: AiInsightRow[] | null;
  loading: boolean;
} {
  const initial = peekInsight(kind);
  const [text, setText] = useState<string | null>(initial);
  const [loading, setLoading] = useState<boolean>(initial == null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;

    const cached = peekInsight(kind);
    if (cached) {
      setText(cached);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    // ★ 延后启动：端侧模型约 1.1GB，加载 + 推理会占用内存与主线程，
    //   必须让首屏渲染/滚动先跑完，否则进页面就卡。
    const timer = setTimeout(() => {
      getAiInsight(kind)
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
  }, [kind]);

  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  return {
    text,
    rows: kind === 'cycle' || kind === 'recovery' ? parseInsightRows(text) : null,
    loading,
  };
}

export default useAiInsight;
