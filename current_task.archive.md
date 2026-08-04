> ⚠️ 历史归档（只读，勿更新）。当前活快照见同目录 current_task.md；本文件只供考古。

---

# Current Task — im-web（Web 客户端）

## 归档于 2026-08-05（引用消息增强收口，转入四大任务协作）

**当时焦点**：
- **无进行中开发（2026-08-05 收口）**：群聊对方气泡头像 → 资料面板（`openPeerDetail`，相册宫格+普通气泡两
  渲染分支，与 iOS 语义统一）已**实测通过、提交并推送 origin/main**；引用增强 M4-2（`replyToFrom` 两行式 /
  `[file] 名` 前缀本地化 / 描边闪烁 / 字号等比 / 两句 toast，含 /code-review 修复）亦已收口。逐功能×端状态见
  `../IMServer/docs/CLIENT_PARITY.md`。tsc + 91 vitest 为绿基线。
- **更早批次**——分片上传对齐 iOS、多选/合并转发/引用卡片、粘贴条攒批等——全部已实测通过并提交。

**当时下一步**：
1. caption（图+文一条消息）
2. 网络恢复秒连
3. 群内已读细化、@提醒
4. 消息列表虚拟化

---

## Status（2026-08-05：引用增强 M4-2 + 群聊头像进资料面板，从活快照迁入）
> 均已实测通过、提交并推送 origin/main。逐功能×端状态见 `../IMServer/docs/CLIENT_PARITY.md`。
- **群聊对方气泡头像 → 资料面板**（`7848196`，用户实测通过）：`Avatar` 加可选 `onClick`（role=button +
  cursor pointer）；两处渲染分支——相册宫格分支(grid) 与普通气泡分支(bubbleBlock，此前漏挂致文本消息点头像
  无反应)——都挂 `openPeerDetail(m.from)`。语义与 iOS 统一：先进资料、不学 telegram 直跳聊天（单聊依赖好友
  关系，非好友直跳会开出发不了消息的死会话；资料页内再决定发消息/加好友）。
- **引用增强 M4-2 web 消费**（`a1425cc`）：SDK 贯通 `replyToFrom` + 乐观回显带值；引用条两行式（群聊显被引用者、
  单聊不显）；`[file] 名` 前缀本地化；`replyPreviewOf` 本端文件名；媒体跳转描边闪烁（直链 (0,6,0) 选择器压过
  旧规则）；系统小字/时间标签等比 ×0.8（`--sys-font`）；胶囊圆角 999px + `.reedit-btn` 联动字号；跳转失败两句
  提示（模型判定 `minSeqOf` + 宫格成员定位主行）。/code-review 修复并入。

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

## 增量（2026-06-15 ②）：Telegram 绿主题追平 iOS
照 iOS 第二版细化，Web 端 UI 追平到同一套 Telegram 绿主题（`npm run build` tsc+vite 通过；preview 浏览器实测浅/深色均 OK）：
- **绿主题 design tokens**（styles.css `:root` + dark）：accent 绿、自己气泡浅绿 `#E3FDD0`(深 `#1F4D2E`)、对方白(深 `#262D31`)、已读勾绿、气泡时间次要色、壁纸渐变/日期胶囊色——与 iOS IMTheme 一一对应。
- **聊天壁纸**：`.msgs` 绿渐变 + 内联 SVG data-uri 涂鸦平铺（圆/星/心，低透明），深色自动切暗绿。
- **气泡**：行内 flex，时间 + ✓/✓✓ 贴右下角；**已读 ✓✓ 绿、已送达灰 ✓**（不再是"已读/已送达 ✓ · seq#N"文字），去掉调试 seq。
- **日期分组**：每自然日首条上方居中日期胶囊（今天/昨天/M月d日/yyyy年M月d日），`isSameDay`/`dayHeader` 工具。
- **长按/右键菜单**：右键消息弹 `.ctx-menu`（复制 / 删除）；复制走 clipboard、删除仅本端（从 msgsByConv + 去重集移除）；点空白/滚动/Esc 关闭。
- **会话列表已读双勾**：我发的最后一条——对端已读到→绿 ✓✓、否则灰 ✓，用后端新增 `peer_read_seq`（protocol.ts `Conversation` 加该字段）。preview 实测对端未读时正确显示灰单勾 ✓。
- **已知限制**：壁纸为内联 SVG 近似（非 Telegram 原涂鸦）；聊天气泡的"已读"仍依赖 live 读回执（peerReadSeq map）。

