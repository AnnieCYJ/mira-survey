// llama.rn 模型封装（端侧 Qwen2.5-1.5B，llama.cpp）
// 单例 context，懒加载。模型走 iOS bundle 原生资源，用 expo-file-system 取真实路径，
// 绕开 Metro 对 1.1GB 二进制资源的字符串长度限制。

import { initLlama, releaseAllLlama, type LlamaContext } from 'llama.rn';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { postLog } from '../lib/logger';
import { MODEL_CONTEXT_TOKENS } from './contextBudget';

export const MODEL_FILENAME = 'qwen2.5-1.5b-instruct-q4_k_m.gguf';

let ctx: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let cachedPath: string | null = null;
/**
 * ★★ 模型挂起（2026-09-27）：进入重内存场景（相机/相册）前调用 suspendModel()，
 * 之后任何 getLlamaContext() 直接快速失败（上层已有降级兜底），防止后台洞察任务
 * 把刚释放的 1GB 模型又加载回去。离开场景后 resumeModel() + warmupModel() 恢复。
 * 真机实证：use_mlock 钉死 1GB → 系统 wired 2.68GB / free 仅 27MB → 相机缓冲区分配
 * 失败 → launchCameraAsync 永不返回（JetsamEvent-2026-09-27-133123.ips 铁证）。
 */
let suspended = false;
export function suspendModel(): void { suspended = true; }
export function resumeModel(): void { suspended = false; }
/**
 * ★★ 2026-09-17：每个 JS 世代只清理一次「上次遗留在原生的 llama context」。
 * 为什么需要：llama.rn 的原生 context **不随 JS Runtime 销毁**。JS reload 后旧 Runtime 被释放，
 * 但旧 context 还挂在原生侧、还持有指向旧 Runtime 的 jsi 回调；一旦在新 Runtime 里再次
 * initLlama，原生侧触碰到已死 Runtime → EXC_BAD_ACCESS（崩溃栈 = rnllama_jsi::installJSIBindings，
 * 真机 4 次崩溃全部命中）→ 表现为「reload 后白屏」。
 * 每次真正加载模型前先 releaseAllLlama() 把这些残留 context 释放掉，即可根治。
 */
let didCleanStaleContexts = false;

function normalizeNativePath(p: string | null | undefined): string {
  if (!p) return '';
  let s = p.startsWith('file://') ? p.slice('file://'.length) : p;
  s = s.replace(/\/$/, '');
  return s;
}

/** 解析模型路径：iOS 走 app bundle 原生资源；Android 走 app 私有 files 目录（由 adb push 预置） */
export async function resolveModelPath(): Promise<string> {
  if (cachedPath) return cachedPath;
  if (Platform.OS === 'android') {
    // ★ 2026-11-06（用户：P30 真跑 AI）：Android 端 llama.rn 没有 bundle 资源概念，
    //   模型通过 `scripts/push-model-android.sh` 用 adb 推到 app 私有 files 目录
    //   （/data/data/com.miraringfashion.app/files/）。该路径 expo-file-system 可直接读。
    const dir = FileSystem.documentDirectory;
    const modelPath = `${dir}${MODEL_FILENAME}`;
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) {
      throw new Error(
        `[MiraAI] Android 模型未找到：${modelPath}\n` +
          '请先执行 `bash scripts/push-model-android.sh` 把 ' +
          MODEL_FILENAME +
          ' 推送到设备。'
      );
    }
    cachedPath = modelPath;
    return modelPath;
  }
  const rawBundleDir = FileSystem.bundleDirectory;
  if (!rawBundleDir) {
    throw new Error('[MiraAI] FileSystem.bundleDirectory 为空，无法定位模型');
  }
  const isUri = rawBundleDir.startsWith('file://');
  const bundlePath = normalizeNativePath(rawBundleDir);
  const modelUri = isUri
    ? `${rawBundleDir.replace(/\/$/, '')}/${MODEL_FILENAME}`
    : `file://${bundlePath}/${MODEL_FILENAME}`;
  const modelPath = `${bundlePath}/${MODEL_FILENAME}`;

  const info = await FileSystem.getInfoAsync(modelUri);
  if (!info.exists) {
    throw new Error(
      `[MiraAI] 模型未打包进 app bundle: ${modelPath}\n` +
        '请确认已执行 prebuild（withLlamaRN 插件会把 assets/models/*.gguf 拷进 iOS bundle resources）并重新 ⌘R。'
    );
  }
  cachedPath = modelPath;
  return modelPath;
}

