# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md`（2026-10-02 瘦身前的全量快照在其顶部）+ `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
**通话被踢后现场重启（2026-10-09，未 commit）**：`rtcCall.ts` 的 `registerRtcRestart` / `shouldRestartRtc`，RtcHost 注册重启方（`restartTick` 重建引擎），呼叫在 actions 就绪后补发（15s 有效）；`rtc.test.ts` 有单测。Chrome 实测正常呼叫无回归。设计见 `IMServer/docs/design/CALL_ACCESS_CONTROL_DESIGN.md`。

- **10-08 接 im-rtc 2.2.0 Kit tokenProvider（已切 npm 正式版 2.2.0）**：`createRtcEngine` 只建不登，`<CallProvider tokenProvider={rtcTokenProvider(getAuthToken)}>` 由 Kit 登录；删掉 4401 续票 / AbortController；被踢只对 takenOver/configRejected 丢引擎；`useCallHistory` 先 `ensureRtcReady()`。修了 `sdk-source.sh` 相对路径。vitest 2023 绿、`npm run build` 过。Chrome 实测：换票失败退避重试、拨号两种失败提示、online 后 22 ms 重登；npm 2.2.0 下 Kit 自动登录。
**三端已读/菜单/管理员一批修复（2026-10-06，已 commit + push）**：群语音已读双勾（iOS 曾无条件排除群聊）、九宫格已读勾（三端同规则，见 `IMServer/docs/design/READ_TICK_DESIGN.md` §4；Android 相册行曾不上报已读）、iOS 单字气泡 meta 被压成「…」、Android 长按菜单恒在气泡下方（气泡上移让位）、添加管理员总数 ≤ 5（上限 = 5 − 已有，客户端规则，服务端无总数上限）、会话列表搜索提示词含设置、Android 置顶/未读样式对齐 iOS、通讯录入口建群后进群、「跟随系统」改读 `LocaleManager.systemLocales`（OPPO 实测英文→跟随系统变回中文）。用户真机自测通过。管理员总数上限已补服务端（`MaxGroupAdmins=5`、`300213`，**后端需重启**：`cd ../IMServer && ./scripts/dev.sh --no-tail`）；Android 重建 Activity 后停在原 tab / 「我」二级页（`rememberSaveable`）。

2026-10-02 **本机清空位点 `clearedUpTo`**（IMServer `docs/design/OFFLINE_BACKLOG_DESIGN.md` §6.7，Android 先行、Web 本次对齐）代码完成，**待用户审查后提交**：
清空聊天记录改为同事务「删消息 + 清区间 + 抬位点 + 推游标、墓碑不动」，位点以内的消息一律不落库/不上屏/不问服务端；有效可见下界 = 服务端下界 ∪ 位点（`sdk/clearFloor.ts`，各存各的、用时取大）。
web(IndexedDB v6，位点存游标行、升级事务回填)与桌面(SQLite `sync_cursors.cleared_up_to`，加列+回填、不清缓存)两套都过契约；真浏览器验过「清空→切走切回/刷新不拉回」。
未做：`docs/ROADMAP.md`/`CLIENT_PARITY.md`/`SYMMETRY.md` 状态（IMServer 仓，用户来改）。最近另有：桌面系统通知对齐（2026-10-01）。

## 下一步

1. **资料页断网兜底**：iOS / Android 已做「我」页本人资料本机副本；Web 设置页头部（`SettingsPanelsHost`）仍是 `myInfo?.nickname → @username → common.unnamed_user`，**无本机副本**，断网会退回「未命名用户」。补一份本人资料本机副本（对称兄弟，见 `../IMServer/docs/CLIENT_PARITY.md`「陌生人首条消息的会话壳…」行）。
2. 消息列表虚拟化（暂回退普通滚动列表；`VirtualList` 目前只用于通讯录）；测试债：Playwright E2E。

## 技术债 / 下次
- **`src/App.tsx` 拆分已收口**（6302 → 2958，后长回 ~3760）：剩余是应用外壳本体（核心 state/连接/phase 路由、enterApp、滚动·定位·已读核心、conversationActions 菜单表、send() 编排、子组件接线），**不再硬抽**，新功能按决策树进新文件。再拆必守三条：① Hook 调用须在 `if (phase==='login') return` 之前且注入依赖已定义；② `searchOpen/searchQuery` 留 App；③ 行为保持型（逐字平移，靠 `App.smoke.test.tsx` + tsc + build + 回归兜底），services 的 `useMemo` 放在所有 early return 之前。
- **⛔ prop-drilling 墙（架构决策，留给 code review 定方向，不做机械搬迁）**：会话详情抽屉 / DetailHeader 内联在 App.tsx IIFE（朴素抽要 ~30 props，只是搬接口）、成员 ⋯ 菜单、QR 三模态；聊天消息流 / 滚动·已读·分页互咬 ref / 消息 CRUD / composer 是紧耦合核心，**jsdom 撑不住真滚动布局，滚动定位类回归仍需浏览器手测**。候选：`useBlacklist`/`useLinkPreview`；共享 `<MediaTile>`（行为合并非纯移动，需专门评审）。
- **⏸ 拆 `useChatScroll`**：独立大重构，性价比最差，缓做或不做。

