# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md`（2026-10-02 瘦身前的全量快照在其顶部）+ `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
- **注销账号（2026-10-16，已提交 main，未 push；未浏览器实测）**：设计 `IMServer/docs/design/DELETE_ACCOUNT_DESIGN.md` + 草图，契约 PROTOCOL §6.16（已对账）。入口：`EditProfilePanel` 只读态底部红字按钮 + 脚注 → `settings/DeleteAccountPanel.tsx`（`DeleteAccountContainer` 自持状态；Host 自持 `deleteAccountOpen`）。逻辑 `useDeleteAccount.ts`（提交/二次确认 Dialogs/群主阻断 `owned_groups:[{conv_id,name}]`；`useRestoreOffer`：登录遇 `200005` 弹恢复→`restore`→再 `enterApp`）；SDK `sdk/accountApi.ts`（`tokenSession` 登录分支带 `deleteAt`，200005 计死凭据免重连）、`sdk/wipeOwner.ts`（成功后清该 owner 的 IndexedDB + 会话缓存）；WS error 帧 `reason=account_deleted` → `onAccountDeleted` → logout + 清缓存。`deleted=true`/`peer_deleted` 在 `chatNaming.ts` 显示「已注销用户」。`ConfirmDlg` 新增可选 `title`。
- **二维码展示三端对齐（2026-10-16，已三端自测 + 全量测试，未提交）**：名片码/群二维码/群邀请链接卡片头部（头像·名字·成员数/@句柄）竖排居中（iOS `IMQRCardView`、Web `QRCardModal`+扫码结果分支）；iOS 扫一扫「我的二维码」改为嵌入 `IMQRCardViewController`（同 Android 共用整页）；群邀请链接页改为链接框 + 分享/复制 + 「查看二维码」，不画码（三端）；群码有效期提示三端统一为「X月X日 前有效，重置后旧码立即失效」（无到期时间退回 7 天口径）；链接页不放重置（重置只在二维码页）；新增 i18n 键 `qr.card.share_link/view_code/group_link_hint_expiry` 已入 `strings.json` 并重新生成。
- **置顶消息面板 v3（2026-10-15，未提交，浏览器实测过：开面板 / 长按取消 / 实时摘除 / 一键取消所有）**：设计 `IMServer/docs/design/PINNED_PANEL_DESIGN.md` + 草图。横幅恒显最新置顶（`pinned.ts#latestPinned`）、不轮转、整条点击开面板、≡ 恒显、kicker「· N 条」；状态簇在 `usePinnedMessages.ts`（取消置顶帧本地摘除 + 300ms 合并重拉、空集自动收起）；面板 `components/modals/PinnedListModal.tsx`（`ModalHead` + 真气泡 `components/MessageBubble.tsx readOnly` + `icons/LocateInChatIcon.tsx`，长按 `.ctx-menu` 渲染在遮罩内）；SDK `sdk/pinnedApi.ts`（`message` 完整对象解析、`clearPinned`、批量取消帧 `targets` 经 `batchRemove.ts#applyBatchUnpinFrame` 逐条应用）。i18n 已改 IMServer 源表并只生成 Web/desktop 两份。
- **聊天文件夹（2026-10-14，已提交 f4cfb4d / f041c67；右键菜单贴 Tab 下方 5a22f39；桌面端未单独验证）**：`chatFolders.ts`/`useChatFolders.ts`/`sdk/foldersApi.ts`、`components/ChatFolderTabs.tsx`（固定头：搜索 + Tab 条 + 右键编辑/删除）、`ChatFolderMenuItems.tsx`（右键菜单文件夹项第一位）、`settings/ChatFoldersPanel.tsx`；App.tsx 恰卡在 3520 行红线，新逻辑都在新文件。设计见 IMServer `docs/design/CHAT_FOLDERS_DESIGN.md`。
- **失效媒体口径对齐（2026-10-14，已提交并推送 3326074 / 633b0b7）**：服务端清理即标记失效，**不看浏览器缓存**（取代 2026-08-07 铁律 A）；自己发的也显示失效。探测抽成纯模块 `src/expiryProber.ts`（每址每会话一次 / 查看器 `force` / 断网·5xx·401·429 撤记号 / 并发 ≤4；相对路径 `/uploads/…` 与 http(s) 可探，blob:/data: 不探——此前守卫要求 http(s)，探测实际从未发出，已修）。聊天页只探被门控挡着的图 + 所有视频，`MediaTile` 只探门控格与视频，**命中缓存的图留到进查看器那一次**（`MediaViewer` → `probeExpiry(m, true)`）。查看器补左上角关闭钮；媒体库里打开的无收藏/复制，失效页再去转发/下载；长按菜单对失效图/视频隐藏复制图片/转发/收藏/下载。**未浏览器实测**（自动化浏览器放不了视频）。**2026-10-14 三端对齐（未提交）**：查看器「更多」= 下载·定位·收藏·复制（仅图）·转发·删除（媒体库里打开的也一样，不再隐藏收藏/复制）；右下角 更多·媒体库·下载（下载恒在最右）；浮钮改浅色玻璃底 + 细描边（`--viewer-ctl-*`，原黑色半透明在 90% 黑蒙层上看不出）；详情/媒体库长按「定位到聊天」第一位。
- **2026-10-13 会话列表待审（未提交）**：群主/管理员有待审时，该行只显蓝色药丸「入群申请 N」（可带 @我），不再接最后一条消息预览；清零恢复。文案 `conv.list.pending_badge` 改为「入群申请 {count}」，三端同口径（原生为红字 `[入群申请 N]`）。
- **好友建立系统消息 `friend_accepted`（2026-10-13，未提交，已验证）**：单聊 system/sender 空消息。`sysEventRender.ts#GROUP_SYS_EVENTS` 加表项（聊天页 `renderSysLine` 与 `convPreview` 共用，未知事件回退 content）；`App.tsx` ↓N 只数 `countsAsUnread`（系统行仍触发贴底，行数 3520 持平）；桌面 SQLite 补 `sys_event`/`sys_args` 列（`sqliteRows.ts`/`sqliteStore.ts`，加列自动迁移）。通知/提示音由 `alertDecision.isSystem` 拒绝；会话不存在时 new_msg→`scheduleConversationRefresh` 拉服务端列表建壳并置顶（名片/头像随列表字段）。未浏览器实测。
- **桌面通知相册合并（2026-10-13，已验证）**：`src/notifyAlbum.ts` 按 (会话, groupId) 记进度，后到成员正文「[N 张图片]」、不再响；桥新增 `albumKey`（preload→index.ts→`shellCaps.notify`），主进程先收掉同 albumKey 的旧通知再弹（`notifyRegistry` 的 `albumKey` scope）。群文字通知本来就是标题群名 + `发送人: 内容`，无改动。
**2026-10-09 「新的朋友」加「已添加」段（未提交）**：设计 `IMServer/docs/design/NEW_FRIENDS_DESIGN.md`；纯函数 `src/friendRequests.ts#recentAdded`（30 天/50 条，updated_at 为毫秒），`FriendRequestsModal` 新增 `added`/`onOpenProfile`（点行关弹窗→`openPeerDetail`）；i18n 键 `friend.requests.added(_tag)` 已手加到 `src/i18n/locales` 与 `desktop/src/shared/locales`，**源表 `IMServer/docs/i18n/strings.json` 需同步加键，否则下次生成会覆盖**。角标口径核对无需改（只数 pending，accept/reject 后 `refreshFriends`）。未做浏览器实测。