export function getLlamaContext(): Promise<LlamaContext> {
  if (suspended) {
    return Promise.reject(new Error('[MiraAI] 模型已挂起（相机场景腾内存），任务走降级'));
  }
  if (ctx) return Promise.resolve(ctx);
  if (loading) return loading;
  loading = (async () => {
    try {
      // ★★ 2026-09-17：先释放「上次 reload 遗留在原生侧的 llama context」再加载模型，
      //    否则新 Runtime 里 initLlama 会触碰已死 Runtime → EXC_BAD_ACCESS → 白屏。
      //    每个 JS 世代只做一次（didCleanStaleContexts），不影响本世代后续推理。
      if (!didCleanStaleContexts) {
        didCleanStaleContexts = true;
        try {
          await releaseAllLlama();
          console.log('[MiraAI] 已释放遗留的原生 llama context（防 reload 崩溃）');
        } catch (e) {
          console.log('[MiraAI] releaseAllLlama 失败（忽略，继续加载）:', e);
        }
      }
      const model = await resolveModelPath();
      console.log('[MiraAI] initLlama:', model);
      // ★ 2026-11-06（用户：P30 真跑 AI）：Android 走 llama.cpp CPU 后端（n_gpu_layers=0），
      //   避开麒麟 980 的 Vulkan/OpenCL 兼容坑，保证一定能加载（1.5B q4 在 CPU 上约 10–20 tok/s，可用）；
      //   iOS 维持 Metal 全卸载（n_gpu_layers=99）。
      const isAndroid = Platform.OS === 'android';
      const c = await initLlama({
        model,
        n_ctx: MODEL_CONTEXT_TOKENS,
        n_gpu_layers: isAndroid ? 0 : 99,
        n_batch: 512, // 加速 prompt prefill（TTFT 关键）
        n_ubatch: 512,
        n_threads: isAndroid ? 4 : 4, // CPU 部分并行（GPU offload 下仍有益）
        // ★ 2026-09-27 移除 use_mlock：它把 ~1GB 模型内存钉成 wired 不可换出，
        //   iPhone 13 4GB 上直接把全机 free 内存压到 27MB，相机等重内存场景全部卡死。
      });
      ctx = c;
      // —— 诊断：确认 GPU/Metal 是否真的启用（慢的根因往往在这里）——
      // 真机 ⌘R 后看 Xcode 控制台 [MiraAI] 行：gpu=true 才正常；false 说明回落 CPU。
      console.log(
        '[MiraAI] 模型已加载 | gpu=',
        c.gpu,
        '| reasonNoGPU=',
        c.reasonNoGPU || '-',
        '| devices=',
        JSON.stringify(c.devices || []),
        '| n_params=',
        c.model?.nParams,
        '| systemInfo=',
        c.systemInfo
      );
      return c;
    } catch (e) {
      // ★ 关键修复：失败必须清空 loading，否则这个 rejected Promise 会被永久缓存，
      //   之后每次 getLlamaContext() 都直接返回它 →「模型失败一次 = 整轮会话永久走规则文案」。
      //   清空后下一次调用会重新尝试加载（内存/瞬时失败可自愈）。
      loading = null;
      console.log('[MiraAI] initLlama 失败（已允许下次重试）:', e);
      throw e;
    }
  })();
  return loading;
}

// ── 推理串行化（排队 + 去重 + busy 退避） ────────────────────────────────────
/**
 * ★ 为什么必须串行：llama.rn 的 `ctx` 是**单例**，同一时刻只允许一个 completion。
 * 并发调用会直接抛 `Exception in HostFunction: Context is busy`（真机日志已复现），
 * 上层 catch 后**静默回落规则文案** → 表现成「AI 有时不出内容/只有规则文案」，且不报错给用户。
 * 真机上很容易撞到：进洞察页时 overview + cycle + today 三个通道几乎同时发起；
 * 或 AI 分析生成时用户点开聊天。
 *
 * 策略：
 *  ① **排队**：`inferenceChain` 串成一条链，前一个任务结束（无论成功/失败）才启动下一个；
 *  ② **去重**：同一 `key`（如 `recovery@2026-09-16`）在飞行中的重复请求直接复用同一个 Promise；
 *  ③ **busy 退避**：万一原生侧上一次推理还占着（例如异常路径未释放），退避后重试一次，
 *     避免直接降级成规则文案。
 */
let inferenceChain: Promise<unknown> = Promise.resolve();
const inFlightByKey = new Map<string, Promise<unknown>>();

async function invokeWithRetry<T>(task: (ctx: LlamaContext) => Promise<T>, tries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await getLlamaContext();
    try {
      return await task(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < tries - 1 && /busy/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw e;
    }
  }
}

