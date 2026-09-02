#!/usr/bin/env node
"use strict";
// 把 assets/models/*.gguf 注册为 iOS Copy Bundle Resources。
// 不复制到 ios/ 目录（避免 1GB 模型重复占用磁盘），Xcode 构建时按相对路径从 assets/models 读取并拷进 app bundle。
// 直接运行：node scripts/link-model-ios.js
// 被 withLlamaRN config plugin require 调用：require('./scripts/link-model-ios').linkModelIos()

const fs = require("fs");
const path = require("path");

function findProjectRoot() {
  return path.resolve(__dirname, "..");
}

function addBundleResource(project, filePath, displayName, targetUuid, groupKey) {
  const quotedPath = `"${filePath}"`;
  const refSection = project.pbxFileReferenceSection();
  for (const k in refSection) {
    const ref = refSection[k];
    if (ref && (ref.path === quotedPath || ref.path === filePath)) {
      return { added: false, fileRef: k };
    }
  }

  const file = {
    basename: displayName,
    path: filePath,
    lastKnownFileType: "unknown",
    sourceTree: '"<group>"',
    group: "miraringfashion",
    includeInIndex: 0,
    target: targetUuid,
  };
  file.uuid = project.generateUuid();
  file.fileRef = project.generateUuid();
  project.addToPbxFileReferenceSection(file);
  project.addToPbxBuildFileSection(file);
  project.addToPbxResourcesBuildPhase(file);
  if (groupKey) project.addToPbxGroup(file, groupKey);

  // xcode 库对 undefined 字段会写出非法 "fileEncoding = undefined;"，手动清理
  const writtenRef = project.pbxFileReferenceSection()[file.fileRef];
  if (writtenRef) {
    delete writtenRef.fileEncoding;
    delete writtenRef.explicitFileType;
  }
  return { added: true, fileRef: file.fileRef, buildFile: file.uuid };
}

function linkModelIos(projectRoot = findProjectRoot()) {
  const modelDir = path.join(projectRoot, "assets", "models");
  if (!fs.existsSync(modelDir)) {
    console.warn("[link-model-ios] assets/models 不存在，跳过");
    return;
  }
  const ggufs = fs.readdirSync(modelDir).filter((f) => f.endsWith(".gguf"));
  if (ggufs.length === 0) {
    console.warn("[link-model-ios] assets/models 下无 .gguf 文件，跳过");
    return;
  }

  const iosDir = path.join(projectRoot, "ios");
  if (!fs.existsSync(iosDir)) {
    throw new Error("[link-model-ios] ios 目录不存在，请先执行 npx expo prebuild --platform ios");
  }
  // Expo prebuild 结构：ios/<projectName>.xcodeproj，源文件目录 ios/<projectName>/
  const xcodeprojs = fs
    .readdirSync(iosDir)
    .filter((d) => d !== "Pods" && d.endsWith(".xcodeproj"))
    .map((d) => path.join(iosDir, d));
  if (xcodeprojs.length === 0) {
    throw new Error("[link-model-ios] 找不到 iOS 主工程 .xcodeproj");
  }
  const xcodeproj = xcodeprojs[0];
  const projectName = path.basename(xcodeproj, ".xcodeproj");
  const appProjectDir = path.join(iosDir, projectName);
  const pbxproj = path.join(xcodeproj, "project.pbxproj");

  const xcode = require("xcode");
  const project = xcode.project(pbxproj);
  project.parseSync();

  const target = project.getFirstTarget();
  const targetUuid = target ? target.uuid : undefined;
  const mainGroupKey = project.findPBXGroupKey({ name: projectName });

  for (const gguf of ggufs) {
    const src = path.join(modelDir, gguf);
    // 相对路径基于 appProjectDir (ios/<projectName>/)
    // assets/models/foo.gguf -> ../../assets/models/foo.gguf
    const relativePath = path.relative(appProjectDir, src);

    const result = addBundleResource(project, relativePath, gguf, targetUuid, mainGroupKey);
    if (result.added) {
      console.log(`[link-model-ios] 已加入 Xcode resources: ${gguf}`);
    } else {
      console.log(`[link-model-ios] 已存在于 Xcode resources: ${gguf}`);
    }
  }

  fs.writeFileSync(pbxproj, project.writeSync());
  console.log("[link-model-ios] pbxproj 已更新:", pbxproj);
}

module.exports = { linkModelIos };

if (require.main === module) {
  linkModelIos();
}
