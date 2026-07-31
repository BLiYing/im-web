# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
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
- **消息排序（2026-06-17）**：改按 `timestamp` 排序（conv_seq 同毫秒次级）——修"失败消息被新消息挤到后面"。乐观发送 ack 后把时间戳换成服务器 `ack.timestamp`，消除客户端时钟偏差影响。规则见 `../IMServer/docs/CHAT_UX.md §1`。
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
