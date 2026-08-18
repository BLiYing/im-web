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
- 禁止魔法数/字符串,抽成具名常量。
- 列表渲染 `key` 用稳定身份（消息用 `mediaIdentity`/`convSeq`，别用数组下标——除非静态列表）。

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
2026-08 起分批拆分（→ ~5029，历史与方案见 `current_task.md`「技术债」）。**新代码往哪放，按此决策树，别默认往 App.tsx 堆**：

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
- **已登记例外**：`MediaViewer`（~24 props）在 Context 落地前先按纯 props 拆出——它的多是**一次性动作回调**（onLocate/
  onFavorite/onCopy/onForward/onDelete…），不是跨组件共享的服务，硬传成本可接受。**Context 落地时应把这些公共服务类回调一并收编**。
- 会话详情抽屉（~50 props）**不走硬传**：已触墙，等 `AppServicesContext` 就位再拆（见 `current_task.md`「prop-drilling 墙」）。

## 八、测试
- **每加一个功能配 `*.test.ts(x)`**，`npm test`（vitest）自动纳入回归。
- 纯逻辑模块直接测函数；组件/Hook 测试用 `@testing-library`，文件顶部加 `// @vitest-environment jsdom`（默认 node 环境不拖慢纯逻辑用例）。
- **`App.smoke.test.tsx` 是拆分护栏**（mock IMClient 渲染真实 `<App/>` 走通登录→发/收消息主链路）——**任何拆分/重构必须保持它绿**。
- jsdom 测不到真滚动布局（`scrollTo` 已桩掉）：滚动定位/分页类改动，编译过 ≠ 对，**必须浏览器手测**。

## 九、通用约定
- 提交信息：`类型(模块): 描述`（`feat(web):` / `fix(web):` / `refactor(web):` …）。
- 每个非平凡改动后更新 `current_task.md`（活快照，就地覆盖）。
- 新增业务/技术 Markdown 统一放 `docs/`；根目录仅留 README / CLAUDE / AGENTS / `current_task.md` / 本规范等入口。
- 声明「完成」前跑 `npm run build`（`tsc -b && vite build`）零错误，条件具备时浏览器实测——详见 `CLAUDE.md`「完成的定义」。
