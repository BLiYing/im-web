# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
- M2「状态与可靠性」Web 端全部达成并浏览器实测：已读双勾/未读红点/presence/typing、未读分割线(read_seq 精确)、进会话停首条未读、双向分页(上滚更早/下滚更新)、↓N 跳转、Telegram 桌面式双栏(窄屏单栏)。
- Telegram 绿主题已追平 iOS：浅绿/白气泡 + 绿已读双勾、聊天壁纸(SVG 涂鸦)、按日期分组、右键消息菜单(复制/删除)、会话列表"我发的"已读双勾(`peer_read_seq`)、未读角标蓝。
- **下一步里程碑：M2.5，与 iOS 同步**。

## 下一步
1. 重新引入消息列表虚拟化（react-window / @tanstack/react-virtual，或定位 virtua 双栏挂载问题）。
2. M2.5 通讯录/加好友/找人，与 iOS 同步交付。
3. 压测：`cd ../IMServer && go run ./cmd/loadtest -from 1002 -to 1001 -n 10000` 灌数据观察。

## 已知坑 / 限制
- **虚拟化暂回退**：virtua 在双栏「条件挂载 + 嵌套 flex」下视口测 0、渲染空且不自愈 → 现为普通滚动列表（配反向分页常规不卡，狂滚历史时 DOM 累积）。
- **落后 iOS**：无离线消息+重连增量同步、无本地落库（纯内存态，刷新即丢未拉历史）。
- 真账号/密码登录未做（开发期免密填 uid 直签）。
- 已读=**可见即读**（已实现，与 iOS 一致）：滚动时按元素 rect 取视口内最大 seq，0.3s 节流 `markRead` + `refreshConversations`；↓N 徽标与左侧列表红点都=视口下方未读数，随滚动递减。preview 实测：进会话 ↓N/红点=44 → 半屏=14 → 滚到底=0/按钮隐藏。
- 壁纸为内联 SVG 近似，非 Telegram 原涂鸦。

## 关联工程 / 常用命令
- 后端 `/Users/liying/IOSProject/IMServer`；iOS `/Users/liying/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
