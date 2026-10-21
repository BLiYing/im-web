import { Check } from "lucide-react";
import { AUTO_DELETE_TIERS, tierLabelKey } from "../autoDelete";
import { useT } from "../i18n";

/** 自动删除档位单选组（账号默认面板与会话详情页共用）：复用设置子面板的 `.radio-row` 单选行，
 *  选中态按草图在行右侧打 ✓（语言页等是左侧圆点，这里是 iOS/Android 稿的 ✓ 口径）。 */
export function AutoDeleteTiers({ value, disabled, onPick, className = "settings-group" }: {
  value: number;
  disabled?: boolean;
  onPick: (sec: number) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={className} role="radiogroup">
      {AUTO_DELETE_TIERS.map((sec) => (
        <button key={sec} className="radio-row autodel-row" role="radio" aria-checked={value === sec} disabled={disabled} onClick={() => onPick(sec)}>
          <span className="row-label">{t(tierLabelKey(sec))}</span>
          {value === sec && <Check size={18} className="autodel-check" />}
        </button>
      ))}
    </div>
  );
}
