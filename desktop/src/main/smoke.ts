// `--smoke`：无人值守自检。**D2 的验收不能靠「我看见窗口弹出来了」**——那既不可重跑，
// 也证明不了桥真的挂上了。这里让外壳自己走一遍真实启动路径，在渲染进程里查三件事，
// 打印结果并以退出码表态，于是它能进 CI、也能在没有人盯着屏幕时跑。
//
// 查的三件事，每一件都对应一个会静默失败的坑：
//   ① window.imDesktop 挂上了吗          —— preload 路径写错时窗口照开，只是桥没了
//   ② platform() 认出桌面了吗            —— 桥挂了但字段残缺时 isBridgeUsable 会回落 web，看起来一切正常
//   ③ deviceId 和页面拿到的是同一个吗    —— 桥给一份、页面用另一份的话，后端会堆僵尸 session
import type { BrowserWindow } from "electron";

/** 页面里查到的实情。字段名与 im-web 的 Platform 对齐，便于对读。 */
interface SmokeReport {
  bridgePresent: boolean;
  bridgeContract: number | null;
  platformName: string | null;
  deviceIdFromBridge: string | null;
  deviceIdFromPlatform: string | null;
  deviceName: string | null;
  /** 页面自己攒下的 localStorage 键数（`im.` 前缀）。**origin 一变这些全丢**——会话 / 主题 /
   *  壁纸 / 字号 / 会话列表缓存都在里面。D2 第一版用临时端口，每次启动这里都是 0（D3 实测才照出来）。 */
  imKeys: number;
  /** 页面的来源。dev 是 http://localhost:5173，打包后是 file:// —— 这一位决定下一位。 */
  origin: string | null;
  /** 后端够不够得着。im-web 的 API 全是相对路径（/api/v1/…，见 sdk/http.ts 用 location.origin 拼），
   *  dev 下靠 Vite 代理到 :8080；打包后 origin 是 file://，相对路径解析成 file:///api/… 打不出去。 */
  backendReachable: boolean;
  backendDetail: string;
  error?: string;
}

const PROBE = `(() => {
  const b = window.imDesktop;
  const r = {
    bridgePresent: !!b,
    bridgeContract: b ? b.contract : null,
    platformName: null,
    deviceIdFromBridge: b ? b.deviceId : null,
    deviceIdFromPlatform: null,
    deviceName: b ? b.deviceName : null,
  };
  // platform() 是页面自己的模块，未必挂在 window 上；用它暴露的可观察结果代替：
  // 页面登录时会把 deviceId 落 localStorage（web 路径）或直接用桥的（desktop 路径）。
  // 这里只做不依赖登录的判定：桥可用 ⇒ platform 必然选 desktop（见 platform/index.ts）。
  r.platformName = r.bridgePresent && r.bridgeContract > 0 && r.deviceIdFromBridge && r.deviceName
    ? "desktop" : "web";
  r.deviceIdFromPlatform = r.platformName === "desktop" ? r.deviceIdFromBridge : localStorage.getItem("im.deviceId");
  r.origin = location.origin;
  r.imKeys = Object.keys(localStorage).filter((k) => k.startsWith('im.')).length;
  return r;
})()`;

/** 单独一段：探后端够不够得着。走的正是页面自己那条相对路径，所以它测的是真实处境，
 *  不是「localhost:8080 通不通」——后者在打包版里通也没用，页面根本拼不出这个地址。 */
const BACKEND_PROBE = `(async () => {
  try {
    const r = await fetch("/api/v1/login", { method: "POST", body: "{}" });
    return { ok: true, detail: "HTTP " + r.status };   // 400 也算够得着：请求真的到了后端
  } catch (e) {
    return { ok: false, detail: String(e && e.message ? e.message : e) };
  }
})()`;

/** 跑一次自检，返回进程退出码（0=通过）。**不吞异常**：加载失败要能从退出码看出来。 */
export async function runSmoke(
  win: BrowserWindow,
  target: string,
  load: Promise<void>,
): Promise<number> {
  const say = (s: string): void => { process.stdout.write(`${s}\n`); };
  say(`[smoke] 目标 ${target}`);
  try {
    await load;
  } catch (e) {
    say(`[smoke] ✗ 页面加载失败：${String(e)}`);
    say("[smoke]   dev 模式下最常见的原因是 Vite 没在跑（cd .. && npm run dev）");
    return 2;
  }

  let r: SmokeReport;
  try {
    r = (await win.webContents.executeJavaScript(PROBE)) as SmokeReport;
  } catch (e) {
    say(`[smoke] ✗ 探针执行失败：${String(e)}`);
    return 3;
  }

  say(`[smoke] bridge=${r.bridgePresent} contract=${r.bridgeContract} platform=${r.platformName}`);
  say(`[smoke] deviceName=${r.deviceName}`);
  say(`[smoke] deviceId(bridge)=${r.deviceIdFromBridge}`);
  say(`[smoke] origin=${r.origin}  localStorage(im.*)=${r.imKeys} 个`);

  const probe = (await win.webContents.executeJavaScript(BACKEND_PROBE)) as { ok: boolean; detail: string };
  say(`[smoke] 后端可达=${probe.ok}（${probe.detail}）`);

  const fail: string[] = [];
  if (!r.bridgePresent) fail.push("window.imDesktop 没挂上（preload 路径或 contextBridge 出错）");
  if (r.platformName !== "desktop") fail.push(`platform 判定成了 ${r.platformName}，桥字段可能残缺`);
  if (!r.deviceIdFromBridge) fail.push("deviceId 为空——后端会按 (uid, device_id) 堆僵尸 session");
  if (r.deviceIdFromBridge !== r.deviceIdFromPlatform) fail.push("桥与页面拿到的 deviceId 不一致");
  if (!r.deviceName) fail.push("deviceName 为空");
  if (!probe.ok) {
    fail.push(`后端够不着（${probe.detail}）——页面的 API 是相对路径，靠 origin 拼；`
      + `打包版 origin 是 file://，没有 Vite 代理这一层。这是 D2 的真实欠账，不是环境没起。`);
  }

  if (fail.length) {
    for (const f of fail) say(`[smoke] ✗ ${f}`);
    return 1;
  }
  say("[smoke] ✓ 外壳骨架通了：桥挂上、平台判定为 desktop、身份两项一致");
  return 0;
}
