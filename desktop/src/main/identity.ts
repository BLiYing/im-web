// 本机身份：deviceId 与 deviceName。**这是 D2 阶段桥唯一提供的能力**，其余全部回退 web
// （见 im-web src/platform/desktop.ts 的逐能力回退）。
//
// 为什么身份必须是「值」而不是异步方法：`IMClient` 拼登录帧时同步取用 deviceId，
// 后端按 (uid, device_id) 顶替去重——做成异步 IPC 就得把登录帧的拼装改成异步，那是行为改变。
// 所以主进程在建窗口之前就把两项算好，经 webPreferences.additionalArguments 传给 preload。
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

/** 桥契约版本。页面比外壳新时据此判断该不该走某条新路；改桥的对外形状就要 +1。 */
export const BRIDGE_CONTRACT = 1;

/** deviceId 落在 userData 下——跟着用户配置走，卸载重装前一直是同一台。
 *  对应 web 侧的 localStorage("im.deviceId")，语义相同：一台机器一个稳定 ID。 */
function deviceIdFile(): string {
  return join(app.getPath("userData"), "device.json");
}

/**
 * 取本机稳定 deviceId：读不到就新生成一枚并落盘。
 *
 * **写盘失败不阻断登录**：与 web 侧「localStorage 不可用时退化为一次性 ID」同口径——
 * 功能降级为不去重（设备列表会堆同一台），但用户仍然能用。这条不变式两端必须一致，
 * 已在 docs/SYMMETRY.md 登记。
 */
export function stableDeviceId(): string {
  const file = deviceIdFile();
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { deviceId?: unknown };
    if (typeof raw.deviceId === "string" && raw.deviceId) return raw.deviceId;
  } catch {
    // 首次运行 / 文件损坏 / 无读权限：往下走，重新生成一枚。
  }
  const id = randomUUID();
  try {
    writeFileSync(file, JSON.stringify({ deviceId: id }), "utf8");
  } catch {
    // 落盘失败：本次会话仍返回一枚可用 ID，降级为不去重但不阻断登录（同 web 侧）。
  }
  return id;
}

/** 人读的系统名。`process.platform` 只给 darwin/win32，直接展示对用户没意义。 */
function osLabel(): string {
  switch (process.platform) {
    case "darwin": return `macOS ${release()}`;   // release() 是内核版本（如 24.6.0），不是 15.7；见下方注释
    case "win32": return `Windows ${release()}`;
    case "linux": return `Linux ${release()}`;
    default: return process.platform;
  }
}

/**
 * 设备名，登录时上报供设备管理页展示。
 *
 * ⚠️ **已知不精确**：macOS 上 `os.release()` 给的是**内核版本**（24.6.0），不是用户认得的
 * 系统版本（15.7）。要拿后者得读 `sw_vers` 或 SystemVersion.plist，属 D4 的打磨项；
 * 现在宁可显示一个诚实的内核号，也不要在这里写死一张会过期的映射表
 * （Darwin→macOS 的对照表每年都要改，改漏了就是「假的对齐声明」）。
 */
export function deviceName(): string {
  return `IM Desktop · ${osLabel()}`;
}
