# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
**媒体持久化 C1 + 持久失效标记（2026-08-07，tsc + 144 vitest 绿 + vite build 绿；待浏览器手测）**
> 对齐 iOS「原件落 sandbox 磁盘、`fileExistsAtPath` 命中即就绪」。解决两个刷新丢失：**已下载文件刷新又要下载**（含资料卡文件列表）＋ **expired 刷新变透明/条纹坏占位、重刷 404 风暴**。
- **`src/mediaCache.ts`（新）+ 6 单测**：Cache Storage 薄封装（按 uid 命名空间 `im-media-<uid>`，跨账号隔离）
  `cachePutBlob/cacheMatchBlob/cacheClear` + 持久字符串集合 `loadStrSet/saveStrSet`（末 500 封顶）+ 键 `expiredKey/downloadedFilesKey`。
  **无 `caches` 全局（Node/隐私模式）静默降级为易失内存 blob，绝不抛**。
- **C1 已下载文件持久化**：`startDownload` 成功 → `cachePutBlob` + 记 `im.dlfiles.<uid>` 键集合；登录 rehydrate（cacheMatchBlob→objectURL→dlBlobs）→ 刷新/离线仍在、秒开。图片/视频不走此路（沿用 `mediaOptedIn` + 远端 URL + 浏览器 HTTP 缓存）。
- **持久失效标记**（草图 §06 404 止损）：`expiredSet`（`im.expired.<uid>`）。命中来源两条——`startDownload` 拿 404/410；被动 `<img>/<video>` `onError` → **ranged GET 复验**（`Range: bytes=0-0`，区分「404 已清理」与「解码/瞬时」，只前者标失效）。`mediaGate` 命中即返回 `expired`、**不回源**（掐 404 风暴），三类消息统一。
- **失效占位**：气泡/查看器中心 ⊘（`.play-badge.expired`）+ 类型化文案（`downloadText(s,size,kind)`：图片/视频/文件已失效）。
- **清理边界**：`clearMediaCache` → `cacheClear` + 清 opt-in/dlfiles；**失效标记不清**（服务端已删是客观事实，清了只会再撞 404）。换账号清内存态、各 uid 各自持久化。
- **已知未尽**：相册/详情宫格的原件 `<img>` 未各自接 `onError`（靠气泡/查看器先标失效后自愈）；iOS 三条被动路径仍 ⬜（见 CLIENT_PARITY 媒体失效行）。

**修复用户手测 3 个新问题（2026-08-07，tsc + 138 vitest 绿）**
- **① 详情文件「定位到聊天」个别文件失败**（浏览器实证修复 ✅）：根因**两处**——(a) `jumpToSeq` 用 `scrollTo({behavior:"smooth"})`，本 `.msgs` 容器上方大量异步布局媒体使平滑滚动**远距离目标滚不动**（实测 scrollTo smooth 纹丝不动、`scrollTop=` 瞬时赋值可靠）；(b) 从底部跳到较早目标后，下方媒体 onLoad 触发 `onMediaLoad` 因 `wasNearBottom` 仍 true 把 scrollTop 拽回底部，定位当场被冲掉。近处文件滚动距离小所以"正常"，seq 121 需大滚动就失败。修：`jumpToSeq` 改**瞬时滚动 + rAF 校正 + 置 `wasNearBottom=false`**。另加 `locateInChat`（详情读全量本地、聊天页是分页窗口——目标不在窗口内时**自动上翻分页直到加载到再定位**；跨会话先打开会话），三处「定位」入口（详情文件菜单/查看器/引用条）统一走它。
- **② 媒体库点格后九宫格不消失**：`gallery-item` onClick 补 `setGalleryOpen(false)`（点格=关九宫格 + 开查看器）。
- **③ 查看器「更多」hover 即消失**：`viewer-more-wrap` 由 `onMouseEnter/Leave` 改**点击切换**（`setViewerMore(v=>!v)`）；点查看器图片/视频/蒙层收起弹窗。

**修复：资料卡片「媒体/文件」列表全空（2026-08-07，tsc + 138 vitest 绿，浏览器实证修复逻辑 ✅）**
> 根因（**日志锁定**：`im-web.log` 有 238 条 `conversation_load_failed` / `NotFoundError: object store not found` @`localStore.ts`）：
> `loadConversation` 开 `[messages, deletions]` 双 store 事务，但用户浏览器那条 IndexedDB 连接是**缺 `deletions` store 的陈旧连接**
> ——DB 升级到 v3 新增 `deletions` 前打开、被 `dbPromise` 模块级缓存复用（多标签页测号 / HMR 常见）→ 事务抛 `NotFoundError` → catch 返回 `[]` → 详情媒体/文件全空。
> 修复两层（`src/sdk/localStore.ts`）：① `openDB` 加 `onblocked` + `db.onversionchange`（别的标签页升级时关闭本陈旧连接并清缓存）+ 拿到缺 store 的连接则关掉重开自愈（最多 2 次）；② `loadConversation` 按 `db.objectStoreNames.contains('deletions')` 决定事务 store 列表，缺则**只读 messages**（暂不过滤墓碑也不抛错）。`markMessageDeleted`/`loadDeletedSeqs` 本就 try/catch 安全降级。
> 浏览器实证：缺 deletions 的连接上「旧写法抛 NotFoundError / 新写法正常返回」。**用户侧刷新一次页面即自愈**（openDB 升级补齐 deletions store）。

