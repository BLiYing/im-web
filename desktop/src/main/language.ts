// 主进程的界面语言状态：偏好落盘（userData/lang.json），托盘 / 启动失败对话框等**页面之外**的文案读它。
// 页面的语言偏好在渲染进程 localStorage 里，主进程读不到，且窗口收进托盘后页面可能没在跑——
// 所以由页面经 `im:set-language` 推一份，这里自己持久化。契约见 IMServer docs/design/I18N_DESIGN.md §5.3。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import zhHans from "../shared/locales/zh-Hans.json";
import en from "../shared/locales/en.json";
import { parsePref, resolveLanguage, translate, type Args, type Lang, type LangPref, type Tables } from "../shared/i18nCore";

const TABLES = { "zh-Hans": zhHans, en } as unknown as Tables;

export interface LanguageState {
  pref(): LangPref;
  lang(): Lang;
  t(key: string, args?: Args): string;
  /** 设偏好（入参不可信，非法返回 false 且不变）；真的变了才落盘并回调。 */
  set(raw: unknown): boolean;
}

function readFile(file: string): LangPref {
  try {
    return parsePref((JSON.parse(readFileSync(file, "utf8")) as { pref?: unknown }).pref) ?? "system";
  } catch { return "system"; }   // 没有 / 损坏：跟随系统
}

export function createLanguageState(opts: {
  file: string;
  systemLangs: () => readonly string[];
  onChange?: (lang: Lang) => void;
}): LanguageState {
  let pref = readFile(opts.file);
  const lang = (): Lang => resolveLanguage(pref, opts.systemLangs());
  return {
    pref: () => pref,
    lang,
    t: (key, args) => translate(TABLES, lang(), key, args),
    set(raw) {
      const next = parsePref(raw);
      if (next === null) return false;
      if (next === pref) return true;
      pref = next;
      try {
        mkdirSync(dirname(opts.file), { recursive: true });
        writeFileSync(opts.file, JSON.stringify({ pref }));
      } catch { /* 落盘失败：本次运行仍生效，下次启动回到旧值 */ }
      opts.onChange?.(lang());
      return true;
    },
  };
}
