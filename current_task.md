# Current Task — im-web（Web 客户端，React+TS+Vite）

> **活快照**：只记当前状态，**就地覆盖、不追加**。逐功能×端状态以 `../IMServer/docs/CLIENT_PARITY.md` 为唯一来源；
> 历史流水见 `current_task.archive.md` + `git log`。聊天交互蓝图以 `../IMServer/docs/CHAT_UX.md` 为准。

## 技术债 / 下次
- **`src/App.tsx` 已 6000+ 行单体组件，迟早要重构**（2026-08-14 记）。症状：改一个小格子就得动这个巨文件、抽组件发怵、
  重渲染面巨大、代码里已出现「须在使用前定义避免 TDZ」这类顺序耦合。**建议单独立项、分批做**：先抽叶子组件
  （`MessageBubble` / `MediaViewer` / `MediaTile` / `DetailPanel` / `Gallery`）+ 自定义 hook，每步跑 vitest（现 271 例是安全网），
  **不要**塞进业务需求里顺手做（那最容易引回归）。近例：会话媒体库 `gallery-item` 与详情 `detail-media-tile` 现有 ~15 行重复渲染，
  可优先抽一个共享 `<MediaTile>`。

## 当前焦点

**设置页优化四项（2026-08-15，tsc + build 绿，待浏览器手测）** — 纯前端（`src/App.tsx` + `src/styles.css`）：
- **① 卡片字号等比放大**：`.settings-row/.menu-card-row/.entry-row` 14→15.5px、gap 8→12、padding 11；`.row-value` 13→14；`.section-label` 12→13；`.settings-name` 18→20、`.settings-status` 13→14；`.settings-logout` 15→16；`.switch-row/.media-card-title` →15.5；`.tier-btn` →15。
- **② iOS 风格图标色块**：`Row` 加 `iconTint?`，`renderRow` 有 tint 时渲染 `.row-icon-tile`（29×29 圆角7 + 白 glyph，`size=17`），否则裸图标（账号气泡卡不变）。色块色抽成 `--ic-{gray,red,orange,yellow,green,teal,blue,indigo,purple,pink}` 令牌（三套主题分支都加，深色略提亮）。分色对齐 iOS `IMSettingsViewController`：通用gray/动画orange/通知red/数据green/隐私indigo/文件夹blue/设备teal/语言purple/表情pink；资料卡 手机green·用户名blue·二维码gray；通讯录 群聊blue·公众号orange·服务号teal。退出登录仍无图标（对齐 iOS 红字无 tile）。
- **③ 数据与存储可读性**：`.settings-foot` 12→13px + 行高 1.45→1.55 + 上下留白；`.range-scale` 11→12；`.media-card-hint` 12→13；开关 checkbox 18→20。
- **④ 返回/编辑按钮加大**：所有设置返回 `ChevronLeft` 24→27、设置页编辑铅笔 `SquarePen` 20→24；`.settings-head .icon-btn` 32→38（**仅设置头**，聊天头不受影响）、`.icon-btn-spacer` 32→38。
- 预览：静态 settings-preview.html（浅/深）已发用户核对。

**壁纸改版（深色默认）+ 色板脱节修复（2026-08-15，tsc + 291 vitest + build 绿，待浏览器手测）** — 纯前端（`src/App.tsx` + `src/styles.css` + `appearance.test.ts`）：
- **壁纸目录重做**：`WALLPAPER_PRESETS` 换成 14 张分层柔和渐变（6 浅：dawn/mint/blossom/sky/sand/meadow；8 深：midnight/aurora/nebula/abyss/ember/twilight/forest-night/graphite），每张多层 radial 光晕 + linear 底、低对比保证气泡可读；加 `tone` 字段。
- **深/浅默认随主题**：新增 `WallpaperChoice` 第 4 种 `{kind:"auto"}`（新默认）；`DEFAULT_WALLPAPER_LIGHT="dawn"` / `DEFAULT_WALLPAPER_DARK="midnight"`；抽 `resolveWallpaper(choice,isDark)`，`wallpaperCSS(choice,isDark?)` 按明暗解析 auto。`isDark = theme==="dark" || (theme==="system" && systemDark)`，`systemDark` 听 `matchMedia(prefers-color-scheme)`；壁纸 effect 依赖 `[wallpaper, isDark]` → 明暗切换自动换默认壁纸。壁纸格高亮用 `resolveWallpaper` 后的选择；壁纸面板加 `.wallpaper-hint` 说明「默认跟随明暗，点恢复默认切回跟随」。**注意**：老用户 localStorage 里已存了具体 preset（旧 effect 每次挂载都持久化），需点一次「恢复默认」才切到 auto。
- **色板脱节修复**（用户报 bug）：根因 `styles.css .color-spectrum{--picker-hue:156}` 就地重声明遮蔽了父卡片 JSX 写入的动态 `--picker-hue` → 色板底色永远卡在 156 绿、与色相滑块/预设脱节。改：删掉 `.color-spectrum` 的重声明，兜底默认移到 `.color-editor-card`。滑块/预设/HEX 早就联动（同一 `colorHSV` 态），只是色板背景没跟着变。
- **测试**：`appearance.test.ts` +2 例（auto 解析浅/深默认、两默认 id 存在于目录、非 auto 透传）。

