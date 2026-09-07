# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 当前焦点

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
