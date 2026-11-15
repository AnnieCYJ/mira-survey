import { uploadSelfReports } from '../data/selfReportSync';
import { getLocalDeviceId } from '../data/ringIdentity';
import { getAutoUploadEnabled, setAutoUploadEnabled } from '../data/autoUpload';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as AsyncStorage from '../utils/prefs'; // ★ 2026-10-18：Expo Go 无 AsyncStorage 原生模块，改用 file-system 版同接口 KV
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import Icon from '../components/Icon';
import BackButton from '../components/BackButton';
import Toggle from '../components/Toggle';
import { useAppState } from '../state/AppState';
import { RingBle, type RingState } from '../ble/RingBleManager';
import { shortRingLastSeen } from '../ble/ringDeviceCard';
import { useDeviceModel } from '../config/deviceModel';
import { APP_VERSION_LABEL, APP_VERSION_TAG, APP_VERSION_CODE, APP_VERSION_NAME } from '../version';
import { healthStore } from '../data/healthStore';
// ★ 2026-11-09：App 内检查更新（版本清单 → 系统浏览器下载 APK → 系统安装器）
import { checkAppUpdate, openApkDownload, downloadAndInstallApk, formatApkSize, type AppUpdateInfo } from '../data/appUpdate';
// ★ Phase 1/2：上传成功后重拉规律摘要
import { syncPatterns } from '../ai/cloudPatterns';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  useFocusEffect(
    React.useCallback(() => {
      // ★ 2026-10-10：进入设置页自动尝试连回上次那台戒指（与 App 启动自动连同源），
      //   不再需要手动点「连接」。已连 / 在连 / 在扫时 autoConnect 内部跳过。
      RingBle.autoConnect();
    }, [])
  );

  const safeGoBack = React.useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Main' as never);
    }
  }, [navigation]);
  const [sync, setSync] = useState(RingBle.getSyncEnabled());
  const [autoUpload, setAutoUpload] = useState(true);
  React.useEffect(() => {
    getAutoUploadEnabled().then((v) => setAutoUpload(v));
  }, []);
  const { autoMonitor, setAutoMonitor } = useAppState();
  // 机型分档：精简版 / 全量版两套口径严格分开，说明文案与数据实况都按它走
  const { model } = useDeviceModel();
  const [notif, setNotif] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [dumpPath, setDumpPath] = useState<string | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  // ── 检查更新 ──
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'latest' | 'available' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const doCheckUpdate = React.useCallback(async () => {
    setUpdateState('checking');
    setUpdateMsg(null);
    const r = await checkAppUpdate();
    if (r.state === 'available') {
      setUpdateInfo(r.info);
      setUpdateState('available');
    } else if (r.state === 'latest') {
      setUpdateState('latest');
      setUpdateMsg(`当前 ${r.current} 已是最新版本`);
    } else {
      setUpdateState('error');
      setUpdateMsg(r.message);
    }
  }, []);
  // 进设置页自动静默检查一次：有新版本直接显示下载入口，不用手动点
  React.useEffect(() => {
    void checkAppUpdate().then((r) => {
      if (r.state === 'available') {
        setUpdateInfo(r.info);
        setUpdateState('available');
      }
    });
  }, []);
  const doDownloadUpdate = React.useCallback(async () => {
    if (!updateInfo?.apkUrl || downloading) return;
    setDownloading(true);
    setProgress(0);
    setUpdateMsg(null);
    try {
      // ★ 2026-11-10：App 内直接下载并拉起系统安装器（不再跳浏览器中转）
      await downloadAndInstallApk(updateInfo.apkUrl, (p) => setProgress(p.progress));
      setUpdateMsg('已拉起安装。请在系统弹窗里点「安装」完成更新（覆盖安装，本地数据不会丢）。');
    } catch {
      Alert.alert('下载失败', '请检查手机网络后重试，或复制更新地址到浏览器下载安装。');
    } finally {
      setDownloading(false);
    }
  }, [updateInfo, downloading]);
  const [ring, setRing] = useState<RingState>({
    status: 'idle',
    deviceName: null,
    deviceBroadcastName: null,
    deviceBroadcastNameSource: null,
    rssi: null,
    battery: null,
    firmware: null,
    deviceId: null,
    deviceInfo: null,
    sportSessions: null,
    metrics: { hr: null, spo2: null, temp: null, eda: null, hrv: null, rr: null },
    availability: { hr: 'syncing', spo2: 'syncing', temp: 'syncing', eda: 'syncing', hrv: 'syncing', rr: 'unavailable' },
    history: { hr: [], spo2: [], temp: [], eda: [], hrv: [], rr: [] },
    lastUpdated: { hr: null, spo2: null, temp: null, eda: null, hrv: null, rr: null },
    daily: {},
    dailyHistory: {},
    tempDaily: {},
    hrvDaily: {},
    hrDaily: {},
    seriesByDay: {},
    deviceCapabilities: null,
    spo2Daily: {},
    edaDaily: {},
    rrDaily: {},
    sleepDaily: {},
    stepDaily: {},
    statusDaily: {},
    statusHistory: [],
    lastSyncedAt: null,
    lastBackfillAt: null,
    dataVersion: 0,
    sleepStages: null,
    sleepStagesDaily: {},
    sleepSummary: null,
    sleepSummaryDate: null,
    sleepTime: null,
    wakeTime: null,
    female: null,
    dailyCurve: null,
    curveStatus: null,
    statusTimeline: [],
    statusTimelineByDay: {},
    error: null,
    devices: [],
    flashing: false,
    flashResult: null,
    protocol: null,
    extDaily: {},
    ecg: null,
    ecgDaily: {},
    ecgHistory: [],
    lastUploadedAt: null,
    ecgProgress: null,
    ecgLiveWaveform: null,
    ecgError: null,
    ecgHint: null,
    oxygenAnalysis: null,
    rrAnalysis: null,
    emotion: null,
  });

  // 订阅真实 BLE 连接状态
  React.useEffect(() => {
    // 立即同步当前单例状态：重进设置页时若戒指仍连着，直接显示「已连接」，
    // 而不是从硬编码 idle 默认值起步（避免「看起来断联」的错觉）。
    setRing(RingBle.getState());
    // ★ 节流订阅（rAF 合并）：BLE 推送较频繁，直接 setRing 会把多次推送叠加成多次全屏重渲染 → 卡顿。
    let pending: RingState | null = null;
    let scheduled = false;
    const throttled = (s: RingState) => {
      pending = s;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if (pending) setRing(pending);
        });
      }
    };
    const off = RingBle.onState(throttled);
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

  // 手动上传本地戒指数据到云端：仅此按钮触发，本地数据始终保留。
  const uploadCloud = () => {
    if (uploading) return;
    Alert.alert(
      '上传云端',
      '将同步戒指数据、情绪选择和经期记录到云端，用于个人分析。自由文本备注不上传；情绪和经期的云端副本会按本机现有记录更新（包含删除）。本机数据保留。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '上传',
          onPress: async () => {
            setUploading(true);
            setUploadMsg(null);
            try {
            const r = await RingBle.uploadRingData();
            const stForReports = RingBle.getState();
            const reports = await uploadSelfReports(stForReports.deviceId || stForReports.deviceName || await getLocalDeviceId());
            setUploading(false);
            setUploadMsg(r.ok ? `已上传 ${r.count} 条戒指记录；${reports.ok ? '自报记录同步完成' : reports.error}` : `戒指上传失败：${r.error ?? '未知错误'}；${reports.ok ? '自报同步完成' : reports.error}`);
            // ★ Phase 1/2：上传成功 → 云端数据变了，强制重拉一次规律摘要（长窗口规律可能刚成立）
            if (r.ok || reports.ok) {
              try {
                const st = RingBle.getState();
                await syncPatterns({ deviceId: st.deviceId || st.deviceName || undefined, force: true });
              } catch {
                /* 拉规律失败不影响上传结果 */
              }
            }
            } catch {
              setUploadMsg('同步未完成，请稍后重试');
            } finally {
              setUploading(false);
            }
          },
        },
      ]
    );
  };

  // ★ 2026-11-07（用户：「显示不出来、显示不对」）：旧的「最近 7 天各指标有数据天数」
  //   默认收起、只给天数不给频率，且混着旧戒指的历史归档 —— 已换成默认展开的
  //   「当前戒指 · 数据实况」卡片，按机型分开、点数与频率都从真实样本算。

  const ringConnected = ring.status === 'connected';
  const ringBusy = ring.status === 'scanning' || ring.status === 'connecting';
  const ringFailed = ring.status === 'error';

  // 状态视觉映射（基于设计系统 token，组件不写裸色）
  const STATUS_COLOR = {
    connected: theme.colors.ui.status.good,
    scanning: theme.colors.ui.status.warn,
    connecting: theme.colors.ui.status.warn,
    error: theme.colors.ui.status.danger,
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

  // ★ 2026-11-07（用户）：卡片标题直接用**固件广播名**（如 Lunamira），不再显示品牌占位名。
  //   按 MAC 直连时 resolveBroadcastName 会退回本机已记录的真实广播名，仍是固件原名，不是编的名字。
  const firmwareName = ring.deviceBroadcastName?.trim() || null;
  const ringTitle =
    ring.status === 'connected'
      ? firmwareName || '已连接戒指'
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

  const SEP3 = '2026-9-3';
  const sep3HrVisible =
    ring.hrDaily[SEP3] != null ||
    ((ring.seriesByDay?.hr?.[SEP3]?.length ?? 0) > 0);
  // 「强制重新同步」调试按钮已移除：离线数据同步统一由设置页「数据同步」开关管理
  // （JS syncBackfill → 原生 recoverOffline，从戒指 flash 重拉后回填）。
  const onExportDump = async () => {
    if (diagBusy) return;
    setDiagBusy(true);
    try {
      const ble = RingBle as any;
      if (typeof ble.exportDebugDump !== 'function') {
        throw new Error('exportDebugDump 未编译进当前 bundle，需要 Xcode Clean Build + ⌘R');
      }
      const { path } = await ble.exportDebugDump();
      setDumpPath(path);
    } catch (e) {
      setDumpPath(`导出失败: ${(e as Error).message}`);
    } finally {
      setDiagBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* v10：设置页背景全白（与首页/洞察页/日历页同款），原紫渐变收起 */}
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer>
        {/* 顶部导航 */}
        <View style={styles.header}>
          <BackButton onPress={safeGoBack} />
          <Text style={styles.headerTitle}>设置</Text>
          <View style={styles.headerBtn} />
        </View>

        {/* 日常设置 */}
        <Text style={styles.sectionTitle}>日常设置</Text>
        <Card padded={false} style={styles.listCard}>
          <Row icon="bell" tone="pink" title="消息通知" desc="周期提醒与每日洞察推送" value={notif} onValueChange={setNotif} />
          <View style={styles.divider} />
          <Row
            icon="sync"
            tone="cyan"
            title="数据同步"
            desc={sync
              ? '每次连上戒指自动回填全部历史数据；回前台、每 30 分钟也会补一次'
              : '已关闭：连上戒指不再自动回填历史数据'}
            value={sync}
            onValueChange={(v) => {
              setSync(v);
              // 「数据同步」是回填总开关（默认开启，持久化为 v2 标记）。
              // 开启即立刻全量同步一次，之后每次连接都自动触发；关闭只停自动同步，不清除已有数据。
              RingBle.setSyncEnabled(v);
              if (v) RingBle.syncBackfill();
            }}
          />
        </Card>

        {/* 自动监测 */}
        <Text style={styles.sectionTitle}>自动监测</Text>
        <Card style={styles.noteCard}>
          <View style={styles.toggleCard}>
            <View style={styles.toggleLeft}>
              <View style={[styles.iconWrap, { backgroundColor: mm.chipBg.lime.bg }]}>
                <Icon name="orb" size={theme.fontSize.lg} color={mm.chipBg.lime.fg} strokeWidth={2} />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.rowTitle}>基础指标自动监测</Text>
                <Text style={styles.rowDesc}>佩戴戒指时自动持续采集生理信号</Text>
              </View>
            </View>
            <Toggle value={autoMonitor} onValueChange={setAutoMonitor} />
          </View>
          <Text style={styles.footnote}>
            此开关用于开启佩戴时的自动持续采集。下面只列当前连接的这枚戒指真实具备的通道：
          </Text>
          <Text style={[styles.footnote, styles.footnoteSub]}>
            {model.id === 'BASE_UI'
              ? '· 逐点（全天 1 分钟等间隔）：心率 · 血氧 · HRV · 收缩压 / 舒张压\n· 日汇总：步数 · 距离 · 卡路里\n· 睡眠：精准睡眠分期（1 分钟 / 点）\n· 压力：设备支持，但原生测量记录通道未接入，当前为空'
              : '· 基础指标：心率 · 血氧 · 体温 · HRV · 呼吸率\n· 代谢：血脂 · 血糖 · 身体成分\n· 睡眠 / 恢复：睡眠分期 · 交感神经活跃度'}
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
                size={theme.fontSize.lg}
                color={ringConnected ? theme.colors.textWhite : theme.colors.accentText}
                strokeWidth={2}
              />
            </View>
            <View style={styles.ringHeaderText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {ringTitle}
              </Text>
              {/* ★ 2026-11-15（上线测试 UI-SET-01）：这句「点击连接你的智能戒指」
                  原本是纯 Text，clickable=false、点了没反应。未连接时给真实点击热区。 */}
              <TouchableOpacity
                onPress={ringConnected ? undefined : connectRing}
                disabled={ringConnected}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="点击连接戒指"
              >
                <Text style={styles.rowDesc} numberOfLines={2}>
                  {ringSub}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 操作按钮：单独一行，左对齐，避免挤标题 */}
          <View style={styles.ringActions}>
            <TouchableOpacity
              onPress={connectRing}
              disabled={ringBusy}
              activeOpacity={0.7}
              style={[
                styles.connectBtn,
                ringConnected && styles.connectBtnOn,
                ringBusy && styles.connectBtnBusy,
              ]}
            >
              {ringConnected || ringBusy ? (
                <Text style={[styles.connectBtnText, styles.connectBtnTextAlt]}>
                  {ringConnected ? '断开' : '连接中'}
                </Text>
              ) : (
                <LinearGradient
                  colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.connectBtnGrad}
                >
                  <Text style={styles.connectBtnTextGrad}>{ringFailed ? '重试' : '连接'}</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
            {ringConnected && (
              <TouchableOpacity
                onPress={() => RingBle.flashRing()}
                disabled={ring.flashing}
                activeOpacity={0.7}
                style={styles.findBtn}
              >
                <LinearGradient
                  colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.findBtnGrad}
                >
                  <Icon name="bell" size={theme.fs(14)} color={mm.colors.btnTextOnGrad} strokeWidth={2} />
                  <Text style={styles.findBtnText}>{ring.flashing ? '查找中' : '查找戒指'}</Text>
                </LinearGradient>
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

              {/* ★ 2026-11-07：固件广播名已上移为卡片标题；这里补机型 / 协议，不再重复占位文案 */}
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>机型</Text>
                <Text style={styles.metricVal}>
                  {model.id === 'BASE_UI' ? 'LunaMira 精简版' : 'HK18 / 全量版'}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>协议</Text>
                <Text style={styles.metricVal}>
                  {model.id === 'BASE_UI' ? 'v5 · 存储 3 天' : 'SDK 全量协议'}
                </Text>
              </View>
            </View>
          )}

          {/* 连接失败：错误提示框 */}
          {ringFailed && ring.error && (
            <View style={[styles.errorBox, { borderColor: theme.colors.ui.status.danger }]}>
              <Text style={[styles.errorText, { color: theme.colors.ui.status.danger }]}>{ring.error}</Text>
            </View>
          )}
        </Card>

        {/* ★ 2026-11-13（用户）：搜到多枚戒指时全部列出，由用户自己选；1 枚时 App 自动连。
            两枚同名 Lunamira 靠 MAC 尾号区分，不再显示「推荐」这种替用户做决定的标记。 */}
        {ring.devices.length > 0 && ring.status !== 'connected' && (
          <Card padded={false} style={styles.listCard}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <Text style={styles.rowDesc}>
                {ring.devices.length > 1
                  ? `检测到 ${ring.devices.length} 枚戒指，请选择要连接的那一枚`
                  : '搜索到的戒指'}
              </Text>
            </View>
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
                      size={theme.fontSize.card}
                      color={d.recommended ? theme.colors.textWhite : theme.colors.accentText}
                      strokeWidth={2}
                    />
                  </View>
                  <View style={styles.toggleText}>
                    <Text style={styles.rowTitle}>{d.name}</Text>
                    {/* ★ 2026-11-13（用户）：两枚同名 Lunamira 只靠 MAC 尾号分不清。
                        显示完整 MAC + 本机记住的固件版本/上次连接/电量，点选前就能认出是哪一枚。 */}
                    <Text style={styles.rowDesc}>{`MAC ${String(d.id)}`}</Text>
                    <Text style={styles.rowDesc}>
                      {d.rssi != null ? `信号 ${d.rssi}dBm` : '当前未广播'}
                      {d.firmware ? ` · 固件 ${d.firmware}` : ' · 固件待读取'}
                      {d.lastConnectedAt
                        ? ` · 上次连接 ${shortRingLastSeen(d.lastConnectedAt)}`
                        : ' · 未连接过'}
                      {d.lastBattery != null ? ` · 电量 ${d.lastBattery}%` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </Card>
        )}

        {/* 任何状态下都可点：强制重新扫描全部戒指（也用来解除「连接中」卡死） */}
        <TouchableOpacity
          onPress={() => RingBle.startScan()}
          activeOpacity={0.7}
          style={{ paddingVertical: 12, alignItems: 'center' }}
        >
          <Text style={{ color: theme.colors.accentText, fontSize: theme.fontSize.sm }}>
            重新扫描全部戒指
          </Text>
        </TouchableOpacity>

        {/* ★ 2026-11-07（用户）：「当前戒指 · 数据实况」整段卡片已按要求移除 */}

        <Text style={styles.sectionTitle}>数据备份（云端）</Text>
        <Card style={styles.uploadCard}>
          <View style={styles.uploadAutoRow}>
            <View style={styles.toggleText}>
              <Text style={styles.rowTitle}>自动上传云端</Text>
              <Text style={styles.rowDesc}>每约 4 小时自动同步到你的数据平台（也可随时手动上传）</Text>
            </View>
            <Toggle
              value={autoUpload}
              onValueChange={(v) => {
                setAutoUpload(v);
                void setAutoUploadEnabled(v);
              }}
            />
          </View>
          <View style={styles.divider} />
          <Text style={styles.uploadDesc}>
            你佩戴戒指积累的数据始终保存在本机。可手动点击上方按钮上传，或开启「自动上传云端」由 App 每约 4 小时自动同步。本机数据不会被删除。
          </Text>
          <TouchableOpacity
            onPress={uploadCloud}
            disabled={uploading}
            activeOpacity={0.7}
            style={[styles.uploadBtn, uploading && styles.uploadBtnBusy]}
          >
            {uploading ? (
              <Text style={styles.uploadBtnTextBusy}>{'上传中…'}</Text>
            ) : (
              <LinearGradient
                colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.uploadBtnGrad}
              >
                <Icon name="sync" size={theme.fs(14)} color={mm.colors.btnTextOnGrad} strokeWidth={2} />
                <Text style={styles.uploadBtnText}>{'上传云端'}</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>
          {uploadMsg && (
            <Text
              style={[
                styles.uploadMsg,
                { color: uploadMsg.startsWith('已') ? theme.colors.ui.status.good : theme.colors.ui.status.danger },
              ]}
            >
              {uploadMsg}
            </Text>
          )}
          <Text style={styles.uploadTime}>
            最近上传：{fmtUploadTime(ring.lastUploadedAt)}
          </Text>
        </Card>

        {/* ★ Phase 0（P0 合规）：隐私政策入口 */}
        <Text style={styles.sectionTitle}>关于与条款</Text>
        <Card padded={false} style={styles.listCard}>
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => navigation.navigate('PrivacyPolicy' as never)}
            activeOpacity={0.7}
          >
            <Icon name="mind" size={theme.fs(16)} color={mm.colors.ink} strokeWidth={2} />
            <Text style={styles.navRowTitle}>隐私政策与开源致谢</Text>
            <Icon name="chevronRight" size={theme.fs(16)} color={theme.colors.textSub} strokeWidth={2} />
          </TouchableOpacity>
          <View style={styles.divider} />
          {/* ★ 2026-11-09：检查更新 —— 读版本清单，有新版本就直接给下载入口 */}
          <TouchableOpacity style={styles.navRow} onPress={doCheckUpdate} activeOpacity={0.7}>
            <Icon name="sync" size={theme.fs(16)} color={mm.colors.ink} strokeWidth={2} />
            <Text style={styles.navRowTitle}>检查更新</Text>
            {updateState === 'checking' ? <Text style={styles.verRowVal}>检查中…</Text> : null}
            {updateState === 'available' ? <Text style={styles.verRowVal}>有新版本</Text> : null}
            {updateState === 'available' ? <View style={styles.updateDot} /> : null}
            <Icon name="chevronRight" size={theme.fs(16)} color={theme.colors.textSub} strokeWidth={2} />
          </TouchableOpacity>
          {updateState !== 'idle' && updateState !== 'checking' ? (
            <>
              <View style={styles.divider} />
              <View style={styles.updateResult}>
                {updateState === 'available' && updateInfo ? (
                  <>
                    <Text style={styles.updateTitle}>
                      新版本 v{updateInfo.versionName} · {formatApkSize(updateInfo.sizeBytes) || 'APK'}
                    </Text>
                    {updateInfo.notes ? <Text style={styles.updateNotes}>{updateInfo.notes}</Text> : null}
                    {downloading ? (
                      <View style={styles.updateProgressWrap}>
                        <View style={styles.updateProgressTrack}>
                          <View style={[styles.updateProgressFill, { width: `${Math.max(progress, 3)}%` }]} />
                        </View>
                        <Text style={styles.updateProgressPct}>{progress}%</Text>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.updateBtn} onPress={doDownloadUpdate} activeOpacity={0.8}>
                        <Text style={styles.diagBtnText}>下载并安装</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={styles.updateNotes}>
                      {downloading
                        ? '正在本地下载更新包，完成后会自动拉起系统安装器…'
                        : '点「下载并安装」即在本地下载并拉起安装（覆盖安装，本地数据不会丢）。'}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.updateNotes}>{updateMsg}</Text>
                )}
                {updateState === 'available' && updateMsg ? (
                  <Text style={styles.updateNotes}>{updateMsg}</Text>
                ) : null}
              </View>
            </>
          ) : null}
          <View style={styles.divider} />
          {/* ★ 本轮：设置页展示当前版本号（与 git tag 对齐） */}
          <View style={styles.verRow}>
            <Text style={styles.verRowTitle}>当前版本</Text>
            <Text style={styles.verRowVal}>{APP_VERSION_LABEL}</Text>
          </View>
          <View style={styles.verRow}>
            <Text style={styles.verRowTitle}>版本标记</Text>
            <Text style={styles.verRowVal}>{APP_VERSION_TAG}</Text>
          </View>
          {/* ★ 更新比对用的真相源（与 android/app/build.gradle 一致） */}
          <View style={styles.verRow}>
            <Text style={styles.verRowTitle}>版本代号</Text>
            <Text style={styles.verRowVal}>{APP_VERSION_NAME} ({APP_VERSION_CODE})</Text>
          </View>
        </Card>
      </ScreenContainer>
    </View>
  );
}

