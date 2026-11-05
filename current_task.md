# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md`（2026-10-02 瘦身前的全量快照在其顶部）+ `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点
- **分享选择页：好友/群聊入口 + 底部已选栏 + 发送确认**（2026-11-05，未提交，**未浏览器目测**；稿 `../IMServer/docs/design/sketches/SHARE_PICKER_UX_SKETCH.html`）：
  `ForwardPicker` 新增可选 `sources`（不传＝「添加例外」原样，无入口/已选栏）；选择模型纯函数 `shareTargets.ts`（+单测）；
  宿主 `components/modals/ForwardPickerHost.tsx`（App 只剩一次调用；打开时拉 `/groups`）；零件 `SharePickerParts.tsx`；
  建群成员条抽成 `components/MemberChips.tsx` 两处共用；`QRCardModal.shareTo` →「发送给朋友 / 其他应用…」，群码走 `useContactShare.shareGroupInvite`。
  手测：转发一条消息 → 多选 → 我的好友里勾一个没聊过的人 → 发送(N) → 确认面板 → 发送，左侧应出现新会话。
- 近期功能（邮箱登录、两步验证、清除所有对话、删除会话统一口径、导出我的数据、自动删除 v2、会话列表编辑模式、注销账号、置顶面板、聊天文件夹、失效媒体口径等）均已落地并推送，详情见 `current_task.archive.md` 末段。
- 浏览器实测欠账：邮箱登录、删除会话统一口径、隐私「上次上线/头像」、自动删除 v2、导出我的数据冷却页、聊天文件夹（桌面端）。原文见 archive。

## 下一步

1. **资料页断网兜底**：iOS / Android 已做「我」页本人资料本机副本；Web 设置页头部（`SettingsPanelsHost`）仍是 `myInfo?.nickname → @username → common.unnamed_user`，**无本机副本**，断网会退回「未命名用户」。补一份本人资料本机副本（对称兄弟，见 `../IMServer/docs/CLIENT_PARITY.md`「陌生人首条消息的会话壳…」行）。
2. 消息列表虚拟化（暂回退普通滚动列表；`VirtualList` 目前只用于通讯录）；测试债：Playwright E2E。

## 技术债 / 下次
- **`src/App.tsx` 拆分已收口**（6302 → 2958，后长回 ~3760）：剩余是应用外壳本体（核心 state/连接/phase 路由、enterApp、滚动·定位·已读核心、conversationActions 菜单表、send() 编排、子组件接线），**不再硬抽**，新功能按决策树进新文件。再拆必守三条：① Hook 调用须在 `if (phase==='login') return` 之前且注入依赖已定义；② `searchOpen/searchQuery` 留 App；③ 行为保持型（逐字平移，靠 `App.smoke.test.tsx` + tsc + build + 回归兜底），services 的 `useMemo` 放在所有 early return 之前。
- **⛔ prop-drilling 墙（架构决策，留给 code review 定方向，不做机械搬迁）**：会话详情抽屉 / DetailHeader 内联在 App.tsx IIFE（朴素抽要 ~30 props，只是搬接口）、成员 ⋯ 菜单、QR 三模态；聊天消息流 / 滚动·已读·分页互咬 ref / 消息 CRUD / composer 是紧耦合核心，**jsdom 撑不住真滚动布局，滚动定位类回归仍需浏览器手测**。候选：`useBlacklist`/`useLinkPreview`；共享 `<MediaTile>`（行为合并非纯移动，需专门评审）。
- **⏸ 拆 `useChatScroll`**：独立大重构，性价比最差，缓做或不做。

## 已知坑 / 限制
- **分享选择页**：选中集只存 conv_id（好友按 `convIdFor` 本地推导），三源去重靠它，别改成存 uid；群列表接口无禁言/角色/人数 → 群一律不置灰、不显 (N)；
  群列表拉取失败不弹吐司，「我的群聊」/ 主页群搜索就地「加载失败，点击重试」；来源齐后剔除解析不到的幽灵选中（群还在加载/失败时不剔）；
  `useForward.forwardExclude` 统一排除无意义目标（群邀请排除该群、推荐名片排除与本人的单聊），随关窗复位；
  好友子页是 `updated_at` 降序平铺（**Web 通讯录本就无 A–Z 分组**，iOS/Android 有）；单选仍「点行即发」（Web 改造前就没有单选确认框）；
  完成吐司已走 i18n（`forward.toast.*_to_name` / `common.sent_to_chats` / `favorites.forward.success_count`，动词是 `ForwardVerb = "forward" | "send"`）；群邀请文本按**发送者当前语言**拼进消息。
- **清除所有对话**：请求进行中用户已返回隐私页则不弹 toast（本机照清）；HTTP 成功但本机存储清除失败只记日志，靠回声帧 / 下次列表 `cleared_at` 对齐补清；聊天页正开着时消息清空、页面保持打开；批量路径 `onConvCleared` 的 `retained` 恒 false（无消费方）；详情抽屉文件列表 / 置顶横幅沿用 §6.7.1 限制。
- **导出我的数据（已决定不处理）**：① 失败态关闭面板重开会再次显示失败页（「重试」的 dismissed 标记只活在面板生命周期内）；② 最新任务被取消后看不到之前的冷却（发起时服务端 200011 会纠正）。另：下载令牌经 `<a download>` 触发，浏览器端无法感知 401（令牌已用/过期），不做探测（HEAD 会烧令牌）；只有「换取 download_url」失败才 toast `export.download_failed`（`useDataExport.test.tsx` 已覆盖）。
- **自动删除**：聊天内搜索的服务端结果、通知中心不做过滤（过期项可能在服务端搜索命中里出现）；清理以本机时钟，改系统时间会早/晚；会话行预览本地先重算（内存里没载到 from 之前的老消息时暂空），随后被列表节流刷新的服务端值覆盖；PUT 无回包时（极少）等 conv_update 回灌 sec+from。
- **注销（已知限制）**：通话记录/气泡回拨对已注销对端已在宿主端拦截（2026-10-20，见上）；`chat.detail.deleted_user` 文案复用于输入框占位/300003 提示。登录页非红提示走 `useAuthMsg`（`authNotice` 存 i18n 键，与 authErr 互斥，改输入即清；切语言仍非红）。200005 原文（无密码路径）仍走 authErr 红字。
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
