import { useState } from "react";
import { useT } from "../../i18n";
import { isCodeReady, type CodeMode } from "../../twoStepRules";
import type { ActionKind, TwoStepState } from "../../useTwoStep";
import { CodeInput, RecoveryInput } from "../CodeInput";

/** 关闭两步验证 / 重新生成恢复码：当前密码 + 一个码（动态码，可切恢复码）。关闭走系统二次确认（在 useTwoStep.submitAction）。 */
export function ActionPage({ kind, s }: { kind: ActionKind; s: TwoStepState }) {
  const t = useT();
  const [pwd, setPwd] = useState("");
  const [mode, setMode] = useState<CodeMode>("code");
  const [raw, setRaw] = useState("");
  const ready = !!pwd && isCodeReady(mode, raw) && !s.busy;
  const go = () => { if (ready) void s.submitAction(kind, pwd, mode, raw); };
  const switchMode = () => { setMode(mode === "code" ? "recovery" : "code"); setRaw(""); };
  const label = t(mode === "code" ? "twostep.field.code" : "twostep.field.recovery");
  const disable = kind === "disable";
  return (
    <>
      <div className="settings-group edit-fields">
        <label className="edit-field"><span>{t("twostep.field.password")}</span>
          <input type="password" autoComplete="current-password" autoFocus value={pwd} readOnly={s.busy} onChange={(e) => setPwd(e.target.value)} /></label>
        <label className="edit-field"><span>{label}</span>
          {mode === "code"
            ? <CodeInput key="c" value={raw} onChange={setRaw} readOnly={s.busy} invalid={!!s.error} label={label} />
            : <RecoveryInput key="r" value={raw} onChange={setRaw} onSubmit={go} readOnly={s.busy} invalid={!!s.error} label={label} />}
        </label>
      </div>
      <div className="ts-switch"><button className="ts-link" onClick={switchMode}>{t(mode === "code" ? "twostep.use_recovery" : "twostep.use_code")}</button></div>
      {s.error && <div className="pwd-error" role="alert">{s.error}</div>}
      <div className="settings-foot">{t(disable ? "twostep.disable.footer" : "twostep.regen.footer")}</div>
      <div className="pwd-actions">
        <button className={`mini-btn wide${disable ? " danger" : ""}`} disabled={!ready} onClick={go}>
          {s.busy ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null}{t(disable ? "twostep.disable.row" : "twostep.regen.submit")}
        </button>
      </div>
    </>
  );
}
