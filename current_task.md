# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
**参与四大任务（2026-08-05）**——协作 IMServer/iOS：
1. **任务一** ✅ **P0 + 恢复路径完成**：非好友聊天拦截（微信式）
   - 资料面板非好友显「加好友」隐藏「消息/呼叫/视频」+ 隐藏设置/备注名/页签三卡（`showDetailBody`）；
     群成员右键菜单好友→「发送消息」、非好友→「添加好友」
   - 拒收系统行带「发送好友申请」恢复入口（`noteCode` 瞬态，刷新后链接消失、点重试重生成）
   - `requestFriend()` 读服务端 `outcome`：已直接成为好友时**不吐司**（避免误以为要等对方通过）
   - 聊天页顶栏头像进资料 → 隐藏「消息」（`fromOwnChat`，对齐 iOS `showsMessagePill`）
   - **修被拒媒体消息退化成 URL 文本**：`saveRejected`/`loadMessages` 只存还 6 个字段且 SDK 把
     `contentType` 写死 `"text"` → 刷新后图片/视频变字符串、相册因丢 `groupId` 散架成独立消息。
     三处补齐完整字段集（与 ACK 落库一致），配回归测试。
   - tsc + 92 vitest 绿；用户浏览器实测通过
   - 未做 P1（全局开关切 Telegram 式）
2. **任务二**：多选消息支持合并转发的聊天记录设计（待讨论）
3. **任务三**：媒体与文件下载设置设计（待 Telegram 截图 + 讨论）
4. **任务四**：文件与媒体消息下载 UI/UX（待 Telegram 截图 + 讨论）

详见 `../IMServer/current_task.md` 完整需求。

## 下一步
1. **接 IMServer 四大任务方案确认**（等 Telegram 截图）→ 实施代码
2. **caption（图+文一条消息）**：方案见 `../IMServer/docs/ROADMAP.md`「M4-6 caption 追加」；
   Web 侧=媒体气泡图下文字区 + 粘贴条「图+配文」合成一条。
3. 网络恢复秒连：听 `online` 事件跳过退避立即重连。
4. 群内已读细化、@提醒（随主线 M5-6）。
5. 消息列表虚拟化；测试债：Playwright E2E。

## 已知坑 / 限制
- **File 句柄不能跨刷新持久化**：刷新后进行中的上传作废，无 iOS 式杀进程自动续传（Web 平台限制）。
- **未读语义（非 bug）**：自己发送的消息在自己任何端永不计未读（服务端排除 sender==本人）。
- 消息排序按 `timestamp`；ack 后换服务器时间戳。
- 虚拟化暂回退为普通滚动列表。
- 本地落库/空洞自愈/连续游标：IndexedDB 按 owner 隔离、同事务。
- 免密登录需后端 `-dev-login`；dev 建的号无法再走密码登录。

## 关联工程 / 常用命令
- 后端 `/Users/liying/IOSProject/IMServer`；iOS `/Users/liying/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
