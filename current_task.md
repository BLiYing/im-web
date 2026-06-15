# Current Task — im-web（Web 客户端）

## Status（2026-06-15）
**M2「状态与可靠性」Web 端已完成，并在浏览器内实测通过。** 当前是正式 Web 端（React+TS+Vite），与 iOS 功能对齐。
- 布局：**Telegram 桌面式双栏**（左会话列表常驻 + 右聊天同屏，当前会话高亮）；**窄屏(<760px)自适应单栏**（列表↔聊天带"‹ 会话"返回）。
- 聊天交互照 `../IMServer/docs/CHAT_UX.md` 蓝图实现。
- SDK（`src/sdk/imSdk.ts`）：登录换 token、WS 连接、send→ack、new_msg、心跳、退避重连、回执（delivered/read）、presence、typing、**双向分页**（openConversation 锚点窗口 / loadOlder 上滚 / loadNewer 下滚，复用后端 LoadSince，pagedPending 抑制自动翻页）。

## 关联工程
- 后端：/Users/liying/IOSProject/IMServer（协议 `docs/PROTOCOL.md`、聊天交互蓝图 `docs/CHAT_UX.md`、端能力 `docs/CLIENT_PARITY.md`、阶段 `docs/ROADMAP.md`）
- iOS：/Users/liying/IOSProject/IMProgram

## Progress
- [x] 协议 SDK 雏形：JWT 登录、WS 连接、send→ack、new_msg、心跳、退避重连、sync 增量、按 conv_seq 去重、送达回执（M0/M1）
- [x] 登录页 + 聊天页（发送态/气泡/连接状态）
- [x] 会话列表 + 未读红点（实时刷新）
- [x] M2：已读回执 + 双勾显示（已读/已送达）
- [x] M2：presence 在线/离线点
- [x] M2：typing "对方正在输入"
- [x] M2：未读分割线（read_seq 精确定位）+ 进会话停首条未读（Telegram 式，非最新）
- [x] M2：右下角 ↓N 跳转按钮（跳最新 + 未读计数）
- [x] 性能：双向分页（进会话只拉最近一页/锚点窗口，上滚更早、下滚更新，位置不跳）
- [x] UI：Telegram 桌面式双栏布局 + 窄屏自适应单栏
- [x] 文档：聊天交互蓝图 CHAT_UX.md（多端单一事实来源，本端按它实现）
- [ ] **性能：消息列表虚拟化（暂回退，见下）**
- [ ] 真账号注册/密码登录（当前开发期免密，填 uid 直签）
- [ ] M2.5 通讯录/加好友/找人；M3 群聊…（按 ROADMAP 与 iOS 同步）

## Decisions & Constraints
- SDK/UI 分层：协议能力在 `sdk/`，组件只调它。
- 聊天交互（定位/分页/分割线/红点/已读/跳转）一律以 CHAT_UX.md 为准。
- 排序去重：消息按 `conv_seq` 升序渲染（发送中 convSeq=0 排末尾），去重以 conv_seq（发送态用 client_msg_id）为键。
- 已读简化：**打开会话即全部已读**（上报 latest），列表红点即时清零；分割线用进入前的 read_seq 快照定位。完整"可见即读"是后续 TODO。
- design tokens 与 iOS IMTheme 对齐（styles.css 顶部 CSS 变量）。
- **虚拟化暂回退**：virtua 在双栏的「条件挂载 + 嵌套 flex 容器」下把滚动视口测成 0、渲染为空且不自愈（已排查：与 height:100vh/绝对定位/StrictMode/VList↔Virtualizer/强制重挂均无关，疑似其 ResizeObserver 在该挂载时序下失效）。现为普通滚动列表，配反向分页常规使用不卡；一路上滚加载大量历史时 DOM 会累积。后续换 react-window / @tanstack/react-virtual 或定位 virtua 问题。

## Next Actions
1. 本端 M2 已收口；等 iOS M2 UI 完成后，整个 M2 里程碑收尾。
2. 性能 TODO：重新引入消息列表虚拟化（react-window/@tanstack/react-virtual）。
3. 跟随 ROADMAP 推进 M2.5（通讯录/加好友/找人）等，与 iOS 同步。
4. 压测：用 `IMServer/cmd/loadtest` 灌数据观察（`go run ./cmd/loadtest -from 1002 -to 1001 -n 10000`）。
