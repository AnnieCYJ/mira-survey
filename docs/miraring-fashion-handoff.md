# Mira Ring Fashion（miraringfashion）App 开发存档

> 存档时间：2026-09-01
> 存档位置：本地磁盘 `/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app`
> 说明：本文档汇总 mira-app 的项目定位、今日（2026-09-01）完成的工作、全部代码绝对路径、关键技术决策与已知问题，作为交付/回溯底稿。

---

## 1. 项目定位

Mira = 全球首款女性周期-心理健康 AI 戒指（硬件 $199 + 订阅 $99/年 + B2B）。
本 App 为戒指配套端，覆盖五大维度（周期 / 睡眠 / 代谢 / 心脏 / 心理）+ AI 对话 + 任务 + 日历。

- 工程名：`mira-app`（即 miraringfashion 的 App 工程）
- 本地根目录：`/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app`

## 2. 技术栈与约束

| 项 | 选型 |
|---|---|
| 框架 | Expo 51 / React Native 0.74 |
| 语言 | TypeScript |
| 导航 | React Navigation 6（自定义 TabBar，中间凸起 = Mira AI） |
| 状态 | React Context（不引 Redux） |
| 动画 | 内置 Animated（不引第三方） |
| UI | 全自绘，SVG 用 react-native-svg |
| 设计系统 | 集中 `src/theme/theme.ts`，组件层禁裸值 |
| 真机数据 | Veepoo 官方 iOS SDK（预编译 framework，经 ObjC 桥 `ios/VeepooRing/`） |
| 本机环境 | Xcode GUI ⌘R 才能编原生；纯 JS/CSS 改动 Metro 热更即可 |

## 3. 今日（2026-09-01）完成的工作

1. **状态值四档切点改为均匀 25 段**：元气满满 76–100 / 状态良好 51–75 / 平平静静 26–50 / 休息一下 1–25。
2. **全天状态趋势图（TrendChart）重写**：按真实时间戳在 0–24h 轴落点（半小时一个采样），不再按数组下标均匀拉伸；每个点可点击弹详情气泡（等级名 + 值 + 采样时刻）；点色与首页圆环四色同源。
3. **首页圆环（EnergyBall）**：中心显示等级名 + 状态值（如"状态良好 / 状态值：35"），四色对应四档。
4. **删除圆环下「今日状态」卡片（DailyStatusCard 在首页的渲染）**，首页仅留圆环 + 全天趋势 + 今日建议。
5. **趋势图下方横轴说明文字移除**。
6. **圆环下方新增一行状态分析（glass 胶囊）**：状态胶囊 + 相位标签（黄体期等）+ 建议描述，统一 design token。
7. **周期数据通路修复**：用户记了经期但状态行显示"未记录"——根因是 `resolveCycle` 只读取 `state.female`（戒指回传，实际为空），未合并本地 `cycleLog`。已合并两者，并让 `CyclePhaseCard` 保存后即时刷新。
8. **AI chatbot 现状核查**：确认当前 App 的 AI 对话 = 本地关键词模板 `pickReply`（`src/data/chat.ts`），**未接入任何云端或端侧模型**（详见第 7 节）。

## 4. 全部代码文件清单（绝对路径）

### 今日改动文件（2026-09-01）
```
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/screens/TodayScreen.tsx           (23:22) 删今日状态卡/状态分析行/趋势图例+横轴
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/screens/InsightScreen.tsx         (18:42) 洞察页读 ring.daily
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/screens/SettingsScreen.tsx        (21:22) RingState 字面量补字段
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/EnergyBall.tsx         (21:32) 圆环四色 + 状态值
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/DailyStatusCard.tsx     (22:50) 趋势图点色/等级名对齐圆环
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/TrendChart.tsx         (23:14) 真实时间轴落点 + 点可点击
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/CyclePhaseCard.tsx     (23:18) 保存后调 refreshLocalCycle
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/BasicMetricCard.tsx     (12:27) 基础指标卡
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/ManualMetricCard.tsx    (14:49) 手动测量卡
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/SleepStageChart.tsx     (17:36) 睡眠分期图
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/SleepStructureCard.tsx  (17:51) 睡眠结构卡
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/components/TempBiphasicChart.tsx  (19:27) 体温双相图
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/ble/RingBleManager.ts              (23:19) 状态曲线接入 + 周期合并修复
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/lib/dailyStatus.ts                 (22:39) 累积能量模型 + 均匀25段切点
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/lib/cycleMath.ts                   (19:26) 周期计算
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/data/metrics.ts                    (21:31) MOODS 四档名
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/data/cycleLog.ts                   (18:29) 本地经期记录
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/src/utils/format.ts                    (12:27) 格式化工具
```

