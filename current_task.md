# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **用户实测第四批 ✅ 2026-09-05**（发送后不滚到最新 / 转文字看不见 / 卡片宽度不齐，三条一起改）。
> `npm run build` 干净 + **vitest 907 全绿**；卡片宽度与转文字补视口两条**已在浏览器实测**。
>
> **① 在历史里发消息 → 窗口与滚动都不动**（用户："浏览到列表中间时发消息，iOS 会滚到最新，Web 不会"）。
> 两处同时失效：**(a)** 渲染窗口停在历史某段时，新发的那条落在"最新"那一段、根本不在窗口里；
> **(b)** 滚动 layout effect 的判据 `lastMine && (grew || wasNearBottom)` 跨窗口移动时必然为假——
> `grew` 是**按条数比**的，锚点窗（≤600）换到尾窗（200）反而**变短**，而人在历史里 wasNearBottom 也是 false。
> 修法：**收口到出箱消息的唯一回显入口 `appendMsg`**（文本/媒体/语音/转发/名片都走它）——
> 目标是当前会话就把窗口拉回贴最新 + 置 `sendStickRef`，layout effect 里**无条件贴底**且早于所有分页保位分支。
> 此前只有 `send()`（文本）复位窗口，发图/发语音/转发/发名片全没有；顺带去掉 `send()` 里那句，
> 它连**编辑历史消息**（走 msg_op、不 append）都会把窗口拽回贴最新。回归：`App.locate.test.tsx` 新用例（已验反路）。
>
> **② 语音转文字：末条是语音时，转出来的文字挂在视口下沿之外**，必须手动再滑一下才看得见（两端同病）。
> 面板是**后**长出来的：条数与窗口签名都没变，滚动 effect 这一轮压根不重跑（与媒体加载同一类）。
> 新 `useVoiceTranscript.ts`（顺带把转文字那一族从 App.tsx 抽出，§7①：`transcripts` 只被这族读写）
> 里加一个 layout effect：按 `revealDelta`「该行底部露出多少就补多少」——已完整可见则**一步不动**
>（在历史里转写中间某条不该被拽走），行比视口还高时最多补到行顶贴容器顶，**收起不滚**。
> 浏览器实测：面板展开使行高 +27px，scrollTop 430→446，行底恰好回到容器底沿。
>
> **③ 聊天记录卡片与个人名片不同宽**（220 vs 232，上下相邻一眼看得出）。抽令牌 `--card-bubble-w: 232px`
> 两处共用（实测两张卡都是 232px）；`docs/design/CONTACT_CARD_DESIGN.md §8.3` 同步。
>
> **iOS 同批**（`IMChatViewController+Voice.m`）：`im_applyTranscriptText:` 应用前记 `isNearBottom`，
> 应用后贴底 / 或 `ScrollPositionNone` 最小位移露全该行（`animated:NO`——动画滚动每帧触发
> `maybeLoadOlder/NewerOnScroll`，插行会把落点带偏）。**按用户要求只编译未跑模拟器**。
>
> **本轮体量**：App.tsx 3776 → 3756（转文字族抽走 ~50 行、本轮新增 ~30 行），闸棘轮 3790 → **3770**。

## 下一步
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
