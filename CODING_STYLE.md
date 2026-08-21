# im-web 代码规范（React 18 + TypeScript 5 + Vite）

> 主栈：**React + TS**。总原则：可读性 > 取巧；与现有代码风格一致；一个文件/函数只做一件事。
> 本文只讲**编码风格 + 防巨组件**；工作流程、日志、配色、协议等契约以 `CLAUDE.md` 及其指向的文档为准，不在此重复。

---

## 一、命名
- **组件**：大驼峰，一个文件一个主组件，文件名 = 组件名。`MediaViewer.tsx` → `export function MediaViewer(...)`。
- **Hook**：`use` 前缀 + 小驼峰。`useDevices` / `useDialogs`。文件名同名 `useDevices.ts`。
- **纯函数模块**：小驼峰文件名,导出具名函数。`messageContent.ts` / `wallpaper.ts`。
- **类型 / 接口**：大驼峰。`type ChatMessage`、`type WallpaperChoice`。**协议字段类型先加到 `sdk/protocol.ts`**。
- **变量 / 函数**：小驼峰，语义完整不缩写。事件回调 `onXxx`（组件 prop）/ `handleXxx`（内部）。
- **布尔**：`is/has/should/can` 开头，如 `isGroupChat`、`canManage`。
- **常量**：全大写下划线或 `const` 具名，禁止散落魔法数/字符串字面量。`const MAX_FORWARD_TARGETS = 9;`。

## 二、文件组织
- 一个组件一个文件；纯展示组件放 `src/components/`（弹窗归 `components/modals/`、设置面板归 `components/settings/`）。
- 自定义 Hook 放 `src/*.ts`（`use*.ts`）；纯逻辑放 `src/*.ts`（无 React）。
- **SDK 与 UI 分层**（CLAUDE.md 已定）：协议能力沉淀在 `sdk/`，组件只调它，不在组件里拼协议帧。
- import 顺序：react/三方 → SDK/协议 → 本项目模块 → 组件 → 图标；相对路径就近。
- 优先具名导出（`export function`）；默认导出仅用于页面级入口（如 `App`）。

## 三、类型与空值安全（TS strict）
- **避免 `any`**；确实要逃逸用 `unknown` + 收窄。第三方无类型处就近写最小 `type`。
- 可选值用 `?.` / `??` / `if (!x) return`，不用非空断言 `!` 图省事（除非上文已保证）。
  - **例外——可选 render slot 的兜底用 `||` 不用 `??`**：`{right ?? <Spacer/>}` 只在 null/undefined 时兜底；调用方若传 `right={cond && <btn/>}`，`cond` 为 false 时 `right` 是 `false`（非空值），`??` 不兜底→占位丢失。JSX 渲染槽的默认值一律 `{right || <Spacer/>}`（本次 `SubPanel` 踩过）。
- 数据结构优先 `type`（本项目惯例）；props 就地写 inline 类型或紧邻 `type XxxProps`。
- 新协议字段：先 `sdk/protocol.ts` 加类型，再在 SDK/UI 使用。

## 四、代码风格
- 缩进 **2 空格**，不用 Tab（跟随现有文件）。
- 组件函数体顺序：`useState` → `useRef` → 派生值/`useMemo` → `useCallback` → `useEffect` → `return(JSX)`。
- **Hook 顺序耦合**：`useCallback` 的依赖数组在组件体内**即时求值**——被依赖的回调/值**必须先声明**，否则 TDZ 崩溃。
  自定义 Hook（`useToast`/`useDialogs`/`useDevices`）须在**用到其返回值的回调之前**调用（放组件体最靠前）。
- **所有 Hook 必须在任何 `return`（含 early return）之前调用**（React Hooks 规则，别与上一条 TDZ 混淆）：
  `useState/useRef/useMemo/useCallback/useEffect` 一律放组件体顶部。放在 `if (phase==="login") return <LoginView/>` 之后
  →登录/主视图两种渲染 hook 数不一致→运行时崩 **"Rendered more hooks than during the previous render"**
  （本次 `AppServicesContext` 的 `services` useMemo 踩过：一开始放在 early return 之后，移到之前才好）。
- **早退前的 hook 需要早退后定义的函数 → 经 ref 注入，别复制那段派生**（2026-08 App.tsx 系统性拆分沉淀）：
  从 App 抽出的 hook 必须在 `if (phase==="login") return` 之前调用，但它要用的某个函数（如 `openPeerDetail`/`handleScanRaw`，
  依赖只在主视图存在的 state）定义在早退**之后**。解法：App 建一个 `const xRef = useRef(noop)`，在 x 定义处回写 `xRef.current = x`，
  把 `xRef` 注入 hook（样板 `useQR` 的 `openPeerDetailRef`）。**这是退而求其次**——首选把该函数/其依赖 hoist 到早退之前；
  ref 注入只在 hoist 会引起大范围挪动时用，且**别为每个晚定义函数复刻一对 ref**（味道），必要时抽一个通用 `useLatest(fn)`。