## 增量（2026-06-15 ③）：联调反馈三处修复
用户两端联调（Web 1001 + iOS 模拟器 1002）1–5 项通过，反馈三个小问题，已修并 preview 复验：
1. **未读胶囊颜色**：iOS 未读角标原用 `accent`（已被改成绿）→ 看着像绿在线点；改为蓝（`IMTheme.unreadBadge=systemBlue`），Web `.badge`/`.jump-badge` 也从红改蓝（`--badge:#3e91ff`），两端统一、对齐 UI.md「未读用蓝色胶囊」、与绿在线点/绿勾区分。
2. **↓N 跳转按钮误显**：进会话有少量未读、整屏放得下时也弹 ↓1。改为定位后实测 `scrollHeight-scrollTop-clientHeight<80` 贴底则不显示（CHAT_UX §7「未贴近底部才出现」）。preview 验证贴底时按钮隐藏。
3. **【重要】自己发的消息重复显示两条**：根因——Web `onAck` 拿到 ack 的 `conv_seq` 后**没登记进去重集 `seenByConv`**（iOS `handleSendResult` 有登记）。于是 server 抄送的 `new_msg` 或切会话重开时的 `sync_resp`（二者均无 `client_msg_id`，只能按 `conv_seq` 去重）再次回显时被当成新消息追加 → 重复。修复：`onAck` 成功时把 `conv_seq` 加入该会话的 `seenByConv`（与 iOS 一致）。preview 复验：连发两条只显一条，来回切 1002↔1003 两次 A1/A2 计数稳定为 1，不再翻倍。
- 三处均 `npm run build` 通过；iOS workspace build 通过。

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


---

## Status（2026-08-04 迁移：连续同步/文件与图标/深色与壁纸/日志治理/详情面板/群聊等批次，从活快照迁入）
> 以下条目原在 current_task.md「当前焦点」，**均已实测通过**（标注"待跨端实测/待验收"的实际已验收，
> 文档未及时更新）。原文迁入，只读勿更新。

- **多端历史连续同步与账号隔离（2026-08-02，自动化/构建通过；待跨端实测）**：新增 IndexedDB
  `sync_cursors`，按 `(owner,conv_id)` 保存独立连续游标，不再从本地最大消息或会话 latest 推断；
  收到消息时消息+游标同事务落库，ACK 不推进，多页响应只从实际连续页尾继续，实时跳号从空洞前
  自愈。修复 `connect()` 返回但 Socket 尚未 OPEN 时过早占用 in-flight 导致 onopen 永不补拉；分页与
  自动同步改按请求 seq 区分。切账号/新重连用连接代次屏蔽旧登录和旧 Socket 回调，并清空旧账号
  游标、in-flight、重连计时与未决发送。重复文件消息会合并权威文件名/大小到 IndexedDB 和当前 UI。
  同时补齐 Web 离线冷启动：有该 uid 会话缓存时，登录接口不可达不会退回登录页，而是进入会话页显示
  “未连接”并后台重连；恢复后自动刷新权威列表并续传。根因与自动化测试分层方案见
  `../IMServer/docs/CONTINUOUS_SYNC_AND_MULTI_CLIENT_TESTING.md`；待用户清库后做跨端、断线、多页和
  切账号实测。Vitest 12 个文件、68/68 用例及生产构建均通过。
- **✅ 文件入口与大小端到端展示（2026-08-01，自动化及用户测试通过）**：“图片或视频”
  入口继续发送媒体；“文件”入口保留浏览器原始 `File` 字节/名称并强制 `content_type=file`。
  `file_name/file_size` 随发送、转发、实时/离线消息进入 IndexedDB；上传以服务端实际字节数为准，
  聊天文件卡片和详情文件 Tab 使用共用工具按 1024 进制显示 KB/MB/GB，不重新下载计算。
  文件入口语义已由用户验收；`npm test -- --run` 63/63、`npm run build` 通过。
