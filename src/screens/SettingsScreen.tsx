import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import Icon from '../components/Icon';
import Toggle from '../components/Toggle';
import { useAppState } from '../state/AppState';
import { RingBle, type RingState } from '../ble/RingBleManager';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const [notif, setNotif] = useState(true);
  const [sync, setSync] = useState(true);
  const { autoMonitor, setAutoMonitor } = useAppState();
  const [ring, setRing] = useState<RingState>({
    status: 'idle',
    deviceName: null,
    rssi: null,
    battery: null,
    firmware: null,
    metrics: { hr: null, spo2: null, temp: null, eda: null, hrv: null, rr: null },
    availability: { hr: 'syncing', spo2: 'syncing', temp: 'syncing', eda: 'syncing', hrv: 'syncing', rr: 'unavailable' },
    history: { hr: [], spo2: [], temp: [], eda: [], hrv: [], rr: [] },
    lastUpdated: { hr: null, spo2: null, temp: null, eda: null, hrv: null, rr: null },
    daily: {},
    dailyHistory: {},
    tempDaily: {},
    sleepStages: null,
    sleepSummary: null,
    sleepTime: null,
    wakeTime: null,
    female: null,
    statusHistory: [],
    dailyCurve: null,
    curveStatus: null,
    statusTimeline: [],
    error: null,
    devices: [],
    flashing: false,
    flashResult: null,
    protocol: null,
  });

  // 订阅真实 BLE 连接状态
  React.useEffect(() => {
    // 立即同步当前单例状态：重进设置页时若戒指仍连着，直接显示「已连接」，
    // 而不是从硬编码 idle 默认值起步（避免「看起来断联」的错觉）。
    setRing(RingBle.getState());
    const off = RingBle.onState(setRing);
    return () => {
      // 仅退订，不断开戒指：连接由全局单例持有，应跨页面存活。
      // 之前的 bug 是在这里调 RingBle.disconnect()，导致一离开设置页 BLE 就被掐。
      off();
    };
  }, []);

  const connectRing = () => {
    if (ring.status === 'scanning' || ring.status === 'connecting') return;
    if (ring.status === 'connected') {
      RingBle.disconnect();
      return;
    }
    // 开始扫描（不过滤服务，按设备名识别）；结果以候选列表呈现，可手动点选
    RingBle.startScan();
  };

  const ringConnected = ring.status === 'connected';
  const ringBusy = ring.status === 'scanning' || ring.status === 'connecting';
  const ringFailed = ring.status === 'error';

  // 状态视觉映射（基于设计系统 token，组件不写裸色）
  const STATUS_COLOR = {
    connected: theme.colors.success,
    scanning: theme.colors.warn,
    connecting: theme.colors.warn,
    error: theme.colors.danger,
    idle: theme.colors.textSub,
  } as const;
  const statusColor = STATUS_COLOR[ring.status];
  const statusLabel = ringConnected
    ? '已连接'
    : ring.status === 'scanning'
    ? '搜索中'
    : ring.status === 'connecting'
    ? '连接中'
    : ringFailed
    ? '连接失败'
    : '未连接';

  // RSSI(dBm) → 信号格数（1-4），默认 0
  const signalBars = (() => {
    if (ring.rssi == null) return 0;
    if (ring.rssi >= -55) return 4;
    if (ring.rssi >= -70) return 3;
    if (ring.rssi >= -85) return 2;
    return 1;
  })();

  const ringTitle =
    ring.status === 'connected'
      ? ring.deviceName || 'Mira Ring'
      : ring.status === 'scanning'
      ? '正在搜索戒指…'
      : ring.status === 'connecting'
      ? '正在连接…'
      : ringFailed
      ? '连接失败'
      : '未连接设备';
  const ringSub = ringBusy
    ? '请在戒指上确认配对，并保持手机靠近'
    : ringConnected
    ? `${ring.battery != null ? `电量 ${ring.battery}%` : '电量待同步'} · 固件 ${ring.firmware ?? '待同步'}`
    : ringFailed
    ? ring.error || '请重试'
    : '点击连接你的智能戒指';

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer>
        {/* 顶部导航 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn} hitSlop={10}>
            <Icon name="chevronLeft" size={theme.fs(24)} color={theme.colors.textWhite} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>设置</Text>
          <View style={styles.headerBtn} />
        </View>

        {/* 用户卡片 */}
        <Card style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>K</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Kristina</Text>
            <Text style={styles.profileSub}>Mira 会员 · 第 2 个月</Text>
          </View>
        </Card>

        {/* 日常设置 */}
        <Text style={styles.sectionTitle}>日常设置</Text>
        <Card padded={false} style={styles.listCard}>
          <Row icon="bell" title="消息通知" desc="周期提醒与每日洞察推送" value={notif} onValueChange={setNotif} />
          <View style={styles.divider} />
          <Row icon="sync" title="数据同步" desc="跨设备云端备份与恢复" value={sync} onValueChange={setSync} />
        </Card>

        {/* 自动监测 */}
        <Text style={styles.sectionTitle}>自动监测</Text>
        <Card style={styles.noteCard}>
          <View style={styles.toggleCard}>
            <View style={styles.toggleLeft}>
              <View style={styles.iconWrap}>
                <Icon name="orb" size={theme.fs(20)} color={theme.colors.accentSolid} strokeWidth={2} />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.rowTitle}>基础指标自动监测</Text>
                <Text style={styles.rowDesc}>佩戴戒指时自动持续采集生理信号</Text>
              </View>
            </View>
            <Toggle value={autoMonitor} onValueChange={setAutoMonitor} />
          </View>
          <Text style={styles.footnote}>
            此开关用于开启佩戴时的自动持续采集。以下指标的趋势曲线均依赖它（关闭后卡片仅显示手动测量结果，不再有全天趋势）：
          </Text>
          <Text style={[styles.footnote, styles.footnoteSub]}>
            · 基础指标：心率 · 血氧 · 体温 · 皮肤电(EDA) · HRV{'\n'}
            · 代谢：血糖 · 血脂 · 尿酸{'\n'}
            · 心理 / 睡眠：压力 · 疲劳度 · 情绪 · 皮肤含水量 · 皮质醇
          </Text>
          <Text style={[styles.footnote, styles.footnoteSub]}>
            采集方式：原生每约 20 秒执行一次健康一览，并按 15 分钟为一个区间对样本取均值，全天约 96 个趋势点，曲线更平滑。
          </Text>
        </Card>

        {/* 智能戒指 */}
        <Text style={styles.sectionTitle}>智能戒指</Text>
        <Card style={styles.ringCard}>
          {/* 头部：图标 + 名称/状态（独占一行，不再与按钮抢宽度） */}
          <View style={styles.ringHeader}>
            <View style={[styles.iconWrap, ringConnected && styles.iconWrapOn]}>
              <Icon
                name="ring"
                size={theme.fs(20)}
                color={ringConnected ? theme.colors.textWhite : theme.colors.accentSolid}
                strokeWidth={2}
              />
            </View>
            <View style={styles.ringHeaderText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {ringTitle}
              </Text>
              <Text style={styles.rowDesc} numberOfLines={2}>
                {ringSub}
              </Text>
            </View>
          </View>

          {/* 操作按钮：单独一行，左对齐，避免挤标题 */}
          <View style={styles.ringActions}>
            <TouchableOpacity
              onPress={connectRing}
              disabled={ringBusy}
              style={[
                styles.connectBtn,
                ringConnected && styles.connectBtnOn,
                ringBusy && styles.connectBtnBusy,
              ]}
            >
              <Text
                style={[
                  styles.connectBtnText,
                  ringConnected ? { color: theme.colors.textSub } : null,
                ]}
              >
                {ringConnected ? '断开' : ringBusy ? '连接中' : ringFailed ? '重试' : '连接'}
              </Text>
            </TouchableOpacity>
            {ringConnected && (
              <TouchableOpacity
                onPress={() => RingBle.flashRing()}
                disabled={ring.flashing}
                style={styles.findBtn}
              >
                <Icon name="bell" size={theme.fs(14)} color={theme.colors.textWhite} strokeWidth={2} />
                <Text style={styles.findBtnText}>{ring.flashing ? '查找中' : '查找戒指'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 查找结果提示（点亮/震动） */}
          {ring.flashResult && ringConnected && (
            <Text style={[styles.flashHint, { color: theme.colors.textSub }]}>{ring.flashResult}</Text>
          )}

          {/* 状态条：彩色圆点 + 状态文字 */}
          <View style={styles.statusBar}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            {ring.protocol && ringConnected && (
              <Text style={styles.protocolTag}>· {ring.protocol}</Text>
            )}
          </View>

          {/* 已连接：电量 / 信号 / 固件 明细 */}
          {ringConnected && (
            <View style={styles.detailWrap}>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>电量</Text>
                {ring.battery != null ? (
                  <View style={styles.batteryWrap}>
                    <View style={styles.batteryTrack}>
                      <View
                        style={[styles.batteryFill, { width: `${Math.max(ring.battery, 4)}%` }]}
                      />
                    </View>
                    <Text style={styles.metricVal}>{ring.battery}%</Text>
                  </View>
                ) : (
                  <Text style={[styles.metricVal, { color: theme.colors.textSub }]}>待同步</Text>
                )}
              </View>

              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>信号</Text>
                <View style={styles.bars}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={[styles.bar, i <= signalBars && styles.barOn]} />
                  ))}
                </View>
                <Text style={styles.metricVal}>{ring.rssi != null ? `${ring.rssi}dBm` : '—'}</Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>固件</Text>
                <Text style={styles.metricVal}>{ring.firmware ?? '待同步'}</Text>
              </View>
            </View>
          )}

          {/* 连接失败：错误提示框 */}
          {ringFailed && ring.error && (
            <View style={[styles.errorBox, { borderColor: theme.colors.danger }]}>
              <Text style={[styles.errorText, { color: theme.colors.danger }]}>{ring.error}</Text>
            </View>
          )}
        </Card>

        {/* 扫描到的候选设备：手动点选连接（避免盲连第一个） */}
        {ring.devices.length > 0 && ring.status !== 'connected' && (
          <Card padded={false} style={styles.listCard}>
            {ring.devices.map((d, i) => (
              <React.Fragment key={d.id}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity
                  onPress={() => RingBle.connectToId(d.id)}
                  style={styles.deviceRow}
                  disabled={ring.status === 'connecting'}
                >
                  <View style={[styles.iconWrap, d.recommended && styles.iconWrapOn]}>
                    <Icon
                      name="ring"
                      size={theme.fs(18)}
                      color={d.recommended ? theme.colors.textWhite : theme.colors.accentSolid}
                      strokeWidth={2}
                    />
                  </View>
                  <View style={styles.toggleText}>
                    <Text style={styles.rowTitle}>{d.name}</Text>
                    <Text style={styles.rowDesc}>
                      {d.rssi != null ? `信号 ${d.rssi}dBm` : '点击连接'}
                      {d.recommended ? ' · 推荐' : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </Card>
        )}
      </ScreenContainer>
    </View>
  );
}

function Row({
  icon,
  title,
  desc,
  value,
  onValueChange,
}: {
  icon: any;
  title: string;
  desc: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={theme.fs(20)} color={theme.colors.accentSolid} strokeWidth={2} />
      </View>
      <View style={styles.toggleText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{desc}</Text>
      </View>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.lg,
    paddingTop: theme.space.xs,
  },
  headerBtn: { width: theme.fs(28), height: theme.fs(28), alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.space.lg,
  },
  avatar: {
    width: theme.sp(13),
    height: theme.sp(13),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.avatarBgLight,
    borderWidth: 1,
    borderColor: theme.colors.avatarBorderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.md,
  },
  avatarLetter: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  profileInfo: { flex: 1 },
  profileName: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  profileSub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textSub,
    marginLeft: theme.space.xs,
    marginBottom: theme.space.sm,
    marginTop: theme.space.sm,
    letterSpacing: 1,
  },
  listCard: { marginBottom: theme.space.sm },
  noteCard: { marginBottom: theme.space.sm },
  footnote: {
    marginTop: theme.space.xs,
    marginHorizontal: theme.space.xs,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
  },
  footnoteSub: {
    marginTop: theme.space.xs,
    marginHorizontal: theme.space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
  },
  divider: { height: 1, backgroundColor: theme.colors.cardBorder, marginHorizontal: theme.space.md },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: theme.space.md },
  toggleText: { flex: 1 },
  iconWrap: {
    width: theme.sp(11),
    height: theme.sp(11),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.md,
  },
  iconWrapOn: { backgroundColor: theme.colors.accentSolid },
  rowTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  rowDesc: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },
  connectBtn: {
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(6),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSolid,
  },
  connectBtnOn: { backgroundColor: 'rgba(120,120,140,0.18)' },
  connectBtnBusy: { backgroundColor: theme.colors.accentSoft },
  connectBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  ringHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.space.sm,
  },
  ringHeaderText: { flex: 1, marginLeft: theme.space.md },
  ringActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  findBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
    backgroundColor: theme.colors.accentSolid,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
  },
  findBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  flashHint: {
    marginTop: theme.space.sm,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.5,
    color: theme.colors.textSub,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
  },
  ringCard: {
    marginBottom: theme.space.sm,
    paddingVertical: theme.space.sm,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.sm,
    paddingLeft: theme.space.xs,
  },
  statusDot: {
    width: theme.fs(9),
    height: theme.fs(9),
    borderRadius: theme.radius.pill,
    marginRight: theme.space.xs,
  },
  statusText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
  },
  protocolTag: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginLeft: theme.space.xs,
  },
  detailWrap: {
    marginTop: theme.space.sm,
    paddingHorizontal: theme.space.xs,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space.xs,
  },
  metricLabel: {
    width: theme.fs(44),
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
  },
  metricVal: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    textAlign: 'right',
  },
  batteryWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryTrack: {
    flex: 1,
    height: theme.fs(8),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBorder,
    overflow: 'hidden',
    marginRight: theme.space.sm,
  },
  batteryFill: {
    height: theme.fs(8),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.success,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.fs(3),
  },
  bar: {
    width: theme.fs(6),
    height: theme.fs(10),
    borderRadius: theme.fs(2),
    backgroundColor: theme.colors.cardBorder,
  },
  barOn: {
    backgroundColor: theme.colors.accentSolid,
  },
  errorBox: {
    marginTop: theme.space.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.dangerSoft,
    borderWidth: 1,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
  },
});
