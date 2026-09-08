import { ChevronRight, Image as ImageIcon } from "lucide-react";
import { SubPanel } from "./SubPanel";

/** 通用设置子面板：设置 ▸ 通用设置进入，叠在设置之上。主题已接通真功能，其余先 UI。
 *  纯展示：全部偏好状态与 setter 由 App 注入。 */
export function GeneralPanel({ fontSize, theme, timeFormat, sendKey, autoStart, autoStartSupported, onFontSize, onTheme, onTimeFormat, onSendKey, onAutoStart, onOpenWallpaper, onBack }: {
  fontSize: number;
  theme: "light" | "dark" | "system";
  timeFormat: "12" | "24";
  sendKey: "enter" | "cmd";
  /** 桌面端开机自启的当前状态。**读的是系统真实值**，不是本地偏好（用户可能在系统设置里改过）。 */
  autoStart: boolean;
  /** 宿主支不支持这个概念。浏览器恒 false —— 那时整段不渲染，
   *  显示一个永远点不动的开关比不显示更糟（platform/types.ts 的说明）。 */
  autoStartSupported: boolean;
  onFontSize: (v: number) => void;
  onTheme: (v: "light" | "dark" | "system") => void;
  onTimeFormat: (v: "12" | "24") => void;
  onSendKey: (v: "enter" | "cmd") => void;
  onAutoStart: (v: boolean) => void;
  onOpenWallpaper: () => void;
  onBack: () => void;
}) {
  return (
    <SubPanel className="general-panel" title="通用设置" onBack={onBack}>
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

        {/* 开机自启：**只在宿主支持时出现**。浏览器版没有这个概念，整段不渲染。 */}
        {autoStartSupported && (
          <>
            <div className="section-label">启动</div>
            <div className="settings-group">
              <button type="button" className="radio-row" onClick={() => onAutoStart(!autoStart)}>
                <span className={`radio-dot${autoStart ? " on" : ""}`} />
                <span className="radio-text">
                  <span className="row-label">开机时自动启动</span>
                  <span className="row-sub">登录系统后在后台启动，收到消息才提示</span>
                </span>
              </button>
            </div>
          </>
        )}
    </SubPanel>
  );
}
