# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **im-rtc 换票：从调试密钥迁移到 IMServer 真实换票接口 ✅（2026-09-28，本端已完成，iOS/Android 待迁移）**：
> 此前 `signToken`（`src/rtc/rtcEngine.ts`）用 `VITE_RTC_DEBUG_SECRET` 在本地直接签接入票——联调期
> 临时方案，代码里早写明"上线前换成 IMServer 换票接口"。本次落地：
> - `signToken` 改签名为 `(getAuthToken: () => string)`，带上**当前 IM 会话的 Bearer token**
>   （不是登录那一刻的快照——用 `App.tsx` 新增的 `getRtcAuthToken`，`useCallback` 空依赖数组，
>   实时读 `clientRef.current.authToken`）调 IMServer 新接口 `POST /api/v1/rtc/token`（走既有
>   `callJson`，天然复用 100102 自动续期重试与统一错误码解包）；`device_id` 不由本端传，
>   IMServer 从登录会话登记值里取——天然等于本端 `platform().deviceId()`（同一个值，登录帧本就用它）。
> - `RtcConfig` 精简为只剩 `wsUrl`；`RtcHost` 新增 `getAuthToken` prop（引用必须稳定，是内部
>   `useEffect` 依赖之一）。
> - `.env.local` 只留 `VITE_RTC_WS_URL`；去掉的三项若外部脚本/文档仍引用需同步清理（已扫过
>   `src/` 无残留引用）。
> - **StrictMode 下重复换票已修**（同日顺手修）：开发环境 `RtcHost` 的登录 effect 会被连续跑两次
>   （mount→cleanup→mount，几乎无间隔），此前 `cancelled` 只挡得住"处理结果"、挡不住"请求已发出"——
>   调试密钥时代这只是白算一次 HMAC，换真实换票后会白打一次后端。改法：`useEffect` 里建
>   `AbortController`，cleanup 时 `controller.abort()`；`signToken`/`startRtcEngine` 新增可选
>   `signal` 参数透传给 `callJson`（`tracedFetch` 本就展开 `init` 全部字段给原生 `fetch`，`http.ts`
>   零改动）。新增测试验证 `signal` 确实传到底层 fetch，变异验红过。
> - 单测：`src/rtc/rtc.test.ts` 新增 `signToken` 四例（带 token 换票成功 / 未登录直接拒绝不发请求 /
>   服务端 `600001` 原样抛出 / signal 已中止时请求被真中止），均变异验红过；`rtcConfig` 相关用例同步精简。
> - `tsc -b` 干净、`vitest` 全量 **1479/1479 绿**、`npm run build` 零错误。
> - 三端对称登记 `../IMServer/docs/SYMMETRY.md`（`im-web src/rtc/rtcEngine.ts`）：iOS `IMRtcConfig.h`/
>   `IMRtcCall.m`、Android `rtc/RtcConfig.kt` 仍在用调试密钥，尚未迁移——迁移前对照本端 `signToken` 实现。
> - **浏览器端到端实测 ✅ 已做（同日）**：`./scripts/dev.sh` 已接好 `IM_RTC_SECRET_KEY` 环境变量
>   （见 IMServer `current_task.md`），用真实密钥重启后端后在浏览器实测——Console 确认 StrictMode
>   去重生效（第一次请求真的 `AbortError`，只有第二次拿到 200）、`sys.hello` 握手成功、`rtc_start`；
>   点「呼叫」真的把 `call.invite` 送到了 im-rtc-server（回「对方当前不在线」，是服务端真实业务判断，
>   不是本地假象），会话列表也正确记了这条通话记录。**未做**：真机（非浏览器）实测；双人实际接通
>   （目前只验证到发起呼叫这一步，未开两个身份互相拨打）；未验证清空本地 `debugSecret` 配置后旧路径
>   确实已完全不可达（代码层面已删，行为上应等价，未专门回归）。
> - **前提**：IMServer 需 `export IM_RTC_SECRET_KEY=<控制台密钥>` 后再跑 `./scripts/dev.sh`，否则本
>   接口回 `600001`、通话入口不可用（这是正常降级，不是 bug）。

