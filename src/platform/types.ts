// 平台适配层的能力契约（D1）。方案见 IMServer 的 docs/design/DESKTOP_DESIGN.md §7.1/§7.3。
//
// 存在的理由：桌面端与浏览器版**共用同一份 src/**，只有少数几件事必须按宿主分流。
// 把这几件事收进一个接口，`src/` 其余部分就完全不需要知道自己跑在哪。
//
// 三条硬规矩（§7.3，`docs/SYMMETRY.md` 已登记，提交时会念）：
//   ① 桥只有一座：桌面能力一律经 preload 的 `window.imDesktop` → `platform/desktop.ts`，
//      组件层**不得**直接摸 `window.imDesktop`——一旦绕过，浏览器版会在那一处崩。
//   ② 平台判定只有一处：`platform/index.ts`。全仓不许出现第二个「我是不是桌面端」。
//   ③ web 与 desktop 是**双实现**：接口加一个方法就要两侧都补，`contract.test.ts` 对两套跑同一组断言。
//      要对称的是「同一能力在两端语义一致」，不是「两份代码长得一样」。
//
// **同步 / 异步不是风格问题，是行为**：下面每个同步方法都有非它不可的理由，改签名前先读那条注释。

import type { LocalStore } from "../sdk/localStore.types";

/** `voiceRecordingSupported()` 的探测结果。语义与红线由 `src/voiceRecorder.ts` 拥有，这里只透传。 */
export interface VoiceRecordingSupport {
  supported: boolean;
  mime: string;
  ext: string;
}

/** 另存一份到用户的磁盘。`url` 可以是应用内 blob URL，也可以是远端同源 URL。 */
export interface SaveFileRequest {
  url: string;
  /** 建议文件名（含扩展名）。桌面端会拿它作保存对话框的默认值。 */
  name: string;
}

/** 一条系统通知。`convId` 供宿主实现「点通知定位到会话」，web 侧目前不消费。 */
export interface NotifyRequest {
  title: string;
  body: string;
  convId?: string;
}

/**
 * 宿主能力面。**只登记真的会按宿主分流的能力**——接口膨胀等于把「一份源码」偷偷拆成两份。
 *
 * 不在本接口里（刻意）：
 * - ~~本地消息库~~ **已于 D4-3b 加入**（见下 `localStore()`）。接口本身仍然只有一个方法，
 *   那 15 个存储方法在 `sdk/localStore.types.ts` 的 `LocalStore` 里，本层只负责"取哪一套"。
 * - **窗口 / 托盘 / 开机自启 / 单实例锁**：没有共享调用方，只有外壳自己用，留在 `desktop/src/main/`。
 *   唯一会被共享代码驱动的是托盘未读角标，那就是 `setBadge`。
 */
export interface Platform {
  readonly name: "web" | "desktop";
  readonly isDesktop: boolean;

  /**
   * 本机稳定设备 ID（对齐 iOS 的 device_id）。后端按 `(uid, device_id)` 顶替去重。
   *
   * **必须同步**：`IMClient` 在拼登录/握手参数时同步取用。桌面端因此要在 **preload 期**
   * 就把值注入 `window.imDesktop`（一个字符串字段，不是异步 IPC 方法）。
   */
  deviceId(): string;

  /** 设备名，登录时上报供设备管理页展示（如 `Chrome · macOS` / `IM Desktop · macOS 15`）。同样必须同步，理由同上。 */
  deviceName(): string;

  /** 另存到磁盘。web=`<a download>`；桌面=原生保存对话框。调用方本就在 async 函数里，故可异步。 */
  saveFile(req: SaveFileRequest): Promise<void>;

  /**
   * 用宿主的方式打开外部链接。web=新标签页；桌面=交给系统浏览器。
   *
   * **必须同步**：`window.open` 一旦脱离用户手势的调用栈就会被弹窗拦截器吃掉
   * （`useMediaDownload` 的原注释：「不 await（保用户手势，避免弹窗拦截）」）。
   * 桌面实现要 fire-and-forget，不许把它改成返回 Promise。
   */
  openExternal(url: string): void;

  /**
   * 发一条系统通知。**返回是否真的发出去了**，调用方据此决定要不要走应用内兜底。
   *
   * **为什么这两个是异步、而 `deviceId`/`openExternal` 是同步**：那两个有非同步不可的理由
   * （登录帧同步拼装 / 保住用户手势的调用栈），`notify` 与 `setBadge` 没有——没有任何调用点
   * 需要在同一个 tick 内拿到结果。而做成同步就得用 `ipcRenderer.sendSync`，它会**阻塞渲染进程**
   * 等主进程回复；一旦主进程那侧正 `await webContents.executeJavaScript(...)` 等渲染进程
   * （所有自检模式都这么干），两边互等 → **死锁**。2026-09-08 实测到：D4-2 接上之后
   * `--e2e` 卡在「会话列表」永不出现，而浏览器版一切正常。
   *
   * ⚠️ web 侧恒返回 `false`，这**不是退化**——im-web 至今没有任何通知功能
   * （全仓 `new Notification` 为 0 处）。D1 只立接口，实现归 D4；这里返回 false 是如实上报，
   * 不是「暂时坏了」。
   */
  notify(req: NotifyRequest): Promise<boolean>;

