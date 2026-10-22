import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { AUTO_DELETE_FIXED_TIERS, isCustomTier, tierLabel } from "../autoDelete";
import { useT } from "../i18n";
import { AutoDeleteCustomSheet } from "./AutoDeleteCustomSheet";

/** 自动删除档位单选组（账号默认面板与会话详情页共用）：固定行 关闭 / 2 分钟 / 1 天 / 1 周 / 1 个月 + 「自定义」行（chevron，
 *  点开底部弹窗选 18 档）。复用设置子面板的 `.radio-row`，选中态在行右侧打 ✓；当前档位不在固定行时 ✓ 归「自定义」行，
 *  行右值显示该时长。弹窗里选中等同在列表里选了该档位，走同一个 onPick。 */
export function AutoDeleteTiers({ value, disabled, onPick, readOnly, onReadOnlyTap, className = "settings-group" }: {
  value: number;
  disabled?: boolean;
  onPick: (sec: number) => void;
  /** 只读（群聊非群主 / 管理员）：保留 ✓ 展示，点任意行只回调 onReadOnlyTap（toast），不选、不开自定义弹窗、不 PUT。 */
  readOnly?: boolean;
  onReadOnlyTap?: () => void;
  className?: string;
}) {
  const t = useT();
  const [sheet, setSheet] = useState(false);
  const custom = isCustomTier(value);
  const pick = (sec: number) => (readOnly ? onReadOnlyTap?.() : onPick(sec));
  const ro = readOnly ? " readonly" : "";
  return (
    <>
      <div className={className} role="radiogroup">
        {AUTO_DELETE_FIXED_TIERS.map((sec) => (
          <button key={sec} className={`radio-row autodel-row${ro}`} role="radio" aria-checked={value === sec} aria-disabled={readOnly || undefined} disabled={disabled} onClick={() => pick(sec)}>
            <span className="row-label">{tierLabel(t, sec)}</span>
            {value === sec && <Check size={18} className="autodel-check" />}
          </button>
        ))}
        <button className={`radio-row autodel-row${ro}`} role="radio" aria-checked={custom} aria-disabled={readOnly || undefined} disabled={disabled} onClick={() => (readOnly ? onReadOnlyTap?.() : setSheet(true))}>
          <span className="row-label">{t("autodel.custom")}</span>
          {custom && <span className="autodel-value">{tierLabel(t, value)}</span>}
          {custom && <Check size={18} className="autodel-check" />}
          <ChevronRight size={18} className={custom ? "autodel-chev" : "autodel-check autodel-chev"} />
        </button>
      </div>
      {sheet && <AutoDeleteCustomSheet value={value} onPick={(sec) => { setSheet(false); onPick(sec); }} onCancel={() => setSheet(false)} />}
    </>
  );
}