- **✅ 跨端文件类型图标（2026-08-01，用户浏览器测试通过；按要求未构建）**：与 iOS 共用同一原创“折角文件卡”生成源，提供 21 类主流文件 + 问号未知类型。聊天文件、引用预览、收藏、合并转发和详情文件 Tab 已统一使用 `FileTypeIcon`；扩展名映射抽为 `fileTypes.ts`，定向 Vitest 2/2 通过。
- **✅ Web 深色主色与会话选中态（2026-08-01，用户浏览器测试通过）**：深色模式普通页面主底色
  由近黑调整为截图对应的 `#242424`，并以 `#1f1f1f` grouped、`#2c2c2c` card、逐级提亮的
  surface/elevated 建立层级；跟随系统深色使用相同令牌。会话选中底色由浅色 14% 提高到
  24% 主色混合、深色提高到 32% 亮绿混合，增强与普通列表及 Hover 的区分。UI 规范已同步；
  `npm test -- --run` 56/56、`npm run build` 通过，用户视觉验收通过。
- **✅ Web 聊天附件毛玻璃菜单（2026-08-01，用户浏览器测试通过）**：底部加号由占据横向空间的
  附件条改为锚定加号上方的气泡式 Popover，鼠标悬停或点击均可打开；菜单使用独立深浅色
  毛玻璃令牌、背景模糊、圆角阴影和气泡尖角；鼠标离开按钮后延时 1 秒关闭，进入菜单会取消
  关闭计时，保证可移动到菜单内选择；保留“图片或视频/文件”两项真实上传能力。
  本轮按用户要求未重新构建。
- **✅ Web UI 配色规范整改 + 聊天壁纸/三卡片布局（2026-07-31，用户浏览器测试通过）**：补齐
  page/grouped/card/elevated、三级文字、danger/online/link、Hover/选中、遮罩/阴影等语义
  令牌；设置、详情、Modal、菜单、聊天辅助组件完成迁移，清除未声明变量 fallback，并统一
  16 px 页面边距和标题层级。通用设置新增截图式“聊天壁纸”子页：四项操作卡片、12 张内置
  渐变/纹理壁纸三列宫格，支持上传本地图片、SV+色相调色器与 15 张纯色卡片、恢复默认、
  背景模糊、即时应用及 localStorage 持久化。壁纸改为应用根节点唯一底层，模糊只作用于
  壁纸；左会话、中间聊天、右资料成为等间距浮动卡片，资料卡与左栏同宽同高，打开后聊天区
  自动收窄。聊天标题补会话头像、双行标题/状态，头像统一增加轮廓线；修复头像菜单点“设置”
  后未立即关闭。新增壁纸 CSS 与 HSV 调色纯函数测试。
  用户已完成浏览器测试并确认通过；按约定 Codex 未编译、未执行自动化测试。
- **✅ 登出状态复位（2026-07-31，用户浏览器测试通过）**：修复从设置页退出后重新登录仍停留在设置面的 bug；`logout()` 现同步关闭设置/编辑资料/通用设置面板并清空设置资料，保证重新登录进入默认会话主页。按用户要求未构建、未跑测试。
- **三端统一品牌图标（2026-07-31，待用户视觉验收）**：接入未来感即时通讯共用图标（双气泡无限连接 + 实时脉冲）；Web 已配置 favicon、Apple Touch Icon，并在登录/静默恢复页展示品牌图。按用户要求未编译。
- **三端日志与文档治理（2026-07-31）**：新增 `docs/LOGGING.md` 记录 Web logger/tracedFetch/WS/STORE/诊断导出规则，并引用 IMServer 的跨端共同契约；新增根目录 `AGENTS.md` 让 Codex 自动读取这些硬规则；后续新增业务/技术 Markdown 统一放入 `docs/`，根目录入口文件除外。
- **✅ Web 统一日志与请求追踪（2026-07-31）**：新增无第三方依赖的结构化日志层，按 `IM.APP/HTTP/WS/STORE/UI` 分 Tag；API 自动注入 `X-Request-ID`，同一 `req` 关联请求/响应并记录状态、耗时、字节数及脱敏正文。password/token/Authorization/cookie/phone/secret 递归隐藏，Data URI/FormData/binary 仅记元数据，正文限 16 KB；生产默认 warn/error 且隐藏业务正文。WebSocket 覆盖连接、断开、重连、ACK 超时/拒绝、序号空洞；IndexedDB/localStorage 失败不再静默；捕获全局 error/unhandledrejection。内存环形缓冲 500 条，可通过 `window.IMDiagnostics` 复制/导出。新增 10 个 Vitest；`npm test` 52/52、`npm run build` 通过；浏览器实测登录失败链路 `req` 与后端 `request_id` 一致且 password 为 `***`。
- **仓库卫生（2026-07-31）**：根目录 `.gitignore` 已忽略 `.codegraph/` Codex 本地索引。
- **会话详情面板对齐 iOS `IMChatDetailViewController`（2026-07-13，tsc + 42 vitest 绿 + app 启动无 console 错误；待接后端实测）**：单聊/群聊共用右侧抽屉（点标题打开，`detail` 状态统一，替代原 `groupPanel` 弹窗）。
  - 头部（头像+名+副标题，群主/管理员相机角标设群头像）→ 操作排 pills（单聊 消息/呼叫/视频、均有搜索/更多；呼叫/视频占位）→ 设置（置顶/免打扰开关复用 `updateConvSettings`；群管理入口）→ 单聊备注名/用户名 → 页签（成员[群]/媒体/文件/链接，从 `loadConversation` 本地历史过滤）。
  - 更多菜单：清空聊天记录（新增 localStore `clearMessages`）/ 拉黑（真接 friendAction，原为占位）/ 退出群组 / 删除群组（群主，新增 SDK `dissolveGroup`）。
  - 群管理二级视图：改名 / 设群头像（uploadFile→updateGroup）/ 简介等占位。点成员→对方资料页（各端统一原则）。
  - **动效**：抽屉滑入（web 化）。iOS 的头像滚动形变（方→圆→水滴→灵动岛）**未移植**——桌面端无灵动岛、非全屏滚动容器，形态不适用（已与用户约定"不能模仿的自己决定"）。