> **im-rtc 2.1.0 通话 Kit 多语言接线到「设置 ▸ 语言」（三端，2026-09-27）**：`src/rtc/RtcHost.tsx` 的
> `<CallProvider>` 此前完全没传 `locale`，SDK 2.1.0 的多语言能力升级后一直没生效。加 `const lang = useLang()`
> （`src/i18n`），`<CallProvider locale={lang === "zh-Hans" ? "zh-CN" : "en"}>`——直接喂已解析值，**不用**
> uikit 自带的 `resolveLocale('auto', …)`，与 iOS/Android 同一个选择（避免两套"跟系统"判据打架）。
> 因为 `useLang()` 是响应式 hook，语言设置变化会自动重渲染生效，不需要像 iOS/Android 那样手动挂一个
> 变更监听。`npm run build` 零错误。三端对称改动见 `../IMServer/docs/SYMMETRY.md`。
> **未做**：浏览器里实际切一次语言、发起一次通话看 Kit 文案是否跟着变。

> **通话记录：被叫侧 `cancel` 文案「未接来电」→「对方已取消」（三端 + 设计文档，2026-09-27，与用户讨论后拍板）**：
> `cancel`（主叫主动撤回）跟真正错过（`no_answer`/`busy`/`offline`）不是一回事，只改这一种 reason 的措辞，其余三种
> 与推送文案不变；`tone`（红/计未读/推送）完全不变，纯文案改动。本端改动：`src/callRecord.ts` 的
> `UNANSWERED_KEYS.cancel` 被叫键从 `call.record.missed` 改成新键 `call.record.cancelled_by_peer`
> （`../IMServer/docs/i18n/strings.json` 新增，已 `node scripts/i18n/gen-i18n.mjs` 重新生成
> `src/i18n/locales/*.json`）；`isMissedCall`/`tone` 判定本就结构化读 `renderCallRecord(...).tone`，
> 不依赖文案字符串，未受影响（这点 Android 那边不同，见其 `current_task.md`）。三端共用向量
> `../IMServer/docs/conformance/call_record.json` 改的那条用例已同步拷贝进本仓
> `src/testing/callRecord.vectors.json`。`tsc -b` 干净、`vitest` 全量 **1476/1476 绿**、
> `npm run build` 零错误。**未做**：浏览器实测"A 呼叫 B、A 取消"看气泡与会话列表预览。

