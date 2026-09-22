import { SubPanel } from "./SubPanel";
import { getPref, setPref, systemLangName, useT, type LangPref } from "../../i18n";

/** 语言选择子面板：设置 ▸ 语言进入。各语言用**自己的语言**写（简体中文 / English），不随界面语言翻译——
 *  用户切错了还认得出来（I18N_DESIGN §2）。纯展示：当前值与 setter 由 App 注入。 */
export function LanguagePanel({ pref, systemLabel, onSelect, onBack }: {
  pref: LangPref;
  /** 「跟随系统」当前解析成的语言自称（如「简体中文」），显示在该选项的副标题。 */
  systemLabel: string;
  onSelect: (v: LangPref) => void;
  onBack: () => void;
}) {
  const t = useT();
  const options: { v: LangPref; label: string; sub?: string }[] = [
    { v: "system", label: t("settings.language.option_system"), sub: systemLabel },
    { v: "zh-Hans", label: t("settings.language.option_zh_hans") },
    { v: "en", label: t("settings.language.option_en") },
  ];
  return (
    <SubPanel className="language-panel" title={t("settings.language.title")} onBack={onBack}>
      <div className="settings-group">
        {options.map((o) => (
          <button key={o.v} className="radio-row" onClick={() => onSelect(o.v)}>
            <span className={`radio-dot${pref === o.v ? " on" : ""}`} />
            <span className="radio-text">
              <span className="row-label">{o.label}</span>
              {o.sub && <span className="row-sub">{o.sub}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="section-label">{t("settings.language.footer")}</div>
    </SubPanel>
  );
}

/** 接好 i18n 偏好存取的容器：App 里只需 `<LanguageSettings onBack={…} />`（一行，App.tsx 有行数预算）。
 *  useT() 已订阅界面语言，切换后本面板与勾选随之重渲染。 */
export function LanguageSettings({ onBack }: { onBack: () => void }) {
  useT();
  return <LanguagePanel pref={getPref()} systemLabel={systemLangName()} onSelect={setPref} onBack={onBack} />;
}
