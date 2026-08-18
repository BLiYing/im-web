import { ChevronLeft, RefreshCw } from "lucide-react";
import type { DeviceView } from "../../sdk/protocol";
import { platformIcon, deviceName, deviceSubtitle } from "../../devices";

/** 已登录设备子面板（多设备管理 P2，草图 DEVICE_MANAGEMENT_UX_SKETCH §3）：
 *  以登录设备(session)为行，本机置顶标灰不可退（想退＝退出登录），底部一键退出其他所有设备。
 *  纯展示：状态与操作来自 useDevices（经 App 传入）。 */
export function DevicesPanel({ devices, err, revokingSid, onRefresh, onRevoke, onRevokeOthers, onBack }: {
  devices: DeviceView[] | null; // null=加载中；[]=空
  err: string;
  revokingSid: string; // 正在踢下线的 sid；"__others__"=退出其他
  onRefresh: () => void;
  onRevoke: (d: DeviceView) => void;
  onRevokeOthers: () => void;
  onBack: () => void;
}) {
  return (
    <div className="settings-panel devices-panel">
      <header className="settings-head">
        <button className="icon-btn" title="返回" onClick={onBack}><ChevronLeft size={27} /></button>
        <span className="settings-title">已登录设备</span>
        <button className="icon-btn" title="刷新" disabled={devices === null} onClick={onRefresh}><RefreshCw size={20} /></button>
      </header>
      <div className="settings-body">
        {devices === null && <div className="devices-empty">加载中…</div>}
        {devices !== null && err && <div className="devices-empty devices-err">{err}</div>}
        {devices !== null && !err && devices.length === 0 && <div className="devices-empty">没有其他登录设备</div>}
        {devices !== null && devices.length > 0 && (
          <>
            <div className="section-label">这些设备当前登录了你的账号</div>
            <div className="settings-group devices-list">
              {devices.map((d) => (
                <div key={d.session_id} className="device-row">
                  <span className="device-ic">{platformIcon(d.platform)}</span>
                  <div className="device-meta">
                    <div className="device-name">
                      <span>{deviceName(d)}</span>
                      {d.current && <span className="device-cur-pill">这台设备</span>}
                    </div>
                    <div className="device-sub">
                      <span className={d.online ? "device-dot on" : "device-dot off"} />
                      {deviceSubtitle(d, Date.now())}
                    </div>
                  </div>
                  {d.current
                    ? <span className="device-btn cur">当前</span>
                    : <button className="device-btn" disabled={!!revokingSid} onClick={() => onRevoke(d)}>
                        {revokingSid === d.session_id ? "退出中…" : "退出"}
                      </button>}
                </div>
              ))}
            </div>
            {devices.some((d) => !d.current) && (
              <button className="devices-revoke-all" disabled={!!revokingSid} onClick={onRevokeOthers}>
                {revokingSid === "__others__" ? "退出中…" : "退出其他所有设备"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