> **多语言 P1+P2+P3 ✅ 已完成（2026-09-22，中文 + 英文；P1+P2 已 commit 1ae0c52 推送，P3 未提交；浏览器未手测）**：P1 基础设施（`src/i18n` 的 `t()`/`useT()`/`setPref` + `LanguagePanel` 设置 ▸ 语言 + 桌面 IPC 同步）。**P2** 存量迁移全覆盖：设置面板、聊天侧组件、各类 modals、详情/联系人/管理侧组件、`menus.ts`/`useGroupOps.ts`/`useChatSearch.ts` 等 hooks、`sdk/errcode.ts` 错误码（对齐 iOS `err.*`）；`tsc -b` 干净、`vitest` 全量 **1434 例绿**。
> **P3 客户端消费**（未提交，另一次会话完成）：新增 `src/sysEventRender.ts`（`buildGroupSysSegments`/`buildSysNoticeText`/`localizeReplySnapshot`，消费服务端 `sys_event`/`sys_args`/`reply_snapshot_kind`/`_args`，占位符分词——从 `format()` 抽出的 `tokenizeTemplate()` 复用——不在代码里拼句子结构）；`sdk/protocol.ts`/`parseMessage.ts`/`localStore.web.ts` 补齐四个新字段的解析/落库；`MessageList.tsx`/`convPreview.ts` 接入。**顺手修了真实 bug**：`messageContent.ts` 的 `localizeSnippet` 此前硬编码中文，不跟随 App 语言，现改用 `t()`。`tsc -b` 干净、`vitest` 全量 **1466/1466 绿**、`check-file-size.sh` 全部在预算内（`MessageList.tsx` 恰好压线 600/600，WARN 不 FAIL）。文案表现有 **1386 键**（跨三端共用，见 `../IMServer/docs/i18n/strings.json`）。
> ⚠️ 已知缺口（详见 `../IMServer/docs/design/I18N_DESIGN.md` §6.1）：`messageContent.ts` 的 `chatRecordSnippet()`（旧版 JSON 快照就地救标题的兜底分支）仍硬编码中文；桌面若切到 SQLite 本地库后端（`desktop/src/main/sqliteRows.ts`/`sqliteStore.ts`），四个新字段未接入（当前多数场景走 IndexedDB，不受影响）。
> **P2 范围内刻意 DEFERRED（不是漏改）**：`App.tsx` 好友申请默认招呼语（发给服务端的消息内容）、`messageContent.ts`/`callRecord.ts`（消息预览占位符）、`mention.ts` 的 `MENTION_ALL_LABEL`（@全员 token，进消息正文）——均待 P3 服务端结构化。`sdk/localStore.contract*.ts` 命中的中文是契约测试用例描述/夹具数据，不算漏改。
> ⚠️ 待清理（非阻塞）：`net.error.avatar_upload_failed` 与 `group.create.avatar_failed` 中文相同英文不同，语义重叠，将来可考虑收口成一个 `common.*`；`menus.ts`「静音/取消静音」与 `ChatHeader.tsx`「免打扰/取消免打扰」指向同一开关但措辞历史遗留不一致（新增 `web.conv.menu.mute/unmute` 保持原样），是否统一待产品定夺。
> ⚠️ W5 发现会话菜单「静音/取消静音」(`menus.ts`) 与详情页「免打扰/取消免打扰」(`ChatHeader.tsx`) 指向同一个开关但措辞不一致（历史遗留，非本次引入）——保持原文案不变、按规则拆了 `web.conv.menu.mute/unmute` 单独键，是否统一措辞待产品定夺。
> ⚠️ **模块顶层不许调 `t()`**（切语言不会变）；`test-setup.ts` 固定 `im.language=zh-Hans`（jsdom 的 navigator.languages 是 en-US）；`App.tsx` 行数预算已顶到 3670/3679，新逻辑别往里塞。
> ⚠️ P2 迁移子代理**曾因周额度限流失败一次**（batch W3，2026-09-21）——失败前的代码改动与文案片段合并均已正常完成，只是收尾报告被打断；每次继续迁移前先核实 git diff 与片段合并状态，务必重新跑一遍 `tsc -b`/`vitest`/`check-i18n.mjs` 确认，别假设失败=没做完。
>
> **im-rtc 通话接入（首版接线，SDK 版本/本地包集成说明）**：`src/rtc/`（`RtcHost` 登录后起引擎 / 退出销毁、
> `rtcCall` 出口、`RtcGroupCallPicker` 群通话选人）；单聊详情页「呼叫 / 视频」→ 1v1，群详情页「群通话」
> （成员多选 ≤8）；名字头像走 App 现成解析链（备注>昵称>@句柄），经 `ProfileProvider` 注入。SDK 用 npm 正式版
> `im-rtc-call-engine` / `im-rtc-call-uikit-react`（2.1.0）。**本地包集成保留、默认关闭**：验未发布的 SDK 改动时
> `./scripts/sdk-source.sh local`（等价于 package.json 两个 `file:../im-rtc/im-rtc-web/.sdk-release/local/tgz/*.tgz`，
> 先在 im-rtc-web 跑 `./scripts/pack-sdk.sh local`），验完 `./scripts/sdk-source.sh npm` 切回；本地档期间别提交
> package.json / package-lock.json，装完 `npx vite --force`。换票机制见「当前焦点」（已迁移到 IMServer 真实接口）。
> 未做：附件面板「音视频」不接（将移除）、设置页「接口/调试」开关。

> **第三批用户报告（Web 部分）✅ 2026-09-15（用户复测通过，已提交；tsc + vitest 1312 条全绿、变异验红）**：
> 左栏页签「会话」→「消息」（三端统一）；「消息」页签补未读蓝点——此前只有 Android 有。页签从 App.tsx 抽到
> `src/components/SidebarTabs.tsx`（+5 例单测），判据复用 `desktopNotify.ts` 的 `badgeCountOf`（与 Dock 角标同一份，
> 与 iOS `IMTabUnreadCount` / Android `TabUnread` 同口径，SYMMETRY 已登记）。**刻意不计「标为未读」**（三端一致）：
> 会话行会画那颗点，但页签不亮——要改就三端一起改 badgeCountOf 那一处。Web 冷启动本就没有「先闪空态」（列表拉完才进主界面）。

