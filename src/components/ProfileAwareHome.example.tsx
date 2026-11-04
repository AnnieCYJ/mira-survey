/**
 * ★ 示例（非接入组件）：首页按 Profile 渲染
 *   演示如何根据当前连接戒指的 Profile，加载“完整版(PRO_UI)”或“精简版(BASE_UI)”界面：
 *     - Pro 专属组件（ECG 入口、体温卡、皮电卡）在 BASE_UI 下“根本不渲染”（无灰锁占位）
 *     - 其余数据卡片只渲染 profile.nativeMetrics 中“该戒指硬件原生支持”的指标
 *   注意：真实首页是 CalmWaveHome.tsx，本文件仅作模式示范，未接入路由。
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import {
  useDeviceModel,
  hasCap,
  hasMetric,
  getEffectiveFeatures,
} from '../config/deviceModel';

export function ProfileAwareHomeExample() {
  const { model, setModelId } = useDeviceModel();
  const firmware = null; // 真实场景取 ring state.firmware
  const features = getEffectiveFeatures(model, firmware);

  return (
    <ScrollView>
      {/* 顶部：当前 Profile 标识（让用户一眼看清“现在这枚是谁”） */}
      <View style={{ padding: 16, backgroundColor: '#113861' }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{model.label}</Text>
        <Text style={{ color: '#cfe0f5', fontSize: 12 }}>{model.subtitle}</Text>
      </View>

      {/* PRO 专属：心电入口 —— BASE_UI 下整体不渲染（无灰锁占位） */}
      {hasCap(model, 'ecg') && (
        <TouchableOpacity style={cardStyle}>
          <Text style={titleStyle}>心电测量</Text>
          <Text style={subStyle}>单导联 ECG · 心电图详情</Text>
        </TouchableOpacity>
      )}

      {/* PRO 专属：体温卡 —— BASE_UI 下不渲染 */}
      {hasMetric(model, 'temp') && (
        <View style={cardStyle}>
          <Text style={titleStyle}>体温</Text>
          <Text style={subStyle}>设备原生支持（PRO_UI only）</Text>
        </View>
      )}

      {/* PRO 专属：皮电 EDA 卡 —— BASE_UI 下不渲染 */}
      {hasMetric(model, 'eda') && (
        <View style={cardStyle}>
          <Text style={titleStyle}>皮电 EDA</Text>
          <Text style={subStyle}>设备原生支持（PRO_UI only）</Text>
        </View>
      )}

      {/* 通用数据卡：只渲染“该 Profile 硬件原生支持”的指标（核心生命体征两档都有） */}
      {['hr', 'spo2', 'hrv', 'steps', 'sleep'].map((metric) =>
        hasMetric(model, metric) ? (
          <View key={metric} style={cardStyle}>
            <Text style={titleStyle}>{metric.toUpperCase()}</Text>
            <Text style={subStyle}>原生支持 · 可展示</Text>
          </View>
        ) : null,
      )}

      {/* 调试/演示：手动在 PRO_UI / BASE_UI 间切换，验证精简版确实少了组件 */}
      <View style={{ flexDirection: 'row', padding: 16 }}>
        <TouchableOpacity style={btnStyle} onPress={() => setModelId('PRO_UI')}>
          <Text>切到 PRO_UI</Text>
        </TouchableOpacity>
        <TouchableOpacity style={btnStyle} onPress={() => setModelId('BASE_UI')}>
          <Text>切到 BASE_UI（精简版）</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const cardStyle = { margin: 12, padding: 16, borderRadius: 12, backgroundColor: '#fff' } as const;
const titleStyle = { fontSize: 16, fontWeight: '600' } as const;
const subStyle = { fontSize: 12, color: '#667' } as const;
const btnStyle = { flex: 1, margin: 4, padding: 12, borderRadius: 8, backgroundColor: '#e6eefc', alignItems: 'center' } as const;
