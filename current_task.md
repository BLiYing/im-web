# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **刷新常需重登「被自己上一次登录踢」根因修复 ✅（2026-08-22，`App.tsx`，tsc+build+504 vitest 绿 + 浏览器实测）** — 08-18 device_id 去重修复（`3d70253`/`87c0d27`/web `37e3c7f`）激活的客户端重连竞态：`enterApp` 建新 `IMClient` 前未断开旧 client → 本次登录同 device_id 被后端 upsert 顶替、踢掉旧连接（WS 1005）→ 旧 client 自排重连、拿已撤销 token 探活 `/devices` 得 100101 → 触发共享 `onAuthError→logout`，把健康新会话也踢回登录页。日志证据：`login_failed 100101` 全集中在 08-21/22。修：①`enterApp` 开头 `clientRef.current?.disconnect()`（manualClose+清重连定时器+bump generation，令旧 client 在途/待发重连全静默作废）；②`onAuthError` 加 `if (client !== clientRef.current) return` 兜底（被顶替的旧 client 鉴权失效不得代表新会话踢 app）。实测：单标签连刷 3 次 0 次 login_failed/1005/100101（修前必现）。**已知边界（非本次修）**：多标签同账号——后一个标签登录会顶替前一个（稳定 device_id 单会话语义），被顶替标签仍回登录页；要多标签共存需跨标签会话协调（BroadcastChannel）或每标签独立 device_id，属更大设计，留待定夺。

> **详情开合动画 + 详情定位 + UI 一致性（2026-08-22，`styles.css`+`App.tsx`，tsc+build+504 vitest 绿 + 浏览器实测）**：
> 1. **聊天区居中 + 开合对称平移动画**（`styles.css` `.main` `@media (min-width:1121px)`）：无 `.detail-mask` 时 `.main` `max-width: calc(100%-2*sidebar-2*gap)` + **`transform: translateX((sidebar+gap)/2)`** 居中；有详情 `translateX(0)` 贴边。**用 transform 而非 margin**——两态宽度恒定、只视觉平移不回流，消除了 margin 方案「开详情时边距+满宽挤不下→聊天先压窄再展开」的抖动（用户反馈开详情效果不好）。**开=向左滑贴边 / 关=向右滑回居中，对称顺滑**；detail-mask（z5 不透明）盖住滑动重叠区。仅宽屏三栏态生效。实测 transform 在 180.8↔0 平滑切换。（`.main` 内无 fixed 后代、菜单在 `<main>` 外渲染 → transform 安全。）
> 2. **详情卡内媒体/文件右键「定位到聊天」保持详情不消失**（`App.tsx` fileMenu locate 去掉 `setDetail(null)`）：详情卡是右侧列、不遮聊天，定位在左侧可见聊天区滚动高亮，不丢详情浏览上下文；仍关闭会遮挡的媒体库蒙层/全屏查看器。实测 `detailStillOpen:true`。
> 3. **URL/卡片气泡时间左下→右下**（`styles.css` `:has()` 扩展 `.link-card`/`.record-card`/`.longtext-card` 的 bmeta `margin-left:auto`）。**已留边界**：折叠「long」档文本（非卡片）时间沿用文本流，未强制右对齐。
> 4. **跳到底部按钮点击不生效（500人大群必现）根因修复**（`App.tsx jumpToBottom`）：`newest < latestSeqRef.current` 走 `openConversation(cid, latest, latest)` 分支——SDK 的 `since = latest - historyPage`；若该页在本地 `seenByConv` 已全 seen（大群反复请求同一页 latest-historyPage..latest 就是这样），`ingestInbound` 走 `mergeMetaBySeq` 只改 meta 不改 `messages.length` → 依赖 `[messages.length, tailSig, ...]` 的 `useLayoutEffect` 不重跑 → `pendingScrollRef` 卡住不消费 → **假死：按钮消失(setShowJump 同步生效)，但 scrollTop 永远是 0**。修：`jumpToBottom` 头部**无条件立即** `box.scrollTop = box.scrollHeight` 消除假死；分支仍做 openConversation + 置 `pendingScrollRef` 让后续真新消息到达时精修。实测 500人大群：修前 scrollTop 卡在 0；修后一击到 38721/39661（已看到最新气泡）。
>
> **无待手测活跃项**：收藏 B 方案 / App.tsx 拆分收口 / msgKey 收敛 / 体检整改 / 详情抽屉解耦地基 / Phase A / HEIC 禁选 / 粘贴视频修复 / 设置·壁纸·弹窗打磨 / QR + 群 G0–G3 / 下载门控全链路 / 四大任务 均已手测通过并提交，细节转入 `current_task.archive.md`（归档于 2026-08-22）。
>
> **下一里程碑 = 语音消息 P0**（设计定稿于 `../IMServer/docs/VOICE_MESSAGE_DESIGN.md` v2，后端未动代码）。Web 侧承载：单行录制条（三态同构，按住/锁定/播放）+ 波形气泡；**坑（已排期）**：Chrome/Firefox 录 `webm/opus` iOS 解不了 → 录制要探测 `audio/mp4`，不支持就禁入口。等后端 `send_msg` 协议/`waveform` 列落定后开工。