- **M3-4 群聊 Web 端完成（2026-07-10，build + 32 vitest 绿；浏览器手测清单待用户走查）**：
  - SDK：groups API 族（create/list/fetch/update/invite/leave/remove/setRole/transfer）+ WS `group` 帧（onGroup）+ `fromNickname`/`is_group|name|avatar_url|member_count`/`last_message.from_nickname` 类型；群错误码友好中文（300204 不映射、透传服务端原因如"群主需先转让"）。
  - UI：通讯录「群聊」入口（我的群弹窗 + 创建群聊：群名+好友多选）；会话列表群项（群名/预览"昵称: 内容"，无 presence/✓✓）；群会话（标题"群名（N人）"点开群资料、气泡内发送者昵称主色小字、typing 显示谁在输入）；群资料弹窗（成员+角色徽章、改群名、邀请、退群、成员 ⋯ 菜单：设/撤管理员·转让·移出，按 `my_role` 显隐）；`group` 帧实时刷新（被移出→toast+退出会话）。
  - 架构：`groupConvId` 与 `peer` 并列为当前会话两种模式、`convId` 统一派生；`groupInfos` 缓存群资料；消息收发/已读/分页/未读线全复用既有 conv_id 机制零改动。
- M2「状态与可靠性」Web 端全部达成并浏览器实测（已读双勾/红点/presence/typing/未读分割线/进会话定位/双向分页/↓N/双栏）+ Telegram 绿主题追平 iOS。
- **M2.5 通讯录全做完（2026-06-16，浏览器实测）**：左栏「会话/通讯录」Tab；找人(`/users/search`)、新的朋友(同意/拒绝)、好友列表(点击发起会话)、加好友/已申请/发消息按钮态、好友行 拉黑/删除、**编辑我的资料**(modal，`GET/PUT /users/me`)。
- **真账号密码登录 + 注册 ✅（2026-06-16）**：登录页 用户名+密码；`connect(uid,password)` 首次登录失败抛错给 UI、`registerAccount()`；保留「免密登录」开发快捷入口（需后端 `-dev-login`）。
- **里程碑层面 M1+M2+M2.5 Web 端收口**。
- **自测修复（2026-06-17）**：①好友事件实时刷新(onFriend→refreshFriends，无需切 Tab)；②找人改精确匹配占位"对方完整 uid 或手机号"；③**黑名单弹窗**(头部「黑名单」→ listFriends("blocked")+解除)；④SDK 错误码→友好中文(`friendlyMessage`，被拉黑用模糊文案不暴露)。
- **自测修复（2026-06-16）**：①好友事件实时——`IMClient` 收 `friend` 帧 → `onFriend` → `refreshFriends`,通讯录红点/列表无需切 Tab 即更新(浏览器实测:curl 触发申请→badge 实时变 1);②找人改精确匹配(占位"对方完整 uid 或手机号")。


