"use strict";
// 本地插件：在生成的 Xcode scheme 的 LaunchAction 里注入
// RCT_PACKAGER_HOSTNAME=Mac 局域网 IP，使 ⌘R 真机启动能确定性连上 Metro
// （自动探测当前 Mac 局域网 IP:8081），不再依赖 Expo dev-launcher 不稳定的局域网自动发现。
// 因为 ios/ 由 prebuild 重建、且被 .gitignore 排除，手动改 scheme 会丢失，
// 故用插件在每次 prebuild 时自动注入 / 刷新。
//
// 注意：早期把 IP 写死成 192.168.1.2，DHCP 换网后 Mac 变成 192.168.1.5，
// 导致真机红屏 "No bundle URL present"。现改为每次动态探测，并在已存在时刷新 value。

const { withDangerousMod, createRunOncePlugin } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PLUGIN_NAME = "with-metro-scheme";
const PLUGIN_VERSION = "1.0.0";

// 动态探测当前 Mac 的局域网 IPv4：优先 en0/en1，排除回环与 169.254 link-local。
function detectLanIp() {
  const ifaces = os.networkInterfaces();
  const found = [];
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue;
      found.push({ name, address: info.address });
    }
  }
  for (const preferred of ["en0", "en1"]) {
    const hit = found.find((f) => f.name === preferred);
    if (hit) return hit.address;
  }
  return found.length ? found[0].address : "127.0.0.1";
}

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
      const host = detectLanIp();
      const schemes = fs
        .readdirSync(schemeDir)
        .filter((f) => f.endsWith(".xcscheme"));
      for (const s of schemes) {
        const p = path.join(schemeDir, s);
        let content = fs.readFileSync(p, "utf8");
        if (content.includes("RCT_PACKAGER_HOSTNAME")) {
          // 已存在：把 value 刷新为当前 IP，避免换网后残留旧地址
          content = content.replace(
            /(key = "RCT_PACKAGER_HOSTNAME"\s+value = ")[^"]*(")/,
            `$1${host}$2`
          );
          fs.writeFileSync(p, content);
          continue;
        }
        const marker = 'allowLocationSimulation = "YES">';
        const idx = content.indexOf(marker);
        if (idx === -1) continue;
        const insert = `\n      <EnvironmentVariables>\n         <EnvironmentVariable\n            key = "RCT_PACKAGER_HOSTNAME"\n            value = "${host}"\n            isEnabled = "YES">\n         </EnvironmentVariable>\n      </EnvironmentVariables>\n`;
        const updated =
          content.slice(0, idx + marker.length) + insert + content.slice(idx + marker.length);
        fs.writeFileSync(p, updated);
      }
      return c;
    },
  ]);
};

module.exports = createRunOncePlugin(withMetroScheme, PLUGIN_NAME, PLUGIN_VERSION);
