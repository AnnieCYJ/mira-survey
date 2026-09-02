// 让 TS 接受对 .gguf 模型资源的 require（Asset.fromModule 期望资源模块 id）
declare module '*.gguf' {
  const value: number;
  export default value;
}
