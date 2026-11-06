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

/** 「关于我们」里会打开网页的四项。 */
export type AboutLinkKind = "privacy" | "terms" | "support" | "customerService";

/** `GET /api/v1/about-links` 的 data（后台「关于我们链接」配置；字段可缺，老服务端整体 404）。 */
export interface AboutLinksData {
  privacy_url?: string;
  terms_url?: string;
  support_url?: string;
  customer_service_url?: string;
}

const KIND_FIELD: Record<AboutLinkKind, keyof AboutLinksData> = {
  privacy: "privacy_url", terms: "terms_url", support: "support_url", customerService: "customer_service_url",
};
const BUILTIN_PATH: Record<Exclude<AboutLinkKind, "customerService">, LegalPath> = {
  privacy: LEGAL_PATH.privacy, terms: LEGAL_PATH.terms, support: LEGAL_PATH.support,
};

/**
 * 把后台下发的链接字段解析成最终要打开的 URL；null = 不能打开（客服行据此隐藏，其余项提示打不开）。
 *   - 空串 / 缺字段 / data=null（拉取失败）：法务三项退回内置路径，在线客服为 null；
 *   - "/" 开头：本服务托管页，走 `legalUrl`（白名单 + `?lang=`）；
 *   - 绝对 http(s) URL：**原样**返回（外部页面自己决定多语言，不追加 `?lang=`）；
 *   - 其它（javascript:/data:/ftp:/乱码/非白名单相对路径）：null，不交给浏览器。
 * 对称兄弟：iOS IMAppInfo、Android AboutLinks（SYMMETRY.md）。
 */
export function resolveAboutLink(kind: AboutLinkKind, data: AboutLinksData | null, lang: Lang): string | null {
  const raw = data?.[KIND_FIELD[kind]];
  if (typeof raw !== "string" || raw === "") {
    return kind === "customerService" ? null : legalUrl(BUILTIN_PATH[kind], lang);
  }
  if (raw.startsWith("/") && !raw.startsWith("//")) return legalUrl(raw, lang);
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
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