**弹窗视觉打磨 ✅（2026-08-14，tsc+build 绿，用户自测通过）** — 纯 CSS（`src/styles.css`）+ 文档同步（`docs/UI_COLOR.md`）：
- 转发弹窗：`.modal-close`（7 处「取消/关闭」底部按钮共用，原本无 CSS＝无圆角）补成整幅次要按钮（圆角 `--radius-card`+`--surface` 承托底色+hover）；`.fwd-title .section-action`「多选」字号 12→15px 对齐标题「转发…」。
- 模态圆角统一：`.viewer-unplayable`/`.gallery-panel`(12px)、`.avatar-cropper`(18px) → 一律 `var(--radius-card)`。
- 磨砂玻璃复用：合并规则 `.ctx-menu,.menu-card,.viewer-more-pop,.mention-panel` 复用 `--glass-menu-*`（与 `.attach-popover` 同一套）+ `backdrop-filter: blur(24px) saturate(165%)`，删掉各自不透明 `--surface-elevated`/`--separator` 底。命中：长按/右键消息·会话·文件/媒体·删除子·好友·成员菜单(`.ctx-menu`)、账号·聊天标题·资料卡「更多」(`.menu-card`)、查看器「更多」(`.viewer-more-pop`)、@提及面板(`.mention-panel`)。
- **圆角/阴影抽令牌统一**（以长按菜单 8px 为基准）：新增 `--radius-menu:8px` + `--shadow-menu:0 4px 16px var(--shadow-strong)`，进合并规则、从各自规则删重复值（`.menu-card` 阴影 `0 8px 32px`→统一、`.mention-panel` 圆角 10→8px）。`.attach-popover` 大快捷面板保留 28px/大阴影（另一类，未并入）。
- **兜底**：`@supports not (backdrop-filter…)` 时上述菜单（含 `.attach-popover`）退回不透明 `--surface-elevated`+`--separator`，避免半透明无模糊透字。
- **规范同步**：`UI_COLOR.md §5` 改为「悬浮菜单/Popover 统一玻璃 + 必须带 @supports 兜底；Modal 仍 `--surface-elevated` + `--radius-card`；玻璃令牌不下放卡片/模态」。


