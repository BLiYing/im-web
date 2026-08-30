# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **收藏页 / 详情页 / 置顶 / 记录卡 五项 UI 修复（2026-08-30，与 iOS 同步；`tsc -b` + **vitest 681 全绿**
> （+3：置顶 voice/chat_record 两例、记录条目 voice 预览一例）；**未在浏览器手测**）**
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

> **记录卡三个后续（2026-08-30 用户实测报，已修；`tsc -b` + vitest 681 绿）**
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

## 下一步
1. **浏览器手测语音**（重启后端后）：Safari 录制（Chrome 无 audio/mp4 支持入口置灰属预期）→ 发送立即显示气泡；收发波形/scrub/倍速；详情语音 tab；收藏语音播放 + 从收藏发送。
2. Web 转文字 P2 方案调研（Whisper.wasm on-device vs 服务端 ASR）。
3. 群内已读细化（随主线）。
4. 消息列表虚拟化；测试债：Playwright E2E。

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