> **第二批用户报告 ✅ 2026-09-15（未提交；tsc + vitest 1303 条全绿、变异验红、浏览器实测）**，逐条见 IMServer `docs/CLIENT_PARITY.md` 顶部：
> ① 角标统一蓝：`.row-badge`（新的朋友）/ `.conv-pending-badge` / `.detail-badge` 由 `--danger` 改 `--unread-badge`；
> ② 文本 / 引用消息时间贴气泡右下角：`.bmeta` 统一 `margin-left:auto`（原先只有 caption / 链接卡 / 超长文本三条 `:has` 规则）；
> ③ **改昵称后老消息仍显旧名、刷新也没用**：`chatNaming.ts` 的 senderLabel 原为快照优先（还有一条单测把它钉成
>    「历史消息不随成员表变」，已翻转），改「成员表 > 本窗最新快照 > 本条快照 > 资料缓存」；`useForward.ts` nameOf 同序；
>    「末条昵称对不上成员表 → 5s 节流重拉群资料」放在 `src/useGroupInfoRefresh.ts`（连同 refreshGroupInfo 逐字平移出 App.tsx——
>    App 已触体量基线 3679，写在 App 里被 pre-commit 拦下），`useGroupInfoRefresh.test.ts` 4 例、变异验红。
> 实测（:5173，user1001）：通讯录页签与「新的朋友」角标蓝；「1002群」里改名后的 user3005 旧消息显示新名；链接 / 引用消息时间在右下角。

> **D4 收尾 ✅ 2026-09-11：单实例锁 / 深链 / 拖文件进聊天列 / 全局快捷键**（设计与取舍记在
> `../IMServer/docs/design/DESKTOP_DESIGN.md` §7.9；上一块 D4-3 本地消息库已移入 archive）。
>
> | 件 | 入口 | 自检 |
> |---|---|---|
> | 单实例锁 | `desktop/src/main/singleInstance.ts` | `--shell-check` ⓪b 真起探针进程 |
> | 深链 `imdesktop://q/u\|g/<token>`（只收邀请码） | `desktop/src/main/deepLink.ts` → preload `subscribeDeepLink` → `useQR` | `--e2e` ②b / ⑨ |
> | 拖文件进聊天列（浏览器版同得） | `src/useFileDrop.ts` → `useMediaSend#addPastedFiles` | `--e2e` ③c |
> | 全局快捷键（**默认关**） | `desktop/src/main/globalShortcutCap.ts` → 设置 ▸ 通用 | `--shell-check` ③b / `--e2e` ⑩ |
>
> 每件都做过双向变异（单测 / 契约 / 接线各自转红）。自动化验不到的手测：~~真拖文件到侧栏不导航~~ ✅、
> ~~桌面端粘贴截图~~ ✅、~~一次拖多个只留最后一个~~ ✅、~~全局快捷键 ⌃⌘W 收起 / 叫出~~ ✅
> （2026-09-11 用户手测，手测欠账清零）。系统真正分发深链要装签名包，归 D6（暂无法验证）。
>
> ⚠️ **自检不能与正在运行的 IM Desktop 同时跑**：单实例锁会拒掉后起的那个并 exit 11（这是故意的——两个进程同写一份 messages.db）。

> 更早的已完成块已移入 [current_task.archive.md](current_task.archive.md)（只读归档）。

## 下一步
0--. **会话内搜索服务端命中翻页 ✅ 2026-09-11**（`b30bed6`）：▲ 翻过最旧命中带 `next_cursor` 取下一页，
   判据在 `src/searchPaging.ts`（与 iOS `IMChatSearchPaging` 同口径，SYMMETRY 已登记）；顺带修了有缺口会话里
   「本地命中先到、服务端命中后到」时下标越界（计数「193 / 50+」、▲▼ 失灵）。浏览器实测过（:8099 副本库 + :5199）。
   **同日续修（用户实测报的）**：搜「98」翻过一页后改成「981」→ 计数「100 / 50+」、▲ 没反应。根因是新词结果防抖 250ms 未到时，
   旧词的服务端命中集仍被当成新词的；现在 `serverKey`（会话|词|发件人）对不上当前查询就不认，▲ 翻页同样要求对得上。
   两条回归在 `useChatSearch.paging.test.ts`（先红后修，两处变异各自转红）；浏览器复测全链路过。**iOS 无此问题**
  （改词时 `recomputeSearchHitsAndJump:` 同步换成本地命中、清截断标记）。
   **C4 ✅ 2026-09-11**（↓ 问区间清单 / 实时消息登记 [seq, seq] / bump 贴底才补 + 取最新下沿 off-by-one），
   浏览器数出站帧实测三场景；自检写法见 `src/sdk/c4Realtime.test.ts`。
