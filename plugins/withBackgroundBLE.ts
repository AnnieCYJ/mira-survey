import { ConfigPlugin, withAndroidManifest } from '@expo/config-plugins';

const withBackgroundBLE: ConfigPlugin = (config) => {
  // Android: 加 foreground service 声明
  config = withAndroidManifest(config, async (conf) => {
    const { mainApplicationFile } = conf.modResults;
    // AndroidManifest 里加 service 声明（如果还没加）
    const manifestContent = conf.modResults;
    
    // 检查有没有 BLE foreground service
    let hasBleService = false;
    try {
      const appNode = manifestContent.manifest?.application?.[0];
      if (appNode?.service) {
        for (const svc of appNode.service) {
          if (svc['$']?.['android:name']?.includes?.('BleForeground')) { hasBleService = true; break; }
        }
      }
    } catch {}

    // 简单处理：往 application 节点塞一个 service 声明
    if (!hasBleService) {
      // 在 application 标签里加 service
      // 用 XML 字符串方式追加（AndroidManifest 可能不是纯 JSON，expo config-plugins 走的是 XML 解析）
    }
    
    return conf;
  });

  return config;
};

export default withBackgroundBLE;