**QRCODE P0 + 群组 G3 入群 ✅（2026-08-13，tsc + build + 249 vitest 绿 + HTTP E2E 全通，待浏览器手测）** — 方案 `../IMServer/docs/QRCODE_DESIGN.md` / `GROUP_FEATURES_DESIGN.md` §4-G3、草图 `QRCODE_UX_SKETCH.html`。
- **依赖**：新增 `qrcode`（出码，本地生成 PNG）+ `jsqr`（图片/摄像头解码）+ `@types/qrcode`。**bundle 因此 398→572KB**（超 500KB 告警，非错误；后续可 `React.lazy` 拆 `QRUI`）。
- **SDK**（`sdk/protocol.ts` 加 QR/G3 类型；`sdk/imSdk.ts`）：`qrMyCard`/`qrResetMyCard`/`groupQR`/`groupQRReset`/`qrResolve`/`joinGroupByCode`/`fetchJoinRequests`/`decideJoinRequest`；`api()` 把 errcode **挂到 `Error.code`**（join 300210/码失效 200110 要按码分支）；`onGroup` 回调加第 5 参 `result`（join_result 用）；`friendlyMessage` 加 200110/300207/300208。
- **纯逻辑**（`src/qr.ts` + `qr.test.ts` 15 例）：`userCardAction`/`groupCardAction`/`classifyUnknown`/`errorCode` + `decodeImageData`/`decodeImageFile`/`drawToImageData`（jsqr 封装）。
- **UI**（`src/QRUI.tsx` + `App.tsx` 接线）：① 侧栏搜索框右侧 QR 图标 → **扫码浮层**（摄像头取景 + 上传/拖拽/⌘V 粘贴图片；无摄像头/非 HTTPS 只留图片通道；权限被拒引导）；② **我的名片码 / 群二维码模态**（本地生成 QR、下载 PNG、复制链接、重置带二次确认）；③ **resolve 四分支**（名片=加好友/发消息/看资料、群预览=加入/需审批带附言/进群/满/黑名单、失效码=`200110` 提示、外来码=域名加粗二次确认不自动跳转）；④ **G3**：群管理「治理」卡加「待审入群申请(N)」→审批列表（同意/拒绝），`onGroup` 处理 `join_request`(重拉列表/刷 `pending_count` 角标)、`join_result`(通过/拒绝 toast)。
- **入口**：侧栏 QR 图标（扫一扫，含「我的二维码」快捷）· 设置页「我的二维码」行 · 群资料抽屉「群二维码」行 · 群管理「待审入群申请(N)」。
- **`/code-review` 修复（2026-08-13，三仓 5 项全修，Web 占 2 项；tsc + 249 vitest 复跑绿）**：
  ① `resetQRCard` 补 try/catch + 失败 toast——模态里的确认按钮只有 try/finally，重置失败会变成未处理的 rejection 且界面毫无反馈；
  ② `handleFile` 捕获 `decodeImageFile` 的 reject——拖拽/粘贴进非图片文件（PDF/压缩包）时 `accept="image/*"` 拦不住，
  原先静默无反应，现提示「这个文件读不出图片」。另三项在 IMServer（邀请入群原子上限）与 iOS（扫码会话竞态 / 名片码页签只显 uid）。
- **已知限制**：① ~~图片识别用 jsqr 单码~~ ✅ **一图多码候选点选已做（2026-08-14）**：BarcodeDetector 优先 + jsqr 兜底，仅 Chrome/Edge 生效（见「已知坑」）；② 群码资料抽屉入口对普通成员也显示，`perm_invite=1` 时点了由后端 300204 拦（toast），未在前端预隐藏；③ 扫码登录 `q/l`（P1）未做，扫到走 unknown。**摄像头实扫需浏览器手测**（自动化环境无相机）。**后端需重启带 QR 路由的新二进制再测。**

**G2 群治理 ✅（2026-08-13，tsc+234 vitest+build 绿，待手测）** — 方案 `../IMServer/docs/GROUP_FEATURES_DESIGN.md` §G2、草图 §04/§07。
群管理面板加三卡：加入与发言（进群确认/全员禁言开关）· 成员权限（仅管理员可邀请/改资料/置顶三开关 + 新成员可见历史）· 治理（黑名单入口）。黑名单弹窗（解除拉黑）。成员菜单加「禁言…(10min/1h/1d/永久时长选择弹窗)」「移出群聊(24h冷却)」「移出并不再允许加入(永久)」。聊天区 composer 禁言锁（`composerMuteReason`：成员级/全员禁言时禁用输入+占位）。SDK 加 setGroupSettings/muteGroupMember/removeGroupMemberWithBan/fetchGroupBans/unbanGroupMember。

**G1 群资料闭环 ✅（2026-08-12，tsc+234 vitest+build 绿，待手测）** — 方案 `../IMServer/docs/GROUP_FEATURES_DESIGN.md` §G1、草图 §04/§08。
群管理面板三行（简介/公告/全员禁言开关，删「即将上线」占位）+ 详情面板公告卡·「我在本群的昵称」·「群备注」行 + 聊天区**公告黄条横幅**（`.pin-banner.announce`，排在置顶蓝条之上）。`memberNick` 群昵称优先（气泡发送者名/成员列表/引用/@列表同步）。群备注本地存储（`localStorage im.grpremark.<uid>.<cid>`，与单聊备注同范式；后端 remark 字段就绪、多端同步后续）。SDK 加 `setGroupAnnouncement`/`setGroupMute`/`setGroupMyNickname` + `updateGroup` 扩 intro。

