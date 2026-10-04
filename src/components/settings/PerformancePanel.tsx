import { Zap } from "lucide-react";
import { SubPanel } from "./SubPanel";
import { useT } from "../../i18n";
import { POWER_ITEMS, pausedCount, THRESHOLD_MAX, THRESHOLD_MIN, THRESHOLD_STEP, type PowerItem, type PowerMode } from "../../powerSave";
import type { PowerSaveSnapshot } from "../../powerSaveStore";

const ITEM_TEXT: Record<PowerItem, { title: string; sub: string }> = {
  animations: { title: "power_saving.item.animations", sub: "power_saving.item.animations_sub_web" },
  blur: { title: "power_saving.item.blur", sub: "power_saving.item.blur_sub" },
  autoDownload: { title: "power_saving.item.auto_download", sub: "power_saving.item.auto_download_sub_web" },
  videoPreload: { title: "power_saving.item.video_preload", sub: "power_saving.item.video_preload_sub" },
};

/** 设置 ▸ 动画与性能（POWER_SAVING_DESIGN；UX 稿 w1–w2）。纯展示：状态来自 props，动作由 SettingsPanelsHost 接 store。 */
export function PerformancePanel({ ps, onSetMode, onSetThreshold, onToggleItem, onLocked, onBack }: {
  ps: PowerSaveSnapshot;
  onSetMode: (m: PowerMode) => void;
  onSetThreshold: (v: number) => void;
  onToggleItem: (item: PowerItem, value: boolean) => void;
  /** 省电生效时点了被锁定的项 → App 弹 power_saving.item.locked_toast。 */
  onLocked: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const { prefs, battery, active } = ps;
  const cjkJoin = (a: string, b: string) => `${a}${/[。！？]$/.test(a) ? "" : " "}${b}`;

  const reason = prefs.mode === "always"
    ? t("power_saving.reason.always")
    : t("power_saving.reason.battery", { percent: prefs.threshold });
  const statusSub = active
    ? t("power_saving.status.active", { reason, count: pausedCount(prefs) })
    : battery.level !== null
      ? t("power_saving.status.battery_web", {
          percent: battery.level,
          charging: t(battery.charging ? "power_saving.status.charging" : "power_saving.status.not_charging"),
        })
      : prefs.mode === "auto"
        ? t("power_saving.status.hint_auto", { percent: prefs.threshold })
        : t("power_saving.status.hint_off");

  const modes: { v: PowerMode; title: string; sub: string; disabled?: boolean }[] = [
    { v: "off", title: t("power_saving.mode.off"), sub: t("power_saving.mode.off_sub") },
    {
      v: "auto", title: t("power_saving.mode.auto"), disabled: !battery.supported,
      sub: battery.supported ? t("power_saving.mode.auto_sub", { percent: prefs.threshold }) : t("power_saving.mode.auto_unsupported"),
    },
    { v: "always", title: t("power_saving.mode.always"), sub: t("power_saving.mode.always_sub") },
  ];
  const modeFoot = cjkJoin(
    t(battery.supported ? "power_saving.mode.footer" : "power_saving.mode.footer_unsupported"),
    t("power_saving.mode.footer_web_suffix"),
  );

  return (
    <SubPanel className="perf-panel" title={t("settings.row.animations")} onBack={onBack}>
      <div className="settings-group">
        <div className="settings-row static">
          <span className="row-icon-tile yellow"><Zap size={17} /></span>
          <span className="radio-text">
            <span className="row-label">{t(active ? "power_saving.status.on" : "power_saving.status.off")}</span>
            <span className="row-sub">{statusSub}</span>
          </span>
        </div>
      </div>

      <div className="section-label" id="perf-mode-label">{t("power_saving.mode.header")}</div>
      <div className="settings-group" role="radiogroup" aria-labelledby="perf-mode-label">
        {modes.map((m) => (
          <button key={m.v} type="button" role="radio" aria-checked={prefs.mode === m.v} className={`radio-row${m.disabled ? " dim" : ""}`} disabled={m.disabled} onClick={() => onSetMode(m.v)}>
            <span className={`radio-dot${prefs.mode === m.v ? " on" : ""}`} />
            <span className="radio-text"><span className="row-label">{m.title}</span><span className="row-sub">{m.sub}</span></span>
          </button>
        ))}
        {prefs.mode === "auto" && battery.supported && (
          <div className="range-row">
            <div className="range-top"><span className="row-label">{t("power_saving.threshold.label")}</span><span className="row-value">{prefs.threshold}%</span></div>
            <input type="range" aria-label={t("power_saving.threshold.label")} aria-valuetext={`${prefs.threshold}%`} min={THRESHOLD_MIN} max={THRESHOLD_MAX} step={THRESHOLD_STEP} value={prefs.threshold}
                   onChange={(e) => onSetThreshold(Number(e.target.value))} />
            <div className="range-scale"><span>{THRESHOLD_MIN}%</span><span>{THRESHOLD_MAX}%</span></div>
          </div>
        )}
      </div>
      <div className="settings-foot">{modeFoot}</div>

      <div className="section-label">{t("power_saving.items.header")}</div>
      <div className="settings-group">
        {POWER_ITEMS.map((k) => (
          <label key={k} className={`switch-row${active ? " locked" : ""}`}>
            <span className="radio-text">
              <span className="row-label">{t(ITEM_TEXT[k].title)}</span>
              <span className="row-sub">{t(active ? "power_saving.item.paused" : ITEM_TEXT[k].sub)}</span>
            </span>
            {/* 锁定态不 disabled：保持可聚焦，Space / Enter / 点整行都走 onClick 弹「已锁定」Toast（点 label 会合成一次 input 点击，只触发这一处）。 */}
            <input type="checkbox" checked={active ? false : prefs[k]} aria-disabled={active ? "true" : undefined}
                   onClick={active ? onLocked : undefined}
                   onChange={(e) => { if (!active) onToggleItem(k, e.target.checked); }} />
          </label>
        ))}
      </div>
      <div className="settings-foot">{t("power_saving.items.footer")}</div>
    </SubPanel>
  );
}