- 禁止魔法数/字符串,抽成具名常量。
- 列表渲染 `key` 用**稳定身份**：消息一律 `album.ts#msgKey`（convSeq 优先），**绝不用数组下标 `i` 或 `serverMsgId` 兜底**
  （详见 §九——入站消息无 clientMsgId、翻历史 prepend 时下标平移会让 React 错绑 DOM）。静态列表除外。

## 五、错误处理与日志
- 网络 / IO / IndexedDB 调用必须有明确失败分支，不吞错（`catch` 里至少 `setToast` 或落日志）。
- **禁止业务代码直接 `console.*`**：统一走 `src/logging/logger.ts` 的 `logger` + `LOG_TAG`（`logger.ts` 自身除外）。
  自查：`grep -rn "console\." src --include="*.ts" --include="*.tsx" | grep -v logger.ts` 应为 0。
- REST API 必须走 `sdk/http.ts` 的 `tracedFetch` 或 SDK `api/fetchJSON`，禁止裸 API `fetch`。详见 `docs/LOGGING.md`。

## 六、UI / 样式
- 改 UI 前先读 `docs/UI_COLOR.md`；CSS 只用已声明的**语义令牌**（design tokens），禁止散落固定 RGB/Hex。
- 聊天列表交互（定位/分页/未读分割线/已读/自动滚动）以 `../IMServer/docs/CHAT_UX.md` 为单一事实来源。
- 浮层菜单/Popover 用统一玻璃令牌且必带 `@supports` 兜底；Modal 用 `--surface-elevated` + `--radius-card`（见 UI_COLOR.md §5）。

## 七、防巨组件（组件/文件不膨胀）—— 重点
`App.tsx` 曾长到 **6302 行**单体组件（改一个小格子要动整个巨文件、重渲染面巨大、出现「须在使用前定义避免 TDZ」这类顺序耦合）。
2026-08 起分批拆分（6302 → ~4778，历史与方案见 `current_task.md`「技术债」）。**新代码往哪放，按此决策树，别默认往 App.tsx 堆**：

- **① 有自己状态 + 一组操作的功能 → 自定义 Hook**（`use*.ts`）。判据：需要 **≥2 个新 state**、或有自己的
  定时器/订阅/缓存。副作用依赖（IM 客户端、吐司、弹窗）**注入进去**，别在 Hook 里直接摸全局。
  参考 `useDevices`（设备管理四态 + 操作，clientRef/askConfirm/setToast 注入）。**语音消息、通话状态等一律走这条**。
- **② 一整块 UI（面板 / 弹窗 / 查看器 / 卡片）→ 独立展示组件**（`components/**`）。纯展示：数据与动作全经 props 注入，
  组件不持业务状态。参考 `SettingsPanel` / `MediaViewer` / `modals/ForwardPicker`。
- **③ 纯逻辑（无 React、无 self）→ `*.ts` 纯函数模块 + 单测**。参考 `messageContent`/`wallpaper`/`color`（各配 `*.test.ts`）。

**拆完之后还有第二步：跨叶子的「共享外壳」上提**（拆巨组件只做①②③是不够的）。
把 App.tsx 拆成「一功能一文件」会催生**第二种重复**——同一套**外壳/骨架**被逐字复制进 N 个叶子文件：弹窗的
`modal-mask`+面板+`stopPropagation`、设置面板的「返回+标题+右槽」头部、多选行的「勾选框+头像+名」……散在各文件时
「看起来每个文件都不长」，但改一处跨切面行为要动 N 处。判据与做法：
- 同一段**结构性外壳/单元**在 **≥3 个文件**里逐字重复 → 抽成共享**包裹组件**，叶子只写差异（内容 + 少量 `className`/slot）。
  本次落地：`Modal`（14 处弹窗外壳）、`settings/SubPanel`（7 个面板头部）、`rows.tsx#CheckRow`（多选行）、`VideoThumb`（视频快照格）。
- 收益不止省行数：**跨切面行为**（点遮罩关闭、Esc 关闭、焦点陷阱、`role=dialog`、a11y）从「改 N 处」变「改 1 处」——
  外壳分散时这些根本没法统一加。差异用 **prop/slot 兜住**（容器类走 `className` prop、头部按钮走 `right` slot），别为差异复制整壳。

**纯结构重构要「行为等价」**：外壳上提这类清理，DOM 结构 / className / 事件时序须逐字不变（本次每个 `Modal`/`SubPanel`
转换后 DOM 完全一致，`tsc` + `App.smoke` + 全量 vitest 全绿即等价证据）。**顺手加功能**（如借机给所有弹窗补 Esc 关闭）
诱惑大，但那是**另一个改动**——混进重构会让「等价性」无从核对、review 变难；要加单独开一个 commit。