0-a. **会话刷新不再整份重读 / 全量同步 ✅ 2026-09-11**（C4 浏览器实测时看到的那个多出来的 `sync_req`）。
   原链路：开窗 / 翻页 / conv_bump / 实时消息 → `scheduleConversationRefresh` → `preloadLocal(全部会话)`（每个会话 `getAll` 整份本地消息，
   结果被「内存优先」丢掉）+ `syncTracked()`（全部会话一帧 `sync_req`）。现在 `src/useLocalPreload.ts` 的 `preloadNew` 只预载**本 client
   还没登记过**的会话、`syncTracked(fresh)` 只同步它们；已登记的只刷新超级群标记（`trackConversation(id, 0, is_super)`，SDK 不拿 0 盖游标）。
   登录 / 重连仍走全量 `preloadLocal`。**没改成只拉列表**的原因：新会话要登记、群升级后超级群标记要跟上。
   测试：`useLocalPreload.test.ts`（5）/ `App.conversationRefresh.test.tsx`（2，防接线改回）/ `sdk/syncTracked.test.ts`（2），五处变异各自转红。
   浏览器实测（:8099 副本库，大群灌 500 条）：翻历史时收 bump → 出站帧 0、会话列表 1 次、本地库 `getAll` 0；点 ↓ 开窗 →
   `window_req` + 2 个回执、**无 `sync_req`**、`getAll` 0。iOS / Android 查过没有同类问题（iOS 开窗不通知列表页；Android 开窗只落库）。
0-. **D4-4 桥补齐 ✅ 2026-09-09**：`saveFile`（blob 递字节 / 远端流式落盘）、`openExternal`
   （协议白名单 + blob 退回 window.open + `setWindowOpenHandler` 不让子窗口继承桥）、
   `subscribeWake`（睡眠唤醒/解锁/聚焦，**叠加**页面那两个信号）。
   **`voiceRecording` 实测后决定不做**：Electron 原生支持 AAC 录制，页面那套探测本就给对答案
   且自纠错。桥现在没有未实现的能力了（IMServer `docs/design/DESKTOP_DESIGN.md` §7.8）。
0. **桌面版手测本地库**（D4-3b 已过 e2e，但有三件要眼睛看的）：① 发一条语音 → 重启应用 →
   波形还在不在（`waveform` 是这轮才补上落库的）；② 换号后不串库（SQLite 按 owner 隔离，
   但没在真机上验过两个账号来回切）；③ **首次升级会清空本地缓存**——既有 IndexedDB 数据
   不迁移是刻意取舍（§7.6.3），表现是「离线冷启动可浏览」断一次、消息从服务端重新同步。
1. **浏览器手测语音**（重启后端后）：Safari 录制（Chrome 无 audio/mp4 支持入口置灰属预期）→ 发送立即显示气泡；收发波形/scrub/倍速；详情语音 tab；收藏语音播放 + 从收藏发送。
2. 语音转文字**结果链路**未在本地验通（本轮实测停在「识别中…」，服务端识别多半没配）——排一次后端 `internal/transcribe` 配置再复测。
3. 群内已读细化（随主线）。
4. 消息列表虚拟化；测试债：Playwright E2E。

## 技术债 / 下次
- **`src/App.tsx` 系统性拆分 ✅ 收口（2026-08-21，6302 → 2958；半年功能后长回 ~3760，2026-09-05 两轮再抽；详情已归档）**。**剩余 ~3760 行 = 应用外壳本体**（44 个核心 state/连接/phase 路由 + enterApp 173 行 + 滚动·定位·已读核心 ~320 行·20 个互咬 ref + conversationActions 菜单表 160 行/43 依赖 + send() 编排 + 子组件组装接线）——均为 §7 点名的胶水，**不再硬抽**；新功能按决策树进新文件即可。
- **再拆必守（三条约束）**：① Hook 调用须在 `if (phase==='login') return` 之前，且注入依赖必须已定义（定义在早退后的函数走 props 或 ref 注入，见 useQR.openPeerDetailRef）；② `searchOpen/searchQuery` 留 App（highlightSearch 定义在 Hook 之前会 TDZ）；③ 行为保持型——函数体/JSX 逐字平移，靠 `App.smoke.test.tsx` 5 例 + tsc + build + 907 例回归兜底；services 的 `useMemo` 必须放在所有 early return 之前（否则 hook 数不一致「Rendered more hooks」崩）。
- **⛔ prop-drilling 墙（属架构决策，留给 code review 定方向，不做机械搬迁）**：
  - **会话详情抽屉 / DetailHeader** 仍内联在 App.tsx IIFE：朴素抽 DetailHeader 需 ~30 props（IIFE 顶 ~18 派生值 title/avatarUrl/pinned/muted/peerBlocked… + ~15 群/好友/会话动作）——是把 30-prop 接口搬个地方、不减耦合。要么整块 `DetailPanel`（连 IIFE 派生一起搬，~35 props），要么维持现状。
  - **成员 ⋯ 菜单**（深耦合 doGroupAction/askConfirm）、**QR 三模态**（已是薄包装，收益小）。
  - **紧耦合核心**：聊天消息流、滚动/已读/分页那堆互咬 ref（`wasNearBottomRef`/`histAnchorRef`/`prevMinSeqRef`… 见「已知坑」scroll/jump 雷区）、消息 CRUD、composer——**jsdom 撑不住真滚动布局（scrollTo 已桩掉），滚动定位类回归仍需浏览器手测**。候选 Hook：`useBlacklist`/`useLinkPreview`；共享 `<MediaTile>`（`gallery-item` 与 `detail-media-tile` 差异在 expired 徽标/size 可见性/容器元素，属**行为合并非纯移动**，需专门评审）。