function fmtAgo(ts: number | null): string {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

function fmtUploadTime(ts: number | null): string {
  if (!ts) return '尚未上传';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugLabel}>{label}</Text>
      <Text style={styles.debugVal}>{value}</Text>
    </View>
  );
}

function Row({
  icon,
  tone = 'lav',
  title,
  desc,
  value,
  onValueChange,
}: {
  icon: any;
  /** v16 图标方块语义色（chipBg 五家族之一） */
  tone?: 'lav' | 'pink' | 'cyan' | 'lime' | 'butter';
  title: string;
  desc: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const chip = mm.chipBg[tone];
  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: chip.bg }]}>
        <Icon name={icon} size={theme.fontSize.lg} color={chip.fg} strokeWidth={2} />
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
  root: { flex: 1, width: '100%', backgroundColor: theme.colors.bgBottom },
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
    color: mm.colors.ink,
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
  // ── Phase 0：关于与条款导航行 ──
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(3),
    gap: theme.sp(2.5),
  },
  navRowTitle: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    fontWeight: theme.weight.medium,
  },
  // ★ 本轮：设置页版本号两行（与 git tag 对齐）
  verRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
  },
  verRowTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    fontWeight: theme.weight.medium,
  },
  verRowVal: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
  },
  // ── 检查更新 ──
  updateDot: {
    width: theme.fs(7),
    height: theme.fs(7),
    borderRadius: theme.fs(4),
    backgroundColor: '#E9705B',
    marginLeft: theme.sp(1),
  },
  updateResult: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(3),
    gap: theme.sp(2),
  },
  updateTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textBody,
  },
  updateNotes: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  updateBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentSolid,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
  },
  // ★ 2026-11-10：App 内下载进度条
  updateProgressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  updateProgressTrack: {
    flex: 1,
    height: theme.fs(8),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBorder,
    overflow: 'hidden',
  },
  updateProgressFill: {
    height: theme.fs(8),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSolid,
  },
  updateProgressPct: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textBody,
    minWidth: theme.fs(34),
    textAlign: 'right',
  },
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
  // ★ 渐变按钮铁律：渐变层作为正常流子元素、自带 padding 撑起尺寸；
  //   绝不用 absoluteFill（不占布局宽 → 外层无 padding 时按钮塌成 0 宽，点不到）。
  connectBtn: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: mm.colors.btnGradFrom,
  },
  connectBtnOn: { borderColor: 'rgba(120,120,140,0.28)', backgroundColor: 'rgba(120,120,140,0.18)' },
  connectBtnBusy: { backgroundColor: mm.colors.btnBusyBg, borderColor: 'rgba(120,120,140,0.28)' },
  connectBtnGrad: {
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textSub,
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(6),
  },
  connectBtnTextAlt: { color: theme.colors.textSub },
  connectBtnTextGrad: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.btnTextOnGrad,
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
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: mm.colors.btnGradFrom,
  },
  findBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  findBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.btnTextOnGrad,
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
    backgroundColor: theme.colors.ui.status.good,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.fs(3),
  },
  bar: {
    width: theme.fs(6),
    height: theme.fontSize.tiny,
    borderRadius: theme.fs(2),
    backgroundColor: theme.colors.cardBorder,
  },
  barOn: {
    backgroundColor: mm.colors.limeCore,
  },
  errorBox: {
    marginTop: theme.space.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.ui.status.dangerSoft,
    borderWidth: 1,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
  },
  debugCard: { marginBottom: theme.space.sm },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space.xs,
  },
  debugLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  debugVal: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  debugNote: {
    marginTop: theme.space.sm,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
  },
  debugKeys: {
    marginTop: theme.space.xs,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.5,
    color: theme.colors.textTitle,
  },
  debugPath: {
    marginTop: theme.space.sm,
    color: theme.colors.accentText,
  },
  diagBtns: {
    flexDirection: 'row',
    gap: theme.space.sm,
    marginTop: theme.space.sm,
  },
  diagBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentSolid,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
  },
  diagBtnAlt: {
    backgroundColor: 'rgba(120,120,140,0.18)',
  },
  diagBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  uploadCard: { marginBottom: theme.space.sm },
  uploadAutoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2.5),
  },
  uploadDesc: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.6,
    color: theme.colors.textSub,
    marginBottom: theme.space.md,
  },
  uploadBtn: {
    overflow: 'hidden',
    alignSelf: 'flex-start',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: mm.colors.btnGradFrom,
  },
  uploadBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
  },
  uploadBtnBusy: { backgroundColor: mm.colors.btnBusyBg, borderColor: 'rgba(120,120,140,0.28)' },
  uploadBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.btnTextOnGrad,
  },
  uploadBtnTextBusy: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textSub,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
  },
  uploadMsg: {
    marginTop: theme.space.sm,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
  },
  uploadTime: {
    marginTop: theme.space.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
  },
});