**红线（机械护栏，别靠自觉）**：`./scripts/check-file-size.sh`——单文件 > **600 行**（`.ts`/`.tsx`，不含 `*.test.*`）即非零退出。
**建议装 pre-commit 钩子自动跑**：`./scripts/install-hooks.sh`（每个 clone 一次，超预算即拦提交；应急 `git commit --no-verify`）。
超标的正确处理是**拆分**（按上面三档），**不是放宽阈值**。历史欠账（`App.tsx`、`sdk/imSdk.ts`）在脚本里登记
「只准降不准升」，逐步拆到 600 以下后从表里删。

**prop-drilling 墙（何时上 Context）**：props 数是**软信号，不是硬上限**——当一个待拆组件的 props 逼近 **~20 个、且其中多数是
`clientRef`/`setToast`/`askConfirm`/`refresh*` 这类公共服务**时，就该停下来考虑：别硬传，先建 `AppServicesContext` 收拢这批
稳定依赖，组件从 `useAppServices()` 取，props 降到个位数（方案与触发点见 `current_task.md`）。**注意 Context 只放稳定的服务，
不放高频变化的 state**（如 `input`/`msgsByConv`——放进去会让所有消费组件跟着重渲染）。
- **要把「依赖高频 state 的回调」放进 Context → 先用 `useEvent` 抹平身份，别裸 `useMemo`（假稳定陷阱）**（2026-08 `ChatActionsContext` /code-review 沉淀）：
  一个 `useCallback` 若依赖 `input`/`dlStates`/`uploadProgress`（如 `send`/`onGateTap`/`pickMention`），它**每次按键/上传 tick 都换新身份**。
  把它塞进 `chatActions = useMemo(() => ({ send, … }), [send, …])`，看着像「memo 一次」，实则依赖里带着它 → **context 值每次按键重建、
  所有消费组件重渲染**，比 prop-drilling 还糟且更隐蔽（`memo(子组件)` 会被静默击穿）。正确做法：用 `src/useEvent.ts` 把这些回调包成
  **身份恒定、调用走最新实现**的版本（`const sendEv = useEvent(send)`），Context 只收 `*Ev` + setter/ref，`useMemo` 依赖数组**为空**、值只建一次。
  判据：**Context 成员的身份必须恒定**——setter/ref 天然恒定；`useCallback([])` 恒定；带非空 deps 的 `useCallback` **必经 `useEvent`** 才能进。
- **已登记例外**：`MediaViewer`（~24 props）在 Context 落地前先按纯 props 拆出——它的多是**一次性动作回调**（onLocate/
  onFavorite/onCopy/onForward/onDelete…），不是跨组件共享的服务，硬传成本可接受。**Context 落地时应把这些公共服务类回调一并收编**。
- 会话详情抽屉（~50 props）**不走硬传**：已触墙，等 `AppServicesContext` 就位再拆（见 `current_task.md`「prop-drilling 墙」）。

**拆巨文件按 ROI 排序，别为「砍行数」硬拆（2026-08 抽屉 + 消息表重构复盘）**：
- **Context/服务对巨文件瘦身的杠杆常有限**。会话详情抽屉 ~45 个依赖里，能进 `AppServicesContext` 的**稳定服务只 ~6 个（~13%）**；
  大头是**数据**（conversations/groupInfos/detailMsgs…）+ **有状态动作**（doXxx，闭包依赖 state），它们进 Context 会拖累重渲染、进不去。
  别指望「上了 Context 抽屉就瘦」——先分清一个巨块的依赖里，稳定服务占多少。
- **优先级：③纯逻辑 hook ＞ ②视图组件 ＞ 胶水层**，按此顺序动手：
  - **③纯逻辑（无 self 的转换/状态机）是唯一「可测 + 真解耦」的**——抽成 `*.ts` 纯函数 + 薄 hook 外壳并配单测。
    参考 `messageStore.ts`（去重/合并/ack 纯变换）+ `useMessageStore`（状态外壳）。**先抽它**，收益最实。
  - **②视图**（把 JSX 搬进高-prop 子组件）砍行最多，但多是「换个地方放」：解耦有限、jsdom 测不到、**要浏览器验**，收益递减。
  - **胶水层别抽**：一个 hook 若要注入 **~20 个 App `set*`/`refresh*`**（如「SDK 事件 → 一堆 setter」的 handlers 总线），
    抽出 = **搬走 tangle**、还测不动（要 mock 全部依赖 + SDK），属**负 ROI**，维持内联。
- **目标是「把易错逻辑隔离成可测」，不是「拆到 600 红线以下」**。App.tsx 是历史欠账，逐步降即可；别为凑数字把耦合硬搬。

