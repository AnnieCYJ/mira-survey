// llama.rn 模型封装（端侧 Qwen2.5-1.5B，llama.cpp）
// 单例 context，懒加载。模型走 iOS bundle 原生资源，用 expo-file-system 取真实路径，
// 绕开 Metro 对 1.1GB 二进制资源的字符串长度限制。

import { initLlama, type LlamaContext } from 'llama.rn';
import * as FileSystem from 'expo-file-system';
import { postLog } from '../lib/logger';

export const MODEL_FILENAME = 'qwen2.5-1.5b-instruct-q4_k_m.gguf';

let ctx: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let cachedPath: string | null = null;

function normalizeNativePath(p: string | null | undefined): string {
  if (!p) return '';
  let s = p.startsWith('file://') ? p.slice('file://'.length) : p;
  s = s.replace(/\/$/, '');
  return s;
}

/** 解析模型路径：从 iOS app bundle 原生资源取 llama.rn 可用的本地路径 */
export async function resolveModelPath(): Promise<string> {
  if (cachedPath) return cachedPath;
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
  if (ctx) return Promise.resolve(ctx);
  if (loading) return loading;
  loading = (async () => {
    try {
      const model = await resolveModelPath();
      console.log('[MiraAI] initLlama:', model);
      const c = await initLlama({
        model,
        n_ctx: 2048,
        n_gpu_layers: 99, // iOS Metal 全卸载
        n_batch: 512, // 加速 prompt prefill（TTFT 关键）
        n_ubatch: 512,
        n_threads: 4, // CPU 部分并行（GPU offload 下仍有益）
        use_mlock: true,
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
      console.warn('[MiraAI] initLlama 失败（已允许下次重试）:', e);
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

export async function releaseLlama(): Promise<void> {
  if (ctx) {
    try {
      await ctx.release();
    } catch {
      /* ignore */
    }
    ctx = null;
    loading = null;
  }
}
