# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

> **网络恢复秒连（2026-08-30；`tsc -b` + **vitest 676 全绿**（+4：wakeActionFor）；**未在浏览器手测**）**：
> 原先断网恢复后最坏要等完 16~30s 的指数退避档才重连。
> - 新 `src/sdk/wake.ts`：判据纯函数 `wakeActionFor(state, manualClose)`（与 iOS `IMSocketWakeActionFor` 同口径）
>   + `installWakeListeners`（`online` / `visibilitychange`，返回拆除函数）。三条"不该做"逐条有单测：
>   manualClose 后不连、连接中不连、已连接只 `probe` 不重连。
> - `IMClient` 只留薄入口 `reconnectNow(reason)`；监听在 `connect`/`connectWithToken` 装、`disconnect` 拆——
>   **换号会新建 IMClient 并断开旧的，不拆则旧实例跟着醒来重连**，把已作废的会话拉回来
>   （这个坑 2026-08-22 以"旧 client 拿已吊销 token 探活把新会话踢回登录页"的形态出现过）。
> - **代价**：`check-file-size.sh` 里 `imSdk.ts` 预算 1450 → **1465**。判据与 DOM 监听都已抽到 `wake.ts`，
>   类里剩的是接线口（连接活性本就是这个类的职责），再往外拆就是为凑数字硬拆。**这是一次"只准降不准升"的破例，
>   记在这里等复查。**

> **`UI_COLOR.md` 收敛为「跨端主文档 + 本端补充」（2026-08-30，纯文档）**：本端这份开头一直写着
> 「由 iOS 那份同步并适配」——是**复制**不是引用，109 vs 120 行早已分叉。现在跨端共同规则
> （语义令牌总表、文本层级、页面/卡片/输入口径、聊天个性化、深色验收清单、检查清单）搬进
> `../IMServer/docs/UI_COLOR.md`，**本端只留 Web 平台特有**：`:root` 声明纪律与迁移期别名、
> **卡片/Modal/浮层菜单三层用色不可互借**（`--glass-menu-*` + `@supports` 兜底）、根壁纸层唯一性、
> `--app-gap` 桌面布局、深色具体取值（`#242424`/`#1f1f1f`、选中态 24%/32%）、PWA 图标。
> 109 → 69 行。`CLAUDE.md`/`AGENTS.md`/`CODING_STYLE.md` 的指引**不用改**——本端这份第一句就指向主文档
> （与 `docs/LOGGING.md` 同一套分工）。

> **无进行中的开发项。** 2026-08-30 三批（单聊资料卡收口 5 条 / 群系统消息可读性 2 条 /
> 转发选择器排除系统通知）**用户已验收通过并提交**；细节转入 `current_task.archive.md`。
> 仍**未做**的是「下一步」里那几件：浏览器手测语音、转文字 P2 调研、网络恢复秒连、列表虚拟化。

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