**2026-10-09 全部已提交（工作区干净）**：发送被拒提示与 iOS/Android 同口径（6c9dd07 / 27a3716）；通话被踢后现场重启（448b240，`rtcCall.ts` `registerRtcRestart` / `shouldRestartRtc`，RtcHost 注册重启方，呼叫在 actions 就绪后补发 15s 有效）。

- **10-08 接 im-rtc 2.2.0 Kit tokenProvider（npm 正式版 2.2.0）**：`createRtcEngine` 只建不登，`<CallProvider tokenProvider={rtcTokenProvider(getAuthToken)}>` 由 Kit 登录；被踢只对 takenOver/configRejected 丢引擎；`useCallHistory` 先 `ensureRtcReady()`。
- **清空位点 `clearedUpTo`**（10-02，IndexedDB v6 + 桌面 SQLite，设计 `IMServer/docs/design/OFFLINE_BACKLOG_DESIGN.md` §6.7）已落地；`ROADMAP.md`/`CLIENT_PARITY.md`/`SYMMETRY.md` 状态在 IMServer 仓。

## 下一步

1. **资料页断网兜底**：iOS / Android 已做「我」页本人资料本机副本；Web 设置页头部（`SettingsPanelsHost`）仍是 `myInfo?.nickname → @username → common.unnamed_user`，**无本机副本**，断网会退回「未命名用户」。补一份本人资料本机副本（对称兄弟，见 `../IMServer/docs/CLIENT_PARITY.md`「陌生人首条消息的会话壳…」行）。
2. 消息列表虚拟化（暂回退普通滚动列表；`VirtualList` 目前只用于通讯录）；测试债：Playwright E2E。

## 技术债 / 下次
- **`src/App.tsx` 拆分已收口**（6302 → 2958，后长回 ~3760）：剩余是应用外壳本体（核心 state/连接/phase 路由、enterApp、滚动·定位·已读核心、conversationActions 菜单表、send() 编排、子组件接线），**不再硬抽**，新功能按决策树进新文件。再拆必守三条：① Hook 调用须在 `if (phase==='login') return` 之前且注入依赖已定义；② `searchOpen/searchQuery` 留 App；③ 行为保持型（逐字平移，靠 `App.smoke.test.tsx` + tsc + build + 回归兜底），services 的 `useMemo` 放在所有 early return 之前。
- **⛔ prop-drilling 墙（架构决策，留给 code review 定方向，不做机械搬迁）**：会话详情抽屉 / DetailHeader 内联在 App.tsx IIFE（朴素抽要 ~30 props，只是搬接口）、成员 ⋯ 菜单、QR 三模态；聊天消息流 / 滚动·已读·分页互咬 ref / 消息 CRUD / composer 是紧耦合核心，**jsdom 撑不住真滚动布局，滚动定位类回归仍需浏览器手测**。候选：`useBlacklist`/`useLinkPreview`；共享 `<MediaTile>`（行为合并非纯移动，需专门评审）。
- **⏸ 拆 `useChatScroll`**：独立大重构，性价比最差，缓做或不做。

## 已知坑 / 限制
- **注销后清缓存仅 Web（IndexedDB）**：桌面端 SQLite 桥无按 owner 清库原语，未清；「已注销用户」暂未禁用发消息/加好友/邀请入口（协议建议禁用）；阻断态群名不可点跳转。
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
- **置顶重拉多一次本地存储读**（2026-10-16）：`usePinnedMessages.refresh` 每次 `await client.loadClearedUpTo(cid)` 取清空位点（内存 `clearedUpToOf` 取大值兜底）。有意取舍——位点可能尚未载入内存；代价是批量删除 / 取消置顶突发时每次多一次异步读，且它抛错会让该次刷新作废。要省就把位点载入前移到进会话时。

## 关联工程 / 常用命令
- 后端 `/Users/dev/IOSProject/im-client/IMServer`；iOS `/Users/dev/IOSProject/im-client/IMProgram`；Android `/Users/dev/IOSProject/im-client/im-android`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
