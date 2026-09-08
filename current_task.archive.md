> ⚠️ 历史归档（只读，勿更新）。当前活快照见同目录 current_task.md；本文件只供考古。

---

# 归档于 2026-09-07（refresh_token 接入 —— 从活快照转入，被相册宫格上限一轮顶下）

> 从活快照转入（活快照只留当前焦点，见 current_task.md）。

> **接上 `refresh_token`，登录寿命与 iOS 对齐 ✅ 2026-09-06**。此前 Web 的「保持登录」是
> **localStorage 里存明文密码、每次重连重放**——iOS 2026-09-03 就换掉了，Web 一直没跟。
> 存密码的真问题不是"泄露风险大一点"，而是攻击者拿到的是**密码**而不是会话：
> 「设备管理 / 注销某台设备」对它完全失效（注销掉的只是会话，对方用密码立刻重登）。
>
> 顺带修掉一条没人报过的坑：**HTTP 层没有任何 token 生命周期管理**。`this.token` 是登录那一刻
> 拿到的，除非 WS 断线重连没有任何代码去换它；而 WS 长连接建立后服务端**不复查 token**
> （只在握手校验）。于是页面连开超过 24h 时，WS 收发照常、所有 REST 开始报「登录已失效」，
> 既不跳登录也不重签，要等 WS 真断一次才自愈。
>
> 三处改动：
> ① **`session.ts` 存 `refresh` 不存 `pwd`**。老会话里那份明文密码作为**只读迁移垫片**
> （`legacyPwd`）换一次凭据，`saveSession` 的新结构里压根没有这个字段，换完即从磁盘消失。
> ② **新模块 `sdk/tokenSession.ts`** 收所有取 token 的判据：探活 → 续期 → 才轮到凭据登录
> （三条路的优先级即安全序）。**两条不能丢**：探活 `/devices` 必须先于一切（否则密码会话重连
> 直接 `/login` 会重新签发新会话，把「踢下线」自愈掉）；**续期被明确拒绝时不再回退密码登录**
> （服务端认定这条会话已死，拿密码重登只会把「已被注销」洗成「又登上了」）。
> 放新文件不只是为了 `imSdk.ts` 的行数预算（1445，改前 1442，只剩 3 行）——这些判据是可注入
> 依赖的纯决策，脱开 WebSocket 就能单测。
> ③ **`sdk/http.ts` 的 `callJson` 撞 `100102` 自动续期重试一次**。拦在这一层是因为 `imSdk.ts` 里
> 有 58 处 `this.token`，其中 51 处是 `xxxApi(this.token, …)` 的一行转发——逐个改成"取新鲜 token"
> 会把方法体从 1 行撑到 3 行、直接撞穿预算；而那些模块**最终都汇到这一个函数**。
> 只重试一次、只重放可重放的请求（`Request` 对象与 `FormData` 不救）、**只救本就带
> `Authorization` 的请求**（免鉴权接口不该被偷偷补一个 Bearer 头再发一遍）。
>
> 后端配套改了一处（IMServer 仓）：**扫码登录也签凭据**，`qr/login/poll` 的 `confirmed` 首次领取里
> 跟 `token` 同批一次性下发。原先刻意不签（"签而不用等于白放一枚长期凭据"）——那是 Web 还没接
> 续期接口时的判断；不改的话扫码会话仍被 access token 的 24h 顶死、隔天必须重扫。
>
> `tsc -b` 干净 + **vitest 961 全绿**（+28：`tokenSession.test.ts` 14 / `http.test.ts` 救援 7 /
> `session.test.ts` 迁移 7）。**未跑浏览器**：没验「老会话迁移后 localStorage 里密码消失」，
> 也没真等 24h 验救援路径（单测里是拿假后端模拟 100102 的）。

---

# 归档于 2026-08-30（群系统消息可读性 · 转发排除系统通知 · 单聊资料卡收口 · 失败重发 · 登录页在途反馈 · 语音 P0/P1）

> 从活快照转入（活快照只留当前焦点，见 current_task.md）。


