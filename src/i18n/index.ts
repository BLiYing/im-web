// 多语言：文案表 `t()` + 语言偏好（每设备，localStorage）。契约见 IMServer docs/design/I18N_DESIGN.md。
// 文案来自 IMServer 的 docs/i18n/strings.json 经 scripts/i18n/gen-i18n.mjs 生成到 ./locales/，**勿手改生成物**。
//
// 规则：**禁止在模块顶层调用 t()**（模块加载时求值，切语言不会变）——常量里放键，渲染处再 t()。
import { useSyncExternalStore } from "react";
import zhHans from "./locales/zh-Hans.json";
import en from "./locales/en.json";

export type Lang = "zh-Hans" | "en";
export type LangPref = "system" | Lang;
export type Args = Record<string, string | number>;
type Entry = string | Record<string, string>;

export const LANG_STORAGE_KEY = "im.language";
const TABLES: Record<Lang, Record<string, Entry>> = { "zh-Hans": zhHans, en };
/** `<html lang>` 取值（与文案表的 zh-Hans 不同，见设计稿 §3）。 */
const HTML_LANG: Record<Lang, string> = { "zh-Hans": "zh-CN", en: "en" };

/** 「跟随系统」解析：取系统首选语言里第一个被支持的；都不支持回落 en（设计稿 §2）。 */
export function resolveLanguage(pref: LangPref, systemLangs: readonly string[]): Lang {
  if (pref !== "system") return pref;
  for (const raw of systemLangs) {
    const l = raw.toLowerCase();
    if (l.startsWith("zh")) return "zh-Hans"; // zh-Hant / zh-HK 暂归简体（无繁体资源）
    if (l.startsWith("en")) return "en";
  }
  return "en";
}

const systemLangs = (): readonly string[] =>
  typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language ?? ""];

export function readPref(): LangPref {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v === "zh-Hans" || v === "en" ? v : "system";
  } catch { return "system"; }
}

let pref: LangPref = readPref();
let lang: Lang = resolveLanguage(pref, systemLangs());
const listeners = new Set<() => void>();

function applyHtmlLang() {
  if (typeof document !== "undefined") document.documentElement.lang = HTML_LANG[lang];
}
applyHtmlLang();

export const getPref = (): LangPref => pref;
export const getLang = (): Lang => lang;

export function setPref(next: LangPref): void {
  pref = next;
  try {
    if (next === "system") localStorage.removeItem(LANG_STORAGE_KEY);
    else localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch { /* 隐私模式/配额满：本次会话仍生效 */ }
  lang = resolveLanguage(pref, systemLangs());
  applyHtmlLang();
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 订阅当前语言：组件渲染里调用，切语言时触发重渲染。返回当前 Lang。 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** `{name}` 具名占位符替换；`{{` `}}` 还原为字面量花括号；缺参保留 `{name}` 原样。 */
export function format(tpl: string, args?: Args): string {
  return tpl.replace(/\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name?: string) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    return args && name !== undefined && name in args ? String(args[name]) : m;
  });
}

/** 取文案。复数键（值为 {one,other} 对象）按 args.count 选形式；缺键回落中文源，再缺返回键本身。 */
export function translate(l: Lang, key: string, args?: Args): string {
  const e = TABLES[l][key] ?? TABLES["zh-Hans"][key];
  if (e === undefined) return key;
  if (typeof e === "string") return format(e, args);
  const form = new Intl.PluralRules(l === "zh-Hans" ? "zh" : l).select(Number(args?.count ?? 0));
  return format(e[form] ?? e.other ?? key, args);
}

/** 非组件代码用（toast / 错误 / 通知）：读调用时刻的语言。组件渲染里请用 useT() 以便切语言重渲染。 */
export const t = (key: string, args?: Args): string => translate(lang, key, args);

/** 组件用：订阅语言并返回绑定当前语言的 t。 */
export function useT(): (key: string, args?: Args) => string {
  const l = useLang();
  return (key, args) => translate(l, key, args);
}

/** 语言的**自称**（不随界面语言翻译，见设计稿 §2）。 */
export const LANG_NATIVE_NAME: Record<Lang, string> = { "zh-Hans": "简体中文", en: "English" };

/** 「跟随系统」当前解析成的语言自称（如「简体中文」）。 */
export const systemLangName = (): string => LANG_NATIVE_NAME[resolveLanguage("system", systemLangs())];

/** 设置页「语言」行右侧的当前值：跟随系统时写成「跟随系统（简体中文）」。 */
export function langPrefLabel(p: LangPref = pref, l: Lang = lang): string {
  return p === "system"
    ? translate(l, "settings.language.current_system", { language: systemLangName() })
    : LANG_NATIVE_NAME[p];
}