**G0 置顶消息横幅 ✅（2026-08-12，tsc + 234 vitest + build 绿，待手测）** — 方案/草图见 `../IMServer/docs/GROUP_FEATURES_DESIGN.md` §G0 与 `GROUP_FEATURES_UX_SKETCH.html` §03（**实现须严格对齐草图**）。
进会话拉 `GET /conversations/{id}/pinned` 回填 `.pin-banner`（竖条 + `📌 置顶消息 i/N · 发送者` + 单行预览），点条=跳转并轮转到下一条，多条时右侧 ☰ 开置顶列表弹窗（可就地取消置顶）；右键菜单加「置顶↔取消置顶」切换对（群内仅群主/管理员可见）。纯逻辑在 `src/pinned.ts`（12 例）。
**顺带修**：`applyMsgOp` 对 `op=pin` 写死 `pinnedAt: Date.now()`，把「取消置顶」也记成置顶——改为认 `data.pinned`，时间取服务端 `timestamp`。

**修 `@<uid>` 不高亮/不可点 ✅（2026-08-12）**：无昵称成员回填的是 `@<uid>`（如 `@1002`），`mentionEntriesFor` 取昵称失败时未回退 uid 就跳过了 → 改 `memberNick||uid`。

**气泡内 `@昵称` 高亮 + 点击跳资料 ✅（2026-08-12，tsc + 210 vitest + build 绿，待手测）**：`segmentMentions`（mention.ts，7 例）用消息 `mentions`+群昵称还原 `@昵称`，short/long 气泡 + 全屏阅读器均高亮（`.mention-hl`）；可点的 `@昵称`（有 uid，`@所有人` 除外）= `.mention-tap`，onClick `stopPropagation`+`openPeerDetail(uid)`，多选态不接管点击。token 边界同 `containsMentionToken`、长名优先。

**三项 UX 优化 ✅ 代码完成 + `/code-review` 7 条全修（2026-08-11，tsc + 210 vitest + build 绿，**待浏览器手测**）** — 逐端矩阵见 `../IMServer/docs/CLIENT_PARITY.md`「UX」三行。
> 审查修复：① 展开 key 加 convId（防跨会话 seq-N 串号）；② 多选态长文本不接管点击（让位选中）；③ 阈值/字数改按码点计（与 iOS 对齐）；④ `textTier` 加短消息快路径；⑤ iOS `groupedCount` 收敛到 `+charCountLabelForText:`；⑥ 删无用 `COLLAPSED_LINES`；⑦ iOS 长文引用点击先于跳转（否则永远点不开）。
1. **长文本三档显示**：`src/longtext.ts`（`textTier` + `charCountLabel`，8 例，阈值与 iOS 统一：huge `chars≥2000|lines≥60`、long `≥300|≥10`）。`App.tsx renderMessageText`——short 全显；long `.lt-body.collapsed` 夹 8 行 + `.lt-toggle` 展开/收起（`expandedTexts` 记忆）；huge `.longtext-card` 摘要卡 → 全屏阅读器 `.text-reader`（`textReader` 状态 + `readerFontStep` 字号 + 复制全文 + Esc）。CSS 全在 styles.css。
2. **视频禁复制**：`viewer-more-pop` 复制按钮 `contentType!=="video"` 条件渲染（长按菜单 `menus.ts` 本就 `isText||image`，不含视频）。
3. **媒体入口类型校验**：`fileTypes.ts mediaKindForFile`（MIME 前缀优先→扩展名回退，svg 拒收，5 例）；`onFilePicked` 媒体档过滤非图/视频并 toast。**后端 `allowedUploadExt` 仍是权威白名单**，此闸只为体验。

**任务二（IMServer 驱动）— 详情页删文件两档 ✅ 三端手测通过（2026-08-11，tsc + 165 vitest 绿）**
> 完整设计/归档见 `../IMServer/current_task.archive.md`「2026-08-11 归档④」；逐端矩阵 `../IMServer/docs/CLIENT_PARITY.md`「任务二」。
- **为所有人删除**：`sdk/protocol.ts` `OP.DELETE`；`imSdk.ts` `deleteMessageForEveryone`（WS `msg_op op=delete`）；`applyMsgOp` 收到 delete → `removeMessageLocal`（落墓碑 + `onMessageRemoved`，物理移除不显墓碑）；`processIncoming` 遇 `deleted_at>0` 目标行直接移除（不只靠事件行）。
- **仅删除自己**：`hideMessage`（`POST /api/v1/messages/hide` + 本地移除）；`fetchHidden`（`GET /messages/hidden` 登录 catch-up，uid 维度 `appliedHidden` 去重、重连不重刷）；`msg_hidden` 帧 → 本端移除。
- **UX**：`App.tsx` 详情文件右键两档——我发的/群主·管理员=【为所有人删除】+【仅删除自己】，他人=【删除】（=仅删自己）；`onMessageRemoved` 从聊天列表 + 详情文件列表移除。
- `/code-review` 5 条已全修（含 `processIncoming` 跳过 deleted_at、`fetchHidden` 去重）。

