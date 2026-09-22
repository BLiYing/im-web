// 主进程用的多语言核心（纯函数，无 electron 依赖，可单测）。
// **与 im-web/src/i18n/index.ts 的 resolveLanguage / format / translate 同口径**（SYMMETRY 已登记）：
// 那份跑在渲染进程（要 React、localStorage），这里跑在主进程，无法共用同一个模块，故两份 + 同一组测试向量。
// 契约见 IMServer docs/design/I18N_DESIGN.md。文案来自 docs/i18n/strings.json 生成的 ./locales/*.json。

export type Lang = "zh-Hans" | "en";
export type LangPref = "system" | Lang;
export type Args = Record<string, string | number>;
export type Tables = Record<Lang, Record<string, string | Record<string, string>>>;

/** 校验来自渲染进程的偏好值；非法返回 null（IPC 入参不可信，见 storeIpc 的同类做法）。 */
export function parsePref(raw: unknown): LangPref | null {
  return raw === "system" || raw === "zh-Hans" || raw === "en" ? raw : null;
}

/** 「跟随系统」解析：首个被支持的系统语言；繁体归简体；都不支持回落 en。 */
export function resolveLanguage(pref: LangPref, systemLangs: readonly string[]): Lang {
  if (pref !== "system") return pref;
  for (const raw of systemLangs) {
    const l = raw.toLowerCase();
    if (l.startsWith("zh")) return "zh-Hans";
    if (l.startsWith("en")) return "en";
  }
  return "en";
}

export function format(tpl: string, args?: Args): string {
  return tpl.replace(/\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name?: string) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    return args && name !== undefined && name in args ? String(args[name]) : m;
  });
}

/** 取文案；缺键回落中文源，再缺返回键本身。主进程文案暂无复数键，复数形式按 other 处理。 */
export function translate(tables: Tables, lang: Lang, key: string, args?: Args): string {
  const e = tables[lang][key] ?? tables["zh-Hans"][key];
  if (e === undefined) return key;
  return format(typeof e === "string" ? e : (e.other ?? key), args);
}