### 迁移时点的「下一步 / 已知坑」原文（供考古比对）

## 下一步
1. 随主线：iOS 群聊 UI（M3-5，镜像本次 Web 交互）后，两端对齐验收 M3。
2. 群聊 Web 待补：群内已读细化（现自己消息恒单 ✓）、@提醒（M3 后期/M4）。（群头像上传已随详情面板群管理落地。）
3. 详情面板待用户接后端实测：单聊/群聊各页签、置顶/免打扰、清空记录、拉黑、解散群、设群头像。若媒体页签视频无 poster 显示破图可再兜底。
3. 重新引入消息列表虚拟化（react-window / @tanstack/react-virtual，或定位 virtua 双栏挂载问题）。

## 已知坑 / 限制
- **未读语义澄清（2026-08-03，非 bug）**：自己发送的消息（含从另一端/设备发的）在自己的其它端
  **永远不计未读**——服务端 `conversation.unreadCount` 排除 `sender==本人`，与微信/Telegram 一致。
  实例：web 登录 1001，看 1001 自己从 iOS 发到群里的图/视频，未读=0 是正确行为，既非 bug 也非
  IndexedDB 缓存问题（`/conversations` 直接返回 `unread:0`，Web 如实渲染）。要测未读须由**他人**
  （如 1002/1003）发送且本端未读该会话。
- **消息排序（2026-06-17）**：改按 `timestamp` 排序（conv_seq 同毫秒次级）——修"失败消息被新消息挤到后面"。乐观发送 ack 后把时间戳换成服务器 `ack.timestamp`，消除客户端时钟偏差影响。规则见 `../IMServer/docs/CHAT_UX.md §1`。
- **虚拟化暂回退**：virtua 在双栏「条件挂载 + 嵌套 flex」下视口测 0、渲染空且不自愈 → 现为普通滚动列表（配反向分页常规不卡，狂滚历史时 DOM 累积）。
- **发送态补"失败"✅（2026-06-17）**：sendText 起 10s 超时计时器，无 ack（断网/发不出去）→ `onAck(false)` 标"发送失败 ✗"且不落库；ack 到则清计时器；disconnect 清所有计时器。浏览器实测：断后端发→10s 后失败；后端恢复发→✓ 不误翻失败。CLIENT_PARITY M0 发送态 Web 🚧→✅。
- **本地落库 ✅（机制于 2026-08-01 加固，待本轮实测）**：`src/sdk/localStore.ts` 按 owner 隔离消息与会话；同步位置现为独立 IndexedDB 游标，不再从本地最大消息推断。消息与连续游标原子提交，失败时游标不会先于消息落盘；刷新/重连从持久化连续位置分页追平全部历史，重复消息按 owner+conv_seq 幂等覆盖。
- **离线空洞自愈 ✅（机制于 2026-08-01 加固，待本轮实测）**：实时跳号（包括初始游标 0 却先见到较大序号）从空洞前补拉；自动 sync 有 request-seq in-flight，逐页连续校验，ACK/历史窗口/会话 latest 均不能跨洞推进。仍缺 Playwright 端到端断连竞态用例。
- **Web 已追平 iOS 本地侧债务**（落库/位点续传/空洞自愈）。
- **测试基建 ① vitest ✅（2026-06-17）**：`npm test`（vitest + fake-indexeddb，node 环境 + `src/test-setup.ts` 注入 indexedDB/localStorage）。16 用例：localStore（消息落库/会话缓存）、friendlyMessage、shouldHealGap（空洞自愈判定，已抽为纯函数可测）。**仍缺 ②Playwright E2E（UI/多端流程仍靠手测）、③CLIENT_PARITY 覆盖列**——这是后续最大测试债。
- 登录已支持真账号密码；「免密登录」按钮仅在后端开 `-dev-login` 时生效（默认关）。dev 免密建的号空密码哈希、无法再密码登录——测密码登录用「注册并登录」建新号。
- 已读=**可见即读**（已实现，与 iOS 一致）：滚动时按元素 rect 取视口内最大 seq，0.3s 节流 `markRead` + `refreshConversations`；↓N 徽标与左侧列表红点都=视口下方未读数，随滚动递减。preview 实测：进会话 ↓N/红点=44 → 半屏=14 → 滚到底=0/按钮隐藏。
- 壁纸为内联 SVG 近似，非 Telegram 原涂鸦。

