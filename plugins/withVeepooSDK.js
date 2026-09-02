const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin: embeds the Veepoo SDK + its dependency frameworks into the iOS build
 * and compiles the local VeepooRing native bridge.
 *
 * The framework bundle + bridge source live under <projectRoot>/veepoo-assets (committed),
 * because `expo prebuild` regenerates ios/ from the Expo template. On every prebuild we copy
 * the assets into ios/ and wire them into the generated Xcode project.
 *
 * Reference configuration (works on real device):
 *   MiraRingProbe/project.yml
 */
function withVeepooSDK(config) {
  config = withXcodeProject(config, (c) => {
    const projectRoot = c.modRequest.projectRoot;
    const iosDir = path.join(projectRoot, 'ios');
    const fwDir = path.join(iosDir, 'Frameworks');
    const srcM = path.join(iosDir, 'VeepooRing', 'VeepooRing.m');
    const srcH = path.join(iosDir, 'VeepooRing', 'VeepooRing.h');

    // Copy committed assets into ios/ on every prebuild so incremental builds also pick up
    // framework updates.
    const assetsSrc = path.join(projectRoot, 'veepoo-assets');
    const copyAssetDir = (relSrc, relDst) => {
      const s = path.join(assetsSrc, relSrc);
      const d = path.join(iosDir, relDst);
      if (!fs.existsSync(s)) return false;
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.rmSync(d, { recursive: true, force: true });
      fs.cpSync(s, d, { recursive: true, force: true });
      console.log('[withVeepooSDK] copied', relSrc, '->', relDst);
      return true;
    };
    const copyFrameworks = () => {
      const srcDir = path.join(assetsSrc, 'Frameworks');
      const dstDir = path.join(iosDir, 'Frameworks');
      if (!fs.existsSync(srcDir)) return false;
      fs.mkdirSync(dstDir, { recursive: true });
      for (const name of fs.readdirSync(srcDir)) {
        if (!name.endsWith('.framework')) continue;
        const s = path.join(srcDir, name);
        const d = path.join(dstDir, name);
        fs.rmSync(d, { recursive: true, force: true });
        fs.cpSync(s, d, { recursive: true, force: true });
      }
      console.log('[withVeepooSDK] copied frameworks', srcDir, '->', dstDir);
      return true;
    };

    const haveFrameworks = copyFrameworks();
    const haveBridge = copyAssetDir('VeepooRing', 'VeepooRing');

    if (!haveFrameworks || !haveBridge) {
      console.warn('[withVeepooSDK] missing veepoo-assets/Frameworks or veepoo-assets/VeepooRing - skipping');
      return c;
    }
    if (!fs.existsSync(srcM)) {
      console.warn('[withVeepooSDK] VeepooRing.m not found at', srcM, '- skipping');
      return c;
    }

    const project = c.modResults;
    const target = project.getFirstTarget();
    const targetUuid = target.uuid;
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;

    // Idempotency: match file references by basename so re-runs don't duplicate entries.
    const hasBasename = (bn) => {
      const section = project.pbxFileReferenceSection();
      if (!section) return false;
      return Object.values(section).some((fr) => {
        if (!fr || fr.isa !== 'PBXFileReference') return false;
        const raw = String(fr.path);
        const p = raw.replace(/^"|"$/g, '');
        return path.basename(p) === bn;
      });
    };

    // Ensure the "Embed Frameworks" copy-files phase exists before addFramework tries to use it.
    if (!project.buildPhaseObject('PBXCopyFilesBuildPhase', 'Embed Frameworks', targetUuid)) {
      try {
        project.addBuildPhase([], 'PBXCopyFilesBuildPhase', 'Embed Frameworks', targetUuid, 'frameworks', '');
      } catch (e) {
        console.warn('[withVeepooSDK] addBuildPhase failed:', e.message);
      }
    }

    // Discover all frameworks under ios/Frameworks and add them to the project.
    // Reference project links all of them; embeds all EXCEPT VeepooBleSDK.
    const frameworks = fs.readdirSync(fwDir)
      .filter((n) => n.endsWith('.framework'))
      .sort();

    for (const name of frameworks) {
      const fwPath = path.join(fwDir, name);
      const binPath = path.join(fwPath, path.basename(name, '.framework'));
      if (!fs.existsSync(binPath)) {
        console.warn('[withVeepooSDK] skipping framework without binary:', name);
        continue;
      }
      if (hasBasename(name)) {
        console.log('[withVeepooSDK] framework already in project:', name);
        continue;
      }
      const isVeepoo = name === 'VeepooBleSDK.framework';
      try {
        project.addFramework(fwPath, {
          customFramework: true,
          embed: !isVeepoo,
          link: true,
          sign: !isVeepoo,
          target: targetUuid,
        });
        console.log('[withVeepooSDK] added framework', name, 'embed=', !isVeepoo);
      } catch (e) {
        console.warn('[withVeepooSDK] addFramework failed for', name, ':', e.message);
      }
    }

    // Add the bridge source files.
    try {
      if (!hasBasename('VeepooRing.m')) {
        const mRef = project.addSourceFile(srcM, { target: targetUuid }, mainGroupKey);
        if (!mRef) {
          console.warn('[withVeepooSDK] addSourceFile returned false for', srcM);
        } else {
          console.log('[withVeepooSDK] added', path.basename(srcM));
        }
      }
      if (fs.existsSync(srcH) && !hasBasename('VeepooRing.h')) {
        project.addHeaderFile(srcH, { target: targetUuid }, mainGroupKey);
      }
    } catch (e) {
      console.warn('[withVeepooSDK] add source/header failed:', e.message);
    }

    // Build settings: search paths, -ObjC, bitcode, archs.
    const fspNeed = '"$(SRCROOT)/Frameworks"';
    const lspNeed = '"$(SRCROOT)/Frameworks"';

    const configs = project.pbxXCBuildConfigurationSection();
    Object.keys(configs).forEach((key) => {
      const cfg = configs[key];
      if (!cfg || !cfg.buildSettings) return;
      const bs = cfg.buildSettings;

      // FRAMEWORK_SEARCH_PATHS
      const fsp = bs['FRAMEWORK_SEARCH_PATHS'];
      let fspArr = Array.isArray(fsp) ? fsp.slice() : (fsp ? [fsp] : []);
      fspArr = fspArr.filter((v) => {
        const s = String(v);
        // Drop old absolute paths that pointed at a single framework or the ios dir.
        return !s.includes('/VeepooBleSDK.framework') && !s.includes('/ios/Frameworks');
      });
      if (!fspArr.some((v) => String(v).includes('$(SRCROOT)/Frameworks'))) {
        fspArr.push('"$(inherited)"', fspNeed);
      }
      bs['FRAMEWORK_SEARCH_PATHS'] = uniqueArray(fspArr);

      // LIBRARY_SEARCH_PATHS (defensive; reference project sets it too)
      const lsp = bs['LIBRARY_SEARCH_PATHS'];
      let lspArr = Array.isArray(lsp) ? lsp.slice() : (lsp ? [lsp] : []);
      if (!lspArr.some((v) => String(v).includes('$(SRCROOT)/Frameworks'))) {
        lspArr.push('"$(inherited)"', lspNeed);
      }
      bs['LIBRARY_SEARCH_PATHS'] = uniqueArray(lspArr);

      // OTHER_LDFLAGS: ensure -ObjC, remove old -force_load / framework-dir entries.
      const ldflags = bs['OTHER_LDFLAGS'];
      let ldfArr = Array.isArray(ldflags) ? ldflags.slice() : (ldflags ? [ldflags] : []);
      const cleaned = [];
      for (let i = 0; i < ldfArr.length; i++) {
        const cur = String(ldfArr[i]).replace(/"/g, '').trim();
        const next = String(ldfArr[i + 1] || '').replace(/"/g, '').trim();
        // Drop standalone '-force_load' and the following path if it points at any of our frameworks.
        if (cur === '-force_load' && next.includes('Frameworks/') && next.includes('.framework')) {
          i++;
          continue;
        }
        // Drop any remaining framework path entries that point at framework binaries.
        if (cur.includes('.framework/') && !cur.includes('-force_load')) {
          continue;
        }
        cleaned.push(ldfArr[i]);
      }
      ldfArr = cleaned;
      if (!ldfArr.some((v) => String(v).replace(/"/g, '').trim() === '-ObjC')) {
        ldfArr.push('"-ObjC"');
      }
      bs['OTHER_LDFLAGS'] = uniqueArray(ldfArr);

      // Architecture / bitcode settings from the reference project.
      bs['ENABLE_BITCODE'] = 'NO';
      bs['BUILD_LIBRARY_FOR_DISTRIBUTION'] = 'NO';
      bs['VALID_ARCHS'] = '"arm64 arm64e"';

      // Runpath search paths so embedded dynamic frameworks are found at launch.
      const rpath = bs['LD_RUNPATH_SEARCH_PATHS'];
      let rpathArr = Array.isArray(rpath) ? rpath.slice() : (rpath ? [rpath] : []);
      for (const need of ['@executable_path/Frameworks', '@loader_path/Frameworks']) {
        if (!rpathArr.some((v) => String(v).includes(need))) {
          rpathArr.push('"' + need + '"');
        }
      }
      bs['LD_RUNPATH_SEARCH_PATHS'] = uniqueArray(rpathArr);
    });

    fixAbsolutePaths(project, iosDir);
    cleanUndefinedFileRefs(project);

    return c;
  });

  // Post-write text sweep to remove any ` = undefined;` tokens and ensure the workspace exists.
  config = withDangerousMod(config, 'ios', (c) => {
    const iosDir = path.join(c.modRequest.projectRoot, 'ios');
    let pbxPath = null;
    const walk = (dir) => {
      if (pbxPath) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name.endsWith('.xcodeproj')) {
            const cand = path.join(full, 'project.pbxproj');
            if (fs.existsSync(cand)) pbxPath = cand;
          } else if (ent.name !== 'Pods' && ent.name !== 'build') {
            walk(full);
          }
        }
      }
    };
    try { walk(iosDir); } catch (e) { /* ignore */ }
    if (!pbxPath || !fs.existsSync(pbxPath)) return c;

    const projName = path.basename(path.dirname(pbxPath), '.xcodeproj');
    const wsDir = path.join(iosDir, projName + '.xcworkspace');
    const wsData = path.join(wsDir, 'contents.xcworkspacedata');
    if (!fs.existsSync(wsData)) {
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(
        wsData,
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<Workspace\n   version = "1.0">\n' +
          '   <FileRef\n      location = "group:' + projName + '.xcodeproj">\n   </FileRef>\n' +
          '   <FileRef\n      location = "group:Pods/Pods.xcodeproj">\n   </FileRef>\n' +
          '</Workspace>\n'
      );
      console.log('[withVeepooSDK] created', projName + '.xcworkspace');
    }

    const raw = fs.readFileSync(pbxPath, 'utf8');
    const cleaned = raw
      .replace(/explicitFileType = undefined; ?/g, '')
      .replace(/fileEncoding = undefined; ?/g, '');
    if (cleaned !== raw) {
      fs.writeFileSync(pbxPath, cleaned);
      console.log('[withVeepooSDK] stripped undefined tokens from', path.basename(pbxPath));
    }
    return c;
  });

  return config;
}

function uniqueArray(arr) {
  const seen = new Set();
  return arr.filter((v) => {
    const key = String(v).replace(/"/g, '').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fixAbsolutePaths(project, iosDir) {
  const prefix = iosDir.endsWith('/') ? iosDir : iosDir + '/';
  const section = project.pbxFileReferenceSection();
  if (!section) return;
  Object.keys(section).forEach((key) => {
    const fr = section[key];
    if (!fr || fr.isa !== 'PBXFileReference') return;
    let raw = fr.path;
    if (typeof raw !== 'string') return;
    const quoted = raw.startsWith('"') && raw.endsWith('"');
    if (quoted) raw = raw.slice(1, -1);
    if (raw.indexOf(prefix) !== 0) return;
    fr.path = (quoted ? '"' : '') + raw.slice(prefix.length) + (quoted ? '"' : '');
  });
}

function cleanUndefinedFileRefs(project) {
  const section = project.pbxFileReferenceSection();
  if (!section) return;
  Object.keys(section).forEach((key) => {
    const fr = section[key];
    if (!fr || fr.isa !== 'PBXFileReference') return;
    if (fr.fileEncoding === 'undefined' || fr.fileEncoding === undefined) delete fr.fileEncoding;
    if (fr.explicitFileType === 'undefined' || fr.explicitFileType === undefined) delete fr.explicitFileType;
  });
}

module.exports = withVeepooSDK;
module.exports.name = 'withVeepooSDK';