---

**（更早·待浏览器手测）媒体持久化 C1 + 持久失效标记（2026-08-07，tsc + 144 vitest 绿 + vite build 绿）**
> 对齐 iOS「原件落 sandbox 磁盘、`fileExistsAtPath` 命中即就绪」。解决两个刷新丢失：**已下载文件刷新又要下载**（含资料卡文件列表）＋ **expired 刷新变透明/条纹坏占位、重刷 404 风暴**。
- **`src/mediaCache.ts`（新）+ 6 单测**：Cache Storage 薄封装（按 uid 命名空间 `im-media-<uid>`，跨账号隔离）
  `cachePutBlob/cacheMatchBlob/cacheClear` + 持久字符串集合 `loadStrSet/saveStrSet`（末 500 封顶）+ 键 `expiredKey/downloadedFilesKey`。
  **无 `caches` 全局（Node/隐私模式）静默降级为易失内存 blob，绝不抛**。
- **C1 已下载文件持久化**：`startDownload` 成功 → `cachePutBlob` + 记 `im.dlfiles.<uid>` 键集合；登录 rehydrate（cacheMatchBlob→objectURL→dlBlobs）→ 刷新/离线仍在、秒开。图片/视频不走此路（沿用 `mediaOptedIn` + 远端 URL + 浏览器 HTTP 缓存）。
- **持久失效标记**（草图 §06 404 止损）：`expiredSet`（`im.expired.<uid>`）。命中来源两条——`startDownload` 拿 404/410；被动 `<img>/<video>` `onError` → **ranged GET 复验**（`Range: bytes=0-0`，区分「404 已清理」与「解码/瞬时」，只前者标失效）。`mediaGate` 命中即返回 `expired`、**不回源**（掐 404 风暴），三类消息统一。
- **失效占位**：气泡/查看器中心 ⊘（`.play-badge.expired`）+ 类型化文案（`downloadText(s,size,kind)`：图片/视频/文件已失效）。
- **清理边界**：`clearMediaCache` → `cacheClear` + 清 opt-in/dlfiles；**失效标记不清**（服务端已删是客观事实，清了只会再撞 404）。换账号清内存态、各 uid 各自持久化。
- **已知未尽**：相册/详情宫格的原件 `<img>` 未各自接 `onError`（靠气泡/查看器先标失效后自愈）；iOS 三条被动路径仍 ⬜（见 CLIENT_PARITY 媒体失效行）。

**修复用户手测 3 个新问题（2026-08-07，tsc + 138 vitest 绿）**
- **① 详情文件「定位到聊天」个别文件失败**（浏览器实证修复 ✅）：根因**两处**——(a) `jumpToSeq` 用 `scrollTo({behavior:"smooth"})`，本 `.msgs` 容器上方大量异步布局媒体使平滑滚动**远距离目标滚不动**（实测 scrollTo smooth 纹丝不动、`scrollTop=` 瞬时赋值可靠）；(b) 从底部跳到较早目标后，下方媒体 onLoad 触发 `onMediaLoad` 因 `wasNearBottom` 仍 true 把 scrollTop 拽回底部，定位当场被冲掉。近处文件滚动距离小所以"正常"，seq 121 需大滚动就失败。修：`jumpToSeq` 改**瞬时滚动 + rAF 校正 + 置 `wasNearBottom=false`**。另加 `locateInChat`（详情读全量本地、聊天页是分页窗口——目标不在窗口内时**自动上翻分页直到加载到再定位**；跨会话先打开会话），三处「定位」入口（详情文件菜单/查看器/引用条）统一走它。
- **② 媒体库点格后九宫格不消失**：`gallery-item` onClick 补 `setGalleryOpen(false)`（点格=关九宫格 + 开查看器）。
- **③ 查看器「更多」hover 即消失**：`viewer-more-wrap` 由 `onMouseEnter/Leave` 改**点击切换**（`setViewerMore(v=>!v)`）；点查看器图片/视频/蒙层收起弹窗。

