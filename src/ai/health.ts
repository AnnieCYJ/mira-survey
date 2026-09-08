// 健康数据快照（架构图⑥：注入 daily_status / 周期 / 状态值）
// 直接读 RingBle 真实链路（ble/RingBleManager），不依赖 UI 状态。仅做"参考锚点"，不主动宣讲。

import { RingBle } from '../ble/RingBleManager';

const FEMALE_STATE: Record<number, string> = {
  0: '未设置经期',
  1: '月经期',
  2: '备孕期',
  3: '怀孕期',
  4: '辣妈期',
};

function fmt(v: number | null | undefined, unit = ''): string | null {
  if (v == null || Number.isNaN(v)) return null;
  return `${Math.round(v * 10) / 10}${unit}`;
}

export function buildHealthSnapshot(): string {
  const st = RingBle.getState();
  const daily = st.daily || {};
  const parts: string[] = [];

  const add = (label: string, val: string | null) => {
    if (val != null) parts.push(`${label}=${val}`);
  };

  add('心率', fmt(daily['hr'], 'bpm'));
  add('血氧', fmt(daily['spo2'], '%'));
  add('HRV', fmt(daily['hrv'], 'ms'));
  add('体温', fmt(daily['temp'], '℃'));
  add('皮电(eda)', fmt(daily['eda']));
  add('步数', fmt(daily['steps']));
  add('睡眠总时长', fmt(daily['sleepTotal'], 'min'));
  add('深睡', fmt(daily['sleepDeep'], 'min'));
  add('REM', fmt(daily['sleepRem'], 'min'));
  add('睡眠评分', fmt(daily['sleepScore']));
  add('压力', fmt(daily['stress']));
  add('血糖', fmt(daily['bloodSugar']));
  add('血脂', fmt(daily['cholesterol']));
  add('梅脱', fmt(daily['metabolicRate']));

  const tl = st.statusTimeline || [];
  if (tl.length) {
    const last = tl[tl.length - 1];
    add('今日状态值', `${last.value}/100(${last.level})`);
  }

  const female = st.female;
  if (female) {
    add('周期状态', FEMALE_STATE[female.state] ?? `未知(${female.state})`);
    if (female.lastMenstrualDate) add('末次经期', female.lastMenstrualDate);
  }

  // 用「计算出的真实相位」（经期/卵泡期/排卵期/黄体期）喂给 AI，
  // 而不是裸的末次经期日期——否则 AI 只能自己拿日期做推算，容易和你实际阶段对不上。
  // 注意：戒指硬件不测经期相位，相位是按你记录的末次经期 + 标准周期模型算出来的。
  const cs = st.curveStatus;
  if (cs && cs.hasLog) {
    add('生理周期相位', cs.phaseLabel);
    if (cs.dayInCycle != null) add('周期第几天', `${cs.dayInCycle}`);
  }

  if (parts.length === 0) return '';
  return (
    '【用户今日健康数据（仅作回答参考，不要逐条播报；用户没问就不主动提）】\n' +
    parts.join('；')
  );
}
