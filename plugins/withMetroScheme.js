"use strict";
// 本地插件：在生成的 Xcode scheme 的 LaunchAction 里注入
// RCT_PACKAGER_HOSTNAME=Mac 局域网 IP，使 ⌘R 真机启动能确定性连上 Metro
// (192.168.1.5:8081)，不再依赖 Expo dev-launcher 不稳定的局域网自动发现。
// 因为 ios/ 由 prebuild 重建、且被 .gitignore 排除，手动改 scheme 会丢失，
// 故用插件在每次 prebuild 时自动注入。

const { withDangerousMod, createRunOncePlugin } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PLUGIN_NAME = "with-metro-scheme";
const PLUGIN_VERSION = "1.0.0";
const HOST = "192.168.1.12";

const withMetroScheme = (config) => {
  return withDangerousMod(config, [
    "ios",
    async (c) => {
      const schemeDir = path.join(
        c.modRequest.projectRoot,
        "ios",
        `${c.modRequest.projectName}.xcodeproj`,
        "xcshareddata",
        "xcschemes"
      );
      if (!fs.existsSync(schemeDir)) return c;
      const schemes = fs
        .readdirSync(schemeDir)
        .filter((f) => f.endsWith(".xcscheme"));
      for (const s of schemes) {
        const p = path.join(schemeDir, s);
        const content = fs.readFileSync(p, "utf8");
        if (content.includes("RCT_PACKAGER_HOSTNAME")) continue;
        const marker = 'allowLocationSimulation = "YES">';
        const idx = content.indexOf(marker);
        if (idx === -1) continue;
        const insert = `\n      <EnvironmentVariables>\n         <EnvironmentVariable\n            key = "RCT_PACKAGER_HOSTNAME"\n            value = "${HOST}"\n            isEnabled = "YES">\n         </EnvironmentVariable>\n      </EnvironmentVariables>\n`;
        const updated =
          content.slice(0, idx + marker.length) + insert + content.slice(idx + marker.length);
        fs.writeFileSync(p, updated);
      }
      return c;
    },
  ]);
};

module.exports = createRunOncePlugin(withMetroScheme, PLUGIN_NAME, PLUGIN_VERSION);
