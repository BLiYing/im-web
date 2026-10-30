import { ShieldCheck, ChevronRight } from "lucide-react";
import { useT } from "../../i18n";
import { fullDate } from "../../time";
import { isRecoveryLow, statusFooterKey } from "../../twoStepRules";
import type { TwoStepState } from "../../useTwoStep";
import { SubPanel } from "./SubPanel";
import { VerifyPasswordPage, BindPage, CodesPage } from "./TwoStepSteps";
import { ActionPage } from "./TwoStepActionPage";
import "../twoStep.css";

/** 两步验证二级页（隐私与安全 ▸ 账号保护 ▸ 两步验证）：按状态机 `page` 在同一个面板里切换页面。
 *  状态与网络全在 useTwoStep（挂在 SettingsPanelsHost，面板关掉不丢结果）；本组件只做路由与介绍 / 状态页。 */
export function TwoStepPanel({ s, onClose }: { s: TwoStepState; onClose: () => void }) {
  const t = useT();
  const titleKey: Record<string, string> = {
    verifyPw: "twostep.verify_pw.title", bind: "twostep.bind.title", codes: "twostep.codes.title",
    disable: "twostep.disable.title", regen: "twostep.regen.title",
  };
  const back = () => {
    if (s.page === "codes") void s.leaveCodes(); // 恢复码只显示一次：未勾选「已保存」时二次确认
    else if (s.page === "intro" || s.page === "status" || s.page === "loading") onClose();
    else s.cancelFlow();
  };
  return (
    <SubPanel className="twostep-panel" title={t(titleKey[s.page] ?? "twostep.title")} onBack={back}>
      {s.page === "loading" && <div className="settings-foot" role="status"><span className="btn-spinner keep-anim" aria-hidden="true" /></div>}
      {s.page === "intro" && <IntroPage onStart={s.startFlow} />}
      {s.page === "status" && s.status && <StatusPage s={s} />}
      {s.page === "verifyPw" && <VerifyPasswordPage s={s} />}
      {s.page === "bind" && <BindPage s={s} />}
      {s.page === "codes" && <CodesPage s={s} />}
      {(s.page === "disable" || s.page === "regen") && <ActionPage key={s.page} kind={s.page} s={s} />}
    </SubPanel>
  );
}

function IntroPage({ onStart }: { onStart: () => void }) {
  const t = useT();
  return (
    <>
      <div className="ts-hero"><ShieldCheck size={48} aria-hidden="true" /><h3>{t("twostep.title")}</h3><p>{t("twostep.intro.body")}</p></div>
      <div className="pwd-actions"><button className="mini-btn wide" onClick={onStart}>{t("twostep.intro.start")}</button></div>
    </>
  );
}

function StatusPage({ s }: { s: TwoStepState }) {
  const t = useT();
  const st = s.status!;
  const low = isRecoveryLow(st.recoveryRemaining);
  const footKey = statusFooterKey(st.recoveryRemaining, s.unsaved);
  return (
    <>
      <div className="ts-hero"><ShieldCheck size={48} aria-hidden="true" /><h3>{t("twostep.on.title")}</h3>
        {st.enabledAt > 0 && <p>{t("twostep.on.since", { date: fullDate(new Date(st.enabledAt)) })}</p>}</div>
      <div className="settings-group">
        <button className="settings-row" onClick={() => s.openAction("regen")}>
          <span className="row-label">{t("twostep.recovery.row")}</span>
          <span className={`row-value${low ? " ts-low" : ""}`}>{t("twostep.recovery.remaining", { count: st.recoveryRemaining })}</span>
          <ChevronRight size={18} className="row-chevron" />
        </button>
        <button className="settings-row danger ts-center" onClick={() => s.openAction("disable")}>{t("twostep.disable.row")}</button>
      </div>
      {footKey && <div className="settings-foot">{t(footKey)}</div>}
    </>
  );
}