**修复：资料卡片「媒体/文件」列表全空（2026-08-07，tsc + 138 vitest 绿，浏览器实证修复逻辑 ✅）**
> 根因（**日志锁定**：`im-web.log` 有 238 条 `conversation_load_failed` / `NotFoundError: object store not found` @`localStore.ts`）：
> `loadConversation` 开 `[messages, deletions]` 双 store 事务，但用户浏览器那条 IndexedDB 连接是**缺 `deletions` store 的陈旧连接**
> ——DB 升级到 v3 新增 `deletions` 前打开、被 `dbPromise` 模块级缓存复用（多标签页测号 / HMR 常见）→ 事务抛 `NotFoundError` → catch 返回 `[]` → 详情媒体/文件全空。
> 修复两层（`src/sdk/localStore.ts`）：① `openDB` 加 `onblocked` + `db.onversionchange`（别的标签页升级时关闭本陈旧连接并清缓存）+ 拿到缺 store 的连接则关掉重开自愈（最多 2 次）；② `loadConversation` 按 `db.objectStoreNames.contains('deletions')` 决定事务 store 列表，缺则**只读 messages**（暂不过滤墓碑也不抛错）。`markMessageDeleted`/`loadDeletedSeqs` 本就 try/catch 安全降级。
> 浏览器实证：缺 deletions 的连接上「旧写法抛 NotFoundError / 新写法正常返回」。**用户侧刷新一次页面即自愈**（openDB 升级补齐 deletions store）。

**下载门控 阶段 7 — 对齐 iOS 手测场景（2026-08-07，tsc + 138 vitest 绿；已浏览器冒烟：气泡视频/图片门控磨砂占位 ✅、数据与存储页 ✅、无 JS 报错）**
> 依据 `../IMProgram/docs/DOWNLOAD_TEST_SCENARIOS.md`（现为 iOS 基准 + §11 Web 场景/差异）逐条对齐；把原先"直连原件"的 4 处补进门控：
- **相册宫格逐格门控（档 A）**：`AlbumGrid` 加 `gateFor`——未下载格 thumb 磨砂 + 中心 ↓ + 尺寸角标，点门控格=就地解门控（`onGateTap`）非进查看器。
- **详情媒体宫格门控（档 A）**：`detail-media-tile` 加 `mediaGate`——磨砂 + ↓ + 尺寸；点门控格=解门控，就绪格=查看器（详情不自动预取，对齐 iOS `autoPrefetch=NO`）。
- **引用缩略被动预览（档 B）**：`QuoteThumb` 加 `gated`——未下载**只用 thumb 磨砂、绝不联网拉原件/poster/远端抽帧**，无 thumb 退 ▶/🖼 图标；两处调用点（气泡引用块 + 输入框引用条）都传 gated。
- **会话媒体库被动预览（档 B）**：`gallery-item` 用 `passivePreviewSource`——未下载磨砂、打开媒体库这一动作不拉原件；点某格才 setViewer 联网。
- **打开查看器 = 标记已解门控**：新增 `useEffect([viewer])`——看过的图/视频 opt-in（落 localStorage），之后气泡/相册/详情/媒体库/引用条随之显真帧、刷新仍在（对齐 iOS「点某格才拉原件」）。
- **纯函数 + 单测**：`src/download.ts passivePreviewSource(resolved,hasThumb)`（3 例，`download.test.ts`）——档 B 三态取图契约（original/thumb/icon）。CSS：`.gate-blur`/`.gate-empty`/`.album-dl`/`.detail-media-dl`/`.detail-media-size`/`.quote-thumb.gate-blur`/`.quote-thumb-ph`。
- **文档**：`../IMProgram/docs/DOWNLOAD_TEST_SCENARIOS.md` 加 §11「Web 手测场景 + 独有差异」（§11.A–§11.K，含 §11.J 差异表）。**待用户逐条手测**（尤其 §11.E/§11.F 后端日志无 `/uploads` GET）。

