/**
 * ★ 2026-11-04（用户）：双机型能力区分
 *
 * 同一 Veepoo 协议下的两档戒指：
 *  - Luna Mira Pro：全功能（现 HK18 对应机型）——心电 / 血液成分 / 一键体检 / 身体成分 等全开
 *  - Luna Mira　　：精简档——无心电、无血液成分、无一键体检（其余基础指标照常）
 *
 * 真相源：本文件的能力矩阵。所有功能入口（tab / 卡片 / 深链）统一走 `capabilities` 判断，
 * 新增机型差异时：这里加一个 capability 布尔位，然后在入口处问一次 hasCap()。
 *
 * 型号识别：两机型共用协议、广播名暂无法可靠区分 → 以「设置页手动选择」为准，
 * 默认 Luna Mira Pro（当前手上的功能全的机器）。将来广播名定了再补 guessModelFromName。
 */
import { useEffect, useState } from 'react';
import * as Prefs from '../utils/prefs';

export type DeviceModelId = 'lunaMiraPro' | 'lunaMira';

export interface DeviceCapabilities {
  /** 心电（单导联 ECG 实时测量 + 心电图详情） */
  ecg: boolean;
  /** 血液成分（尿酸 + 血脂四项） */
  bloodComponents: boolean;
  /** 一键体检（HealthGlance 聚合快检：概览 → 记录 → 报告详情） */
  quickCheck: boolean;
}

export interface DeviceModelProfile {
  id: DeviceModelId;
  label: string;
  /** 设置页选择器里的一句说明 */
  subtitle: string;
  capabilities: DeviceCapabilities;
}

export const DEVICE_MODELS: Record<DeviceModelId, DeviceModelProfile> = {
  lunaMiraPro: {
    id: 'lunaMiraPro',
    label: 'Luna Mira Pro',
    subtitle: '全功能：心电 · 血液成分 · 一键体检',
    capabilities: { ecg: true, bloodComponents: true, quickCheck: true },
  },
  lunaMira: {
    id: 'lunaMira',
    label: 'Luna Mira',
    subtitle: '精简档：基础健康指标（无心电/血液成分/一键体检）',
    capabilities: { ecg: false, bloodComponents: false, quickCheck: false },
  },
};

/** 默认机型 = Pro（功能全的 HK18 对应档），未设置/读取出错时兜底 */
export const DEFAULT_DEVICE_MODEL: DeviceModelId = 'lunaMiraPro';

const KEY = 'device_model_v1';

export async function getDeviceModelId(): Promise<DeviceModelId> {
  try {
    const v = await Prefs.getItem(KEY);
    if (v === 'lunaMiraPro' || v === 'lunaMira') return v;
  } catch {}
  return DEFAULT_DEVICE_MODEL;
}

export async function setDeviceModelId(id: DeviceModelId): Promise<void> {
  await Prefs.setItem(KEY, id);
}

export function getModelProfile(id: DeviceModelId): DeviceModelProfile {
  return DEVICE_MODELS[id] ?? DEVICE_MODELS[DEFAULT_DEVICE_MODEL];
}

/**
 * 能力判断统一出口：入口处一句 `hasCap(model, 'ecg')`。
 * capability key 用字符串而不是枚举，方便将来加新位不破坏调用点。
 */
export function hasCap(model: DeviceModelProfile, cap: keyof DeviceCapabilities): boolean {
  return model.capabilities[cap] === true;
}

/**
 * （预留）广播名 → 机型猜测：两机型共用协议、命名未定，先恒返回 null（= 交给手动选择）。
 * 将来广播名定了（例如含 "Pro" 尾缀），在这里补关键词即可全链路自动生效。
 */
export function guessModelFromName(_deviceName: string | null | undefined): DeviceModelId | null {
  return null;
}

/**
 * React 侧统一取用：加载 + 订阅变更（设置页切换后所有门禁即时生效）。
 * 切换用返回的 setModelId（内部持久化 + 触发重渲染）。
 */
export function useDeviceModel(): {
  model: DeviceModelProfile;
  setModelId: (id: DeviceModelId) => Promise<void>;
} {
  const [id, setId] = useState<DeviceModelId>(DEFAULT_DEVICE_MODEL);
  useEffect(() => {
    let alive = true;
    getDeviceModelId().then((v) => {
      if (alive) setId(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  const setModelId = async (next: DeviceModelId) => {
    await setDeviceModelId(next);
    setId(next);
  };
  return { model: getModelProfile(id), setModelId };
}
