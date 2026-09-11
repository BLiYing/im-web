# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

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
   **接下来是 C4**（↓ 跳到底 / 实时跳号 / conv_bump，OFFLINE_BACKLOG_DESIGN §4.8）。
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
- 后端 `/Users/liying/IOSProject/IMServer`；iOS `/Users/liying/IOSProject/IMProgram`。
- 开发：`npm run dev`（:5173，已代理 `/api`、`/ws` → :8080）；构建：`npm run build`（tsc -b + vite）。
- 回归：`npx tsc -b && npx vitest run`。
- SDK/UI 分层：协议能力在 `src/sdk/`，组件只调它；排序去重按 `conv_seq`（发送态用 client_msg_id）。
