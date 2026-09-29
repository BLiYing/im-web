# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **通知与提示音 P0 ✅ 代码完成（2026-09-29，浏览器 gm0100 已验证核心交互，未接后端实测收发）**：
> 设计 `../IMServer/docs/design/NOTIFICATIONS_DESIGN.md`；30 条共用判据向量 `alert_decision.json`。
> - **新文件**：`src/notifySettings.ts`（模型 + `im.notif.v1` localStorage 持久化，per-field 回落 + Hook）、
>   `src/alertDecision.ts`（纯函数，30/30 向量绿）、`src/alertPlayer.ts`（预加载 Audio、ogg→mp3 兜底、
>   1.5s 节流 + 试听不节流）、`components/settings/NotificationsPanel.tsx`（一页平铺，浏览器版桌面通知行
>   降级占位、例外列表合并私聊+群聊）。
> - **接线**：`useDesktopIntegration.ts#notifyInbound` 改走 `alertDecision`（不再是原地判断的 `shouldNotify`，
>   那个函数现在是薄封装、保留给窄场景/旧测试）；桌面 `shellCaps.ts#notify` 加 `silent:true`（声音统一由本页控制，
>   不再叠系统默认音）；`desktopNotify.ts#badgeCountOf` 加 `includeMuted` 入参（默认 false=现行口径），
>   `SidebarTabs`/`useDesktopIntegration` 两个调用点都接了 `notif.settings.badge.includeMuted`。
> - **Web「静音」改「免打扰」**（决策 §9-5）：`web.conv.menu.mute/unmute` 生成物已改中文值，`src/menus.ts`
>   删掉解释「为何不同」的旧注释、doc comment 里的「静音」字样一并改成「免打扰」。
> - **测试**：新增 `notifySettings.test.ts`(11) / `alertDecision.test.ts`(34，含 30 条向量) /
>   `alertPlayer.test.ts`(8) / `useDesktopIntegration.test.ts`(12) / `NotificationsPanel.test.tsx`(10) +
>   `desktopNotify.test.ts` 补 2 条；`npm run build` 零错误，`npx vitest run` **1591/1591 绿**（含 desktop 端
>   `npm test` 116/116）。关键分支（notifyInbound 接线、音量滑杆 onChange/onMouseUp 分工）都先红后绿验证过——
>   后者过程中真的抓到一个 bug：React 给 `<input type=range>` 的 `onChange` 实际绑的是原生 `input` 事件而非
>   `change`，「拖动只刷新数字、松手才提交+试听」必须靠 `onMouseUp`/`onTouchEnd`/`onKeyUp` 才成立，已修。
> - **浏览器验证**（gm0100，:5174 无会话）：设置 ▸ 通知 主页/例外列表/重置确认弹窗渲染与交互都过，
>   `包含免打扰会话` 开关切换即时生效、重置能恢复默认、刷新页面设置不丢、控制台无报错；截图见
>   `/private/tmp/claude-502/-Users-dev-IOSProject-im-client/02a2407d-ade3-4d4c-b18b-26026d267944/scratchpad/web-notif/`。
>   **未测**：真实收发消息触发 `alertDecision` 全链路（该账号无好友/会话）、提示音 `<select>` 原生下拉
>   （自动化点不动系统级 popup）、桌面 Electron 壳里的 `silent:true` 实际效果（未跑 `npm run dev`/打包）。
> - **已知缺口**：① `notif.exceptions.empty_private` 被借用当 Web 合并例外列表的空态文案（私聊+群聊合并，
>   没有对应的「合并空态」i18n key，未回写 IMServer 源表——若日后要精确文案需新增 `notif.exceptions.empty_all`
>   之类的 key）；② P1 范围明确不做：应用内横幅、定时免打扰、「添加例外」入口、移动端 `inApp.*`
>   （本端无移动壳，字段留着但 UI 不碰）。
> - **App.tsx 体量收口 ✅（2026-09-29，随本轮一起处理）**：通知接线把 App.tsx 顶到 3695 行，超出
>   `check-file-size.sh` 登记的 3679 天花板。把设置页体系的 12 个子面板路由（SettingsPanel/DataStoragePanel/
>   EditProfilePanel/DevicesPanel/PrivacySecurityPanel/BlockedListPanel/ChangePasswordPanel/GeneralPanel/
>   NotificationsPanel/LanguageSettings/WallpaperPanel/WallpaperColorPanel）整体抽到新文件
>   `components/settings/SettingsPanelsHost.tsx`（CODING_STYLE §7 决策树②）——不只搬 JSX，`onReset`/`onSubmit`/
>   `onOpenConv` 等胶水回调体也随迁，改经 `useAppServices()`/`useT()` 直接取 `clientRef`/`setToast`/`comingSoon`/
>   `askConfirm`/`t`，App 侧收窄成一次组件调用（~30 行 props 透传）。App.tsx 3679 → 3559 行；天花板棘轮
>   3679 → 3579（脚本注释登记依据）。拆成两个提交：`refactor(web)` 先落地（11 个面板，不含通知）、
>   `feat(web)` 通知本身把第 12 个面板（NotificationsPanel）接进同一个 host。

