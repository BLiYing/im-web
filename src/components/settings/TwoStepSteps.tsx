import { useEffect, useState } from "react";
import * as QRCode from "qrcode";
import { ChevronDown } from "lucide-react";
import { useT } from "../../i18n";
import { LOG_TAG, logger } from "../../logging/logger";
import { useAppServices } from "../../AppServicesContext";
import { groupSecret, isCodeReady, recoveryCopyText, recoveryFileText } from "../../twoStepRules";
import type { TwoStepState } from "../../useTwoStep";
import { CodeInput } from "../CodeInput";

/** 复制到剪贴板；失败（权限 / 非安全上下文）返回 false。 */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** ② 验证密码。 */
export function VerifyPasswordPage({ s }: { s: TwoStepState }) {
  const t = useT();
  const [pwd, setPwd] = useState("");
  const go = () => { if (pwd && !s.busy) void s.submitPassword(pwd); };
  return (
    <>
      <div className="settings-group edit-fields">
        <label className="edit-field"><span>{t("twostep.field.password")}</span>
          <input type="password" autoComplete="current-password" autoFocus value={pwd} readOnly={s.busy}
            onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} /></label>
      </div>
      {s.error && <div className="pwd-error" role="alert">{s.error}</div>}
      <div className="settings-foot">{t("twostep.verify_pw.footer")}</div>
      <div className="pwd-actions">
        <button className="mini-btn wide" disabled={!pwd || s.busy} onClick={go}>
          {s.busy ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null}{t("twostep.action.continue")}
        </button>
      </div>
    </>
  );
}

/** ③ 绑定认证器：本地绘制二维码（白底 + 12px 内边距，深浅色都不变）+ 折叠的手动密钥 + 6 位码。 */
export function BindPage({ s }: { s: TwoStepState }) {
  const t = useT();
  const { setToast } = useAppServices();
  const [qr, setQr] = useState("");
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const uri = s.setup?.otpauthUri ?? "";
  useEffect(() => {
    let alive = true;
    if (!uri) { setQr(""); return; }
    QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 0, width: 176, color: { dark: "#000000", light: "#ffffff" } })
      .then((u) => { if (alive) setQr(u); })
      .catch(() => logger.warn(LOG_TAG.http, "twostep_qr_failed")); // 不带 URI：里面有密钥
    return () => { alive = false; };
  }, [uri]);
  const secret = s.setup ? groupSecret(s.setup.secret) : "";
  const go = () => { if (isCodeReady("code", code) && !s.busy) void s.submitBind(code); };
  return (
    <>
      <div className="settings-foot">{t("twostep.bind.hint")}</div>
      <div className="ts-qr">{qr && <img src={qr} width={176} height={176} alt="" />}</div>
      <div className="settings-group">
        <button className="settings-row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="row-label">{t("twostep.bind.manual")}</span>
          <ChevronDown size={18} className={`row-chevron ts-chev${open ? " open" : ""}`} />
        </button>
        {open && (
          <div className="ts-key-box">
            <div className="ts-key" data-testid="ts-secret">{secret}</div>
            <button className="ts-link" onClick={() => void copyText(secret).then((ok) => ok && setToast(t("twostep.bind.copied")))}>{t("twostep.bind.copy")}</button>
          </div>
        )}
      </div>
      <div className="settings-group edit-fields">
        <label className="edit-field"><span>{t("twostep.field.code")}</span>
          <CodeInput value={code} onChange={setCode} readOnly={s.busy} invalid={!!s.error} label={t("twostep.field.code")} />
        </label>
      </div>
      {s.error && <div className="pwd-error" role="alert">{s.error}</div>}
      <div className="pwd-actions">
        <button className="mini-btn wide" disabled={!isCodeReady("code", code) || s.busy} onClick={go}>
          {s.busy ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null}{t("twostep.bind.submit")}
        </button>
      </div>
    </>
  );
}

/** ④ 保存恢复码：勾选「我已保存」才能点「完成」；返回由容器拦截确认。 */
export function CodesPage({ s }: { s: TwoStepState }) {
  const t = useT();
  const { setToast } = useAppServices();
  const save = () => {
    const blob = new Blob([recoveryFileText(s.codes, t("twostep.codes.file_header"))], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "im-recovery-codes.txt"; a.style.display = "none";
    document.body.appendChild(a);
    try { a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  return (
    <>
      <div className="settings-foot">{t("twostep.codes.footer")}</div>
      {s.codesOrigin === "regen" && <div className="settings-foot">{t("twostep.regen.footer")}</div>}
      <div className="settings-group"><div className="ts-codes">{s.codes.map((c) => <span key={c}>{c}</span>)}</div></div>
      <div className="settings-group">
        <button className="settings-row ts-act" onClick={() => void copyText(recoveryCopyText(s.codes)).then((ok) => ok && setToast(t("common.copied")))}>{t("twostep.codes.copy_all")}</button>
        <button className="settings-row ts-act" onClick={save}>{t("twostep.codes.save_file")}</button>
        <label className="switch-row">
          <span className="row-label">{t("twostep.codes.saved_check")}</span>
          <input type="checkbox" checked={s.saved} onChange={(e) => s.setSaved(e.target.checked)} />
        </label>
      </div>
      <div className="pwd-actions"><button className="mini-btn wide" disabled={!s.saved} onClick={s.finishCodes}>{t("twostep.codes.done")}</button></div>
    </>
  );
}