> **群系统消息可读性两条（2026-08-30 用户反馈；`tsc -b` + **vitest 672 全绿**（+5：sysSegmentName 3 例）；未在浏览器手测）**：
> - **`.sys-name` 不再用 `--accent`**：胶囊底 `--date-pill-bg` 是 `rgba(92,138,76,.55)`（主题绿），
>   名字再染 `--accent`(#4ca64c) 两者色相几乎重合。改新变量 **`--sys-name: #ffd98a`（浅琥珀）+ 600**，
>   可点性交给 hover 下划线。（先试过白，与胶囊正文 `--on-media` 同色，用户不要白色。）
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


# Current Task — im-web（Web 客户端）

## 归档于 2026-08-22（收藏 B 方案 · App.tsx 拆分收口 · msgKey 收敛 · 体检整改 · 详情抽屉解耦地基 · Phase A · HEIC 禁选 · 粘贴视频修复 · 设置/壁纸/弹窗打磨 · QR/群 G0–G3 · 下载门控全链路 · 四大任务——全部手测通过）

> 从活快照转入。以下均已完成、手测通过（逐 commit 见 git log，逐功能×端状态见 `../IMServer/docs/CLIENT_PARITY.md`）。App.tsx 拆分的「再拆必守约束 / prop-drilling 墙」等**前瞻性架构指引**仍留在活快照「技术债 / 下次」。

**收藏 B 方案（FAVORITES_DESIGN §14）Web 落地 ✅（2026-08-21，tsc + build + 502 vitest 绿，手测通过）** — 无「全部」分签（默认媒体）/ 媒体 chip 3 列宫格（复用 `MediaTile` 逐格门控）/ 文件 chip 三态行（复用 `detail-fileitem` + `FileGateIcon`，门控走 App 注入 `glue`=useMediaDownload）/ 链接·文本·聊天记录统一行 / 右上 ⋯ 互斥菜单「以消息模式 / 以聊天模式查看」（`localStorage im.favorites.viewMode`）/ 聊天模式按 `source_conv_id` 分组（自己发·无来源→「我的」）→ 点进按来源过滤。新文件：`favoritesGrouping.ts(+test)`、`favoritesViewMode.ts(+test)`、`components/modals/FavoritesItems.tsx`；`favoritesCategories.ts` 加 `record` 签 + `deriveCategories(favs,{includeAll:false})`。App.tsx 仅换 props（2958→2959）。已知限制：视频时长无字段不显；`mediaGate` 按当前打开会话判档；文件就绪行只显大小。

**消息身份 key 收敛 `msgKey()` ✅（2026-08-19，tsc build + 351 vitest 绿，手测通过）** — `/code-review` 体检发现的唯一实锤 bug 源：同一 ChatMessage 曾有 4 套不一致身份表达式，List React key（`App.tsx` ×4）用 `clientMsgId ?? serverMsgId ?? i`——入站消息无 `clientMsgId`、实时帧缺 `server_msg_id` 时**塌到数组下标 `i`**，向上翻页 prepend 使下标平移 → React 把 DOM/组件状态错绑到别的行。**收敛**：`album.ts` 的 `mediaIdentity` 重命名为 **`msgKey`**（convSeq 优先、会话内唯一），List key ×4、`menuActive`、详情页 media/file/link key ×3 全部改用，消灭 `?? i` 与 `serverMsgId || convSeq` 漂移。`album.test.ts` 加「React key 契约」用例。**配套**：三端「交付前自审清单」落地——iOS `CODING_STYLE.md` §9 / Go `CONVENTIONS.md` §4.8 / 本仓 §九。

**体检整改 3/4 ✅（2026-08-19，tsc build + 353 vitest 绿，#3 已浏览器验证）** — `/code-review` 防复发项：① **IndexedDB store 单一来源化**（`sdk/localStore.ts` 建 `STORE_DEFS` 清单，`onupgradeneeded` 建表 + `EXPECTED_STORES` 校验都从它派生，杜绝「四处漏改一处→`NotFoundError`」）；② **friendlyMessage 码表对齐**（局部 map 提升为导出 `FRIENDLY_MESSAGES` + 锚定后端 `errcode.go`，`imSdk.test.ts` 断言映射码 ⊆ 后端码集）；③ **CSS 泛化选择器**（`.login button` → 显式 `.login-submit` 类，消灭染到页签/免密链接的坑；菜单类容器故意留泛选）。

**会话详情抽屉解耦（地基已落）✅（2026-08-19，tsc build + 358~363 vitest 绿，手测通过）** — 路线「先上 Context / 先收口群动作 / 再拆子件」前两步完成：① **AppServicesContext**（收拢 9 项稳定服务 clientRef/setToast/comingSoon/askConfirm/askPrompt/四 refresh*，`useMemo` 包一次永不重建；**坑**：services 的 useMemo 必须放在所有 early return 之前，否则 hook 数不一致崩）；② **useGroupActions 收口**（7 个只依赖 services 的群写操作整簇抽出，`.test.ts` 5 例）；③ **拆子件 3 个**（`GroupManagePanel`/`DetailTabs`/`MemberMenu`，自取 `useGroupActions(useAppServices())`，App.tsx 5087→4858）。`/code-review` 已过（补 `DetailPanelParts.test.tsx` 5 例）。**⏳ 剩硬骨头 DetailHeader**（~30 props，留待评审）——已转入活快照技术债的 prop-drilling 墙。

**Phase A 逻辑 hook 收口 ✅（2026-08-19，tsc build + 375 vitest 绿）** — **useMessageStore**（`messageStore.ts` 纯变换 + `useMessageStore.ts` 有状态外壳 + 两 `.test`）：去重/合并/patch/append/删除那套从 SDK handlers 收口为可单测纯函数（+12 例）。App.tsx 4858→4778。**⏹ useIMConnection 评估后不做**（handlers 引用 ~25 个 App 符号，抽出=搬走 tangle 非解耦）。**⏸ useChatScroll** 留作独立大重构。

**App.tsx 系统性拆分收口 ✅（2026-08-18~21，~32+ 提交，6302 → 2958 行；tsc + 319~502 vitest + build 逐阶段绿，手测通过）** — 抽出 ~30+ 组件/hook/纯函数文件：纯逻辑模块（wallpaper/color/messageContent/session/optedIn/videoPoster/time/album/searchPredicate…）+ 叶子展示组件（Avatar/AlbumGrid/QuoteThumb/AnchoredMenu/FileGateIcon/LinkCard/LoginView/MessageList/DetailPanel/Composer/ChatBanners/ContactsTab/ChatHeader）+ 设置面板栈 7 + 弹窗栈 13 + 媒体查看器/文本阅读器/媒体库 + Hook（useChatSearch/useMediaDownload/useMediaSend/useForward/useFavorites/useMentions/useQR/useAppearanceSettings/useFriendOps/useProfileEdit/useDevices/useDialogs/useToast/useMessageStore/useGroupActions）+ `ChatActionsContext`/`AppServicesContext`。`App.smoke.test.tsx` 5 例护栏守登录→聊天主链路。行数闸棘轮只降不升。**详细约束（再拆必守）与 prop-drilling 墙留在活快照技术债。**

**「图片或视频」入口从源头禁选 HEIC ✅（2026-08-18，tsc+build+12 vitest 绿，手测通过）** — `accept="image/*,video/*"` 通配把 HEIC 也列可选。改 `MEDIA_PICKER_ACCEPT` 显式扩展名白名单（从 `RULES` image/video 集合派生，减黑名单+svg，与发送闸 `webCanRenderMedia` 天然一致）；保留第二道 JS 闸兜底（可被「所有文件」/拖拽/粘贴绕过），安全边界仍在服务端。`fileTypes.test.ts` +3 例。

**粘贴视频预览异常修复 ✅（2026-08-18，tsc+build 绿，手测通过）** — `addPastedFiles` 把视频与图片一并压成 `kind:"image"` → 预览条对 image 一律 `<img>` → 视频 blob 破图。修：`pastedImages` 项 `kind` 扩为 `"image"|"video"|"file"`，预览条 video 分支用 `<video muted preload=metadata playsInline>` + 中心 ▶；发送 filter 改 `kind==="image"||"video"` 仍同批走 `sendMediaBatch`。**核对**：粘贴图片/视频 thumb 磨砂 web 端无缺失（统一 `sendMediaBatch`）。

**设置页优化四项（2026-08-15，tsc + build 绿，手测通过）** — ① 卡片字号等比放大；② iOS 风格图标色块（`Row.iconTint` + `.row-icon-tile` 29×29，色块令牌 `--ic-{gray,red,orange,…}` 三主题分支，分色对齐 iOS `IMSettingsViewController`）；③ 数据与存储可读性；④ 返回/编辑按钮加大（仅设置头 `.settings-head .icon-btn` 32→38，聊天头不受影响）。

**壁纸改版（深色默认）+ 色板脱节修复（2026-08-15，tsc + 291 vitest + build 绿，手测通过）** — 壁纸目录换 14 张分层柔和渐变（6 浅 6+2 深）；新增 `WallpaperChoice` 第 4 种 `{kind:"auto"}`（新默认，`resolveWallpaper(choice,isDark)` 按明暗解析，听 `matchMedia(prefers-color-scheme)`）。**色板脱节修复**：`styles.css .color-spectrum{--picker-hue:156}` 就地重声明遮蔽父卡片动态 `--picker-hue` → 删掉重声明，兜底移到 `.color-editor-card`。`appearance.test.ts` +2 例。**注意**：老用户 localStorage 存了具体 preset，需点一次「恢复默认」才切到 auto。

**弹窗视觉打磨 ✅（2026-08-14，tsc+build 绿，用户自测通过）** — 纯 CSS：`.modal-close` 补整幅次要按钮样式；模态圆角统一 `var(--radius-card)`；磨砂玻璃复用（`.ctx-menu,.menu-card,.viewer-more-pop,.mention-panel` 合并规则 + `--glass-menu-*` + `backdrop-filter: blur(24px) saturate(165%)`）；圆角/阴影抽令牌 `--radius-menu:8px`/`--shadow-menu`；`@supports not (backdrop-filter…)` 兜底。规范同步 `UI_COLOR.md §5`。

**QRCODE P0 + 群组 G3 入群 ✅（2026-08-13，tsc + build + 249 vitest 绿 + HTTP E2E 全通，手测通过）** — 方案 `../IMServer/docs/QRCODE_DESIGN.md` / `GROUP_FEATURES_DESIGN.md` §4-G3。依赖 `qrcode`+`jsqr`（bundle 398→572KB）。SDK：`qrMyCard`/`groupQR`/`qrResolve`/`joinGroupByCode`/`fetchJoinRequests`/`decideJoinRequest`，`api()` 把 errcode 挂 `Error.code`。纯逻辑 `src/qr.ts`（15 例）。UI `src/QRUI.tsx`：扫码浮层（摄像头+上传/拖拽/⌘V）、我的名片码/群二维码模态、resolve 四分支、G3 待审入群申请审批。`/code-review` 修复 2 项（`resetQRCard` try/catch+失败 toast、`handleFile` 捕获非图片 reject）。**已知限制**：一图多码点选仅 Chrome/Edge（BarcodeDetector）；扫码登录 `q/l`（P1）未做。

**G2 群治理 ✅（2026-08-13，tsc+234 vitest+build 绿，手测通过）** — 群管理面板三卡（加入与发言/成员权限/治理）+ 黑名单弹窗；成员菜单加禁言（时长选择弹窗）/移出/移出并拉黑；composer 禁言锁（`composerMuteReason`）。SDK 加 setGroupSettings/muteGroupMember/removeGroupMemberWithBan/fetchGroupBans/unbanGroupMember。

**G1 群资料闭环 ✅（2026-08-12，tsc+234 vitest+build 绿，手测通过）** — 群管理三行（简介/公告/全员禁言）+ 详情面板公告卡·「我在本群的昵称」·「群备注」+ 聊天区公告黄条横幅。`memberNick` 群昵称优先。群备注本地存储（后已改服务端多端同步，见归档⑨）。SDK 加 `setGroupAnnouncement`/`setGroupMute`/`setGroupMyNickname`。

**G0 置顶消息横幅 ✅（2026-08-12，tsc + 234 vitest + build 绿，手测通过）** — 进会话拉 `GET /conversations/{id}/pinned` 回填 `.pin-banner`（`📌 置顶消息 i/N · 发送者` + 单行预览），点条=跳转轮转，多条右侧 ☰ 开列表弹窗，右键菜单加置顶↔取消（群内仅群主/管理员可见）。纯逻辑 `src/pinned.ts`（12 例）。**顺带修**：`applyMsgOp` 对 `op=pin` 写死 `pinnedAt`→改认 `data.pinned` + 服务端 timestamp。

**气泡内 `@昵称` 高亮 + 点击跳资料 ✅（2026-08-12，tsc + 210 vitest + build 绿，手测通过）** — `segmentMentions`（mention.ts，7 例）用消息 `mentions`+群昵称还原 `@昵称`，short/long 气泡 + 阅读器高亮 `.mention-hl`；可点 `@昵称`（有 uid、`@所有人` 除外）= `.mention-tap` onClick `openPeerDetail`。**顺带修 `@<uid>` 不高亮**：`mentionEntriesFor` 取昵称失败未回退 uid → 改 `memberNick||uid`。

**三项 UX 优化 ✅ + /code-review 7 条全修（2026-08-11，tsc + 210 vitest + build 绿，手测通过）** — ① 长文本三档显示（`src/longtext.ts` `textTier`+`charCountLabel`，阈值与 iOS 统一：huge `≥2000|≥60`、long `≥300|≥10`；short 全显/long 夹 8 行+展开/huge 摘要卡→全屏阅读器）；② 视频禁复制；③ 媒体入口类型校验（`mediaKindForFile` MIME 前缀优先→扩展名回退，svg 拒收；后端白名单仍权威）。

**任务二 详情页删文件两档 ✅ 三端手测通过（2026-08-11，tsc + 165 vitest 绿）** — 为所有人删除（`OP.DELETE`→WS `msg_op op=delete`→`removeMessageLocal` 落墓碑物理移除；`processIncoming` 遇 `deleted_at>0` 直接移除）+ 仅删除自己（`hideMessage` POST `/messages/hide`；`fetchHidden` 登录 catch-up，uid 维度去重；`msg_hidden` 帧→本端移除）。详情文件右键两档 UX。`/code-review` 5 条全修。

**媒体持久化 C1 + 持久失效标记（2026-08-07，tsc + 144 vitest + build 绿，手测通过）** — 对齐 iOS「原件落盘、命中即就绪」。`src/mediaCache.ts`（Cache Storage 薄封装，按 uid 命名空间，无 `caches` 静默降级内存 blob 绝不抛）+ 6 单测。C1 已下载文件持久化（`startDownload` 成功→`cachePutBlob`+`im.dlfiles.<uid>` 键集，登录 rehydrate）；图片/视频走 `mediaOptedIn`+远端 URL+浏览器 HTTP 缓存。**持久失效标记** `expiredSet`（`im.expired.<uid>`，命中来源 404/410 + `<img> onError` ranged GET 复验；`mediaGate` 命中即返回 expired 不回源，掐 404 风暴）+ 失效占位 ⊘。清理边界：`clearMediaCache` 清 opt-in/dlfiles，**失效标记不清**。

**下载门控 阶段 6/7 + 数据与存储（任务三/四，2026-08-06~07，tsc + 138 vitest 绿，手测通过）** — `src/download.ts`（纯逻辑，21 例，策略/`shouldAutoDownload`/快捷档/状态机，逐条对齐后端 `internal/downloadsettings` 与 iOS `IMDownloadPolicy`）。SDK：`downloadSettings/saveDownloadSettings/resetDownloadSettings`（PUT 体就是 settings 本身）+ `capabilities_update` 帧→重拉。卡片门控：媒体气泡未下载 thumb 模糊/斜纹 + ↓ + 尺寸角标；文件条状态位 + 进度条；下载走 `fetch`+`ReadableStream` 真进度，✕ 用 AbortController 真中止。设置▸数据与存储（存储用量/清缓存/自动下载总开关/低中高档/图片单群·视频·文件上限滑块/重置）。**Web 诚实差异**：只读写 Wi-Fi 档。阶段 6/7：圆形图标+环形进度（`FileGateIcon`）；`openReadyFile` 预览路由；详情「文件」页签并入门控；**图片/视频改 URL 直取（方案 B）**（解门控后 `<img/video src=远端>`，浏览器 HTTP 缓存持久，`mediaOptedIn` 记已解门控）；相册/详情/引用/媒体库四处逐格门控（`AlbumGrid.gateFor`/`detail-media-tile.mediaGate`/`QuoteThumb.gated`/`gallery-item passivePreviewSource`）。日志统一 `logger.*(LOG_TAG.media)`。

**修复用户手测多个新问题（2026-08-07，tsc + 135~138 vitest 绿，浏览器实证）** — ① **详情文件「定位到聊天」失败**：根因 `jumpToSeq` 用 `scrollTo({behavior:"smooth"})` 远距离滚不动 + 下方媒体 onLoad 因 `wasNearBottom` 仍 true 把 scrollTop 拽回底部 → 改**瞬时滚动 + rAF 校正 + 置 `wasNearBottom=false`**，新增 `locateInChat`（详情读全量、聊天页分页窗口不在窗口内则自动上翻分页再定位）；② 媒体库点格后九宫格不消失→`gallery-item` onClick 补 `setGalleryOpen(false)`；③ 查看器「更多」hover 即消失→改点击切换。④ **资料卡「媒体/文件」列表全空**：根因缺 `deletions` store 的陈旧 IndexedDB 连接被模块级缓存复用→事务 `NotFoundError`→catch 返回 `[]`；修 `openDB` 加 `onblocked`+`onversionchange`+缺 store 关掉重开自愈、`loadConversation` 按 `objectStoreNames.contains` 决定事务 store 列表。⑤ **门控图刷新退化 + opt-in 丢失**：`localStore` 补持久化 `thumb` + 已解门控存 localStorage。⑥ **删了又冒出来**：**双层墓碑**（IndexedDB `deletions` 表读盘过滤 + 内存墓碑 `deletedByConv` 登录载入 `onMessage` 丢弃），缺一都复现。

**Typing 提示位置对齐（2026-08-05，手测通过）** — 移除输入栏上方提示条；收到 typing 后聊天标题栏副标题显「正在输入」，3 秒无新帧恢复在线态/成员数。

**参与四大任务 · 任务一 ✅（2026-08-05，tsc + 92 vitest 绿，浏览器实测通过）** — 非好友聊天拦截（微信式）：资料面板非好友显「加好友」隐藏消息/呼叫/视频三卡（`showDetailBody`）；拒收系统行带「发送好友申请」恢复入口（`noteCode` 瞬态）；`requestFriend()` 读 `outcome` 已直接成好友时不吐司；聊天顶栏头像进资料隐藏「消息」（`fromOwnChat`）；**修被拒媒体消息退化成 URL 文本**（`saveRejected`/`loadMessages` 只存 6 字段 + SDK 写死 `contentType:"text"` → 三处补齐完整字段集，配回归测试）。未做 P1（全局开关切 Telegram 式）。任务二/三/四方案后续落地（详情删文件两档 / 下载门控 / 数据存储，见上）。

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



---

# 归档于 2026-09-05（搜索开错会话 / 合并转发标题口径 / 条目匿名化 · 收藏详情置顶记录卡五项 · 记录卡补齐与语音红点 · 记录卡三后续）

> 从活快照转入（活快照只留当前焦点，见 current_task.md）。

> **三项：会话内搜索开错会话 + 合并转发标题口径 + 条目 `u` 匿名化（2026-08-31，与 iOS 同步；
> `tsc -b` 干净、`vitest 704` 全绿；**未手测**）**
>
> 1. **搜索 pill 静默搜错会话（真 bug）** —— `DetailPanel` 的搜索 pill 调 `openInChatSearch()`，
>    这函数**不收会话参数**，开的是当前活动会话的搜索；而 `openPeerDetail()` 只设 `detail.convId`、
>    **不切活动会话**。于是「群里点成员头像 → 资料卡 → 搜索」搜到了那个**群**上，且毫无提示。
>    现 pill 交出 `(d.convId, d.peer, d.isGroup)`；App 侧目标 ≠ 当前会话就先 `openChat`/`openGroupChat`。
>    **不能"先切会话再 openInChatSearch"**——`useChatSearch` 的 `[convId]` effect 会把刚开的搜索态关掉
>    （那是防"关键词泄漏到下一个会话"的既有逻辑）。故新增 `armInChatSearch(targetConvId)` 把"待开"
>    记在 ref 上，由那个 effect 在切换落定后接手打开。回归见 `DetailPanel.test.tsx`。
> 2. **合并转发标题收敛到微信口径** —— 原 `useForward.ts` 按条目发送者数量推标题
>    （一个人「张三 的聊天记录」/ 多人「群聊的聊天记录」），而 iOS 那侧写的是**真实群名**，同一操作两端分叉。
>    现共用纯函数 `chatRecordTitle`（`messageContent.ts`）：群聊固定「群聊的聊天记录」（不写群名）、
>    单聊「{对方公开名}和{我的公开名}的聊天记录」。名字从 `App.tsx` 注入（`peer_nickname` + `myInfo.nickname`，
>    **不是 `peer_remark`**——备注仅本人可见）；**直接从 `conversations` 取而不调 `peerNick()`**，
>    后者定义在 `useForward` 调用点之后，取值会 TDZ。
> 3. **条目 `u` 改成卡片内匿名序号 `s1/s2`**（`buildRecordSenderKeys`）—— 原本发的是发送者真 10 位内部 ID，
>    随卡片到了可能不在群里的收件人手上，而 `GET /users/{id}` 不校验请求方与目标的关系。
>    **读端零改动**（`recordSenderKey` 本就只做相等比较）；只把 `RecordModal` 的头像色种从 `it.u` 换成 `it.n`
>    （匿名序号当色种没意义：同一人在两张卡里会换色）。契约见 `../IMServer/docs/PROTOCOL.md`。
>
> **未手测**；后端同批加了显示名字符清洗（`internal/textguard`），Web 侧无需配合改动
> （`maxLength` 计数按 UTF-16 码元、服务端按 rune，方向上客户端更严，刻意不动）。

> **收藏页 / 详情页 / 置顶 / 记录卡 五项 UI 修复（2026-08-30，与 iOS 同步；`tsc -b` + **vitest 681 全绿**
> （+3：置顶 voice/chat_record 两例、记录条目 voice 预览一例）；**已在浏览器手测通过（2026-08-30）**）**
>
> 1. **置顶预览** `src/pinned.ts`：只认 `audio` 不认 `voice`、且无 `chat_record` 分支 → 语音置顶铺一串 URL、
>    合并转发卡片铺整段 JSON。现统一 `[语音]` / `chatRecordSnippet()` 的 `[聊天记录] 标题`。
> 2. **收藏「来自X」不再露 10 位内部 ID**：`groupInfos` 只在**打开过**那个群时才有成员表、`friends` 只覆盖好友
>    → "没聊过的群里、非好友发的收藏"全回退 uid。`App.tsx` 加按需两级补拉 effect（先 `refreshGroupInfo`
>    拿群昵称，仍缺再 `client.userProfile`），每个 id 只发一次、失败静默。
>    **effect 与 `favUserCards` state 放在登录早退之前**（hook 数恒定），判据不复用早退之后定义的
>    `favSourceLabel`（那会 TDZ）。
> 3. **收藏副行时间与「来自X」拆两行 + 颜色分开**（新 `FavMeta` 组件；`.fav-src` 改 accent，与链接卡来源行同色）：
>    长备注名会把时间挤没。名片行的「由 X 分享」从 `ContactRow` 副行拆成第三行（`.contact-row-source`）。
>    顺手去掉链接分类里重复的来源（`DetailLinkItem` 的 `source` prop 与 `FavMeta` 各显一遍）。
> 4. **详情页链接 tab 时间改 `detailFullDateTime`**（原「今日 HH:mm / 昨天 / M月d日」，同页四 tab 两套语言）；
>    **文件 tab 补上原本完全没有的时间行**（`.detail-file-time`）。
> 5. **`.detail-tabs` 横向可滚**：`flex:1` 等分在 6 签时把每格压到放不下两个字。改 `flex:1 0 auto` + `min-width`
>    + 容器 `overflow-x:auto`（够放时仍等分铺满，同旧行为）。收藏的 `.fav-chips` 本就可滚，无需改。
> 6. **合并转发记录弹窗**：语音条目原先落 `.record-item-text` 铺裸 URL → 改用 `VoiceBubble variant="mini"`
>    （与详情页语音 tab / 收藏语音行同一组件）。打包端 `useForward.ts` 补 `d`（时长）/`w`（波形）两个 key
>    （与 iOS 同约定），老记录无这两项时退化成等高条纹 + 0:00 仍可播。`recordItemPreview` 补 voice 分支。
>    名片条目 Web 本就是卡片，无需改（iOS 那侧此次才补上）。

> **记录卡补齐 + 语音红点/倍速对齐（2026-08-30 第三批；`tsc -b` + vitest 685 绿；**已手测通过**）**
> 1. **合并转发条目新增 `ts`/`u`/`a`**（与 iOS 同 key，契约表进了 `../IMServer/docs/PROTOCOL.md`）。
>    `useForward` 新增注入 `recordSenderAvatar`（头像来源=我自己 `myInfo` / 群成员表 / 会话行对端，
>    都长在 App，故留在 App 注入）。`RecordModal` 据此显每条时间 + 头像，**连续同一人只显一次**
>    （判据 `recordSenderKey`，与 iOS `IMRecordSenderKey` 同口径）。老记录缺字段各自降级。
> 2. **未播红点挪到气泡右上角**（与 iOS 同位置）：原先挤在时长行里跟时长/倍速抢位置。
>    **倍速胶囊改到时长行右端**（`justify-content: space-between`），也与 iOS 一致。
> 3. 转文字 Web 仍未实现（P2），故"转文字也消红点"这条只在 iOS 落地。
>
> **记录卡三个后续（2026-08-30 用户实测报，已修并**复测通过**；`tsc -b` + vitest 681 绿）**
> 1. **录音格式红线被绕过（本次 iOS 崩溃的源头）**：`voiceRecordingSupported()` 第一顺位问裸
>    `audio/mp4`——**Chrome 会把 Opus 塞进 MP4 容器**，探测照样 true，于是录出「扩展名 .m4a、内容是
>    Opus」的文件。iOS `AVAudioPlayer` 拿到 `framesPerPacket==0` 直接**除零崩整个 App**。
>    改成：先问点名 AAC 的 mime（`audio/mp4;codecs=mp4a.40.2` → `audio/aac`），裸 `audio/mp4`
>    只在浏览器**不**支持 `audio/mp4;codecs=opus` 时才用（Safari 属这类）；都不行就置灰 mic。
>    `voiceRecorder.test.ts` +2 例（Chrome 式误判 / 点名 AAC 优先），并**刻意更新**了那条
>    「探测抛异常应冒出去」的旧护栏——现在一律兜底成"不支持"。
> 2. **弹窗正中冒出一个 ▶**：`.play-badge` 是 `position:absolute`，而外层 `.fav-thumb-wrap`
>    **没有定位**，于是它一路找到最近的定位祖先（`.modal` 本身）。给 wrap 加
>    `position:relative; display:inline-block`；收藏宫格里 `.fav-icon` 本就 relative，观感不变。
> 3. **语音无时长**：老记录没有 `d` 字段 → 新增 `RecordVoiceItem`，用一个独立的
>    `<audio preload="metadata">` 探一次（不碰 VoiceBubble 的模块级播放单例）；`Infinity`/荒唐大数
>    一律丢弃，宁可不显。新记录直接读 `d`，不走探测。

> **无其它进行中的开发项。** 网络恢复秒连与 `UI_COLOR.md` 收敛（均 2026-08-30）已完成，细节转入
> `current_task.archive.md`。仍**未做**的是「下一步」里那几件：浏览器手测语音、转文字 P2 调研、列表虚拟化。

---

# 归档：2026-09-08 收口时从 current_task.md 裁下的「当前焦点」历史块
（共 7 块，原样搬运，未做删改）

> **D4-2 角标 / 系统通知 / 开机自启 ✅ 2026-09-08 —— 页面侧第一次真正调用 D1 那层适配**。
> 判断逻辑全在纯函数 `src/desktopNotify.ts`（**16 例单测 + 4 次变异验红**），
> 钩子 `src/useDesktopIntegration.ts` 只管「什么时候调」与订阅生命周期。
> **全程没有一处 `if (isDesktop)`**——分流在 `src/platform/`，浏览器版调同一套、拿到空实现。
>
> **口径**：免打扰不计入角标（否则用户得为了消红点去点开他明确说不想被打扰的会话），
> 但免打扰里 @我 计 1；通知的排除顺序是「自己发的 → 前台 → 正在看 → 免打扰」，
> 顺序反了会让「免打扰会话里自己发的消息」被 mention 分支救回来（有专门一条测试钉着）。
> 媒体消息不显 content（那是 `/uploads/xxx` 一串路径），按类型给占位，有图说优先显图说。
> 开机自启在设置▸通用新增一格，**仅宿主支持时渲染**，读系统真实状态，设失败开关会弹回去。
>
> **⚠️ 本轮踩了三个坑，全部是自己的**：
> ① **hook 放在了 App.tsx 的早退之后** → `Rendered more hooks than during the previous render`，
> 48 例全红。这条约束本文件里就写着、我的记忆里也写着，照样踩。已改为「早退前调 hook +
> 定义处回写 ref」（本文件既有套路，见 useQR 那处）。
> ② **门禁跑的不是我刚写的代码**：`IM_FORCE_LOCAL_SERVER=1` 加载的是 `dist/`，而我没重新 build。
> 自检报「会话列表超时」，我照着新代码猜了两轮，**还把它错误归因成 IPC 死锁并写进了代码注释**。
> 真因是陈旧产物。已加硬闸 `distFreshness.ts`（旧了 exit 7 并指名文件，`touch` 验红过），
> 注释也已更正。**定位失败时我先给因果、后找证据，顺序反了**——现已把「转储渲染进程报错 +
> 页面文本」固化进 e2e 失败路径，一眼就能看到 `React error #310`。
> ③ `installBridgeIpc` 原先只在正常模式装，自检模式下页面对着空通道喊。已提前且无条件装。
>
> **`setBadge`/`notify` 改成异步**（`invoke` 而非 `sendSync`）：它们挂在消息路径上，
> 为一个 Dock 角标阻塞 UI 线程不划算；`deviceId`/`openExternal` 仍同步（各有非同步不可的理由）。
>
> **验证**：根仓 build 零错误 + **1030 例全绿**；打包版 `--shell-check`/`--smoke`/`--e2e`/`--perf`
> 四项 exit 0，其中 `setBadge=true`（真设上了 Dock 角标）、系统通知真弹出、
> e2e 的桥检查确认 `setBadge/notify/subscribeOpenConversation/autoStart` 齐备。

> **D4-1 外壳基础能力 ✅ 2026-09-08 —— `desktop/` 内，`src/` 零改动**。
> D4 切成三段交付：**D4-1 纯外壳**（本轮）/ D4-2 角标·通知·自启（要页面配合）/ D4-3 SQLite+FTS5。
>
> **做了**：窗口状态记忆（位置·尺寸·最大化，节流写盘）、托盘 + 菜单、**关闭 = 收起到托盘**、
> 退出闸（托盘退出 / Cmd+Q / `before-quit` 都置闸，否则 `app.quit()` 会被 `preventDefault` 收回去、
> 永远退不掉）、应用图标与托盘图标（由 `public/im-logo.png` 生成，不自己造）、
> 以及 review 第 8 条的**本地服务生命周期修复**（记下活连接逐个 destroy——WS 隧道是长连接，
> `server.close()` 拆不掉它；D2 时靠「进程紧接着退出」掩盖了，现在应用会长期活着就真会踩）。
>
> **`desktop/` 有测试跑法了**：加 vitest，`windowState` 的几何判断抽成纯函数（注入工作区，不碰 electron），
> **11 例 + 3 次变异验红**。这段判错的后果是「窗口开在看不见的地方，用户以为没启动」——
> 没有报错也没有日志，所以必须钉住。另加 `--shell-check`：托盘装得上吗 / 关窗是收起还是销毁 /
> 退出闸真的能退吗 / 窗口状态落盘了吗，**两条变异都验红过**。
>
> **⚠️ 本轮又抓到两个「失败时看起来正常」**（就是 §4.6.1 立的那条规矩当场兑现）：
> ① **`--shell-check` 自己 timing fail-open**——判「窗口是否被销毁」用 `sleep(50)` 再看，
> 变异（去掉 `preventDefault`）照样全绿，50ms 不够销毁落地。**修法不是把数字调大**（换台慢机器还翻），
> 改成**等事件**：该发生的轮询到发生，不该发生的监听 `closed` + 宽裕上限。
> ② **打包版托盘图标没进包**——`extraResources` 只写路径会保留目录层级，落到
> `Contents/Resources/resources/tray.png` 而代码找 `Contents/Resources/tray.png`，必须 `from`/`to` 压平。
> **dev 模式验不到这条**（走 `__dirname`），是 `--shell-check` 在打包版第一次跑就抓出来的。
>
> **打包版四项全绿**：`--shell-check` / `--smoke` / `--e2e` / `--perf` 均 exit 0。
> 根仓 `npm run build` 零错误 + **1008 例全绿**；`desktop` 单测 11 例全绿。

> **补跑 `/code-review` + 修掉 8 条 ✅ 2026-09-08**（D1~D3 欠了三轮的那次复查）。
> 8 条发现里 **5 条确认是真 bug，其中四条都是「门禁自己会放过失败」**——和我在这三轮里
> 自己踩到的是同一类，说明不是偶发：
>
> | 位置 | 门禁怎么骗过自己 | 修法 |
> |---|---|---|
> | `desktop/src/main/e2e.ts` 步骤⑤ | 只等「发送中」消失，而**失败**的消息同样不含它（失败态换成 `.fail-badge`）→ 后端一挂就对一条没发出去的消息打 ✓ 并 exit 0 | 三条一起断言：marker 在场 + 无发送中 + **无 `.fail-badge`** |
> | `desktop/src/main/perf.ts` | 未登录时量的是**登录页**的内存，却仍 `return 0` → D3 先量错了三轮（323 MB 而非 486） | 会话列表没出现 → **exit 4** |
> | `e2e.ts` 媒体检查 | 只抽 `hits[0]`；本工程「媒体失效」是正常状态，抽中一个已清理的就误报 | 抽最多 5 个，任一为 `image/*` 即通过 |
> | `desktop/src/main/index.ts` | `whenReady` 链无 `.catch` + `show:false` → 启动失败时**窗口永不出现且零报错** | 补 `fatal()`：stderr + `dialog.showErrorBox` + exit 1 |
>
> 另修三条较轻的：`localServer.ts` 读流没挂 `error`（读失败会崩主进程）、`root` 带尾分隔符时
> 穿越守卫会全量 403（潜伏）、`platform/desktop.ts` 的 `notify`/`setBadge` 无条件 `return true`
> 与 `types.ts` 的契约不符（系统拒了通知权限会谎报成功，调用方就跳过应用内兜底）——
> 桥的这两个方法改为返回 `boolean`，契约测试加一条「不许谎报成功」。
>
> **两条修复做了变异验证**：掐掉 WS → e2e 在步骤⑤ 变红 exit 1（还原 exit 0）；
> 全新 profile 跑 perf → exit 4。打包版 `--smoke`/`--e2e`/`--perf` 三项全绿。
>
> **口径纠偏**：D3 那句「486 MB，三轮波动 <1%」只在**同一会话内**成立——同日重跑得到 424 MB，
> 跨会话差 13%。正确说法是「**420–490 MB 量级，同批次内很稳**」，已改进 DESKTOP_DESIGN §4.6。
>
> **一条待观察**：`src/App.locate.test.tsx` 的「开窗回来后自动移窗并高亮」用例耗时 5.7s、
> 对时序敏感，在 swap 耗尽 + 负载 14 的机器上翻过一次；单独跑两次、全量重跑一次都绿（1008/1008）。
> 不是本轮回归，但它是个真实的 flaky 点。

> **D3 性能实测 ✅ 2026-09-08 —— 壳选型定稿：继续用 Electron**。新增 `desktop/src/main/perf.ts`
> （`npm run perf` / 打包版 `--perf`），做成**可重跑模式**而不是一次性 `ps`——一次性的数字没法在
> 换写法、换 Electron 版本后回头对账，而对账才是这件事的意义。内存按 `app.getAppMetrics()` 分进程记。
>
> **实测（打包版 x86_64，已登录、空载，三轮）**：合计 **485.4 / 486.5 / 488.4 MB**，4 个进程
> （Tab 159 / Browser 148 / GPU 107 / Utility 72），**跨轮波动 <1%**。
> 冷启动至**会话列表可见 2.0 / 2.7 / 3.1 s**。同日同机对照：Telegram（原生 C++）83 MB / 2 进程。
> **与当初预期对账：预期 350–600 MB，实测 486 MB，落在区间中部——预期成立。** 倍数约 6×（原预判 7–10×）。
>
> **不换 Tauri**：省的约 250 MB 还是未实测的预期值，代价是引入 Rust 并用 Rust 重写整个本地同源层
> （最难的是 WS 裸 TCP 隧道）。逃生舱仍在——`src/platform/` 保证 UI 与 SDK 不随壳走。
>
> **⚠️ 顺带照出一个 D2 缺陷并修掉**：本地同源层用的是**临时端口**，而 `localStorage` 按 **origin** 隔离、
> origin 里带端口 → **每次启动 origin 都变 → 登录会话/主题/壁纸/字号/会话列表缓存全丢**，
> 用户每开一次桌面端都要重新登录。现场：连开两次 origin 从 `:61140` 变 `:61146`。
> 修法：端口记进 `userData/device.json` 下次复用，被占才退回系统分配并记住新的。
> 修后连开两次 origin 都是 `:61347`，第二次 e2e 报「已有会话，跳过登录」。
> **这不是性能问题，却只有做性能实测才暴露**——`--smoke`/`--e2e` 每次都从登录页开始跑，
> 「又要登录一次」在那两个自检里看起来完全正常；`--perf` 不点登录按钮，会话列表迟迟不出现才顶出来。
> 已加护栏：`--smoke` 每次打印 `origin=… localStorage(im.*)=N 个`。
>
> **测量条件必须一起记**：测时本机 swap 已用 **14.9 GB**、负载 **13.91**（同时跑着 57 个 Claude Code
> 会话、2 个 JVM）。**冷启动那三个数是这种条件下的上界**；内存三轮几乎不动，说明不太受负载影响。
> **两条局限**：`--perf` 不显窗口，冷启动**不含窗口显示与合成**，是用户感知的**下限**；
> 只在 **macOS x86_64** 测过，arm64 与 Windows 无机器。

> **D2 Electron 外壳骨架 ✅ 2026-09-07（晚）—— `desktop/`（新增）**。Electron 44 + electron-builder 26。
> **它不是第五个客户端**：界面与 SDK 全部来自仓库根 `src/`，本目录只出窗口 + 身份 + 本地同源层。
> **`src/` 零改动**。
>
> **本地同源层是本轮的关键决定**（IMServer `DESKTOP_DESIGN.md` §7.5 方案 B）。原本要走方案 A
> （桥注入绝对 base URL + 改 `sdk/http.ts`），实测两条把它否了：① **后端没有任何 CORS**
> （从 `:5173` 打绝对 `http://localhost:8080/api/v1/login` → `Failed to fetch`，打相对 → HTTP 400），
> A 还得外加 CORS 垫片；② 消息里存的媒体地址本身是相对的（`/uploads`、`/avatars`），A 要改 **29 个渲染点**。
> B 让打包版与 dev **同源、同路径、同行为**，两件事一件都不用做。
> 实现 `desktop/src/main/localServer.ts`：Node 自带 `http`/`net`，**零新依赖**，WS 走裸 TCP 隧道，
> 只绑 `127.0.0.1` + 临时端口，`will-quit` 关掉。
>
> **⚠️ 新的对称点**：`localServer.ts` 的 `PROXY_PREFIXES` 必须与 `vite.config.ts` 的 `proxy` 逐条一致
> ——写第一版就漏了 `/avatars`。已登记进 IMServer `docs/SYMMETRY.md`（两条）。
>
> **桥只给身份两项**（`deviceId`/`deviceName`，contract=1），其余能力由 `platform/desktop.ts` 逐能力回退 web。
> `deviceId` 落 `userData/device.json`，写盘失败**不阻断登录**（与 web 侧 localStorage 那条降级同口径）。
>
> **两个无人值守自检**（走与真实启动完全同一条路）：`npm run smoke` 查桥/平台判定/身份一致/**后端可达**；
> `npm run e2e` 走 D2 验收链路 + **抽验相对路径媒体的 content-type**。e2e 只往名字含「冒烟测试」的会话发
> （`IM_E2E_CONV` 可改），找不到就失败退出。`IM_FORCE_LOCAL_SERVER=1` 可不重新打包就验同源层。
>
> **打包版实测全绿**：`--smoke` 与 `--e2e` 均 **exit 0**——登录 → 会话列表 22 行 → 打开会话 → 发一条 →
> 服务端确认 → 相对路径媒体 `200 image/jpeg`。未签名 `.app` 300 MB / x86_64。
>
> **本轮自己踩了三个 fail-open，全部修掉并变异验过**：① `process.exitCode + app.quit()` 退出码恒 0
> （改 `app.exit(code)`）；② `check-file-size.sh` 只扫 `src`，`desktop/src` 是盲区（加 `SCAN_ROOTS`）；
> ③ **媒体检查自己 fail-open**——代理漏前缀时 `Avatar` 的 `onError` 把 `<img>` 摘掉换首字母，
> 检查数到 0 张判成「跳过」。改从 `performance` 资源表取证 + `fetch(no-store)` 看 content-type，
> 同时把服务器的静态兜底改成**带扩展名一律 404**（不再把 HTML 当图片发）。现在去掉 `/avatars` 立刻 exit 5。

> **D1 平台适配层 `src/platform/` ✅ 2026-09-07**（桌面端方案见 IMServer `docs/design/DESKTOP_DESIGN.md`）。
> 桌面端与浏览器版**共用本仓 src/**，只有少数几件事按宿主分流——这一层就是那几件事的收口处。
> 五个文件、四条硬规矩写在 `platform/types.ts` 顶部；`docs/SYMMETRY.md` 已登记（提交时会念）。
>
> **能力面**：`deviceId` / `deviceName` / `saveFile` / `openExternal` / `notify` / `setBadge` /
> `subscribeWake` / `voiceRecording`。调用点已改走本层：`sdk/imSdk` 的握手身份与唤醒订阅、
> `sdk/qrLogin` 的 device_id、`useMediaDownload` 的另存×2 与预览、`components/Composer` 的麦克风探测。
> `webDeviceId`/`webDeviceName` **整段移入** `platform/web.ts`（imSdk 1445→1416，棘轮同步下调）。
>
> **两条同步签名是行为不是风格**，改之前先读 `types.ts` 的注释：① `openExternal` 必须同步——
> 脱离用户手势的调用栈就被弹窗拦截器吃掉；② `deviceId` 必须同步且稳定——`IMClient` 拼登录帧时同步取用，
> 后端按 `(uid, device_id)` 顶替去重，飘一次就多一条僵尸 session。桌面桥因此要在 **preload 期**
> 把身份两项作为**值**注入，不能做成异步 IPC。
>
> **`notify`/`setBadge` 在 web 恒返回 `false`**——本仓至今没有通知功能（全仓 `new Notification` 0 处），
> 这是如实上报不是退化，D4 才接实现。**本地消息库（IndexedDB→SQLite）刻意不在 D1 范围**：
> `sdk/localStore*.ts` 是 700+ 行的面，抽象它是重构不是平移，与「行为零变化」的验收冲突，归 D4。
>
> **验证**：`npm run build` 零错误 + **1007 例全绿**；`contract.test.ts` 25 例对 web/desktop
> 两套实现跑同一组断言，并**做过四次变异验红**（openExternal 改 async / deviceId 不稳定 /
> 桌面 subscribeWake 不叠加浏览器信号 / web notify 假装成功），还原后全绿。
> **浏览器实测**（`localhost:5173` 免密登录）：清空 `im.deviceId` → 登录 → 新 UUID 落盘、WS 连上、
> 会话列表加载；麦克风 `disabled=false`；派发 `online` 拿到 `IM.WS wake action=probe`；
> 打开两万人大群渲染正常、**console 零错误**。
>
> **未实测**：`saveFile` 与 `openExternal` 两条（要真触发一次下载 / 真开一个新标签页，没做）。
> 它们是逐字搬运且被契约测试覆盖，但「搬对了」和「点下去还好使」不是一回事。

> **相册宫格发送侧补 9 件上限 ✅ 2026-09-07**。起点是 CLIENT_PARITY 上那条「能渲染宫格、发不出宫格」，
> 记的根因是「`Composer.tsx` 的 `<input type="file">` 没有 `multiple`」——**这条是误判**。
> `multiple` 本就没写在 JSX 里，是 `useMediaSend#pickFile` 在 `.click()` 前**按入口逐次赋值**的
> （「图片或视频」多选、「文件」单选）；React 不管没出现在 JSX 里的属性，命令式赋的值扛得过重渲染。
> 浏览器实测已证：点「图片或视频」后 live DOM 上 `input.multiple === true`，选 3 张 → 三条消息共享
> 一个 `alb-` `group_id`（IndexedDB 核对）→ `rowPattern(3)=[1,2]` 一个宫格。发送侧本来就是通的。
>
> 真正的缺口在别处：**发送侧没有 9 件上限**。iOS `selectionLimit=9`、Android `MediaPick.LIMIT/AlbumLayout.MAX=9`，
> Web 一个闸都没有。而 `albumRowPattern(n>9)` 只回 `[3,3,3]`（9 格）、`AlbumGrid` 按行 `slice` 取数——
> 选 12 张的结果是 **12 条消息真的发出去、真进对端库，但两端都只显示前 9 张**。
> 这比「发不出去」更难查：发送方以为发了，收件方少看 3 张，谁也不会报错。
>
> 判据抽成纯模块 **`src/albumBatch.ts`**（`ALBUM_MAX=9` / `ALBUM_GROUP_ID_PREFIX="alb-"` /
> `planAlbumBatch` / `albumOverflowToast`），接在 **`sendMediaBatch` 这一个收口**上——附件选择器与
> 粘贴攒批都汇到它，所以 group_id 与上限**全仓只有这一份**，没有第二处 `alb-` 拼接。
> 另加一条自洽断言 `albumGridCapacity()`：`albumRowPattern(ALBUM_MAX)` 的格子数必须等于 `ALBUM_MAX`，
> 把「改了上限没改排布」变成一条会红的测试而不是发出去才发现。
>
> `tsc -b` + `npm run build` 干净、**vitest 982 全绿**（+21：`albumBatch.test.ts` 11 / `useMediaSend.test.ts` 5 +
> 原有 5；新增用例均**先看红过一次**）。浏览器实测两条：3 张 → 一个 `[1,2]` 宫格；12 张 → 只发 9 条
> （IndexedDB 核对 10–12 未发）+ toast「一次最多发送 9 个，已忽略后面的 3 个」，控制台零报错。
>
> **没做**：iOS/Android 那种「选图器里就选不动第 10 张」（Web 用系统选择器，只能事后截断）；
> 粘贴路径仍限单件（2026-08-19 拍板，未动）；「文件」入口仍是单选（既有行为，未动）。

---

## 【归档 2026-09-09】D4-2 之后那轮 /code-review 修完 6 条（原「当前焦点」）


> **`/code-review` 修完 6 条 ✅ 2026-09-08（D4-2 之后）**。其中一条是我这轮埋的最严重的：
>
> ① **离线积压同步会一次弹几十条通知**。`onMessage` 不区分「实时」与「同步/开窗批量投递」——
> `imSdk` 的 `processIncoming` 只有一个 `onMessage` 调用点，`SYNC_RESP`/`WINDOW_RESP` 同样逐条回调。
> **讽刺的是我在 App 那句注释里写了「只对真正新追加的发，否则同步重推会把历史又通知一遍」**，
> 以为 `ingestInbound` 的去重挡住了——去重挡的是「本地已有」，而离线积压对本地就是全新的，一条挡不住。
> **这是「我以为我处理了」，比没处理更糟。** 修法：`onMessage` 加 `live` 位（`!collect`），
> 只对 `live` 的发通知。`imSdk` 那行注释写明「**凡面向用户的提示必须先看这一位**」。
> ② 群系统消息（入群/退群/设管理员）也会通知，正文落成「[消息]」——已排除 system 与 recalled，
> 补 2 例测试并变异验红。
> ③④⑤⑥ 四条都是**注释声称的事实与代码不符**（这几轮我反复在骂它，自己还是留了四处）：
> `setBadge` 注释说同步阻塞而代码已异步；`getAutoStart` 的 sendSync 理由是「设置页点出来才调」，
> 实际在 React 挂载时就调（已改 invoke）；`subscribeOpenConversation` 说换号会拆而 effect 是
> `[]` 依赖（已改 `[selfUid]`，否则点旧通知会给新账号开一个他未必有的会话）；
> `autoStart` prop 说「读系统真实值」而只在挂载读一次（已改：挂载 + **回前台**各读一次）。
>
> **顺带撞到两次体量闸门**：`App.tsx` 与 `imSdk.ts` 都恰好顶在棘轮上，加一行注释就红。
> 没放宽阈值——把注释压进同一行解决。
>
> 验证：build 零错误 + **1032 例全绿**；打包版四项自检 exit 0。

---

## 【归档 2026-09-09】D4-3a：localStore 抽成能力接口（原「当前焦点」，D4-3b 落地后退休）


> **D4-3a ✅ 2026-09-09：`sdk/localStore*.ts` 抽成能力接口 + web 实现逐字平移 + 契约测试**
> （方案 `../IMServer/docs/design/DESKTOP_DESIGN.md` §7.6；桌面端 D4-3b 要把它换成主进程 SQLite）。
>
> 现在是三层，**加方法/改语义前先读 `localStore.types.ts` 的注释**：
>
> | 文件 | 是什么 |
> |---|---|
> | `localStore.types.ts` | 契约：15 个异步方法 + 记录形状 + 键的形状（纯类型，无运行时依赖） |
> | `localStore.web.db.ts` | web 地基：连接 / schema / 游标。**新增 object store 现在改这里**（CODING_STYLE §九 那条已跟着改） |
> | `localStore.web{,.ranges,.search}.ts` | web 实现（原三个文件逐字平移）+ 末尾装配出 `webLocalStore` |
> | `localStore{,.ranges,.search}.ts` | 门面：19 个同名导出转发给选中的实现；**选实现只在 `pickStore()` 一处** |
> | `localStore.contract.ts` | 两侧共跑的 39 条断言，**不在 `*.test.ts` 里**——好让 `desktop/` 那个独立工程也能 import |
>
> **调用点一处没动**（`imSdk.ts`/`App.tsx`/`useChatSearch.ts` 仍是原来的 import），原有 37 条
> localStore 用例逐字未改仍绿——那就是「行为没变」的证据。地基之所以单拆一层：装配点要 import
> 区间与搜索、它们又要 import 地基，写在一起就是一圈运行时循环依赖（同 `platform/types.ts` 那个理由）。
>
> **契约里两条是红线守门人**：「两个字的中文必须搜得到」钉住「不上 FTS5」的结论
> （trigram 要 ≥3 字符，「开会」搜不到且**静默失效**）；「字段整轮往返」钉住 SQLite 逐列建表
> 最容易漏的那类（少 `groupId` 相册散架、少 `thumb` 门控图退化、少 `mentionSpans` @ 不再高亮）。
>
> **按 §九「新增的测试必须先看它红一次」写了个变异验证器**，逐条改坏实现跑契约：8 个变异全被抓。
> 第 2 个变异当场抓到**契约测试自己的一个洞**——「按 conv_seq 升序」原来用个位数序号，而记录键
> 是字符串、字典序恰好等于数字序，把 `sort` 删掉照样绿；换成 1/2/10 才真的在守。
>
> **`/code-review` 复查后又修了 8 条**——全在契约层，全是「用例名声称在守、其实没在守」。
> 最典型的一条：「墓碑消息不参与搜索」原来是删完就查，而查不到只是因为消息行本来就被删了；
> 墓碑唯一起作用的场景是「删完之后服务端又推了一遍」，补上那一步才真的在守。
> 变异验证同步扩到 17 个全绿，过程中又发现两条变异**打在了冗余那一层**
> （`rec.owner === owner` 在 web 侧冗余，真正的强制点是索引键；「倒过来的区间」被守了三遍），
> 改成打真正的强制点才证明得了断言承重——这两条对 D4-3b 有实义：SQLite 侧那些冗余层可能一层都不存在。
>
> **顺带修掉一个老账：`waveform` 从来没落过库**。它是后端下行结构里唯一一个本地没持久化的字段，
> `parseMessage` 解出来了、落库那步丢掉，于是刷新后语音气泡的波形退化成等高条纹，
> `resend.ts` 重发失败语音也带不回。现已落库并进了契约的往返清单。
>
> 验证：`npm run build` 零错误；`npm test` **108 文件 1074+ 例全绿**；`check-file-size.sh` 通过。
> **未做浏览器实测**——纯结构平移 + 一个字段的落库，但按仓规这不等于验过。
