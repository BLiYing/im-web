# Web 长连接重连机制

> **跨端共同口径以 `../../IMServer/docs/RECONNECT.md` 为准**（三态、退避参数表、唤醒判据、
> 鉴权失败与网络失败的分野、不变量清单、手测口径）。本文只写 im-web 的落点与 **浏览器特有**的坑。

## 1. 落点

| 关注点 | 位置 |
|---|---|
| 连接与重连主体 | `src/sdk/imSdk.ts` 的 `IMClient`——`openSocket` / `ws.onclose` / `scheduleReconnect` / `clearReconnectTimer` |
| 退避常量 | 同文件顶部 `RECONNECT_BASE_MS=1000` / `RECONNECT_MAX_MS=30000`；心跳 `PING_INTERVAL_MS=25000` |
| 唤醒判据（纯函数） | `src/sdk/wake.ts` 的 `wakeActionFor(state, manualClose)` → `"none"`/`"reconnect"`/`"probe"` |
| 唤醒执行 | `wake.ts` 的 `runWake(state, manualClose, port)`——`port` 由 `IMClient` 注入两个动作（probe / reconnect），本模块不碰它的私有状态 |
| 唤醒入口 | `IMClient.reconnectNow(reason)`（薄接线口） |
| 浏览器监听 | `wake.ts` 的 `installWakeListeners(onWake)`：挂 `window` 的 `online` 与 `document` 的 `visibilitychange`，**返回拆除函数** |
| 装/拆时机 | `connect()` / `connectWithToken()` 里装（`this.wakeStop ??= …`），`disconnect()` 里拆 |
| 单测 | `src/sdk/imSdk.test.ts` 的 `wakeActionFor` 组（4 例，钉三条"不该做"） |

**为什么判据与监听在 `wake.ts` 而不在 `IMClient` 里**：① 判据是纯函数，放类外才测得动；
② 监听是 DOM 细节，塞进类里还要自己管拆除，换号时最容易漏；③ `imSdk.ts` 有行数硬预算
（`scripts/check-file-size.sh`，本次已从 1450 提到 1465，`sdk/resend.ts` 也是为此放在类外）。

## 2. 浏览器特有的坑

- **监听必须随连接对象一起拆**。App 换账号时会**新建一个 `IMClient` 并 `disconnect()` 旧的**；
  旧对象若还挂着 `online`/`visibilitychange`，网络一恢复它也会醒来重连，把已经作废的会话拉回来。
  2026-08-22 出现过同源事故的另一种形态：被顶替的旧 client 自排重连、拿已吊销 token 探活拿到
  `100101`，触发共享的 `onAuthError → logout`，把**健康的新会话**一起踢回登录页。
- **`visibilitychange` 而不是 `focus`**：后台标签页里浏览器会节流定时器（`setTimeout` 最慢到分钟级），
  退避那一觉可能睡过头；而且后台期间 socket 常被浏览器或中间设备静默断掉、`onclose` 迟迟不来。
  所以标签页一回到前台就唤醒一次；此时若状态仍是 `connected`，走 **probe**（发 ping）而不是重连。
- **`online` 事件只说明"网卡有网"**，不代表能连通服务端（连着一个没有出口的 Wi-Fi 时照样会触发）。
  这没关系——唤醒只是把重试**提前**，连不上仍会回到退避表，从第 1 档重新爬。
- **鉴权码走 `isAuthCode(code)`**：命中即 `manualClose = true` + `onAuthError`，**不进重试**；
  其余错误才 `scheduleReconnect()`。
- **连接代次 `connectionGeneration`**：`openSocket` 每次 `++`，`ws.onopen/onmessage/onclose`
  与登录回调都先比对代次，旧连接的回调一律丢弃。`reconnectNow` 的 reconnect 分支会先
  `clearReconnectTimer()` 再连，避免在途定时器到点又连一条。
- **刷新页面不属于重连范畴**：刷新等于整个 `IMClient` 重建，走的是正常 `connect()`。

## 3. 连上之后（`ws.onopen` 里做的事）

1. `reconnectAttempts = 0`（失败次数归零）；
2. `startPing()`；
3. `sendSyncReq([...tracked])`——按各会话游标补回离线期间的消息；
4. `fetchHidden()`——补收敛离线期间在其它设备产生的「仅为我删除」；
5. **重发 `watched` 订阅集**（连接级易失态，见 PROTOCOL §5.5）。
   > 这一步 Web 在 SDK 里做，iOS 在聊天页 `didChangeState:` 里做——层次不同，别按错层找。

## 4. 排查

日志走 `logger` + `LOG_TAG.ws`。关键事件名：

| 现象 | 事件名 |
|---|---|
| 排到第几档、等多久 | `reconnect_scheduled`（带 `attempt` / `delay_ms`） |
| 唤醒信号有没有到、做了什么 | `wake`（带 `reason`=`browser_online`\|`tab_visible`、`action`） |
| 连上了 | `connected`（带 `tracked_conversations`） |
| 订阅有没有补回来 | `watch_resent` |
| 是不是被踢了 | `disconnect_requested` / `onAuthError` 链路上的 `login_failed 100101` |

手测口径（断够 40 秒再恢复，否则看不出差别）与反例（退出登录后不得自动连回）见跨端主文档 §7。