## 下一步
1. **接下一里程碑：语音消息 P0**（后端排队最前，见 `../IMServer/current_task.md` 与 `docs/ROADMAP.md`）——等后端协议/DB 列落定后做 Web 录制条 + 波形气泡（先探测 `audio/mp4`）。
2. 语音落地后，收藏页 `content_type` 分类把 `voice` 一起做进去（B 方案已留位）。
3. 网络恢复秒连：听 `online` 事件跳过退避立即重连。
4. 群内已读细化（随主线）。
5. 消息列表虚拟化；测试债：Playwright E2E。

## 技术债 / 下次
- **`src/App.tsx` 系统性拆分 ✅ 收口（2026-08-21，6302 → 2958 行；详情已归档）**。**剩余 2958 行 = 应用外壳本体**（44 个核心 state/连接/phase 路由 + enterApp 173 行 + 滚动·定位·已读核心 ~320 行·20 个互咬 ref + conversationActions 菜单表 160 行/43 依赖 + send() 编排 + 子组件组装接线）——均为 §7 点名的胶水，**不再硬抽**；新功能按决策树进新文件即可。
- **再拆必守（三条约束）**：① Hook 调用须在 `if (phase==='login') return` 之前，且注入依赖必须已定义（定义在早退后的函数走 props 或 ref 注入，见 useQR.openPeerDetailRef）；② `searchOpen/searchQuery` 留 App（highlightSearch 定义在 Hook 之前会 TDZ）；③ 行为保持型——函数体/JSX 逐字平移，靠 `App.smoke.test.tsx` 5 例 + tsc + build + 502 例回归兜底；services 的 `useMemo` 必须放在所有 early return 之前（否则 hook 数不一致「Rendered more hooks」崩）。
- **⛔ prop-drilling 墙（属架构决策，留给 code review 定方向，不做机械搬迁）**：
  - **会话详情抽屉 / DetailHeader** 仍内联在 App.tsx IIFE：朴素抽 DetailHeader 需 ~30 props（IIFE 顶 ~18 派生值 title/avatarUrl/pinned/muted/peerBlocked… + ~15 群/好友/会话动作）——是把 30-prop 接口搬个地方、不减耦合。要么整块 `DetailPanel`（连 IIFE 派生一起搬，~35 props），要么维持现状。
  - **成员 ⋯ 菜单**（深耦合 doGroupAction/askConfirm）、**QR 三模态**（已是薄包装，收益小）。
  - **紧耦合核心**：聊天消息流、滚动/已读/分页那堆互咬 ref（`wasNearBottomRef`/`histAnchorRef`/`prevMinSeqRef`… 见「已知坑」scroll/jump 雷区）、消息 CRUD、composer——**jsdom 撑不住真滚动布局（scrollTo 已桩掉），滚动定位类回归仍需浏览器手测**。候选 Hook：`useBlacklist`/`useLinkPreview`；共享 `<MediaTile>`（`gallery-item` 与 `detail-media-tile` 差异在 expired 徽标/size 可见性/容器元素，属**行为合并非纯移动**，需专门评审）。
- **⏸ 拆 `useChatScroll`**（聊天滚动紧耦合核心，互咬 ref + jsdom 测不到真滚动）——独立大重构，性价比最差，缓做或不做。

## 已知坑 / 限制
- **扫自己名片码「查看我的资料」是死路（既有 QR P0 缺陷，未修）**：扫自己的名片码 → resolve 回 relation=self → 结果卡主按钮「查看我的资料」→ `onViewProfile(自己uid)` → `openPeerDetail(peer)`（App.tsx ~3477）因 `peer === uid` 直接 return，弹窗被 onClose 关掉却没打开任何资料页。修法：self 场景改为打开设置页顶部个人资料（`setShowSettings(true)` / `openProfile()`）而非走 peer 抽屉，约 5 行。
- **一图多码消歧仅 Chrome/Edge 生效**：靠原生 BarcodeDetector；Safari/Firefox 无此 API，退回 jsqr 而 jsqr 对并排多码定位失败 → 多码图识别失败（单码仍可用）。要跨浏览器多码需换 zxing-wasm。见 IMServer `docs/QRCODE_DESIGN.md §6`。
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