## 八、测试
- **每加一个功能配 `*.test.ts(x)`**，`npm test`（vitest）自动纳入回归。
- 纯逻辑模块直接测函数；组件/Hook 测试用 `@testing-library`，文件顶部加 `// @vitest-environment jsdom`（默认 node 环境不拖慢纯逻辑用例）。
- **组件/Hook 测试若在一个文件里多次 `render`，须 `afterEach(cleanup)`**（`test-setup.ts` 未全局 cleanup）——否则前一个用例的 DOM 堆进
  `document.body`，`getByText` 报「Found multiple elements」或跨用例串扰（本次 `DetailPanelParts.test` 踩过）。同名文本用 `container.querySelector` 收窄。
- **`App.smoke.test.tsx` 是拆分护栏**（mock IMClient 渲染真实 `<App/>` 走通登录→发/收消息主链路）——**任何拆分/重构必须保持它绿**；
  抽出大块（如 `MessageList`）时先给它补交互特征测试（`App.messageList.test.tsx`），再动代码。
- **App 级 mock 别各文件复制**：`FakeIMClient` 收在 `src/testing/fakeIMClient.ts`，测试用 `vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, … }))` 共享
  （工厂内 `await import` 可跨文件复用，不必内联重抄 ~50 行）；hook 测试的 `clientRef` 走同文件的 `fakeClientRef(partial)`。
- jsdom 测不到真滚动布局（`scrollTo` 已桩掉）：滚动定位/分页类改动，编译过 ≠ 对，**必须浏览器手测**。

## 九、交付前自审清单（编译≠正确，逐条过再交付）
`npm run build` 绿只证明「TS 类型 + 打包过」，本端多数坑是**加载不报错、运行时悄悄错**的逻辑/状态类，jsdom 也测不到真滚动。声明完成前对照下表扫一遍——每条对应一次真实/复盘出的坑，命中即停下来核：

- **[消息身份] List React key / 菜单高亮 / 详情定位一律用 `album.ts#msgKey`（convSeq 优先），永不用数组下标 `i` 或 `serverMsgId` 兜底。** 入站消息无 `clientMsgId`，用 `?? i` 会让向上翻页 prepend 时下标平移、React 错绑 DOM（播放中视频/展开长文/编辑框跳到别的行）。别再各处自造身份表达式（曾 4 套漂移，已收敛）。
- **[IndexedDB] 新增 object store 必须四处齐**（`sdk/localStore.ts`）：① bump `DB_VERSION` ② `onupgradeneeded` 建表 ③ 加进 `EXPECTED_STORES` ④ 每个读函数加 `contains` 降级分支。漏一处 → 升级过的老用户浏览器事务抛 `NotFoundError`、悄悄空列表（最好把 store 清单收敛成单一数据结构派生）。
- **[滚动跳转] 照 `../IMServer/docs/CHAT_UX.md`**：`jumpToSeq` 用瞬时 `scrollTop` 赋值（非 `behavior:"smooth"`）、跳转前清 `wasNearBottomRef`，否则 `onMediaLoad` 把定位拽回底部。滚动/分页改动**编译过 ≠ 对，必须浏览器手测**（jsdom 测不到）。
- **[错误码] 按业务码分支读 `Error.code`**（`qr.ts#errorCode`），**禁止 parse `error.message` 字符串**；`imSdk.ts#friendlyMessage` 手写码表与后端 errcode 各存一份，新增/改码时加对齐测试。
- **[CSS 作用域] 别用「容器 + 裸标签」后代选择器**（`.login button` / `.modal input` 这类会误伤容器内全部子元素，日后加次要按钮无代码即被染成主按钮样式）。用类选择器（`.login-submit`）或 `> button` 限直接子级。
- **[头像/昵称] 走 `peerAvatar.ts#resolvePeerAvatar` 多源兜底**（会话 > 好友 > 群成员 > 搜索），别只读 `peer_avatar_url` 单一来源。
- **[防膨胀] 新功能默认进新文件**（`use*.ts` / `components/**`），别往 `App.tsx`（已 5000+ 行上帝文件）堆；`check-file-size.sh` 600 行红线。

> 展开的证据与「为什么会悄悄错」见对应模块注释与 §五/§七；命中任一条 = 停下来核，别默认 build 绿就交付。

## 十、通用约定
- 提交信息：`类型(模块): 描述`（`feat(web):` / `fix(web):` / `refactor(web):` …）。
- 每个非平凡改动后更新 `current_task.md`（活快照，就地覆盖）。
- 新增业务/技术 Markdown 统一放 `docs/`；根目录仅留 README / CLAUDE / AGENTS / `current_task.md` / 本规范等入口。
- 声明「完成」前跑 `npm run build`（`tsc -b && vite build`）零错误，条件具备时浏览器实测——详见 `CLAUDE.md`「完成的定义」。