  /** 设置未读角标（Dock / 任务栏 / 托盘）。返回是否真的设上了；web 恒 false，理由同 `notify`。 */
  setBadge(count: number): Promise<boolean>;

  /**
   * 订阅「该醒过来看一眼连接」的信号，返回**拆除函数**。
   *
   * web = `online` + `visibilitychange`（实现仍在 `src/sdk/wake.ts`，本层只做分流）。
   * 桌面还会多出窗口重新聚焦、系统睡眠唤醒等信号。
   *
   * 拆除函数必须被调用方在 `disconnect()` 里执行：App 换号会新建 IMClient 并断开旧的，
   * 不拆的话旧实例会跟着一起醒来重连，把已作废的会话拉回来（见 `sdk/wake.ts` 的原注释，
   * 这个坑 2026-08-22 真出过）。
   */
  subscribeWake(onWake: (reason: string) => void): () => void;

  /**
   * 宿主支不支持「开机自启」这个概念。浏览器恒 false——不是「没做」，是**没有这个概念**，
   * 设置页据此决定要不要显示那一项（显示一个永远点不动的开关比不显示更糟）。
   */
  autoStartSupported(): boolean;

  /**
   * 当前是否开机自启。**读系统的真实状态，不是回显上次设的值**——用户可能在系统设置里手动改过。
   *
   * **异步**：它会在页面挂载时就被调用（不只是打开设置页时），那一刻主进程可能正在等渲染进程，
   * 同步跨进程调用在那里是自找死锁；且首屏路径上不该插一次同步往返。
   */
  getAutoStart(): Promise<boolean>;

  /** 设开机自启，返回**设完之后读回来的实际值**。设失败时读回来仍是旧值，调用方据此就知道没设上。 */
  setAutoStart(on: boolean): Promise<boolean>;

  /**
   * 订阅「用户点了系统通知，要打开这个会话」。返回拆除函数。
   *
   * 浏览器侧永远不会回调（web 的 `notify` 恒 false，压根没有通知可点），但接口仍存在——
   * 页面不该写 `if (isDesktop)`，分流在本层。
   *
   * 拆除函数必须调：不拆的话换号后旧回调仍挂在 IPC 上，点通知会把已作废的会话打开
   * （与 `subscribeWake` 那个坑同源，见 sdk/wake.ts 的原注释）。
   */
  subscribeOpenConversation(cb: (convId: string) => void): () => void;

  /**
   * 订阅「外部点了一条本应用的深链」（`imdesktop://q/u|g/<token>`）。回调拿到的是能直接交给
   * `useQR#handleScanRaw` 的扫码原文（`q/g/<token>`）。返回拆除函数。
   *
   * **只有邀请码两种**：登录码在宿主那侧就被丢了（深链任何网页都能触发，放行 q/l 就是
   * QRLjacking 入口，见 desktop/src/main/deepLink.ts）。
   * 浏览器没有深链这个入口——它的等价物是落地页 `?qr=` 回放（`useQR` 的 bootQr），所以 web 侧永不回调。
   *
   * **只在登录后订阅、换号重订**：宿主会把登录前到的链接攒着，订阅那一刻一并交出；
   * 不跟着账号重订的话，旧订阅会拿已作废的会话去 resolve（与 subscribeOpenConversation 同一个坑）。
   */
  subscribeDeepLink(cb: (raw: string) => void): () => void;

  /**
   * 取本地消息库的宿主实现；**没有就返回 `null`**，由 `sdk/localStore.ts` 回落 IndexedDB。
   *
   * 为什么这一项在平台层而不是让 sdk 自己去摸桥：`window.imDesktop` 的唯一调用方必须是
   * `platform/desktop.ts`（§7.3 ②），而"我是不是桌面端"的判断必须只有一处（§7.3 ③）。
   * 本方法就是这两条规矩与本地库的交点——sdk 那边只问"有没有"，不问"我在哪"。
   *
   * ⚠️ **返回的是整套还是 null，没有中间态**：桥少任何一个存储方法都返回 null。
   * 逐方法回退在别的能力上是对的（通知没实现就退回浏览器通知），在本地库上是灾难——
   * 14 个方法写 SQLite、1 个读 IndexedDB，等于同一份数据分裂在两个库里。
   */
  localStore(): LocalStore | null;

  /**
   * 本机能不能录出 **iOS 可播** 的语音。
   *
   * 红线（绝不产出 Opus，否则 iOS `AVAudioPlayer` 除零崩溃）与三级探测逻辑由
   * `src/voiceRecorder.ts` 拥有，本层**只转发不复制**——把探测抄一份进来，
   * 就是给一条已经害过一次 App 崩溃的红线造第二个真相源。
   */
  voiceRecording(): VoiceRecordingSupport;
}
