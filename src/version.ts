// 当前 App 版本（与 git tag 对齐）。
// 命名规则：v-ui-YYYYMMDD-HHMM（HHMM 取「这一版存下来的本地时间，GMT+8」）。
// 改完一版并提交后，同步更新这里 + 打同名 tag。
export const APP_VERSION_LABEL = '2026-11-25 15:20';
export const APP_VERSION_TAG = 'v-ui-20261125-1520';
export const APP_VERSION = '2026.11.25.1520';

/**
 * ★ 2026-11-09：App 内「检查更新」的比对真相源。
 * 必须与 android/app/build.gradle 的 versionCode / versionName 完全一致，
 * scripts/publish-apk-update.mjs 会在发布时校验两边，不一致直接报错。
 * Android 覆盖安装要求 versionCode 单调递增，每次发版两处一起 +1。
 */
export const APP_VERSION_CODE = 112;
export const APP_VERSION_NAME = '1.5.3';
