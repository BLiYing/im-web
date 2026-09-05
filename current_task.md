# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **建群两步流 ✅ 2026-09-05**（与 iOS 同批落地，后端零改动）。`CreateGroupModal` 拆成两步：
> ① 好友多选（内容一字未改，按钮「创建」→「**下一步**」）② 群资料——
> **群头像 / 群名（必填、预填「我、A、B」）/ 成员 chips（可 ✕，不可删到 0）**。
> 头像走既有 `setCropReq` + `uploadAvatar`，拿到 URL 只写回草稿（**群还不存在**，不像
> `pickGroupAvatar` 那样调 `updateGroup`），点「创建」时随 `createGroup(…, avatarUrl)` 一起发——
> **SDK 那个第 4 形参一直在，此前恒传空串**。设计稿见
> `../IMServer/docs/design/sketches/GROUP_CREATE_UX_SKETCH.html`。
>
> **两条值得记的**：
> ① **预填群名只能用公开名（昵称），不能用 `displayNameOf()`（备注优先）**——群名会发到服务端、
> 进系统消息、显示给全群，用备注＝把私下称呼广播出去（同合并转发标题那次 P0，`docs/UI.md` 红线）。
> 新 `src/groupName.ts` 因此只收 nickname/username/uid **三件套**；我自己那一位取 `myInfo.nickname`。
> **成员 chips 上显示的名字仍走 `friendLabel`（认备注）**，两者刻意分叉。
> ② **「＋ 添加」＝ `setStep(1)`**，与「上一步」同一个动作——不另做加人 UI，
> 那等于把搜索/全选/上限截断再抄一遍。草稿是唯一状态源（`createDraft` 加了
> `avatarUrl` / `nameEdited`），来回切不丢；`nameEdited` 为真后增删成员**不再覆盖**用户改过的群名。
>
> 新 CSS 全部只服务第二步（`.create-modal` 360px / `.create-profile` / `.create-name` /
> `.field-count` / `.member-chip` / `.create-head|step|hint` + `.edit-avatar.sm` 修饰），第一步样式没动。
> `tsc -b` 干净 + **vitest 922 全绿**（`groupName.test.ts` 9 例与 iOS 用例逐条对应，
> `GroupPickers.test.tsx` 新增 7 例两步流）。
>
> **浏览器实测（用户点名要求）抓到一条 CSS 特异度坑**：计数「18/30」**压在群名文字上**——
> `.create-name-input` (0,1,0) 被既有的 `.modal input` (0,1,1) 盖过，我留给计数的
> `padding-right:46px` 被打回 12px。改成 `.create-modal .create-name-input` (0,2,0)。
> **`.modal input` 正是 CODING_STYLE §九 点名的「容器 + 裸标签」反模式**，这次反过来咬了新代码一口——
> 以后在 `.modal` 里加控件，选择器一律带上自己那层容器类。
> 另修：「至少选择一位好友」提示会滞留，改为群名一改就清。
>
> 实测跑通：两步流全程、预填名（我打头）、末两字头像圈、「＋添加」回第一步且勾选保留、
> 删成员重算预填名、删到最后一位被拦并红字提示、全空白群名「创建」置灰、建群后弹窗关闭并进新群会话。
> **用户复测报「设不上群头像」→ 又一条 z-index 坑（已修并验通）**：`AvatarCropper` 与建群弹窗
> **都用 `.modal-mask`（z-index:50）**，同层时后出现的那个赢——而 `AvatarCropper` 在 `App.tsx` 里
> 排在建群弹窗**之前**，于是裁切窗被埋在下面，「确定」点不到 → **Web 端群头像根本设不上**。
> 修法：`.avatar-cropper-mask` 提到 `z-index:60`（它是从别的弹窗里拉起来的，本就该盖在所有弹窗之上）。
> **这次头像上传真的验通了**：绕开原生文件框——往那个 `<input type=file>` 注入一个 canvas 生成的 File
> 再派发 change → 裁切窗浮在最上层、「确定」可点 → 拿到 `/avatars/…jpg` → 建群后会话列表那行的头像就是它。
> 同批：预填群名**不再补「…」**（与 iOS `IMDefaultGroupName` 同步，单测一起改）。

> **上一批（2026-09-05，已提交 `55cc1cd`）**：发消息必回最新一窗并贴底 / 转文字撑高后补进视口 /
> 记录卡与名片同宽（`--card-bubble-w`）。前两条已在浏览器实测。

> **体量**：App.tsx 3760（本轮 +4：建群弹窗的三个新 prop 与一段注释），闸棘轮仍 **3770**，未动。

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