**下载门控 + 数据与存储（任务三/四 阶段 5）✅ 完成（2026-08-06，tsc + 138 vitest 绿，待浏览器实测）**
- **`src/download.ts`**（纯逻辑，21 例单测）：策略类型/默认/解析容错、`shouldAutoDownload` 决策矩阵、
  低/中/高快捷档往返、下载状态机的字形与文案。逐条对齐后端 `internal/downloadsettings` 与 iOS `IMDownloadPolicy`。
- **SDK**：`downloadSettings / saveDownloadSettings / resetDownloadSettings`（PUT 体**就是 settings 本身**，后端直接 Decode，别包一层）
  + `capabilities_update` 帧 → `onCapabilitiesUpdate` → 重拉（多端同步）；`ChatMessage.thumb` 入站解析补齐。
- **卡片门控**：媒体气泡未下载显 thumb 模糊占位（`blur(9px)`）或中性斜纹底 + 中心 ↓ + `尺寸 · 时长` 角标；
  文件条图标位即状态位（↓ / ✕ / ↻）+ 进度条；就绪后 `<a download>` 指向应用内 blob，不再走网络。
  下载走 `fetch` + `ReadableStream` 真进度；**✕ 用 AbortController 真中止**（否则被"取消"的请求稍后仍会完成、状态跳回就绪）。
- **设置 ▸ 数据与存储**（原「敬请期待」）：存储用量 + 清除缓存 / 自动下载总开关 / 低·中·高档位（不匹配预设显"自定义"）/
  图片 单聊·群聊 / 视频·文件 上限滑块（0=手动，右端 1.5 GB）+ 各自单群开关 / 重置。
- **Web 诚实差异**：只读写 **Wi-Fi 档**（浏览器分不清移动/Wi-Fi），移动数据档在 Web 不生效但会随账号同步回移动端；始终提供手动下载。
- **日志（2026-08-06 补）**：统一 `logger.*(LOG_TAG.media,…)`（媒体全链路一个桶，§3）——
  `download_settings_applied version=` / `download_settings_unavailable fallback=defaults` / `capabilities_update_received` /
  `download_start` / `download_http_error status= expired=` / `download_completed bytes= duration_ms=` /
  `download_cancelled_by_user` / `media_cache_cleared`。**不在 `mediaGate` 里打**（每次 render 都会走）。
  （初版误用了 `LOG_TAG.http`，已按规范改回 `media`。）
**下载门控 阶段 6 — 对齐 iOS 详情 + 图片/视频改 URL 直取（2026-08-07，未编译按用户要求自测）**
- **圆形图标 + 环形进度**（对齐 iOS `_disc`/`_ring`，共用 `FileGateIcon`）：文件条方形→圆形，进度改图标外围 SVG 圆环、去掉底部线性条；`.msg-file` 固定最小高度 → 下载切换**零高度抖动**。
- **点击预览路由** `openReadyFile`：就绪文件可预览类型（pdf/图片/音视频/文本）**新标签预览**、其余**另存**；右键菜单加「下载」项直接落盘（`saveMessageToDisk`）。
- **详情「文件」页签并入门控**（div + `mediaGate`，共享 `dlBlobs`）+ 右键菜单 **转发/定位到聊天/取消下载（仅下载中）/删除（占位，后端接口待建）**。
- **图片/视频改 URL 直取（方案 B）**：解门控后不下 blob，直接 `<img/video src=远端>`，**浏览器 HTTP 缓存兜底持久（刷新仍在）**；门控判定保留（大图/视频先显模糊、点了才拉，省流量）。`mediaOptedIn: Set<content>` 记已解门控；blob/进度状态机**仅文件**再用。代价：图片/视频无进度环。
- **文档**：Web↔移动端差异一览 + 方案 C（Cache Storage 持久缓存）待办 → `../IMServer/docs/DOWNLOAD_DATA_STORAGE_PLAN.md` §5.1/§阶段6/待办。
- **已知限制**：无断点续传（✕=重来）；**文件** blob 缓存刷新即失效（图片/视频已靠浏览器 HTTP 缓存持久）。

