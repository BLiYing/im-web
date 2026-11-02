// 「关于我们」用的纯函数：法务页链接、版本串。设计：IMServer/docs/design/ABOUT_LEGAL_DESIGN.md。
// 路径与后端 internal/legal 的 Paths 一致；对称兄弟：iOS IMAppInfo、Android AboutLinks。
import type { Lang } from "./i18n";

export const LEGAL_PATH = { privacy: "/legal/privacy", terms: "/legal/terms", support: "/support" } as const;
export type LegalPath = (typeof LEGAL_PATH)[keyof typeof LEGAL_PATH];

const ALLOWED = new Set<string>(Object.values(LEGAL_PATH));

/** 法务页链接：同源相对路径（开发期 vite 代理、生产同域部署）+ `?lang=`（用 App 内语言偏好）。路径不在白名单返回 null。 */
export function legalUrl(path: string, lang: Lang): string | null {
  return ALLOWED.has(path) ? `${path}?lang=${lang}` : null;
}

/** 「0.1.0 (a1b2c3d)」：版本 + 构建号（git 短 hash）；任一缺失退化为另一个，都缺为「-」。 */
export function versionString(version?: string, build?: string): string {
  if (version && build) return `${version} (${build})`;
  return version || build || "-";
}

/** 点「版本」行复制的整串，带平台名便于贴给客服：「Web 0.1.0 (a1b2c3d)」。 */
export function versionClipboardText(version: string): string {
  return `Web ${version}`;
}

declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD__: string | undefined;

/** 当前构建的版本串（vite `define` 注入；测试 / 未注入时为「-」）。 */
export function currentVersion(): string {
  return versionString(
    typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : undefined,
  );
}
