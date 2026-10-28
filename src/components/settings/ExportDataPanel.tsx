import { useT } from "../../i18n";
import { useDataExport, type DataExportDeps, type DataExportState } from "../../useDataExport";
import { formatFileSize } from "../../fileMetadata";
import { fullDateTime } from "../../time";
import { SubPanel } from "./SubPanel";

/** 导出我的数据二级页（DATA_EXPORT_DESIGN §1 四态，草图 DATA_EXPORT_UX_SKETCH Web 列）。
 *  复用 switch-row / settings-group / pwd-error / delacct-pwd / delacct-btn / file-progress 现成样式，无新颜色。
 *  状态与网络全在 useDataExport，本组件纯展示。 */
export function ExportDataPanel({ s, onBack }: { s: DataExportState; onBack: () => void }) {
  const t = useT();
  const { view, job } = s;
  // 进行中遇到一次轮询失败：保留进度画面（轮询仍在继续，下一轮成功即恢复），不整页换成错误 + 重试。
  const showErr = s.loaded && !!s.loadError && view.kind !== "running";
  const ok = s.loaded && !showErr;
  return (
    <SubPanel className="export-panel" title={t("ps.row.export_data")} onBack={onBack}>
      {!s.loaded && <div className="settings-foot" role="status"><span className="btn-spinner keep-anim" aria-hidden="true" /></div>}
      {showErr && (
        <>
          <div className="pwd-error" role="alert">{s.loadError}</div>
          <button className="delacct-btn export-btn" onClick={() => void s.reload()}>{t("export.retry")}</button>
        </>
      )}
      {ok && view.kind === "running" && job && (
        <>
          <div className="section-label">{t("export.running")}</div>
          <div className="settings-group export-card">
            <span className="file-progress" role="progressbar" aria-valuemin={0}
              aria-valuemax={job.totalConvs > 0 ? job.totalConvs : undefined}
              aria-valuenow={job.totalConvs > 0 ? job.doneConvs : undefined}
              aria-busy={job.totalConvs > 0 ? undefined : true}>
              <span className="file-progress-bar" style={{ width: `${job.totalConvs > 0 ? Math.min(100, (job.doneConvs / job.totalConvs) * 100) : 0}%` }} />
            </span>
            <div className="export-line">{t("export.progress", { done: job.doneConvs, total: job.totalConvs })}</div>
          </div>
          <div className="settings-foot">{t("export.running.footer")}</div>
          <button className="delacct-btn export-btn export-btn-neutral" onClick={() => void s.cancel()}>{t("export.cancel")}</button>
        </>
      )}
      {ok && view.kind === "done" && job && (
        <>
          <div className="section-label">{t("export.done.title")}</div>
          <div className="settings-group export-card">
            {job.result && (
              <div className="export-line">{t("export.done.summary", { size: formatFileSize(job.result.sizeBytes), convs: job.result.convCount, msgs: job.result.msgCount })}</div>
            )}
          </div>
          {job.expiresAt > 0 && <div className="settings-foot">{t("export.done.expires", { time: fullDateTime(job.expiresAt) })}</div>}
          <button className="delacct-btn export-btn" disabled={s.downloading} onClick={() => void s.download()}>
            {s.downloading ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null}{t("export.download")}
          </button>
        </>
      )}
      {ok && view.kind === "failed" && (
        <>
          <div className="pwd-error" role="alert">{t("export.failed")}</div>
          <button className="delacct-btn export-btn" onClick={s.retry}>{t("export.retry")}</button>
        </>
      )}
      {ok && (view.kind === "config" || view.kind === "cooldown") && <ConfigForm s={s} />}
    </SubPanel>
  );
}

function ConfigForm({ s }: { s: DataExportState }) {
  const t = useT();
  const { view } = s;
  const cooling = view.kind === "cooldown";
  return (
    <>
      <div className="settings-foot">{t("export.intro")}</div>
      {view.kind === "config" && view.expiredNote && <div className="settings-foot" role="status">{t("export.expired")}</div>}
      <div className="settings-group">
        <label className="switch-row">
          <span className="row-label">{t("export.media.title")}</span>
          <input type="checkbox" role="switch" checked={s.includeMedia} disabled={cooling || s.busy} onChange={(e) => s.setIncludeMedia(e.target.checked)} />
        </label>
      </div>
      <div className="settings-foot">{t("export.media.footer")}</div>
      <div className="section-label">{t("export.format.header")}</div>
      <div className="settings-group">
        <label className="switch-row">
          <span className="row-label">{t("export.format.html")}</span>
          <input type="checkbox" checked={s.html} disabled={cooling || s.busy} onChange={(e) => s.setHtml(e.target.checked)} />
        </label>
        <label className="switch-row">
          <span className="row-label">{t("export.format.json")}</span>
          <input type="checkbox" checked={s.json} disabled={cooling || s.busy} onChange={(e) => s.setJson(e.target.checked)} />
        </label>
      </div>
      <div className="settings-group delacct-pwd">
        <input type="password" autoComplete="current-password" disabled={cooling || s.busy}
          placeholder={t("export.password.placeholder")} value={s.password}
          onChange={(e) => s.setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && s.canStart) void s.start(); }} />
      </div>
      {s.error && <div className="pwd-error" role="alert">{s.error}</div>}
      {cooling && <div className="settings-foot" role="status">{t("export.cooldown", { hours: view.hours })}</div>}
      <button className="delacct-btn export-btn" disabled={!s.canStart} onClick={() => void s.start()}>
        {s.busy ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null}{t("export.start")}
      </button>
    </>
  );
}

/** 容器：状态簇随面板挂载/卸载（关掉即停轮询、丢密码；重开重新取 latest 恢复进度）。 */
export function ExportDataContainer({ onBack, ...deps }: DataExportDeps & { onBack: () => void }) {
  const s = useDataExport(deps);
  return <ExportDataPanel s={s} onBack={onBack} />;
}
