# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
- M2「状态与可靠性」Web 端全部达成并浏览器实测（已读双勾/红点/presence/typing/未读分割线/进会话定位/双向分页/↓N/双栏）+ Telegram 绿主题追平 iOS。
- **M2.5 通讯录全做完（2026-06-16，浏览器实测）**：左栏「会话/通讯录」Tab；找人(`/users/search`)、新的朋友(同意/拒绝)、好友列表(点击发起会话)、加好友/已申请/发消息按钮态、好友行 拉黑/删除、**编辑我的资料**(modal，`GET/PUT /users/me`)。
- **真账号密码登录 + 注册 ✅（2026-06-16）**：登录页 用户名+密码；`connect(uid,password)` 首次登录失败抛错给 UI、`registerAccount()`；保留「免密登录」开发快捷入口（需后端 `-dev-login`）。
- **里程碑层面 M1+M2+M2.5 Web 端收口**。
- **自测修复（2026-06-17）**：①好友事件实时刷新(onFriend→refreshFriends，无需切 Tab)；②找人改精确匹配占位"对方完整 uid 或手机号"；③**黑名单弹窗**(头部「黑名单」→ listFriends("blocked")+解除)；④SDK 错误码→友好中文(`friendlyMessage`，被拉黑用模糊文案不暴露)。
- **自测修复（2026-06-16）**：①好友事件实时——`IMClient` 收 `friend` 帧 → `onFriend` → `refreshFriends`,通讯录红点/列表无需切 Tab 即更新(浏览器实测:curl 触发申请→badge 实时变 1);②找人改精确匹配(占位"对方完整 uid 或手机号")。

## 下一步
1. 重新引入消息列表虚拟化（react-window / @tanstack/react-virtual，或定位 virtua 双栏挂载问题）。
2. 补本地持久化 / 离线增量同步（当前纯内存态，落后 iOS）。
3. 下一里程碑随 iOS：M3 群聊，或多端在线 UI 验证。

## 已知坑 / 限制
- **虚拟化暂回退**：virtua 在双栏「条件挂载 + 嵌套 flex」下视口测 0、渲染空且不自愈 → 现为普通滚动列表（配反向分页常规不卡，狂滚历史时 DOM 累积）。
- **发送态补"失败"✅（2026-06-17）**：sendText 起 10s 超时计时器，无 ack（断网/发不出去）→ `onAck(false)` 标"发送失败 ✗"且不落库；ack 到则清计时器；disconnect 清所有计时器。浏览器实测：断后端发→10s 后失败；后端恢复发→✓ 不误翻失败。CLIENT_PARITY M0 发送态 Web 🚧→✅。
- **本地落库 ✅（2026-06-17）**：`src/sdk/localStore.ts`（按 owner 隔离）——①消息落 IndexedDB（收到/同步 + 自己 ack 后）；②会话列表缓存 localStorage（刷新/弱网先秒显）；③**同步位点持久化**：登录/重连从本地最大 conv_seq 续传（`trackConversation`+`syncTracked`），离线期间的新消息登录即增量补回并落库、不重拉历史。`preloadLocal` 预载 + 按 conv_seq 去重。浏览器实测：离线收 2 条 → 重登 → 自动补回、IndexedDB 共 4 条、无重复。
- **离线空洞自愈 ✅（2026-06-17）**：`processIncoming` 检测 conv_seq 跳号（> 已同步位点+1 且会话在 tracked）→ 用旧位点 `sendSyncReq` 补拉缺口，与 iOS 同逻辑。无回归（顺序消息不误触发）。**注**：该可靠性边界靠断连竞态触发、难手动复现，目前为"对齐 iOS 已验证逻辑 + 无回归"，待 Web 测试基建(Playwright/vitest)后补可重跑用例。
- **Web 已追平 iOS 本地侧债务**（落库/位点续传/空洞自愈）。
- **测试基建 ① vitest ✅（2026-06-17）**：`npm test`（vitest + fake-indexeddb，node 环境 + `src/test-setup.ts` 注入 indexedDB/localStorage）。16 用例：localStore（消息落库/会话缓存）、friendlyMessage、shouldHealGap（空洞自愈判定，已抽为纯函数可测）。**仍缺 ②Playwright E2E（UI/多端流程仍靠手测）、③CLIENT_PARITY 覆盖列**——这是后续最大测试债。
- 登录已支持真账号密码；「免密登录」按钮仅在后端开 `-dev-login` 时生效（默认关）。dev 免密建的号空密码哈希、无法再密码登录——测密码登录用「注册并登录」建新号。
- 已读=**可见即读**（已实现，与 iOS 一致）：滚动时按元素 rect 取视口内最大 seq，0.3s 节流 `markRead` + `refreshConversations`；↓N 徽标与左侧列表红点都=视口下方未读数，随滚动递减。preview 实测：进会话 ↓N/红点=44 → 半屏=14 → 滚到底=0/按钮隐藏。
- 壁纸为内联 SVG 近似，非 Telegram 原涂鸦。

## 关联工程 / 常用命令
- 后端 `/Users/liying/IOSProject/IMServer`；iOS `/Users/liying/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
