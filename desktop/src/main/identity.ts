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

/** 本机状态落在 userData 下——跟着用户配置走，卸载重装前一直是同一份。
 *  存两样：deviceId（对应 web 侧的 localStorage("im.deviceId")）与本地同源层的端口（见下）。 */
function stateFile(): string {
  return join(app.getPath("userData"), "device.json");
}

/** 本机状态的全量读取。`windowState` 等新字段直接往里加，不必再开一个文件。 */
export function readLocalState(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8")) as Record<string, unknown>;
  } catch {
    return {};   // 首次运行 / 文件损坏 / 无读权限
  }
}

/** 合并写入。落盘失败不抛——本机状态丢了最多是下次启动重来，不该阻断任何功能。 */
export function writeLocalState(patch: Record<string, unknown>): void {
  try {
    writeFileSync(stateFile(), JSON.stringify({ ...readLocalState(), ...patch }), "utf8");
  } catch {
    // 落盘失败：本次会话照常工作，只是下次启动要重来。不阻断，理由见 stableDeviceId。
  }
}

/**
 * 本地同源层上次用的端口。**这一位不是性能优化，是正确性**：
 * `localStorage` 按 origin 隔离，而 origin 里带端口——端口每次变，登录会话、主题、壁纸、
 * 字号、会话列表缓存**每次启动全丢**。D2 第一版用临时端口，就是这个下场
 * （2026-09-08 做 D3 性能实测时照出来的：连着两次启动 origin 从 :61140 变成 :61146，
 * 登录完再启动仍回登录页）。
 *
 * 返回 0 表示「没有记录，随便挑一个」。端口被别人占了会退回临时端口——那一次会丢会话，
 * 但总比起不来强，且下次会记住新端口。
 */
export function rememberedLocalPort(): number {
  const v = readLocalState().localPort;
  return typeof v === "number" && v > 1024 && v < 65536 ? v : 0;
}

export function rememberLocalPort(port: number): void {
  if (rememberedLocalPort() !== port) writeLocalState({ localPort: port });
}

/**
 * 取本机稳定 deviceId：读不到就新生成一枚并落盘。
 *
 * **写盘失败不阻断登录**：与 web 侧「localStorage 不可用时退化为一次性 ID」同口径——
 * 功能降级为不去重（设备列表会堆同一台），但用户仍然能用。这条不变式两端必须一致，
 * 已在 docs/SYMMETRY.md 登记。
 */
export function stableDeviceId(): string {
  const existing = readLocalState().deviceId;
  if (typeof existing === "string" && existing) return existing;
  const id = randomUUID();
  writeLocalState({ deviceId: id });   // 落盘失败也返回可用 ID：降级为不去重但不阻断登录（同 web 侧）
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
