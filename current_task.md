# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

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
- **登录寿命口径（2026-09-06）**：access token 24h；`refresh_token` 180 天绝对寿命、**续期不刷新**，
  唯一轮换点是改密码（`changePassword` 必须接住响应里那枚新的，不接住本地这枚当场作废、
  下次冷启动就被弹回登录页）。**WS 连着 ≠ token 有效**——服务端只在握手校验，别拿连接状态当续期依据。
- **凭据存在 localStorage**（XSS 可读，与存密码相比仍是净改善：可吊销、不能改密码、不能登其它端）。
  更强的做法是 httpOnly cookie，需要后端配套，未做。

## 关联工程 / 常用命令
- 后端 `/Users/liying/IOSProject/IMServer`；iOS `/Users/liying/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