- **⏸ 拆 `useChatScroll`**（聊天滚动紧耦合核心，互咬 ref + jsdom 测不到真滚动）——独立大重构，性价比最差，缓做或不做。

## 已知坑 / 限制
- **相册上限 9 是渲染契约，不是偏好**：`albumRowPattern(n>9)` 只有 9 格、`AlbumGrid` 按行 `slice` 取数，
  第 10 件起**根本不渲染**。所以发送侧必须截断（`albumBatch.ts#ALBUM_MAX`，有自洽断言兜着），
  否则多发的消息真进对端库却两端都不显示。三端同值（iOS `selectionLimit` / Android `AlbumLayout.MAX`）。
  ⚠️ **收端不设防**：别的客户端硬塞 >9 个同 `group_id` 的成员，本端仍只显示前 9 个（未做上限提示）。
- **隐藏 `<input type="file">` 的 `multiple` 刻意不写在 JSX 里**，由 `useMediaSend#pickFile` 按入口赋值
  （媒体多选 / 文件单选）。看到 JSX 里没有它**不是 bug**——2026-09-07 就照这个"缺 `multiple`"的判断
  查过一轮，实际是通的。要改多选行为改 `pickFile`，别往 JSX 里加（加了会跟 pickFile 争同一个属性）。
- **扫自己名片码「查看我的资料」是死路（既有 QR P0 缺陷，未修）**：扫自己的名片码 → resolve 回 relation=self → 结果卡主按钮「查看我的资料」→ `onViewProfile(自己uid)` → `openPeerDetail(peer)`（App.tsx ~3477）因 `peer === uid` 直接 return，弹窗被 onClose 关掉却没打开任何资料页。修法：self 场景改为打开设置页顶部个人资料（`setShowSettings(true)` / `openProfile()`）而非走 peer 抽屉，约 5 行。
- **一图多码消歧仅 Chrome/Edge 生效**：靠原生 BarcodeDetector；Safari/Firefox 无此 API，退回 jsqr 而 jsqr 对并排多码定位失败 → 多码图识别失败（单码仍可用）。要跨浏览器多码需换 zxing-wasm。见 IMServer `docs/design/QRCODE_DESIGN.md §6`。
- **File 句柄不能跨刷新持久化**：刷新后进行中的上传作废，无 iOS 式杀进程自动续传（Web 平台限制）。
- **未读语义（非 bug）**：自己发送的消息在自己任何端永不计未读（服务端排除 sender==本人）。
- 消息排序按 `timestamp`；ack 后换服务器时间戳。
- 虚拟化暂回退为普通滚动列表。
- 本地落库/空洞自愈/连续游标：IndexedDB 按 owner 隔离、同事务。
- 免密登录需后端 `-dev-login`；dev 建的号无法再走密码登录。
- **登录寿命口径（2026-09-06）**：access token 24h；`refresh_token` 180 天绝对寿命、**续期不刷新**，
  唯一轮换点是改密码（`changePassword` 必须接住响应里那枚新的，不接住本地这枚当场作废、
  下次冷启动就被弹回登录页）。**WS 连着 ≠ token 有效**——服务端只在握手校验，别拿连接状态当续期依据。
- **凭据存在 localStorage**（XSS 可读，与存密码相比仍是净改善：可吊销、不能改密码、不能登其它端）。
  更强的做法是 httpOnly cookie，需要后端配套，未做。

## 关联工程 / 常用命令
- 后端 `/Users/dev/IOSProject/IMServer`；iOS `/Users/dev/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