/**
 * 在**唯一**的端侧模型上执行一次推理（串行 + 可选去重）。
 * 所有 `ctx.completion(...)` 调用都必须走这里，不要再直接用 `getLlamaContext()`。
 *
 * @param task 收到 context 后执行推理的闭包
 * @param key  可选的去重键；相同 key 的并发请求会复用同一次推理
 */
export function runOnModel<T>(task: (ctx: LlamaContext) => Promise<T>, key?: string): Promise<T> {
  if (key) {
    const hit = inFlightByKey.get(key);
    if (hit) {
      // 命中去重：这是「复用」不是「新推理」，单独记一笔便于排查"为什么没有新文案"
      try {
        postLog('MiraAI', `推理去重命中 key=${key}（复用进行中的同 key 请求）`);
      } catch {
        /* 日志失败不影响推理 */
      }
      return hit as Promise<T>;
    }
  }
  const enqueuedAt = Date.now();
  const run = inferenceChain.then(async () => {
    // ★ 耗时埋点：排队等待 / 实际推理 / 输出字数（落到 :8899 日志）。
    //   实测（2026-09-16 真机）：单次生成约 10–15s，且**与输出字数无关**
    //   （55 字与 193 字耗时几乎相同）→ 主要成本是 prompt prefill（读事实串），不是吐字。
    const waitMs = Date.now() - enqueuedAt;
    const t0 = Date.now();
    try {
      const out = await invokeWithRetry(task);
      const size = typeof out === 'string' ? `${(out as unknown as string).length}字` : '';
      postLog('MiraAI', `推理完成 key=${key ?? '-'} 排队=${waitMs}ms 推理=${Date.now() - t0}ms ${size}`);
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      postLog('MiraAI', `推理失败 key=${key ?? '-'} 排队=${waitMs}ms 耗时=${Date.now() - t0}ms：${msg}`);
      throw e;
    }
  });
  // 队列不能因单个任务失败而断掉：吞掉异常继续接力（异常仍原样抛给调用方）
  inferenceChain = run.then(
    () => undefined,
    () => undefined
  );
  if (!key) return run;
  const tracked = run.then(
    (v) => {
      inFlightByKey.delete(key);
      return v;
    },
    (e) => {
      inFlightByKey.delete(key);
      throw e;
    }
  );
  inFlightByKey.set(key, tracked as Promise<unknown>);
  return tracked;
}

let releaseSeq = 0;
export async function releaseLlama(): Promise<void> {
  // ★★ 修崩溃（2026-10-01 真机 .ips 铁证：EXC_BAD_ACCESS @ rnllama_jsi::createCompletionResult）：
  //   释放时若推理链上还有飞行中的 completion（单次推理 10–15s），native 回调回来取结果时
  //   访问的已是已释放的 context → JS 线程 SIGSEGV、App 闪退（打开 FoodScan 触发释放时撞上
  //   MiraAI 后台洞察推理，必崩）。所以必须先等推理链清空（链上已吞异常，不会 reject）再释放。
  const gen = ++releaseSeq;
  await inferenceChain.catch(() => undefined);
  // ★ 修崩溃 2（2026-10-01 15:41 .ips：lm_ggml_metal_synchronize ← initLlama abort）：
  //   等链清空期间用户退出页面 → cleanup 的 resumeModel()+warmupModel() 开始重新加载模型，
  //   而本函数还没返回 → 继续把刚加载/加载中的模型 release → init 与 release 并发操作 Metal → abort。
  //   所以等待结束后必须复查：场景已退出（resume）或释放请求已被更新的调用取代 → 放弃释放。
  if (gen !== releaseSeq || !suspended) return;
  // ★ 修竞态（2026-09-27）：若 initLlama 还在飞行中，此时 ctx 为 null、直接返回会
  //   「释放了个寂寞」——加载完成后模型照样常驻（真机日志已复现：release 后紧跟
  //   「模型已加载」）。必须先等 loading 落地，再释放。
  if (loading) {
    try { await loading; } catch { /* 加载失败也无 ctx 可释放 */ }
  }
  if (!suspended) return; // 等 loading 期间可能又被 resume（用户快速进出页面）
  if (ctx) {
    const c = ctx;
    ctx = null; // 先摘引用再释放：防并发的 releaseLlama 双重 release
    try {
      await c.release();
      console.log('[MiraAI] 模型已释放，内存已归还系统');
    } catch {
      /* ignore */
    }
    loading = null;
  }
}

/** 🔥 App 启动时后台预热模型（不要 await，不阻塞 UI） */
export function warmupModel(): void {
  getLlamaContext().then(
    (c) => console.log('[MiraAI] ✅ 模型预热完成, gpu=', c.gpu),
    (e) => console.log('[MiraAI] 预热失败（不影响首次 ask，会重试）:', e)
  );
}
