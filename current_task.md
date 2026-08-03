# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
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

## 关联工程 / 常用命令
- 后端 `/Users/liying/IOSProject/IMServer`；iOS `/Users/liying/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
