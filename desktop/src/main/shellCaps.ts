// D4-2 的三件宿主能力：未读角标 / 系统通知 / 开机自启。
//
// 这三件都**只能由外壳做**，也是 D1 立接口时就留好、至今在 web 侧恒返回 false 的那两个
// （`notify` / `setBadge`）第一次真正有实现。判断逻辑不在这里——「该不该弹」「角标算几」
// 是页面侧的纯函数（`src/desktopNotify.ts`），这里只负责「让它发生」。
import { app, BrowserWindow, Notification } from "electron";

/** 主进程 → 渲染进程的事件通道。preload 那侧同名订阅（见 preload/index.ts）。 */
export const IPC_OPEN_CONVERSATION = "im:open-conversation";

/** 本进程内一共真的弹了几条通知。**只给自检用**——`--e2e` 靠它断言「批量投递不产生通知」，
 *  那是没有别的观测手段的：通知弹没弹，从页面里看不见。 */
let notifyCount = 0;
export function getNotifyCount(): number { return notifyCount; }

/**
 * 未读角标。
 *
 * **返回值是「角标真的设上了吗」，不是「调用没抛」**：Windows 没有 Dock 角标，
 * `app.setBadgeCount` 在那儿返回 false —— 如实透传，别谎报成功
 * （这条契约就是 /code-review 上一轮盯的那个点）。托盘 tooltip 无论如何都更新一次，
 * 它在 Windows 上是唯一能显数字的地方，但那不叫角标，所以不影响返回值。
 */
export function setBadge(count: number, tooltip: (text: string) => void): boolean {
  const n = Math.max(0, Math.floor(count));
  tooltip(n > 0 ? `IM Desktop — ${n} 条未读` : "IM Desktop");
  try {
    return app.setBadgeCount(n);
  } catch {
    return false;
  }
}

/**
 * 弹一条系统通知；点它就把窗口叫到前台并让页面打开对应会话。
 *
 * ⚠️ **返回 true 只代表「我们把它交给系统了」**。用户在系统设置里关掉本应用的通知权限、
 * 或开着勿扰时，`show()` 不报错也不显示，Electron 没有 API 能查到——这条残留的不确定性
 * 无法消除，故在此写明：调用方不该把 true 当成「用户一定看见了」。
 */
export function notify(
  win: BrowserWindow | null,
  title: string,
  body: string,
  convId: string | undefined,
): boolean {
  if (!Notification.isSupported()) return false;
  try {
    const n = new Notification({ title, body });
    n.on("click", () => {
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      // 页面自己决定怎么打开（群/单聊入口不同），主进程只把 convId 递过去。
      if (convId) win.webContents.send(IPC_OPEN_CONVERSATION, convId);
    });
    n.show();
    notifyCount += 1;
    return true;
  } catch {
    return false;
  }
}

/** 开机自启：读回真实状态而不是回显入参——用户可能在系统设置里手动关掉了。 */
export function getAutoStart(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

/** 设开机自启，**返回设完之后读回来的实际值**。设失败（如 Linux 某些桌面环境不支持）时
 *  读回来仍是旧值，调用方据此就能知道没设上，不必猜。 */
export function setAutoStart(on: boolean): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: on });
  } catch {
    return getAutoStart();
  }
  return getAutoStart();
}
