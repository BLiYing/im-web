// 两步验证（设置侧）状态机：介绍页 → 验证密码 → 绑定认证器 → 恢复码 → 状态页；状态页 → 重新生成 / 关闭。
// 设计 IMServer/docs/design/TWO_STEP_VERIFICATION_DESIGN.md §2.1/§2.2。
// 状态簇挂在 SettingsPanelsHost（面板关掉也不丢）：enable 的恢复码只回一次，请求在途时用户返回再进来必须还能看到结果。
// 日志纪律：验证码 / 密钥 / 恢复码不进日志——本文件不打日志，请求体由 logging/sanitize 脱敏。
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import {
  TS_CODE, disableTwoStep, enableTwoStep, getTwoStepStatus, regenerateRecoveryCodes, setupTwoStep,
  type TwoStepSetup, type TwoStepStatus,
} from "./sdk/twoStepApi";
import { codeForSubmit, sanitizeCode6, shouldBlockLeave, twoStepErrorText, type CodeMode, type ErrorScene } from "./twoStepRules";

type AskConfirm = (message: string, opts?: { title?: string; okText?: string; danger?: boolean }) => Promise<boolean>;

export type TwoStepFlow = "verifyPw" | "bind" | "codes" | "disable" | "regen";
export type TwoStepPage = TwoStepFlow | "loading" | "intro" | "status";
export type ActionKind = "disable" | "regen";

export interface TwoStepApiLike {
  status: (token: string) => Promise<TwoStepStatus>;
  setup: (token: string, password: string) => Promise<TwoStepSetup>;
  enable: (token: string, code: string) => Promise<string[]>;
  disable: (token: string, p: { password: string; code: string }) => Promise<void>;
  regenerate: (token: string, p: { password: string; code: string }) => Promise<string[]>;
}
const REAL_API: TwoStepApiLike = { status: getTwoStepStatus, setup: setupTwoStep, enable: enableTwoStep, disable: disableTwoStep, regenerate: regenerateRecoveryCodes };

export interface TwoStepDeps {
  owner: string; // 当前账号 uid：变化即整体复位（别让上个账号的恢复码 / 状态漏给下一个账号）
  token: () => string;
  askConfirm: AskConfirm;
  setToast: (msg: string | null) => void;
  api?: TwoStepApiLike;
}

export interface TwoStepState {
  status: TwoStepStatus | null; // null = 尚未加载
  page: TwoStepPage;
  setup: TwoStepSetup | null;
  codes: string[];
  codesOrigin: "enable" | "regen";
  saved: boolean;
  setSaved: (v: boolean) => void;
  unsaved: boolean; // 开启 / 重新生成后没勾选「已保存」就离开过
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  close: () => void;
  startFlow: () => void;
  cancelFlow: () => void;
  openAction: (kind: ActionKind) => void;
  submitPassword: (password: string) => Promise<void>;
  submitBind: (rawCode: string) => Promise<void>;
  submitAction: (kind: ActionKind, password: string, mode: CodeMode, rawCode: string) => Promise<void>;
  finishCodes: () => void;
  leaveCodes: () => Promise<boolean>;
}

const OFF: TwoStepStatus = { enabled: false, enabledAt: 0, recoveryRemaining: 0 };

