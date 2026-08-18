import { useCallback, useState, type MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { DeviceView } from "./sdk/protocol";
import { deviceName } from "./devices";

type AskConfirm = (message: string, opts?: { okText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>;

/**
 * 已登录设备管理（P2）：设备列表加载、单设备踢下线、退出其他所有设备。
 * 自持 devices/devicesOpen/devicesErr/revokingSid 四态；副作用依赖（IM 客户端、确认框、吐司）由 App 注入，
 * 保持与原组件内逻辑逐字一致。
 */
export function useDevices(deps: {
  clientRef: MutableRefObject<IMClient | null>;
  askConfirm: AskConfirm;
  setToast: (msg: string) => void;
}) {
  const { clientRef, askConfirm, setToast } = deps;
  const [devices, setDevices] = useState<DeviceView[] | null>(null); // null=加载中；[]=空
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devicesErr, setDevicesErr] = useState("");
  const [revokingSid, setRevokingSid] = useState(""); // 正在踢下线的 sid（禁用该行按钮）；"__others__"=退出其他

  const loadDevices = useCallback(async () => {
    setDevices(null); setDevicesErr("");
    try {
      const list = await clientRef.current?.listDevices();
      setDevices(list ?? []);
    } catch (e) {
      setDevices([]); setDevicesErr((e as Error).message || "加载失败");
    }
  }, [clientRef]);

  // 踢下线某设备。本机不走此路径（UI 已禁用，想退走「退出登录」）。
  const revokeDevice = useCallback(async (d: DeviceView) => {
    if (d.current) return;
    const ok = await askConfirm(`退出「${deviceName(d)}」？该设备将立即下线并需重新登录。若非你本人设备，建议退出后修改密码。`,
      { okText: "退出登录", danger: true });
    if (!ok) return;
    setRevokingSid(d.session_id);
    try {
      await clientRef.current?.revokeDevice(d.session_id);
      setToast("已退出该设备");
      await loadDevices();
    } catch (e) {
      setToast(`操作失败：${(e as Error).message}`);
    } finally {
      setRevokingSid("");
    }
  }, [clientRef, askConfirm, setToast, loadDevices]);

  const revokeOtherDevices = useCallback(async () => {
    const ok = await askConfirm("退出其他所有设备？除这台设备外的全部登录都将立即下线。换密码后建议这样做。",
      { okText: "全部退出", danger: true });
    if (!ok) return;
    setRevokingSid("__others__");
    try {
      await clientRef.current?.revokeOtherDevices();
      setToast("已退出其他所有设备");
      await loadDevices();
    } catch (e) {
      setToast(`操作失败：${(e as Error).message}`);
    } finally {
      setRevokingSid("");
    }
  }, [clientRef, askConfirm, setToast, loadDevices]);

  // 退出登录时复位：与原组件 logout 逐字一致（关面板 + 清列表）。
  const resetDevices = useCallback(() => { setDevices(null); setDevicesOpen(false); }, []);

  return { devices, devicesOpen, setDevicesOpen, devicesErr, revokingSid, loadDevices, revokeDevice, revokeOtherDevices, resetDevices };
}
