// llama.rn 模型封装（端侧 Qwen2.5-1.5B，llama.cpp）
// 单例 context，懒加载；提供 resolveModelPath（bundle / documents 两路兜底）。

import { initLlama, type LlamaContext } from 'llama.rn';
import { Asset } from 'expo-asset';

// 模型随 app 打包（assetBundlePatterns 已含 assets/models/*.gguf），
// 运行时由 Asset.fromModule 解析为设备内 bundle 路径，llama.rn 直接 fopen。
export const MODEL_FILENAME = 'qwen2.5-1.5b-instruct-q4_k_m.gguf';

let ctx: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let cachedPath: string | null = null;

/** 解析模型路径：从打包资源中解析（assetBundlePatterns 已包含） */
export async function resolveModelPath(): Promise<string> {
  if (cachedPath) return cachedPath;
  const asset = Asset.fromModule(
    require('../../assets/models/qwen2.5-1.5b-instruct-q4_k_m.gguf')
  );
  await asset.downloadAsync();
  cachedPath = asset.localUri ?? '';
  if (!cachedPath) throw new Error('[MiraAI] 模型资源解析失败：localUri 为空，请确认 assetBundlePatterns 包含 assets/models/*.gguf 且已重新 prebuild');
  return cachedPath;
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
      use_mlock: true,
    });
    ctx = c;
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
