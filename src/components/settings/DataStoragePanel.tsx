import { ChevronLeft, Trash2, Image as ImageIcon, Video, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  applyTier, defaultDownloadSettings, isDefaultDownloadSettings, tierOfPolicy, MAX_AUTO_BYTES,
  type DownloadSettings, type SpeedTier,
} from "../../download";
import { formatFileSize } from "../../fileMetadata";

/** 数据与存储（M4-7，草图 §05/§06/§09）：Web 只呈现 **Wi-Fi / 不限流量** 这一档——
 *  浏览器无法可靠区分移动/Wi-Fi，桌面也没有流量焦虑；改动仍随账号同步回移动端。
 *  存储用量是**本页应用内缓存**（手动下载的 blob），刷新即失效，故不与移动端同步。
 *  纯展示：设置读写/清缓存/重置动作由 App 注入。 */
export function DataStoragePanel({ settings, cachedCount, onSave, onClearCache, onReset, onBack }: {
  settings: DownloadSettings | null;
  cachedCount: number;
  onSave: (next: DownloadSettings) => void;
  onClearCache: () => void;
  onReset: () => void; // 恢复出厂默认（App 侧带确认框 + 后端调用）
  onBack: () => void;
}) {
  const st = settings ?? defaultDownloadSettings();
  const wifi = st.wifi;
  const tier: SpeedTier = tierOfPolicy(wifi);
  const patchWifi = (next: typeof wifi) => void onSave({ ...st, wifi: next });
  // 单聊/群聊自动下载开关子行（图片/视频/文件共用）。
  const scopeToggles = (kind: "image" | "video" | "file") => (
    <div className="settings-subrows media-card-toggles">
      {(["single", "group"] as const).map((who) => (
        <label className="switch-row" key={who}>
          <span className="row-label">{who === "single" ? "单聊" : "群聊"}</span>
          <input type="checkbox" checked={wifi[kind][who]}
                 onChange={(e) => patchWifi({ ...wifi, [kind]: { ...wifi[kind], [who]: e.target.checked } })} />
        </label>
      ))}
    </div>
  );
  // 视频 / 文件：带大小上限滑杆的独立卡片（图片体积小，无需上限，见下方单独卡片）。
  const limitCard = (kind: "video" | "file", label: string, Icon: LucideIcon) => (
    <div className="settings-group media-card" key={kind}>
      <div className="media-card-head">
        <Icon size={17} className="media-card-icon" />
        <span className="media-card-title">{label}</span>
      </div>
      <div className="range-row">
        <div className="range-top">
          <span className="row-label">大小上限</span>
          <span className="row-value">{wifi[kind].max_bytes > 0 ? formatFileSize(wifi[kind].max_bytes) : "手动"}</span>
        </div>
        {/* 0 = 手动（不自动下）；其余按 MB 取整，右端对齐后端 MaxAutoBytes(1.5 GiB)。 */}
        <input type="range" min={0} max={Math.round(MAX_AUTO_BYTES / (1024 * 1024))} step={1}
               value={Math.round(wifi[kind].max_bytes / (1024 * 1024))}
               onChange={(e) => patchWifi({ ...wifi, [kind]: { ...wifi[kind], max_bytes: Number(e.target.value) * 1024 * 1024 } })} />
        <div className="range-scale"><span>手动</span><span>1.5 GB</span></div>
      </div>
      {scopeToggles(kind)}
    </div>
  );
  return (
    <div className="settings-panel data-panel">
      <header className="settings-head">
        <button className="icon-btn" title="返回" onClick={onBack}><ChevronLeft size={27} /></button>
        <span className="settings-title">数据与存储</span>
        <span className="icon-btn-spacer" />
      </header>
      <div className="settings-body">
        <div className="section-label">存储用量</div>
        <div className="settings-group">
          <div className="settings-row static">
            <span className="row-label">已缓存媒体</span>
            <span className="row-value">{cachedCount} 个</span>
          </div>
          <button className="settings-row danger" onClick={onClearCache}>
            <Trash2 size={20} className="row-icon" /><span className="row-label">清除缓存</span>
          </button>
        </div>
        <div className="settings-foot">只删本机缓存，云端仍保留、需要时可重新下载。刷新页面也会清空（浏览器限制）。</div>

        <div className="section-label">自动下载媒体文件</div>
        <div className="settings-group">
          <label className="switch-row">
            <span className="row-label">自动下载</span>
            <input type="checkbox" checked={wifi.enabled}
                   onChange={(e) => patchWifi({ ...wifi, enabled: e.target.checked })} />
          </label>
        </div>
        <div className="settings-foot">
          浏览器分不清移动数据与 Wi-Fi，故 Web 只使用「Wi-Fi / 不限流量」这一档；手动点击永远可下载。
        </div>

        <div className="section-label">流量档位</div>
        <div className="settings-group">
          {/* 总开关关闭 → 全部手动、档位无意义：整排置淡且不可点（对齐 iOS 档位滑杆置灰）。 */}
          <div className={`tier-row${wifi.enabled ? "" : " disabled"}`}>
            {([["low", "低"], ["medium", "中"], ["high", "高"]] as const).map(([v, t]) => (
              <button key={v} className={`tier-btn${tier === v ? " on" : ""}`} disabled={!wifi.enabled}
                      onClick={() => patchWifi(applyTier(wifi, v))}>{t}</button>
            ))}
            {/* 自定义为只读指示（无预设可套用）→ 仅当前处于自定义时才出现的高亮按钮、不可点，
                与 低/中/高 同款样式（对齐 iOS「仅自定义时出现的第四档」）。 */}
            {tier === "custom" && <button className="tier-btn on" disabled>自定义</button>}
          </div>
        </div>
        <div className="settings-foot">档位是快捷入口——一键设好下面的大小上限；手改任一上限后回到「自定义」。图片体积小，恒自动下载。</div>

        <div className="section-label">媒体文件类型</div>
        <div className="settings-group media-card">
          <div className="media-card-head">
            <ImageIcon size={17} className="media-card-icon" />
            <span className="media-card-title">图片</span>
            <span className="media-card-hint">体积小 · 恒自动下载</span>
          </div>
          {scopeToggles("image")}
        </div>
        {limitCard("video", "视频", Video)}
        {limitCard("file", "文件", FileText)}

        <div className="settings-group">
          {/* 已是出厂默认 → 无可重置：置灰不可点（对齐 iOS）。用户改动后自动恢复可点。 */}
          <button className="settings-row danger" disabled={isDefaultDownloadSettings(st)} onClick={onReset}>
            <span className="row-label">重置自动下载设置</span>
          </button>
        </div>
      </div>
    </div>
  );
}