export function useTwoStep(deps: TwoStepDeps): TwoStepState {
  const depsRef = useRef(deps); depsRef.current = deps;
  const api = () => depsRef.current.api ?? REAL_API;
  const [status, setStatus] = useState<TwoStepStatus | null>(null);
  const [flow, setFlow] = useState<TwoStepFlow | null>(null);
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [origin, setOrigin] = useState<"enable" | "regen">("enable");
  const [saved, setSaved] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const epoch = useRef(0); // 账号代：换账号（hardReset）后，上个账号在途请求的回包一律丢弃，别把它的状态 / 恢复码写进新账号

  const hardReset = useCallback(() => {
    epoch.current++;
    setStatus(null); setFlow(null); setSetup(null); setCodes([]); setSaved(false); setUnsaved(false); setBusy(false); setError("");
    inFlight.current = false;
  }, []);
  useEffect(() => { hardReset(); }, [deps.owner, hardReset]);

  const refresh = useCallback(async () => {
    const ep = epoch.current;
    try { const st = await api().status(depsRef.current.token()); if (ep === epoch.current) setStatus(st); }
    catch { if (ep === epoch.current) setStatus((cur) => cur ?? OFF); } // 失败当 off，不弹错（右值 / 介绍页仍可用；真已开启时 setup 会回 200024 再校正）
  }, []);

  /** 统一的"一次一发 + busy + 错误文案"外壳；返回 true=成功。 */
  const run = useCallback(async (scene: ErrorScene, fn: () => Promise<void>, onError?: (e: { code?: number }) => void): Promise<boolean> => {
    if (inFlight.current) return false;
    const ep = epoch.current;
    inFlight.current = true; setBusy(true); setError("");
    try { await fn(); return true; }
    catch (e) { if (ep === epoch.current) { setError(twoStepErrorText(e, scene, t)); onError?.(e as { code?: number }); } return false; }
    finally { if (ep === epoch.current) { inFlight.current = false; setBusy(false); } }
  }, []);

  const showCodes = useCallback((list: string[], from: "enable" | "regen") => {
    setCodes(list); setOrigin(from); setSaved(false); setSetup(null); setFlow("codes");
    setStatus((cur) => ({ enabled: true, enabledAt: cur?.enabledAt || Date.now(), recoveryRemaining: list.length }));
  }, []);

  const submitPassword = useCallback(async (password: string) => {
    const ep = epoch.current;
    await run("password", async () => { const su = await api().setup(depsRef.current.token(), password); if (ep === epoch.current) { setSetup(su); setFlow("bind"); } },
      (e) => { if (e.code === TS_CODE.alreadyEnabled) void refresh().then(() => setFlow(null)); });
  }, [run, refresh]);

  const submitBind = useCallback(async (rawCode: string) => {
    const code = sanitizeCode6(rawCode);
    const ep = epoch.current;
    await run("bind", async () => { const list = await api().enable(depsRef.current.token(), code); if (ep === epoch.current) showCodes(list, "enable"); },
      (e) => { if (e.code === TS_CODE.ticketInvalid) { setSetup(null); setFlow("verifyPw"); } }); // 待确认密钥超时：回验证密码重新开始（错误红字保留）
  }, [run, showCodes]);

  const submitAction = useCallback(async (kind: ActionKind, password: string, mode: CodeMode, rawCode: string) => {
    if (inFlight.current) return;
    const code = codeForSubmit(mode, rawCode);
    if (kind === "disable") {
      inFlight.current = true; // 确认弹窗期间也占位：连点不叠弹窗
      let ok = false;
      try { ok = await depsRef.current.askConfirm(t("twostep.disable.confirm_body"), { title: t("twostep.disable.confirm_title"), okText: t("twostep.disable.row"), danger: true }); }
      finally { inFlight.current = false; }
      if (!ok) return;
    }
    const ep = epoch.current;
    await run("verify", async () => {
      const tok = depsRef.current.token();
      if (kind === "disable") {
        await api().disable(tok, { password, code });
        if (ep !== epoch.current) return;
        setStatus(OFF); setFlow(null); setUnsaved(false);
        depsRef.current.setToast(t("twostep.toast.disabled"));
      } else {
        const list = await api().regenerate(tok, { password, code });
        if (ep === epoch.current) showCodes(list, "regen");
      }
    }, (e) => { if (e.code === TS_CODE.notEnabled) { setStatus(OFF); setFlow(null); } });
  }, [run, showCodes]);

  const afterCodes = useCallback(() => { setFlow(null); setCodes([]); setError(""); void refresh(); }, [refresh]);

  const finishCodes = useCallback(() => {
    if (!saved) return;
    setUnsaved(false);
    depsRef.current.setToast(t(origin === "enable" ? "twostep.toast.enabled" : "twostep.toast.regenerated"));
    afterCodes();
  }, [saved, origin, afterCodes]);

  const leaveCodes = useCallback(async () => {
    if (shouldBlockLeave(saved)) {
      const ok = await depsRef.current.askConfirm(t("twostep.codes.leave_body"), { title: t("twostep.codes.leave_title"), okText: t("twostep.codes.leave_confirm") });
      if (!ok) return false;
    }
    setUnsaved(!saved);
    afterCodes();
    return true;
  }, [saved, afterCodes]);

  const close = useCallback(() => {
    if (inFlight.current || flow === "codes") return; // 在途 / 恢复码未处理：保留，重开还能看到
    setFlow(null); setSetup(null); setError(""); setStatus(null);
  }, [flow]);

  const page: TwoStepPage = flow ?? (status === null ? "loading" : status.enabled ? "status" : "intro");
  return {
    status, page, setup, codes, codesOrigin: origin, saved, setSaved, unsaved, busy, error, refresh, close,
    startFlow: () => { setError(""); setFlow("verifyPw"); },
    cancelFlow: () => { setFlow(null); setSetup(null); setError(""); },
    openAction: (kind) => { setError(""); setFlow(kind); },
    submitPassword, submitBind, submitAction, finishCodes, leaveCodes,
  };
}
