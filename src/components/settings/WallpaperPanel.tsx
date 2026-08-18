import { useRef, type CSSProperties } from "react";
import { Camera, Pipette, Star, Check } from "lucide-react";
import { WALLPAPER_PRESETS, resolveWallpaper, type WallpaperChoice } from "../../wallpaper";
import { SubPanel } from "./SubPanel";

/** 聊天壁纸面板：预设网格 + 上传图片/设置颜色/恢复默认/模糊开关。
 *  纯展示：壁纸选择状态与动作由 App 注入；隐藏 file input 的 ref 归本组件私有。 */
export function WallpaperPanel({ wallpaper, isDark, blur, onSelectPreset, onPickImage, onOpenColor, onReset, onToggleBlur, onBack }: {
  wallpaper: WallpaperChoice;
  isDark: boolean;
  blur: boolean;
  onSelectPreset: (id: string) => void;
  onPickImage: (file?: File) => void;
  onOpenColor: () => void;
  onReset: () => void;
  onToggleBlur: () => void;
  onBack: () => void;
}) {
  const wallpaperFileRef = useRef<HTMLInputElement>(null);
  return (
    <SubPanel className="wallpaper-panel" headClassName="wallpaper-head" bodyClassName="wallpaper-body"
      title="聊天壁纸" onBack={onBack}>
        <div className="wallpaper-actions">
          <button className="wallpaper-action" onClick={() => wallpaperFileRef.current?.click()}>
            <Camera size={24} /><span>上传图片</span>
          </button>
          <button className="wallpaper-action" onClick={onOpenColor}>
            <Pipette size={24} /><span>设置颜色</span>
          </button>
          <button className="wallpaper-action" onClick={onReset}>
            <Star size={24} /><span>恢复默认</span>
          </button>
          <button className="wallpaper-action" onClick={onToggleBlur}>
            <span className={`wallpaper-check${blur ? " on" : ""}`}>{blur && <Check size={17} />}</span>
            <span>模糊</span>
          </button>
        </div>
        <input ref={wallpaperFileRef} type="file" accept="image/*" hidden
          onChange={(event) => {
            onPickImage(event.target.files?.[0]);
            event.target.value = "";
          }} />
        <p className="wallpaper-hint">
          {wallpaper.kind === "auto"
            ? "默认壁纸会跟随浅色/深色模式自动切换，当前高亮为正在使用的一张。"
            : "已固定壁纸，浅深模式都用它。点「恢复默认」可切回跟随模式。"}
        </p>
        <div className="wallpaper-grid">
          {WALLPAPER_PRESETS.map((item) => {
            // 用解析后的选择比对：auto 时高亮当前明暗下正在生效的那张预设。
            const active = resolveWallpaper(wallpaper, isDark);
            const selected = active.kind === "preset" && active.value === item.id;
            return (
              <button key={item.id} className={`wallpaper-tile${selected ? " selected" : ""}`}
                title={item.label} aria-label={`使用${item.label}壁纸`}
                style={{ background: item.css } as CSSProperties}
                onClick={() => onSelectPreset(item.id)}>
                {selected && <span className="wallpaper-selected"><Check size={18} /></span>}
              </button>
            );
          })}
        </div>
    </SubPanel>
  );
}
