import { ChevronRight, Image as ImageIcon } from "lucide-react";
import { SubPanel } from "./SubPanel";
import { useT } from "../../i18n";

/** 通用设置子面板：设置 ▸ 通用设置进入，叠在设置之上。主题已接通真功能，其余先 UI。
 *  纯展示：全部偏好状态与 setter 由 App 注入。 */
export function GeneralPanel({ fontSize, theme, timeFormat, sendKey, autoStart, autoStartSupported, globalShortcut, globalShortcutSupported, onFontSize, onTheme, onTimeFormat, onSendKey, onAutoStart, onGlobalShortcut, onOpenWallpaper, onBack }: {
  fontSize: number;
  theme: "light" | "dark" | "system";
  timeFormat: "12" | "24";
  sendKey: "enter" | "cmd";
  /** 桌面端开机自启的当前状态。**读的是系统真实值**，不是本地偏好（用户可能在系统设置里改过）。 */
  autoStart: boolean;
  /** 宿主支不支持这个概念。浏览器恒 false —— 那时整段不渲染，
   *  显示一个永远点不动的开关比不显示更糟（platform/types.ts 的说明）。 */
  autoStartSupported: boolean;
  /** 全局快捷键的**真实状态**（真注册上了才是开）；label 未读到时为空串。 */
  globalShortcut: { enabled: boolean; label: string; taken?: boolean };
  /** 浏览器恒 false，整段不渲染（理由同 autoStartSupported）。 */
  globalShortcutSupported: boolean;
  onFontSize: (v: number) => void;
  onTheme: (v: "light" | "dark" | "system") => void;
  onTimeFormat: (v: "12" | "24") => void;
  onSendKey: (v: "enter" | "cmd") => void;
  onAutoStart: (v: boolean) => void;
  onGlobalShortcut: (v: boolean) => void;
  onOpenWallpaper: () => void;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <SubPanel className="general-panel" title={t("general.title")} onBack={onBack}>
        <div className="section-label">{t("general.section.settings")}</div>
        <div className="settings-group">
          <div className="range-row">
            <div className="range-top"><span className="row-label">{t("general.font_size")}</span><span className="row-value">{fontSize}</span></div>
            <input type="range" min={12} max={24} value={fontSize} onChange={(e) => onFontSize(Number(e.target.value))} />
          </div>
          <button className="settings-row" onClick={onOpenWallpaper}>
            <ImageIcon size={20} className="row-icon" /><span className="row-label">{t("general.wallpaper")}</span><ChevronRight size={18} className="row-chevron" />
          </button>
        </div>

        <div className="section-label">{t("general.section.theme")}</div>
        <div className="settings-group">
          {([{ v: "light", k: "general.theme.light" }, { v: "dark", k: "general.theme.dark" }, { v: "system", k: "common.follow_system" }] as const).map((o) => (
            <button key={o.v} className="radio-row" onClick={() => onTheme(o.v)}>
              <span className={`radio-dot${theme === o.v ? " on" : ""}`} /><span className="row-label">{t(o.k)}</span>
            </button>
          ))}
        </div>

        <div className="section-label">{t("general.section.time_format")}</div>
        <div className="settings-group">
          {([{ v: "12", k: "general.time_12h" }, { v: "24", k: "general.time_24h" }] as const).map((o) => (
            <button key={o.v} className="radio-row" onClick={() => onTimeFormat(o.v)}>
              <span className={`radio-dot${timeFormat === o.v ? " on" : ""}`} /><span className="row-label">{t(o.k)}</span>
            </button>
          ))}
        </div>

        <div className="section-label">{t("general.section.keyboard")}</div>
        <div className="settings-group">
          {([{ v: "enter", k: "general.send.enter", s: "general.send.enter_hint" }, { v: "cmd", k: "general.send.cmd", s: "general.send.cmd_hint" }] as const).map((o) => (
            <button key={o.v} className="radio-row" onClick={() => onSendKey(o.v)}>
              <span className={`radio-dot${sendKey === o.v ? " on" : ""}`} />
              <span className="radio-text"><span className="row-label">{t(o.k)}</span><span className="row-sub">{t(o.s)}</span></span>
            </button>
          ))}
        </div>

        {/* 开机自启：**只在宿主支持时出现**。浏览器版没有这个概念，整段不渲染。 */}
        {autoStartSupported && (
          <>
            <div className="section-label">{t("general.section.startup")}</div>
            <div className="settings-group">
              <button type="button" className="radio-row" onClick={() => onAutoStart(!autoStart)}>
                <span className={`radio-dot${autoStart ? " on" : ""}`} />
                <span className="radio-text">
                  <span className="row-label">{t("general.autostart")}</span>
                  <span className="row-sub">{t("general.autostart_hint")}</span>
                </span>
              </button>
            </div>
          </>
        )}

        {/* 全局快捷键：**默认关**——它在系统范围抢一个组合键，会静默盖掉别的应用的同名快捷键。
            只在宿主支持、且已读到组合键写法时出现。被占用时开关是关着的，副标题说明原因。 */}
        {globalShortcutSupported && globalShortcut.label && (
          <>
            <div className="section-label">{t("general.section.global_shortcut")}</div>
            <div className="settings-group">
              <button type="button" className="radio-row" onClick={() => onGlobalShortcut(!globalShortcut.enabled)}>
                <span className={`radio-dot${globalShortcut.enabled ? " on" : ""}`} />
                <span className="radio-text">
                  <span className="row-label">{t("general.shortcut_toggle", { combo: globalShortcut.label })}</span>
                  <span className="row-sub">{globalShortcut.taken
                    ? t("general.shortcut_taken", { combo: globalShortcut.label })
                    : t("general.shortcut_hint")}</span>
                </span>
              </button>
            </div>
          </>
        )}
    </SubPanel>
  );
}
