// 「导出我的数据」面板的状态簇（设计 DATA_EXPORT_DESIGN §1/§2/§5）：
// 进入即取 latest；任务 queued/running 期间每 2 s 轮询，完成/失败即停，面板卸载即停（重开重新取 → 恢复进度）。
// 下载：先 POST download_url，再 navigate(基址 + url)——后端 Content-Disposition 触发下载，不带登录头。
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { LOG_TAG, logger } from "./logging/logger";
import {
  CODE_EXPORT_BUSY, CODE_EXPORT_COOLDOWN, CODE_WRONG_PASSWORD,
  cancelExport, getExportDownloadUrl, getLatestExport, resolveDownloadUrl, startExport,
  type ExportError, type ExportJob,
} from "./sdk/exportApi";
import { canStartExport, exportFormats, exportView, isActive, nextViewChangeAt, type ExportView } from "./exportState";

export const EXPORT_POLL_MS = 2000;

/** 触发浏览器下载：隐藏 <a download> 点击。不用 location.href——万一令牌已失效/被用过，服务端回 JSON 错误，
 *  整页跳转会把 SPA 换成一页 JSON；带 download 属性则只是一次失败的下载。 */
function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url; a.download = ""; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a);
  try { a.click(); } finally { a.remove(); }
}

export interface DataExportState {
  loaded: boolean;
  loadError: string;
  view: ExportView;
  job: ExportJob | null;
  password: string; setPassword: (v: string) => void;
  includeMedia: boolean; setIncludeMedia: (v: boolean) => void;
  html: boolean; setHtml: (v: boolean) => void;
  json: boolean; setJson: (v: boolean) => void;
  busy: boolean; downloading: boolean;
  error: string;
  canStart: boolean;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  download: () => Promise<void>;
  retry: () => void;
  reload: () => Promise<void>;
}

export interface DataExportDeps {
  token: () => string;
  setToast: (msg: string | null) => void;
  navigate?: (url: string) => void; // 默认隐藏 <a download> 点击（triggerDownload）；测试注入
  base?: string; // 下载基址；Web 同源为空
  pollMs?: number;
  now?: () => number;
}

export function useDataExport(deps: DataExportDeps): DataExportState {
  const { base = "", pollMs = EXPORT_POLL_MS } = deps;
  // 调用方多半传内联箭头：依赖走 ref，保证 reload 等回调身份稳定（否则 effect 每次渲染都重取）。
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const token = useCallback(() => depsRef.current.token(), []);
  const setToast = useCallback((m: string | null) => depsRef.current.setToast(m), []);
  const nowFn = useCallback(() => (depsRef.current.now ?? Date.now)(), []);
  const navigate = useCallback((u: string) => { (depsRef.current.navigate ?? triggerDownload)(u); }, []);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [includeMedia, setIncludeMedia] = useState(false);
  const [html, setHtml] = useState(true);
  const [json, setJson] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [dismissedId, setDismissedId] = useState("");
  const [tick, setTick] = useState(0); // 每次 latest 返回 +1：进度没变也要重排下一轮轮询
  const [, setClock] = useState(0); // 到期定时器触发重渲染（view 里的 now 比较靠它刷新）
  const seq = useRef(0); // 变更序号：start/cancel 之后，更早发出的 latest 响应作废（乱序保护）
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async () => {
    const mine = seq.current;
    try {
      const j = await getLatestExport(token());
      if (!alive.current || mine !== seq.current) return;
      setJob(j); setLoadError("");
    } catch (e) {
      logger.warn(LOG_TAG.ui, "export_latest_failed", { code: (e as ExportError).code });
      if (alive.current && mine === seq.current) setLoadError((e as Error).message || t("net.error.cannot_connect"));
    } finally {
      if (alive.current) { setLoaded(true); setTick((n) => n + 1); }
    }
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  // 轮询：仅进行中；每轮结果落 job，状态一变 effect 重排，终态自然停。
  const active = isActive(job);
  useEffect(() => {
    if (!active) return;
    const h = window.setTimeout(() => { void reload(); }, pollMs);
    return () => window.clearTimeout(h);
  }, [active, tick, pollMs, reload]);

  // 到点重渲染：完成态的 expires_at / 冷却结束。到点后重取 latest，让服务端给 expired 状态与过期说明。
  const changeAt = nextViewChangeAt(job, nowFn(), cooldownUntil);
  useEffect(() => {
    if (!changeAt) return;
    const delay = Math.min(Math.max(changeAt - nowFn(), 0) + 50, 2 ** 31 - 1);
    const h = window.setTimeout(() => { setClock((n) => n + 1); if (isActive(job) === false) void reload(); }, delay);
    return () => window.clearTimeout(h);
  }, [changeAt, nowFn, reload, job]);

  const formats = exportFormats(html, json);
  const baseView = exportView(job, nowFn(), cooldownUntil);
  const view: ExportView = baseView.kind === "failed" && job && dismissedId === job.id ? { kind: "config" } : baseView;
  const canStart = canStartExport({ password, html, json, busy, cooling: view.kind === "cooldown" });

  const start = useCallback(async () => {
    if (!canStart) return;
    setBusy(true); setError("");
    try {
      const j = await startExport(token(), { password, includeMedia, formats });
      seq.current++;
      if (!alive.current) return;
      setJob(j); setPassword("");
    } catch (e) {
      if (!alive.current) return;
      const err = e as ExportError;
      logger.warn(LOG_TAG.ui, "export_start_failed", { code: err.code });
      if (err.code === CODE_WRONG_PASSWORD) setError(t("err.200002")); // 内联红字，输入保留
      else if (err.code === CODE_EXPORT_BUSY) { setError(t("err.200010")); void reload(); } // 其它端已发起：拉回进度
      else if (err.code === CODE_EXPORT_COOLDOWN) {
        if (err.retryAfterSec) setCooldownUntil(nowFn() + err.retryAfterSec * 1000);
        else setError(t("err.200011"));
        void reload();
      } else setError(err.message || t("net.error.cannot_connect"));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [canStart, token, password, includeMedia, formats, reload, nowFn]);

  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      await cancelExport(token(), job.id);
      seq.current++;
    } catch (e) {
      logger.warn(LOG_TAG.ui, "export_cancel_failed", { code: (e as ExportError).code });
      if (alive.current) setToast((e as Error).message || t("net.error.cannot_connect"));
    }
    await reload(); // 无论成败都以服务端为准（取消失败多半是已完成）
  }, [job, token, setToast, reload]);

  const download = useCallback(async () => {
    if (!job || downloading) return;
    setDownloading(true);
    try {
      const url = await getExportDownloadUrl(token(), job.id);
      navigate(resolveDownloadUrl(url, base));
    } catch (e) {
      logger.warn(LOG_TAG.ui, "export_download_failed", { code: (e as ExportError).code });
      setToast(t("export.download_failed"));
    } finally {
      if (alive.current) setDownloading(false);
    }
  }, [job, downloading, token, navigate, base, setToast]);

  const retry = useCallback(() => { if (job) setDismissedId(job.id); setError(""); }, [job]);

  return {
    loaded, loadError, view, job, password, setPassword, includeMedia, setIncludeMedia, html, setHtml, json, setJson,
    busy, downloading, error, canStart, start, cancel, download, retry, reload,
  };
}