**自测三 bug 修复（2026-08-07，tsc + 135 vitest 绿，删除已浏览器实测）**
- **① 门控图刷新退化 + opt-in 丢失**：`localStore` 未持久化 `thumb`（`MsgRecord` 补字段 + 存/读）；图片/视频「已解门控」记录存 `localStorage`（按 uid，`loadOptedIn`/`saveOptedIn`），登录恢复 → 刷新后已看过的媒体仍直显、未看的仍显磨砂而非斜纹底。
- **② 已缓存媒体恒 0**：方案 B 后图片/视频不进 `dlBlobs` → 计数改 `dlBlobs 文件数 + mediaOptedIn.size`。
- **③ 删了又冒出来 / 删不掉**：无服务端删消息接口，纯本地删。原实现只抹内存视图、还 `seenByConv.delete` → 实时/补拉同步当新消息重加回。改为**双层墓碑**：IndexedDB `deletions` 表（`markMessageDeleted`，`loadConversation` 读盘过滤，DB v2→v3）+ **内存墓碑 `deletedByConv`**（登录经 `client.loadDeletedSeqs` 载入，`onMessage` 收到服务端重推直接丢弃）。二者缺一都会复现：只 IndexedDB→实时重推绕过读盘；只内存→刷新丢失。**浏览器实测：删除后刷新不复现 ✅**。

**Typing 提示位置对齐（2026-08-05，待用户手测）**：已移除输入栏上方的提示条；收到 typing 后聊天标题栏副标题显示「正在输入」，3 秒无新帧即恢复单聊在线态或群聊成员数。按本次要求未编译、未跑测试。

**参与四大任务（2026-08-05）**——协作 IMServer/iOS：
1. **任务一** ✅ **P0 + 恢复路径完成**：非好友聊天拦截（微信式）
   - 资料面板非好友显「加好友」隐藏「消息/呼叫/视频」+ 隐藏设置/备注名/页签三卡（`showDetailBody`）；
     群成员右键菜单好友→「发送消息」、非好友→「添加好友」
   - 拒收系统行带「发送好友申请」恢复入口（`noteCode` 瞬态，刷新后链接消失、点重试重生成）
   - `requestFriend()` 读服务端 `outcome`：已直接成为好友时**不吐司**（避免误以为要等对方通过）
   - 聊天页顶栏头像进资料 → 隐藏「消息」（`fromOwnChat`，对齐 iOS `showsMessagePill`）
   - **修被拒媒体消息退化成 URL 文本**：`saveRejected`/`loadMessages` 只存还 6 个字段且 SDK 把
     `contentType` 写死 `"text"` → 刷新后图片/视频变字符串、相册因丢 `groupId` 散架成独立消息。
     三处补齐完整字段集（与 ACK 落库一致），配回归测试。
   - tsc + 92 vitest 绿；用户浏览器实测通过
   - 未做 P1（全局开关切 Telegram 式）
2. **任务二**：多选消息支持合并转发的聊天记录设计（待讨论）
3. **任务三**：媒体与文件下载设置设计（待 Telegram 截图 + 讨论）
4. **任务四**：文件与媒体消息下载 UI/UX（待 Telegram 截图 + 讨论）

详见 `../IMServer/current_task.md` 完整需求。

## 下一步
1. **接 IMServer 四大任务方案确认**（等 Telegram 截图）→ 实施代码
2. **caption（图+文一条消息）**：方案见 `../IMServer/docs/ROADMAP.md`「M4-6 caption 追加」；
   Web 侧=媒体气泡图下文字区 + 粘贴条「图+配文」合成一条。
3. 网络恢复秒连：听 `online` 事件跳过退避立即重连。
4. 群内已读细化、@提醒（随主线 M5-6）。
5. 消息列表虚拟化；测试债：Playwright E2E。

## 已知坑 / 限制
- **扫自己名片码「查看我的资料」是死路（既有 QR P0 缺陷，未修）**：扫自己的名片码 → resolve 回 relation=self → 结果卡主按钮「查看我的资料」→ `onViewProfile(自己uid)` → `openPeerDetail(peer)`（App.tsx ~3477）因 `peer === uid` 直接 return，弹窗被 onClose 关掉却没打开任何资料页。修法：self 场景改为打开设置页顶部个人资料（`setShowSettings(true)` / `openProfile()`）而非走 peer 抽屉，约 5 行。与一图多码改动无关。
- **一图多码消歧仅 Chrome/Edge 生效**：靠原生 BarcodeDetector；Safari/Firefox 无此 API，退回 jsqr 而 jsqr 对并排多码定位失败 → 多码图识别失败（单码仍可用）。属库固有限制，要跨浏览器多码需换 zxing-wasm。见 IMServer `docs/QRCODE_DESIGN.md §6` 第 6 条。
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
