import { ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";

/** 通用设置子面板：设置 ▸ 通用设置进入，叠在设置之上。主题已接通真功能，其余先 UI。
 *  纯展示：全部偏好状态与 setter 由 App 注入。 */
export function GeneralPanel({ fontSize, theme, timeFormat, sendKey, onFontSize, onTheme, onTimeFormat, onSendKey, onOpenWallpaper, onBack }: {
  fontSize: number;
  theme: "light" | "dark" | "system";
  timeFormat: "12" | "24";
  sendKey: "enter" | "cmd";
  onFontSize: (v: number) => void;
  onTheme: (v: "light" | "dark" | "system") => void;
  onTimeFormat: (v: "12" | "24") => void;
  onSendKey: (v: "enter" | "cmd") => void;
  onOpenWallpaper: () => void;
  onBack: () => void;
}) {
  return (
    <div className="settings-panel general-panel">
      <header className="settings-head">
        <button className="icon-btn" title="返回" onClick={onBack}><ChevronLeft size={27} /></button>
        <span className="settings-title">通用设置</span>
        <span className="icon-btn-spacer" />
      </header>
      <div className="settings-body">
        <div className="section-label">设置</div>
        <div className="settings-group">
          <div className="range-row">
            <div className="range-top"><span className="row-label">消息字体大小</span><span className="row-value">{fontSize}</span></div>
            <input type="range" min={12} max={24} value={fontSize} onChange={(e) => onFontSize(Number(e.target.value))} />
          </div>
          <button className="settings-row" onClick={onOpenWallpaper}>
            <ImageIcon size={20} className="row-icon" /><span className="row-label">聊天壁纸</span><ChevronRight size={18} className="row-chevron" />
          </button>
        </div>

        <div className="section-label">主题</div>
        <div className="settings-group">
          {([{ v: "light", t: "浅色" }, { v: "dark", t: "深色" }, { v: "system", t: "跟随系统" }] as const).map((o) => (
            <button key={o.v} className="radio-row" onClick={() => onTheme(o.v)}>
              <span className={`radio-dot${theme === o.v ? " on" : ""}`} /><span className="row-label">{o.t}</span>
            </button>
          ))}
        </div>

        <div className="section-label">时间格式</div>
        <div className="settings-group">
          {([{ v: "12", t: "12 小时制" }, { v: "24", t: "24 小时制" }] as const).map((o) => (
            <button key={o.v} className="radio-row" onClick={() => onTimeFormat(o.v)}>
              <span className={`radio-dot${timeFormat === o.v ? " on" : ""}`} /><span className="row-label">{o.t}</span>
            </button>
          ))}
        </div>

        <div className="section-label">键盘</div>
        <div className="settings-group">
          {([{ v: "enter", t: "按 Enter 发送", s: "Shift + Enter 换行" }, { v: "cmd", t: "按 Cmd + Enter 发送", s: "Enter 换行" }] as const).map((o) => (
            <button key={o.v} className="radio-row" onClick={() => onSendKey(o.v)}>
              <span className={`radio-dot${sendKey === o.v ? " on" : ""}`} />
              <span className="radio-text"><span className="row-label">{o.t}</span><span className="row-sub">{o.s}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