## 已知坑 / 限制
- **清空位点**：新增 `sdk/clearFloor.ts`（纯逻辑）；`localStore.clearMessages(owner,conv,knownLatest)` + `loadClearedUpTo`；桌面主进程有平行实现（`sqliteStore.ts`/`sqliteRows.ts`），改语义两边一起改。位点存在 IndexedDB **游标行**里（`advanceCursorInStore` 必须 `...prev` 保留它）。回填误伤面：history_visible 下界/不落库事件行会被当位点，无害。
- **既有问题（未动）**：`SYNC_RESP` 里 `before` 在页内消息逐条 `updateSynced` 之后才读，页首贴着游标的连续 sync 页 `next > before` 恒假，**整页不落库、区间不登记**（只在内存）；靠开窗/重拉自愈所以没被发现。要修需先读 `before` 再处理页。
- `imSdk.ts` 卡在 1359 行基线：新增逻辑靠把回执合批拆到 `sdk/receiptBatch.ts` + 压缩注释腾出。
- **侧栏面板里开弹窗必须 portal 到 `.app`**（`NotificationsPanel.tsx#overSidebar`）：`.sidebar` 层叠上下文排在 `.main` 之下，`position:fixed` + 高 z-index 也盖不住聊天区。
- **提示音「正看着这个会话」不响是设计**（窗口在焦点且选中该会话，`alertDecision` 的 `viewingConv`）；自测要发到另一个会话或把窗口切走。例外列表空态仍借用 `notif.exceptions.empty_private`（文案写「私聊 / 左滑」，Web 实际是合并列表 + 右键），要改需在 IMServer 源表加新 key 并四端重新生成。
- **相册上限 9 是渲染契约**：`albumRowPattern(n>9)` 只有 9 格、`AlbumGrid` 按行 `slice`，第 10 件起根本不渲染，所以发送侧必须截断（`albumBatch.ts#ALBUM_MAX`，三端同值）。⚠️ 收端不设防：别的客户端硬塞 >9 个同 `group_id`，本端仍只显示前 9 个。
- **隐藏 `<input type="file">` 的 `multiple` 刻意不写在 JSX 里**，由 `useMediaSend#pickFile` 按入口赋值；JSX 里没有它不是 bug，要改多选行为改 `pickFile`。
- **扫自己名片码「查看我的资料」是死路（既有 QR P0 缺陷，未修）**：`onViewProfile(自己uid)` → `openPeerDetail(peer)` 因 `peer === uid` 直接 return，弹窗被关掉却没打开任何资料页。修法：self 场景改为打开设置页顶部个人资料（`setShowSettings(true)` / `openProfile()`），约 5 行。
- **一图多码消歧仅 Chrome/Edge 生效**（靠原生 BarcodeDetector；Safari/Firefox 退回 jsqr 多码定位失败，单码仍可用；要跨浏览器需换 zxing-wasm，见 `QRCODE_DESIGN.md §6`）。
- **File 句柄不能跨刷新持久化**：刷新后进行中的上传作废，无 iOS 式杀进程自动续传（平台限制）。
- 自己发送的消息在自己任何端永不计未读（服务端排除 sender==本人，非 bug）；消息排序按 `timestamp`，ack 后换服务器时间戳；本地落库按 owner 隔离（IndexedDB，同事务）。
- 免密登录需后端 `-dev-login`；dev 建的号无法再走密码登录。
- **登录寿命口径**：access token 24h；`refresh_token` 180 天绝对寿命、**续期不刷新**，唯一轮换点是改密码（`changePassword` 必须接住响应里那枚新的，否则下次冷启动被弹回登录页）。**WS 连着 ≠ token 有效**，服务端只在握手校验。
- **凭据存 localStorage**（XSS 可读；比存密码是净改善：可吊销、不能改密码、不能登其它端）；更强的做法是 httpOnly cookie，需后端配套，未做。

## 关联工程 / 常用命令
- 后端 `/Users/dev/IOSProject/im-client/IMServer`；iOS `/Users/dev/IOSProject/im-client/IMProgram`；Android `/Users/dev/IOSProject/im-client/im-android`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