**下载门控 阶段 7 — 对齐 iOS 手测场景（2026-08-07，tsc + 138 vitest 绿；已浏览器冒烟：气泡视频/图片门控磨砂占位 ✅、数据与存储页 ✅、无 JS 报错）**
> 依据 `../IMProgram/docs/DOWNLOAD_TEST_SCENARIOS.md`（现为 iOS 基准 + §11 Web 场景/差异）逐条对齐；把原先"直连原件"的 4 处补进门控：
- **相册宫格逐格门控（档 A）**：`AlbumGrid` 加 `gateFor`——未下载格 thumb 磨砂 + 中心 ↓ + 尺寸角标，点门控格=就地解门控（`onGateTap`）非进查看器。
- **详情媒体宫格门控（档 A）**：`detail-media-tile` 加 `mediaGate`——磨砂 + ↓ + 尺寸；点门控格=解门控，就绪格=查看器（详情不自动预取，对齐 iOS `autoPrefetch=NO`）。
- **引用缩略被动预览（档 B）**：`QuoteThumb` 加 `gated`——未下载**只用 thumb 磨砂、绝不联网拉原件/poster/远端抽帧**，无 thumb 退 ▶/🖼 图标；两处调用点（气泡引用块 + 输入框引用条）都传 gated。
- **会话媒体库被动预览（档 B）**：`gallery-item` 用 `passivePreviewSource`——未下载磨砂、打开媒体库这一动作不拉原件；点某格才 setViewer 联网。
- **打开查看器 = 标记已解门控**：新增 `useEffect([viewer])`——看过的图/视频 opt-in（落 localStorage），之后气泡/相册/详情/媒体库/引用条随之显真帧、刷新仍在（对齐 iOS「点某格才拉原件」）。
- **纯函数 + 单测**：`src/download.ts passivePreviewSource(resolved,hasThumb)`（3 例，`download.test.ts`）——档 B 三态取图契约（original/thumb/icon）。CSS：`.gate-blur`/`.gate-empty`/`.album-dl`/`.detail-media-dl`/`.detail-media-size`/`.quote-thumb.gate-blur`/`.quote-thumb-ph`。
- **文档**：`../IMProgram/docs/DOWNLOAD_TEST_SCENARIOS.md` 加 §11「Web 手测场景 + 独有差异」（§11.A–§11.K，含 §11.J 差异表）。**待用户逐条手测**（尤其 §11.E/§11.F 后端日志无 `/uploads` GET）。

**下载门控 + 数据与存储（任务三/四 阶段 5）✅ 完成（2026-08-06，tsc + 138 vitest 绿，待浏览器实测）**
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
**下载门控 阶段 6 — 对齐 iOS 详情 + 图片/视频改 URL 直取（2026-08-07，未编译按用户要求自测）**
- **圆形图标 + 环形进度**（对齐 iOS `_disc`/`_ring`，共用 `FileGateIcon`）：文件条方形→圆形，进度改图标外围 SVG 圆环、去掉底部线性条；`.msg-file` 固定最小高度 → 下载切换**零高度抖动**。
- **点击预览路由** `openReadyFile`：就绪文件可预览类型（pdf/图片/音视频/文本）**新标签预览**、其余**另存**；右键菜单加「下载」项直接落盘（`saveMessageToDisk`）。
- **详情「文件」页签并入门控**（div + `mediaGate`，共享 `dlBlobs`）+ 右键菜单 **转发/定位到聊天/取消下载（仅下载中）/删除（占位，后端接口待建）**。
- **图片/视频改 URL 直取（方案 B）**：解门控后不下 blob，直接 `<img/video src=远端>`，**浏览器 HTTP 缓存兜底持久（刷新仍在）**；门控判定保留（大图/视频先显模糊、点了才拉，省流量）。`mediaOptedIn: Set<content>` 记已解门控；blob/进度状态机**仅文件**再用。代价：图片/视频无进度环。
- **文档**：Web↔移动端差异一览 + 方案 C（Cache Storage 持久缓存）待办 → `../IMServer/docs/DOWNLOAD_DATA_STORAGE_PLAN.md` §5.1/§阶段6/待办。
- **已知限制**：无断点续传（✕=重来）；**文件** blob 缓存刷新即失效（图片/视频已靠浏览器 HTTP 缓存持久）。

**自测三 bug 修复（2026-08-07，tsc + 135 vitest 绿，删除已浏览器实测）**
- **① 门控图刷新退化 + opt-in 丢失**：`localStore` 未持久化 `thumb`（`MsgRecord` 补字段 + 存/读）；图片/视频「已解门控」记录存 `localStorage`（按 uid，`loadOptedIn`/`saveOptedIn`），登录恢复 → 刷新后已看过的媒体仍直显、未看的仍显磨砂而非斜纹底。
- **② 已缓存媒体恒 0**：方案 B 后图片/视频不进 `dlBlobs` → 计数改 `dlBlobs 文件数 + mediaOptedIn.size`。
- **③ 删了又冒出来 / 删不掉**：无服务端删消息接口，纯本地删。原实现只抹内存视图、还 `seenByConv.delete` → 实时/补拉同步当新消息重加回。改为**双层墓碑**：IndexedDB `deletions` 表（`markMessageDeleted`，`loadConversation` 读盘过滤，DB v2→v3）+ **内存墓碑 `deletedByConv`**（登录经 `client.loadDeletedSeqs` 载入，`onMessage` 收到服务端重推直接丢弃）。二者缺一都会复现：只 IndexedDB→实时重推绕过读盘；只内存→刷新丢失。**浏览器实测：删除后刷新不复现 ✅**。

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
