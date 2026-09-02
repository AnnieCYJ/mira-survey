#!/usr/bin/env node
"use strict";
// 把 assets/models/*.gguf 复制到 ios/<projectName>/ 并注册为 iOS Copy Bundle Resources。
// 文件放在主 group 目录下，用 <group> sourceTree 引用，Xcode 最可靠。
// 直接运行：node scripts/link-model-ios.js
// 被 withLlamaRN config plugin require 调用：require('./scripts/link-model-ios').linkModelIos()

const fs = require("fs");
const path = require("path");

/** 从 pbxproj 中移除指定文件名的所有旧引用（fileRef / buildFile / group children / resources phase） */
function removeExistingModelReferences(project, filename) {
  const fileRefSection = project.pbxFileReferenceSection();
  const buildFileSection = project.pbxBuildFileSection();
  const groupSection = project.hash.project.objects["PBXGroup"];
  const resourcesPhaseSection = project.hash.project.objects["PBXResourcesBuildPhase"];

  // 1. 找到所有同名（或 basename）fileRef uuid
  const fileRefUuids = [];
  for (const k in fileRefSection) {
    const ref = fileRefSection[k];
    if (ref && typeof ref === "object" && ref.isa === "PBXFileReference") {
      const isMatch =
        ref.name === `"${filename}"` ||
        ref.basename === `"${filename}"` ||
        ref.path === `"${filename}"` ||
        (ref.path && ref.path.includes(filename));
      if (isMatch) {
        fileRefUuids.push(k);
        delete fileRefSection[k];
        const commentKey = `${k}_comment`;
        if (fileRefSection[commentKey] !== undefined) delete fileRefSection[commentKey];
      }
    }
  }

  // 2. 找到并删除引用这些 fileRef 的 buildFile uuid
  const buildFileUuids = [];
  for (const k in buildFileSection) {
    const bf = buildFileSection[k];
    if (bf && typeof bf === "object" && bf.isa === "PBXBuildFile" && fileRefUuids.includes(bf.fileRef)) {
      buildFileUuids.push(k);
      delete buildFileSection[k];
      const commentKey = `${k}_comment`;
      if (buildFileSection[commentKey] !== undefined) delete buildFileSection[commentKey];
    }
  }

  // 3. 从所有 group children 中移除这些 uuid（children 元素是 {value, comment} 对象）
  //    兜底：comment 包含文件名的也一并移除，防止历史残留。
  for (const k in groupSection) {
    const group = groupSection[k];
    if (group && typeof group === "object" && group.isa === "PBXGroup" && Array.isArray(group.children)) {
      group.children = group.children.filter(
        (child) =>
          !fileRefUuids.includes(child.value) &&
          !buildFileUuids.includes(child.value) &&
          !(child.comment && child.comment.includes(filename))
      );
    }
  }

  // 4. 从 resources build phase 中移除这些 buildFile uuid
  //    兜底：comment 包含文件名的也一并移除。
  for (const k in resourcesPhaseSection) {
    const phase = resourcesPhaseSection[k];
    if (phase && typeof phase === "object" && phase.isa === "PBXResourcesBuildPhase" && Array.isArray(phase.files)) {
      phase.files = phase.files.filter(
        (child) =>
          !buildFileUuids.includes(child.value) && !(child.comment && child.comment.includes(filename))
      );
    }
  }
}

function findProjectRoot() {
  return path.resolve(__dirname, "..");
}

function addBundleResource(project, filePath, displayName, targetUuid, groupKey) {
  const refSection = project.pbxFileReferenceSection();
  for (const k in refSection) {
    const ref = refSection[k];
    if (ref && (ref.path === `"${filePath}"` || ref.path === filePath)) {
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

  // xcode 库对 undefined 字段会写出非法 "fileEncoding = undefined;"，手动清理；
  // 文件放在 ios/<projectName>/ 下，与主 group 同目录，因此用 <group> sourceTree 最可靠。
  const writtenRef = project.pbxFileReferenceSection()[file.fileRef];
  if (writtenRef) {
    delete writtenRef.fileEncoding;
    delete writtenRef.explicitFileType;
    writtenRef.sourceTree = '"<group>"';
    writtenRef.path = `"${filePath}"`;
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
    const dst = path.join(appProjectDir, gguf);

    // 复制到 ios/<projectName>/ 下，与主 group 同目录，Xcode 用 <group> sourceTree 最可靠。
    let needCopy = true;
    if (fs.existsSync(dst)) {
      const srcStat = fs.statSync(src);
      const dstStat = fs.statSync(dst);
      if (dstStat.size === srcStat.size) needCopy = false;
    }
    if (needCopy) {
      console.log(
        `[link-model-ios] 复制模型: ${gguf} (${(fs.statSync(src).size / 1024 / 1024 / 1024).toFixed(2)} GB)`
      );
      fs.copyFileSync(src, dst);
    } else {
      console.log(`[link-model-ios] 模型已存在且大小一致，跳过复制: ${gguf}`);
    }

    // 先移除旧的同名模型引用，避免重复添加导致 Ld 失败
    removeExistingModelReferences(project, gguf);

    // 文件在主 group 目录下，path 直接用文件名。
    const result = addBundleResource(project, gguf, gguf, targetUuid, mainGroupKey);
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