### 关键支撑文档
```
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/docs/daily-status-curve-spec.md     状态曲线算法 spec（v2 累积能量模型）
/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/docs/miraring-fashion-handoff.md     本存档文档
```

## 5. 状态值（电量）模型要点

- 内部量 `S(t)` = 0–100 绝对电量刻度；`Score(t) = Score(t-1) + ΔE`（累积更新，非每日总分）。
- 晨间种子 `S0` 每日仅算一次并锁死；白天按恢复/消耗累积。
- 四档切点（均匀 25 段）：元气满满 76+ / 状态良好 51–75 / 平平静静 26–50 / 休息一下 ≤25。
- 趋势图与圆环共用 `MOODS` 四色（金/青/紫/粉），数据来源 `ring.statusTimeline`（每 30 分钟一点）。

## 6. 周期数据通路（已修复）

- 用户记经期：UI（`CyclePhaseCard`）→ 存本地 `cycleLog` 文件 + `RingBle.writeFemale`（仅写硬件）。
- 修复前：`RingBleManager.resolveCycle()` 只读 `state.female`（戒指回传，实际恒空）→ 相位判"未记录"。
- 修复后：启动时读本地 `cycleLog` 缓存；`resolveCycle` 合并 female + localCycle（取更晚经期开始日）；`buildCurveStatus` 相位跟随实时 cycle；`CyclePhaseCard` 保存后 `refreshLocalCycle()` 即时刷新，无需 ⌘R。

## 7. AI Chatbot 现状（重要）

**当前 App 的 AI 对话没有接入任何模型。**
- `ChatScreen.tsx` / `ChatSheet.tsx` 的回复全部来自 `src/data/chat.ts` 的 `pickReply(q)`：按关键词（累/压力/周期/训练/睡）匹配，返回写死的文案模板。
- 全工程无 `openai / anthropic / ollama / qwen / llama` 等任何模型调用；无 AI service 文件。
- `src/data/chat.ts` 里的回复带有"人格化语气"（不评判、共情、数据+体感并列），并引用周期/HRV/深睡等数据——但这是**写死的模板**，不是运行时可调用的模型 + 持久化记忆。
- ima 文档里提到的"端侧模型 / 五人格 Prompt / 记忆 lite"属于**另一个原型项目**的文档，未迁移进本工程。

> 若需真正接入模型：本机有 `mira-local-llm-proxy` skill，可给 App 加 `fetch` 到本地 Ollama（如 `qwen2.5:7b`）或按文档切 TokenHub（云·混元 `hy3-preview`）。

## 8. 已知问题 / 待办

- 本工程**不是 git 仓库**（无版本管理/云端备份），改动仅存本地磁盘，误删或目录清理即丢失，且无法回退。
- 趋势图（TrendChart）仍用 `react-native-svg` 的 Path/Circle；之前 DailyStatusCard 因 SVG 动态 props 在 iOS 崩溃已转纯 View。若 TrendChart 在真机也报 `Malformed calls from JS`，需整体转纯 View。
- 标定（`#95`）：用 `collector.log` 精修 `CURVE_DEFAULTS` 速率常数，非阻塞，待做。
- 真机验证：纯 JS 改动需手机 **Reload**（摇一摇 → Reload）或 **⌘R**（scheme 已注入 `RCT_PACKAGER_HOSTNAME=192.168.1.5`）才生效。

## 9. 真机预览前提

- Metro 常驻 `:8081`；Mac IP `192.168.1.5`；系统防火墙关；`curl http://192.168.1.5:8081/status` 返 200。
- 手机同 Wi-Fi（192.168.1.x）；若连不上，App 内 shake → Configure Bundler 填 `192.168.1.5:8081` → Reload。
