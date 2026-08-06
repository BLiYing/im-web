# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
**下载门控 + 数据与存储（任务三/四 阶段 5）✅ 完成（2026-08-06，tsc + 135 vitest 绿，待浏览器实测）**
- **`src/download.ts`**（纯逻辑，21 例单测）：策略类型/默认/解析容错、`shouldAutoDownload` 决策矩阵、
  低/中/高快捷档往返、下载状态机的字形与文案。逐条对齐后端 `internal/downloadsettings` 与 iOS `IMDownloadPolicy`。
- **SDK**：`downloadSettings / saveDownloadSettings / resetDownloadSettings`（PUT 体**就是 settings 本身**，后端直接 Decode，别包一层）
  + `capabilities_update` 帧 → `onCapabilitiesUpdate` → 重拉（多端同步）；`ChatMessage.thumb` 入站解析补齐。
- **卡片门控**：媒体气泡未下载显 thumb 模糊占位（`blur(9px)`）或中性斜纹底 + 中心 ↓ + `尺寸 · 时长` 角标；
  文件条图标位即状态位（↓ / ✕ / ↻）+ 进度条；就绪后 `<a download>` 指向应用内 blob，不再走网络。
  下载走 `fetch` + `ReadableStream` 真进度；**✕ 用 AbortController 真中止**（否则被"取消"的请求稍后仍会完成、状态跳回就绪）。
- **设置 ▸ 数据与存储**（原「敬请期待」）：存储用量 + 清除缓存 / 自动下载总开关 / 低·中·高档位（不匹配预设显"自定义"）/
  图片 单聊·群聊 / 视频·文件 上限滑块（0=手动，右端 1.5 GB）+ 各自单群开关 / 重置。
- **Web 诚实差异**：只读写 **Wi-Fi 档**（浏览器分不清移动/Wi-Fi），移动数据档在 Web 不生效但会随账号同步回移动端；始终提供手动下载。
- **日志（2026-08-06 补）**：统一 `logger.*(LOG_TAG.media,…)`（媒体全链路一个桶，§3）——
  `download_settings_applied version=` / `download_settings_unavailable fallback=defaults` / `capabilities_update_received` /
  `download_start` / `download_http_error status= expired=` / `download_completed bytes= duration_ms=` /
  `download_cancelled_by_user` / `media_cache_cleared`。**不在 `mediaGate` 里打**（每次 render 都会走）。
  （初版误用了 `LOG_TAG.http`，已按规范改回 `media`。）
- **已知限制**：无断点续传（✕=重来）；blob 缓存活在本页生命周期内，**刷新即失效**（与上传 File 句柄同类限制）；
  会话详情抽屉的媒体/文件 Tab **仍是直连 `<a>`，未门控**（待补）。

**Typing 提示位置对齐（2026-08-05，待用户手测）**：已移除输入栏上方的提示条；收到 typing 后聊天标题栏副标题显示「正在输入」，3 秒无新帧即恢复单聊在线态或群聊成员数。按本次要求未编译、未跑测试。

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
