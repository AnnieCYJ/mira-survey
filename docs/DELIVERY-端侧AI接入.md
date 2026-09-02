# Mira App 端侧 AI 接入 — 交付与构建说明

> 把 Swift 原生版（mira-ios）的「端侧 Qwen2.5-1.5B + FTS5 记忆 + chat_context + 固定闺蜜角色卡 + 健康数据注入」整套大脑，**用 TS 重写进 Expo 版 mira-app 的 Mira AI 问答**。

## 已完成（沙箱内可验证部分）

- ✅ 依赖安装：`llama.rn@0.10`、`expo-sqlite@14`、`expo-build-properties@0.12`、`expo-asset`（已随 Expo 存在）
- ✅ `src/ai/` 全套模块（tsc 0 error）：
  - `character.ts` — 移植 `MiraCharacterCard`（Character Card V2：人设/世界书 8 健康域）+ 先共情后建议话术底座
  - `memory.ts` — `expo-sqlite` + FTS5 记忆层（中文 2/3-gram、`MATCH` + 时间衰减排序、上限 300、无 FTS5 降级 LIKE）
  - `context.ts` — `ChatContextStore` 跨会话 chat_context（情绪/主题/经期阶段）持久化
  - `model.ts` — `llama.rn` `initLlama` 单例封装 + `Asset.fromModule` 解析打包模型路径
  - `health.ts` — 从 `RingBle` 实时读 `daily` / `statusTimeline` / 周期相位，注入对话
  - `miraAi.ts` — 编排器（加载角色卡→注入话术→recall 记忆→load 上下文→注入健康→Qwen 生成→写回记忆/上下文），token 流式
  - `index.ts` — 统一导出
- ✅ `ChatScreen.tsx` / `ChatSheet.tsx` 改接真端侧 LLM（流式输出 + 失败回退关键词模板 + 沿用「放到工具页」任务建议）
- ✅ `app.json`：`expo-build-properties`(cxx20) + `llama.rn` 插件 + `assetBundlePatterns:["**/*"]`
- ✅ `metro.config.js`：把 `.gguf` 加进 `assetExts`（否则 `require` 解析失败）
- ✅ 模型权重 `assets/models/qwen2.5-1.5b-instruct-q4_k_m.gguf`（1.1GB）已就位，`.gitignore` 已排除（不进 git）

## 需要你做（沙箱不能 xcodebuild，必须真机/模拟器）

### 1. 重新 prebuild（插件 + 模型路径只在 prebuild 后生效）
```bash
cd /Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app
npx expo prebuild --platform ios --clean
```
> 改了 `app.json` 插件 / `metro.config.js` 后必须 `--clean` 重生成原生工程。

### 2. Xcode ⌘R 跑起来（dev build，dev-client 模式）
- 原生改动（llama.rn 插件、metro 配置）必须 ⌘R，纯 JS 改动才热更。
- 启动后第一次问 Mira AI 会自动 `initLlama` 加载 1.1GB 模型（首条消息会慢几秒，日志 `[MiraAI] initLlama: ...` 表示成功）。
- 验证：问「我最近状态怎么样」→ 应基于角色卡+记忆+健康数据生成自然回复，而非模板。

### 3. 若 initLlama 报模型找不到
日志会明确：`localUri 为空` 或 `model not found`。定位：
- 确认 `assets/models/` 下 GGUF 存在（1.1GB）且 `.gitignore` 没误伤引用路径。
- 确认 `assetBundlePatterns` 含 `**/*`（已配）。
- 确认跑了 `--clean` prebuild（旧原生工程不认新 asset）。

## 推 gitcode（待你给仓库地址）

两个工程都已在本地提交干净：
- `mira-ios`（Swift 端侧版）：本地 commit `5efa0c2`，**无 remote**，推前需 `git remote add` + `git push -u`
- `mira-app`（Expo 版，本次端侧 AI 接入）：本地 commit `9983c1c`，**无 remote**

> 建议建仓库时选 **Private（私有）** → 代码在 gitcode 云端但不公开。`.gguf` 权重与 `vendor/llama.cpp` 已被各自 `.gitignore` 排除，推上去是源码级备份。

给我 gitcode 仓库地址（两个工程可分别建，或同一 group 下两个 repo），我直接 `remote add` + `push -u`。