> **六条用户报告第 6 项：消息列表补常驻可见滚动条 ✅（2026-09-29，浏览器截图验证）**：
> 系统原生滚动条在 macOS「滚动时显示」偏好下是覆盖式 overlay，只在滚动瞬间一闪而过（实测
> `.msgs` 的 `offsetWidth === clientWidth`，确认即使给 `::-webkit-scrollbar` 定制样式，Chrome
> 仍按 overlay 处理、不占布局空间——样式管得了颜色形状，管不了这条系统级淡入淡出策略），用户
> 报告"看不出能滚"。改用自绘常驻滑块，思路对齐 Android `chatScrollbar`（Canvas 直绘、不依赖
> 系统滚动条）：
> - 纯函数 `src/chatScrollbar.ts` 的 `scrollbarThumb(scrollTop, scrollHeight, clientHeight)`
>   （Web 有真实 DOM 尺寸，比 Android Compose LazyColumn 只能估算简单，判据一致：一屏放得下
>   不显示、内容超长滑块不低于 `SCROLLBAR_MIN_THUMB_PX=24`），4 个用例。
> - `components/ChatScrollbarThumb.tsx` 直接操作 DOM 而不进 React state（滚动事件每帧可能触发，
>   走 setState 会带着消息列表一起高频重渲染）；`scroll`/`ResizeObserver`/`MutationObserver` 三路
>   触发重算（后者补"顶部插入更早历史"这类不一定触发 scroll 事件的内容变化）。
> - **踩坑两处**：① 滑块最初用 `position:absolute` 挂在 `.msgs`（滚动容器）内部，结果跟着内容
>   一起被滚出视口——绝对定位元素若挂在会滚动的祖先内部，仍在其滚动内容流里。改 `position:fixed`
>   （配 `getBoundingClientRect()` 换算视口坐标）。② 改完 `fixed` 仍不对：`.msgs` 自己带
>   `transform: translateZ(0)`（滚动性能用的 GPU 层提升，不能去掉）——CSS 规则是祖先一旦有
>   `transform`，就成了 `position:fixed` 后代的 containing block，`fixed` 退化成相对**那个祖先**
>   定位，坐标全偏移了 `.msgs` 自己的位置（实测复现：滑块套了两次偏移量，落到视口外）。最终用
>   `createPortal` 把滑块挂到 `document.body` 下彻底避开这条 containing-block 坑（组件在 React
>   树里仍是 `.msgs` 的子节点，只是 DOM 输出改道）。
> - 隐藏原生滚动条（`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`），否则滚动瞬间
>   系统 overlay 会和常驻滑块叠成两条。颜色新增令牌 `--scrollbar-thumb`（text-tertiary 转 rgba
>   0.45/0.55，对齐 Android `c.textTertiary.copy(alpha=0.4f)`）。
> - `npm run build` 零错误；`npm test` **1514/1514 绿**（新增 4 例）。**浏览器验证 ✅**：
>   Chrome 截图确认滑块常驻可见（不用等滚动瞬间）、随滚动位置正确移动。
> - **iOS 不需要动**：原生 `UITableView` 指示器实测本就在滑动时清晰可见（XCUITest 截图确认），
>   只是**瞬态**——这是 iOS 全系统统一的滚动条行为（Apple HIG，Messages/Mail/设置等系统 App
>   同款），做成常驻反而破坏平台一致性，不是缺口，未改代码。

> **最近通话验收修复（2026-09-29，浏览器 user1001 已验，已提交 `2e15469`）**：群行改用群会话真实头像（新增
> `groupAvatarOf` prop，App 传 `convAvatarUrl(convById(cid))`，`seed=conv_id` 同会话列表），删掉统一渐变
> 人形图标与 `.callh-avatar-group`；按 UX 稿补行分隔线（左缩进 66）、行内边距 9、名字 15.5、分组头上边距 14。
> `npm run build` 零错误，vitest 1510/1510。
> 第二轮：头像卡片菜单「最近通话」去掉 `iconTint`（原来渲染成彩色方块，比「设置」「收藏消息」大一圈）；
> 分段控制轨道改 `--subtle-fill`（原 `--page-bg` 与弹窗同色看不出轨道），未选中改主文字色，对齐 iOS/Android。

