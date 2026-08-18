import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { COLOR_PRESETS, hsvToHex, hexToHSV, hexToRGB, type HSVColor } from "../../color";
import { SubPanel } from "./SubPanel";

/** 壁纸纯色编辑面板：色板（饱和/亮度）+ 色相滑杆 + HEX/RGB 只读值 + 预设色网格。
 *  纯展示：colorHSV 状态与取色动作由 App 注入。 */
export function WallpaperColorPanel({ colorHSV, onApply, onSpectrum, onBack }: {
  colorHSV: HSVColor;
  onApply: (next: HSVColor) => void;
  onSpectrum: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBack: () => void;
}) {
  return (
    <SubPanel className="wallpaper-color-panel" headClassName="wallpaper-head" bodyClassName="wallpaper-color-body"
      title="设置颜色" onBack={onBack}>
        <div className="color-editor-card" style={{ "--picker-hue": `${colorHSV.h}` } as CSSProperties}>
          <div className="color-spectrum"
            role="slider" aria-label="调整颜色饱和度和亮度" aria-valuenow={Math.round(colorHSV.v)}
            onPointerDown={onSpectrum}
            onPointerMove={(event) => { if (event.buttons === 1) onSpectrum(event); }}>
            <span className="color-cursor"
              style={{ left: `${colorHSV.s}%`, top: `${100 - colorHSV.v}%` }} />
          </div>
          <input className="hue-slider" type="range" min="0" max="360" value={colorHSV.h}
            aria-label="调整色相"
            onChange={(event) => onApply({ ...colorHSV, h: Number(event.target.value) })} />
          <div className="color-values">
            <label>
              <span>HEX</span>
              <input value={hsvToHex(colorHSV)} readOnly />
            </label>
            <label>
              <span>RGB</span>
              <input value={hexToRGB(hsvToHex(colorHSV))} readOnly />
            </label>
          </div>
        </div>
        <div className="color-preset-grid">
          {COLOR_PRESETS.map((color) => {
            const selected = hsvToHex(colorHSV).toLowerCase() === color;
            return (
              <button key={color} className={`color-preset${selected ? " selected" : ""}`}
                title={color} aria-label={`使用颜色 ${color}`}
                style={{ background: color }}
                onClick={() => onApply(hexToHSV(color))}>
                {selected && <Check size={20} />}
              </button>
            );
          })}
        </div>
    </SubPanel>
  );
}
