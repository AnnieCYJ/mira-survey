// llama.rn 模型封装（端侧 Qwen2.5-1.5B，llama.cpp）
// 单例 context，懒加载。模型走 iOS bundle 原生资源，用 expo-file-system 取真实路径，
// 绕开 Metro 对 1.1GB 二进制资源的字符串长度限制。

import { initLlama, type LlamaContext } from 'llama.rn';
import * as FileSystem from 'expo-file-system';

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
  })();
  return loading;
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