> **「设置 ▸ 最近通话」页 ✅ 代码完成（2026-09-28，worktree `im-web-wt-call-history` / 分支 `feature/call-history`，已提交未 push；浏览器未手测）**：
> 设计见 `../IMServer/docs/design/CALL_HISTORY_DESIGN.md` + 配套 UX 稿；先例 `CALL_RECORD_DESIGN.md`（同一套身份解析/未接判色领域逻辑）。
> - **入口**：`App.tsx` 头像卡片菜单 `accountRows` 新增「最近通话」行（复用既有翻译 key `ios.settings.row.recent_calls`、绿色 `iconTint`，紧邻「收藏消息」），点开 `CallHistoryPanel`。
> - **数据**：`engine.fetchCallHistory` 直连 im-rtc SDK（不经 IMServer）。engine 实例此前只活在 `RtcHost` 内部——新增模块级出口
>   `src/rtc/rtcCall.ts#registerCallEngine/getCallEngine`（与既有 `registerCallActions` 同一套模式），`RtcHost.tsx` 起停引擎时登记/反登记。
> - **纯逻辑** `src/callHistoryView.ts`（+`callHistoryView.test.ts` 24 例）：未接判定（`caller!==我 && durationSec===0`，
>   刻意不排除被叫侧 reject——设计文档 §0.6/§4/§6 明文的 v1 简化，与聊天气泡 `callRecord.ts` 的 tone 判据不同，二者是有意分叉，非疏漏）、
>   日期分组（复用 `time.ts#dayHeader`）、群通话人数（对齐 im-rtc-web Demo `peerText` 公式）、「未接」tab 自动续页判据、
>   单聊文案**复用** `callRecord.ts` 的 `buildCallRecord+renderCallRecord`（不重写 reason 判定），群聊文案自拼「群{kind}通话 · N人」（UX 稿要的是这个，不是气泡的叙述句）。
> - **状态簇** `src/useCallHistory.ts`（+`useCallHistory.test.ts` 4 例，含红→绿验证过的 generation 计数器乱序应答测试）：
>   首页/游标翻页、`callEnd` 重拉首页并作废在途翻页请求、401→`auth` 错态复用「未登录」文案（不单独造一套）。
> - **UI** `src/components/CallHistoryPanel.tsx`：Modal 壳（同 `FavoritesModal` 开合模式）、全部/未接分段、滚动到底自动翻页、
>   三态（loading/empty/error+重试）、点单聊行 `placeSingleCall`（与聊天气泡回拨同一入口）直接回拨不确认、点群聊行 `openGroupChat` 跳会话并关面板。
> - `tsc -b` 干净、`npm run build` 零错误、`vitest` 全量 **1507/1507 绿**（新增 28 例）、`check-file-size.sh` 通过（新文件均 < 150 行；`App.tsx` 净增 ~20 行，3676/3679，已逼近体量基线，新逻辑别再往里塞）。
> - **i18n**：新增 `call.history.*` 六键直接手改 `src/i18n/locales/{zh-Hans,en}.json`——**未**回写 `../IMServer/docs/i18n/strings.json`
>   （该生成脚本本 worktree 未见，且改跨仓共用源有跟其他并行改动冲突的风险，故先落地在本端生成物上；下次有人跑生成流程前记得把这六键补进源表，否则会被覆盖）。
> - **未做 / 待浏览器实测**：① 滚动到底自动翻页的真实手感；② 「未接」tab 自动续页在慢网络下的观感（连续请求会不会看起来卡顿）；
>   ③ `callEnd` 到达时面板开着重拉首页的真实时机（自动化测试只验了 generation 语义，没验真事件时序）；④ 群通话行点击跳转到正确会话；
>   ⑤ 深色模式下 `.callh-*` 新样式；⑥ 未在 `App.smoke.test.tsx` 之外补组件级渲染测试（时间/耦合原因，纯逻辑+状态簇已覆盖核心分支）。
>   **v1 范围内刻意不做**（设计文档 §0.4/§0.6 已拍板，不是漏做）：删除、长按菜单、未接数量角标、群通话「进行中可加入」。
> - 未动 `../IMServer/docs/CLIENT_PARITY.md`（三端并行，留给协调者统一收口）；未改 IMServer 后端、未改 im-rtc SDK。

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
5. **「设置 ▸ 最近通话」浏览器实测**（见「当前焦点」未做清单）：滚动自动翻页手感、「未接」tab 续页观感、`callEnd` 重拉时机、群聊跳转、深色模式；
   `call.history.*` 六个 i18n 键待补进 `../IMServer/docs/i18n/strings.json` 源表（本端先手改了生成物，见「当前焦点」）。

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
- **`call.history.*` 六个 i18n 键只手改了 `src/i18n/locales/{zh-Hans,en}.json`，没回写 `../IMServer/docs/i18n/strings.json` 源表**——
  该生成脚本本 worktree 未见；下次有人跑 i18n 生成流程前先把这六键补进源表，否则会被生成物覆盖冲掉。
  更强的做法是 httpOnly cookie，需要后端配套，未做。

## 关联工程 / 常用命令
- 后端 `/Users/dev/IOSProject/IMServer`；iOS `/Users/dev/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
