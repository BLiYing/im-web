# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
- **无进行中开发**（2026-08-04 收口）：近期批次——分片上传对齐 iOS（≥8MB 暂停/续传/取消 + 空闲超时/
  列表刷新节流/blob 回收三优化）、多选/合并转发/引用卡片对齐 iOS（fn/fs 文件名、[聊天记录] 快照救援、
  菜单规则+单测）、粘贴条支持图片+任意文件攒批、引用跳转到位后再闪、粘贴文件 chip 主题底色——
  **全部已实测通过并提交**（详见归档 2026-08-04 节 + git log）。tsc + 91 vitest 为当前绿基线。

## 下一步
1. **caption（图+文一条消息，随三端下一轮）**：方案见 `../IMServer/docs/ROADMAP.md`「M4-6 caption 追加」；
   Web 侧=媒体气泡图下文字区 + 粘贴条「图+配文」合成一条。
2. 网络恢复秒连：听 `online` 事件跳过退避立即重连（与 iOS NWPathMonitor 同轮）。
3. 群内已读细化（现自己消息恒单 ✓）、@提醒（随主线 M5-6）。
4. 重新引入消息列表虚拟化（react-window / @tanstack/react-virtual，或定位 virtua 双栏挂载问题）。
5. 测试债：Playwright E2E（断连竞态/多端流程仍靠手测）、CLIENT_PARITY 覆盖列。

## 已知坑 / 限制
- **File 句柄不能跨刷新持久化**：刷新后进行中的上传作废，无 iOS 式杀进程自动续传（Web 平台限制）。
- **未读语义（非 bug）**：自己发送的消息（含其它端发的）在自己任何端永不计未读（服务端排除 sender==本人）。
- 消息排序按 `timestamp`（conv_seq 同毫秒次级）；ack 后换服务器时间戳，见 CHAT_UX §1。
- 虚拟化暂回退为普通滚动列表（virtua 双栏条件挂载视口测 0）。
- 本地落库/空洞自愈/连续游标：IndexedDB 按 owner 隔离、消息+游标同事务、ACK 不越级推进（已实测）。
- 免密登录需后端 `-dev-login`；dev 建的号无法再走密码登录。
- 已读=可见即读；壁纸为内联 SVG 近似。

## 关联工程 / 常用命令
- 后端 `/Users/liying/IOSProject/IMServer`；iOS `/Users/liying/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
