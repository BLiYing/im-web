# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

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

> 更早的已完成块已移入 [current_task.archive.md](current_task.archive.md)（只读归档）。

## 下一步
0. **D4-3b：主进程 SQLite 实现 + 桥**（判据已备好：照 `sdk/localStore.types.ts` 实现一套
   `LocalStore`，让 `localStore.contract.ts` 那 39 条对它也跑绿，再把 `pickStore()` 改成
   `desktopLocalStore() ?? webLocalStore`）。三个雷都写在接口注释里：**整页写必须是一次 IPC**、
   **字段逐列建全**、**`LIKE` 不许换成 FTS5 分词**。既有 IndexedDB 数据**不迁移**（DESKTOP_DESIGN §7.6.3）。
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
