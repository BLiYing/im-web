# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **群系统消息可读性两条（2026-08-30 用户反馈；`tsc -b` + **vitest 672 全绿**（+5：sysSegmentName 3 例）；未在浏览器手测）**：
> - **`.sys-name` 不再用 `--accent`**：胶囊底 `--date-pill-bg` 是 `rgba(92,138,76,.55)`（主题绿），
>   名字再染 `--accent`(#4ca64c) 两者色相几乎重合。改 `--on-media`(白) + `font-weight:600`，
>   可点性交给 hover 下划线。
> - **我自己那段显示「我」**：新 `sysSegments.ts#sysSegmentName(uid, selfUid, resolve)`，
>   **聊天页系统行（`MessageList.renderSysLine`）与会话列表预览（`App.convPreview`）共用**——
>   不共用就会一处「我」、一处自己的昵称。`renderSysLine` 因此多收一个 `uid` 参数。

> **转发选择器不再列「系统通知」会话（2026-08-30；`tsc -b` 绿 + `ForwardPicker.test.tsx` 9 例绿，
> **按用户要求未跑全量 vitest**）**：与 iOS 同批做，后端零改动。
> - `ForwardPicker` 内新增 `selectable = conversations.filter(c => c.is_group || c.peer !== SYSTEM_UID)`；
>   **可见行与多选「发送」都改读它**——后者若照旧读 `conversations` 全量，勾中系统会话再用搜索把它挡掉，
>   仍会被发出去。
> - **过滤放在组件内**而不是 App 调用点：转发消息 / 收藏转发 / 推荐名片三个入口都汇到本组件，一处即全覆盖。
> - 理由：系统通知是只读会话，服务端直接拒 `send_msg to=system`
>   （`../IMServer/docs/design/SYSTEM_NOTICE_SESSION_DESIGN.md` §2.2），列出来点了必报错。新增 2 例单测。

> **单聊资料卡收口 · 6 条用户反馈（2026-08-30；`tsc -b` + **vitest 667 全绿**（+2：删除好友 / 点复制用户名）；未在浏览器手测）**：
> 与 iOS 同批做，逐功能状态见 `../IMServer/docs/CLIENT_PARITY.md`「资料 · 单聊资料页收口」行。
> - **「更多」弹窗点空白处不消失**（本次最实的一个 bug）：菜单挂在 `.detail-panel` 内，而面板自身
>   `onClick={e => e.stopPropagation()}`（防误关抽屉），冒泡阶段的 window 监听根本收不到面板内的点击。
>   修法照抄成员菜单那条既有注释：**捕获阶段** window click + 排除整个 `.detail-pill-anchor`
>   （只排除菜单的话，再点一次「更多」会先被关掉再被按钮 toggle 打开，永远关不掉）。Esc/滚动一并关闭。
> - **非好友不再显示「更多」**：菜单里全是"已经是好友"才有意义的项，此时页面只留「加好友」一个入口（与 iOS 同）。
> - **「更多」补「删除好友」**（此前只有通讯录行菜单有）：`doRemoveFriend` = askConfirm + `removeFriend` +
>   刷新好友表；**删完不关面板**，本页随即切成非好友视图，用户当场看得到关系已变。破坏性最重故置末位。
> - **头部副标题不再显 @句柄**：改显在线态 `presenceText(presence[peer])`（新 prop `peerPresenceText`）——
>   下方「用户名」行已经显示句柄，同屏显两遍没有新信息（iOS 早就是在线态，这次对齐）。
> - **「用户名」行点击复制**裸句柄（不带 @）+ 吐司；iOS 那端是长按，Web 上点击是其等价物。

> **发送失败重发（2026-08-30，**已合入 main**；`tsc -b` + **vitest 643 全绿**（+7：resendPolicy 6 例、消息列表 1 例）；未手测）**：
> 与 iOS 同批做，口径两端一致（蓝图见 `../IMServer/docs/CHAT_UX.md` §8.1）。此前 `.fail-badge` 只是个
> `<span>`，文本/语音完全没有重发；媒体只有「点气泡重传」一条路。
> - 新 `src/resendPolicy.ts`（6 例单测，与 iOS `IMResendPolicyForMessage` 同口径）：
>   `none`（非本人/非失败/已有 convSeq/**被拒收**）· `retry-upload`（content 是 `blob:` 或空 → 本地重传）·
>   `same-id`（内容已就绪 → 按**原 clientMsgId** 重发）。
> - **`same-id` 是正确性红线**：服务端按 `(conv_id, client_msg_id)` 幂等去重，换新 ID 会在「上次其实已存下、
>   只是 ack 丢了」时让对端收到两条。新增 `src/sdk/resend.ts#resendMessage(client, m, to)`——
>   **刻意放在 IMClient 类外**：`imSdk.ts` 有 1450 行硬预算（`check-file-size.sh` 只准降不准升），
>   加在类里当场超预算；它本就只是 `sendMedia` 的一次组合调用。为此 `MediaSendOptions` 加
>   `clientMsgId?`（**仅重发指定**，首发仍一律新 UUID），引用/转发溯源/@/媒体元数据/caption/waveform 原样带回。
> - **被拒收判据用 `note` 而不是 `noteCode`**（noteCode 瞬态不落 IndexedDB，刷新后归 0）。
> - `.fail-badge` 由 `<span>` 改 `<button>`：不可重发时 `disabled`（恢复入口仍是下方系统行）。
>   相册整组一个红❗ → 点一次重发组内所有失败成员（`useMediaSend.resendMessage(m, messages)`）。
> - `FakeIMClient` 补显式 `sendMedia`（Proxy 兜底返回 Promise，拿不到 cid 也断言不了实参）；
>   `App.messageList.test.tsx` 加 2 例（点红❗按原 cid 重发 / 被拒收那条 disabled）。
> - **已知限制**：`retry-upload` 依赖内存里留存的 `File`（`pendingFilesRef`），**刷新页面即失效**，
>   只能提示"原文件已失效，请重新选择"——与 iOS 的 `im-pending://` 落盘副本不同，这条差距本次不补。

> **登录页「请求在途」可见反馈（2026-08-28，`LoginView.tsx` + `styles.css`，tsc + 555 vitest 绿）**：
> 用户反馈点登录看不到转圈。原来 `authBusy` 只把三个按钮 `disabled`，没有任何可见的进行中态——
> 弱网/后端连不上时就是"点了没反应"。现在被点的那个入口显示内联菊花 + 文案切「登录中…／注册中…」，
> 另外两个仍只禁用。
> - `LoginView` 加**组件内** `busyAction` 记来源（三个入口共用一个 `authBusy`，不记来源会三个一起转）；
>   hooks 声明在 `restoring` 早退**之前**（Hook 顺序不能被早退打断）。回车提交同样置 busyAction。
> - 新 `.btn-spinner` 复用已有 `album-spin` 关键帧，`currentColor` 描边跟随按钮文字色，不另起动画。
> - 新 `src/components/LoginView.test.tsx`（4 例）：空闲无菊花 / 点登录只有登录转 / 免密入口转而登录键不转 / authBusy 落回收掉。
> - iOS 端同批做了等价改动（`UIButtonConfiguration.showsActivityIndicator`）。

> **刷新常需重登「被自己上一次登录踢」根因修复 ✅（2026-08-22，`App.tsx`，tsc+build+504 vitest 绿 + 浏览器实测）** — 08-18 device_id 去重修复（`3d70253`/`87c0d27`/web `37e3c7f`）激活的客户端重连竞态：`enterApp` 建新 `IMClient` 前未断开旧 client → 本次登录同 device_id 被后端 upsert 顶替、踢掉旧连接（WS 1005）→ 旧 client 自排重连、拿已撤销 token 探活 `/devices` 得 100101 → 触发共享 `onAuthError→logout`，把健康新会话也踢回登录页。日志证据：`login_failed 100101` 全集中在 08-21/22。修：①`enterApp` 开头 `clientRef.current?.disconnect()`（manualClose+清重连定时器+bump generation，令旧 client 在途/待发重连全静默作废）；②`onAuthError` 加 `if (client !== clientRef.current) return` 兜底（被顶替的旧 client 鉴权失效不得代表新会话踢 app）。实测：单标签连刷 3 次 0 次 login_failed/1005/100101（修前必现）。**已知边界（非本次修）**：多标签同账号——后一个标签登录会顶替前一个（稳定 device_id 单会话语义），被顶替标签仍回登录页；要多标签共存需跨标签会话协调（BroadcastChannel）或每标签独立 device_id，属更大设计，留待定夺。

> **详情开合动画 + 详情定位 + UI 一致性（2026-08-22，`styles.css`+`App.tsx`，tsc+build+504 vitest 绿 + 浏览器实测）**：
> 1. **聊天区居中 + 开合对称平移动画**（`styles.css` `.main` `@media (min-width:1121px)`）：无 `.detail-mask` 时 `.main` `max-width: calc(100%-2*sidebar-2*gap)` + **`transform: translateX((sidebar+gap)/2)`** 居中；有详情 `translateX(0)` 贴边。**用 transform 而非 margin**——两态宽度恒定、只视觉平移不回流，消除了 margin 方案「开详情时边距+满宽挤不下→聊天先压窄再展开」的抖动（用户反馈开详情效果不好）。**开=向左滑贴边 / 关=向右滑回居中，对称顺滑**；detail-mask（z5 不透明）盖住滑动重叠区。仅宽屏三栏态生效。实测 transform 在 180.8↔0 平滑切换。（`.main` 内无 fixed 后代、菜单在 `<main>` 外渲染 → transform 安全。）
> 2. **详情卡内媒体/文件右键「定位到聊天」保持详情不消失**（`App.tsx` fileMenu locate 去掉 `setDetail(null)`）：详情卡是右侧列、不遮聊天，定位在左侧可见聊天区滚动高亮，不丢详情浏览上下文；仍关闭会遮挡的媒体库蒙层/全屏查看器。实测 `detailStillOpen:true`。
> 3. **URL/卡片气泡时间左下→右下**（`styles.css` `:has()` 扩展 `.link-card`/`.record-card`/`.longtext-card` 的 bmeta `margin-left:auto`）。**已留边界**：折叠「long」档文本（非卡片）时间沿用文本流，未强制右对齐。
> 4. **跳到底部按钮点击不生效（500人大群必现）根因修复**（`App.tsx jumpToBottom`）：`newest < latestSeqRef.current` 走 `openConversation(cid, latest, latest)` 分支——SDK 的 `since = latest - historyPage`；若该页在本地 `seenByConv` 已全 seen（大群反复请求同一页 latest-historyPage..latest 就是这样），`ingestInbound` 走 `mergeMetaBySeq` 只改 meta 不改 `messages.length` → 依赖 `[messages.length, tailSig, ...]` 的 `useLayoutEffect` 不重跑 → `pendingScrollRef` 卡住不消费 → **假死：按钮消失(setShowJump 同步生效)，但 scrollTop 永远是 0**。修：`jumpToBottom` 头部**无条件立即** `box.scrollTop = box.scrollHeight` 消除假死；分支仍做 openConversation + 置 `pendingScrollRef` 让后续真新消息到达时精修。实测 500人大群：修前 scrollTop 卡在 0；修后一击到 38721/39661（已看到最新气泡）。
>
> **无待手测活跃项**：收藏 B 方案 / App.tsx 拆分收口 / msgKey 收敛 / 体检整改 / 详情抽屉解耦地基 / Phase A / HEIC 禁选 / 粘贴视频修复 / 设置·壁纸·弹窗打磨 / QR + 群 G0–G3 / 下载门控全链路 / 四大任务 均已手测通过并提交，细节转入 `current_task.archive.md`（归档于 2026-08-22）。
>
> **语音 P0+P1 已落地 + 2026-08-26 修复批（tsc + vitest 519 绿，待浏览器手测）**：
> ① **发送不显示根因修复**——`sendVoice` 曾无乐观回显行，ack 按 clientMsgId patch 落空 → 刷新才显示；现 append 回显行（status=sending，applyAck 转 sent）；`imSdk.pendingSends` 补 `waveform`（刷新后自己发的语音波形不再退化条纹）。
> ② 转发链带 `waveform`（`useForward` opts + 回显行 extra 带 duration/waveform）。
> ③ 详情页新增「语音」tab（有语音消息才出现，`DetailTabs` VoiceBubble 行 + 右键菜单）。
> ④ 收藏语音 = 内嵌迷你播放器 `FavVoiceRow`（复用 VoiceBubble；曾按文件三态行兜底）；收藏快照带 `waveform`（后端 `im_favorite` 新列）；从收藏发送经 `favoriteToMessage` 透传 duration/waveform（曾被服务端拒发）。
> **Web 转文字留 P2**：SpeechRecognition 只吃 mic 流，不吃 URL/文件——需 Whisper.wasm 或服务端 ASR，调研中。

## 下一步
1. **浏览器手测语音**（重启后端后）：Safari 录制（Chrome 无 audio/mp4 支持入口置灰属预期）→ 发送立即显示气泡；收发波形/scrub/倍速；详情语音 tab；收藏语音播放 + 从收藏发送。
2. Web 转文字 P2 方案调研（Whisper.wasm on-device vs 服务端 ASR）。
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
- **一图多码消歧仅 Chrome/Edge 生效**：靠原生 BarcodeDetector；Safari/Firefox 无此 API，退回 jsqr 而 jsqr 对并排多码定位失败 → 多码图识别失败（单码仍可用）。要跨浏览器多码需换 zxing-wasm。见 IMServer `docs/design/QRCODE_DESIGN.md §6`。
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
