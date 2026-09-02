"use strict";
// 本地版 llama.rn config plugin（修复 llama.rn@0.10.0-rc.0 与 Expo 51
// 的 @expo/config-plugins@8 不兼容：原插件用 require(...).default 取具名导出，
// 但 config-plugins 8 只暴露具名导出、无 default，导致 prebuild 报
// "Cannot destructure ... _configPlugins.default ... undefined"）。
// 这里改用具名导入，逻辑与原插件一致：iOS 强制 C++20（Xcode 工程 + Podfile post_install），
// prod 档案下追加内存/虚拟地址扩展 entitlement（端侧大模型需要）。

const { withDangerousMod, withXcodeProject, createRunOncePlugin } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PLUGIN_NAME = "llama-rn-plugin";
const PLUGIN_VERSION = "1.0.0";

const withLlamaRn = (config, options = {}) => {
  const {
    enableEntitlements = true,
    entitlementsProfile = "production",
    forceCxx20 = true,
  } = options;

  const isProdProfile =
    process.env.EAS_BUILD_PROFILE === entitlementsProfile ||
    process.env.NODE_ENV === "production" ||
    (Array.isArray(entitlementsProfile) &&
      entitlementsProfile.includes(process.env.EAS_BUILD_PROFILE || ""));

  if (enableEntitlements && isProdProfile) {
    config.ios = config.ios || {};
    config.ios.entitlements = config.ios.entitlements || {};
    config.ios.entitlements["com.apple.developer.kernel.extended-virtual-addressing"] = true;
    config.ios.entitlements["com.apple.developer.kernel.increased-memory-limit"] = true;
  }

  if (forceCxx20) {
    config = withXcodeProject(config, (c) => {
      const project = c.modResults;
      const configs = project.pbxXCBuildConfigurationSection();
      Object.values(configs).forEach((cfg) => {
        if (typeof cfg !== "object" || !cfg.buildSettings) {
          return;
        }
        cfg.buildSettings["CLANG_CXX_LANGUAGE_STANDARD"] = '"gnu++20"';
        cfg.buildSettings["CLANG_CXX_LIBRARY"] = '"libc++"';
        const current = String(cfg.buildSettings["OTHER_CPLUSPLUSFLAGS"] || "$(inherited)");
        if (!current.includes("-std=gnu++20")) {
          cfg.buildSettings["OTHER_CPLUSPLUSFLAGS"] = '"$(inherited) -std=gnu++20"';
          return;
        }
        if (!current.startsWith('"')) {
          cfg.buildSettings["OTHER_CPLUSPLUSFLAGS"] = `"${current}"`;
        }
      });
      return c;
    });

    config = withDangerousMod(config, [
      "ios",
      async (c) => {
        const podfilePath = path.join(c.modRequest.projectRoot, "ios", "Podfile");
        if (!fs.existsSync(podfilePath)) return c;
        const contents = fs.readFileSync(podfilePath, "utf8");
        if (contents.includes("LLAMA_RN_CXX20")) return c;
        const postInstallIdx = contents.indexOf("post_install do |installer|");
        if (postInstallIdx === -1) return c;
        const endIdx = contents.indexOf("\n  end", postInstallIdx);
        if (endIdx === -1) return c;
        const insert = `
    # LLAMA_RN_CXX20: Force C++20 on all Pods
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'gnu++20'
        config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
        config.build_settings['OTHER_CPLUSPLUSFLAGS'] = '$(inherited) -std=gnu++20'
      end
    end
`;
        const updated = contents.slice(0, endIdx) + insert + contents.slice(endIdx);
        fs.writeFileSync(podfilePath, updated);
        return c;
      },
    ]);
  }

  return config;
};

module.exports = createRunOncePlugin(withLlamaRn, PLUGIN_NAME, PLUGIN_VERSION);
