# im-web — 项目说明（供 Claude 读取）

## 项目简介
IM 即时通讯的 **Web 用户客户端**（正式 Web 端，非后端的临时调试页）。与 iOS（IMProgram）功能对齐，协议以 `../IMServer/docs/PROTOCOL.md` 为准。

## 技术栈
- **React 18 + TypeScript 5.5 + Vite 5**
- 通信：浏览器原生 `WebSocket`（封装在 SDK 内，对应 iOS 的 `IMSocketManager`）
- 样式：纯 CSS + CSS 变量（design tokens，与 iOS 的 `IMTheme` 对齐，见 `src/styles.css` 顶部）
- 状态：React hooks（无额外状态库）；HTTP 用 `fetch`
- dev 代理：`vite.config.ts` 把 `/api` 与 `/ws` 代理到后端 `:8080`

## 工程结构
```
src/
├── sdk/                协议 SDK（UI 无关，聊天能力沉淀于此）
│   ├── protocol.ts     协议常量与类型（对齐 PROTOCOL.md）
│   └── imSdk.ts        IMClient：登录/连接/收发/心跳/重连/双向分页同步/回执
├── App.tsx             UI（薄，只调 SDK）：登录 + 双栏（会话列表 + 聊天）
├── main.tsx
└── styles.css          design tokens + 布局/气泡/分割线/跳转按钮等
```
**SDK 与 UI 分层**：聊天协议能力放 `sdk/`，界面只调用它，不在组件里直接拼协议帧。

## 工作约定
- **每次开始主要回复前，先读 `current_task.md` 恢复上下文**，改动后更新它。
- **聊天消息列表的交互行为**（进会话定位/分页/未读分割线/红点/已读/跳转按钮/自动滚动）**以 `../IMServer/docs/CHAT_UX.md` 为单一事实来源**，照它实现，别另起一套。
- 协议字段以 `../IMServer/docs/PROTOCOL.md` 为准；端能力矩阵 `../IMServer/docs/CLIENT_PARITY.md`；阶段划分 `../IMServer/docs/ROADMAP.md`。
- 类型先行：新协议字段先加到 `sdk/protocol.ts`，再在 UI/SDK 用；避免 `any`。
- 提交信息格式：`类型(模块): 描述`（如 `feat(web): …` / `fix(web): …`）。

## 工作流程与「完成的定义」（每次自动遵循，无需用户重复提醒）
动手前（Read，不靠记忆）：改聊天交互前先 Read `../IMServer/docs/CHAT_UX.md`；涉及协议字段再 Read `../IMServer/docs/PROTOCOL.md`。

声明「完成」前必须全部满足，并在回复中**贴出 `npm run build` 输出**：
1. **真编译**：`npm run build`（= `tsc -b && vite build`）通过，**零 TS 错误**。
2. 若条件具备，**用浏览器实测**（预览/手测）关键路径，而非只编译——本端 UI 行为（滚动定位、分页、渲染）编译过不代表对。
3. 更新 `current_task.md`；**若完成的是 ROADMAP 里程碑/子项，同步更新 `../IMServer/docs/ROADMAP.md` 与 `CLIENT_PARITY.md` 的状态与完成时间（YYYY-MM-DD）**。
4. **新功能不在 CHAT_UX/CLIENT_PARITY 等设计文档中的，先补文档再实现/同步**。
5. 明确说清「没做什么 / 已知限制 / TODO」，不假装完成。

## 后端重启提醒（重要）
- **纯前端改动**（仅改 `src/`）：`npm run dev` 自动热更新（HMR），**后端不用重启**；浏览器必要时 Cmd+Shift+R 硬刷。
- **改了后端代码**（IMServer）：必须重启 `go run ./cmd/imserver`，否则前端连到旧逻辑——这种情况要**明确提醒用户重启后端**再测。

## 构建 / 运行
```bash
# 1) 先起后端（另一个终端）
cd ../IMServer && go run ./cmd/imserver        # :8080

# 2) 起 Web（dev server :5173，已配 /api 与 /ws 代理到 :8080）
npm install
npm run dev
# 浏览器 http://localhost:5173 ，登录填 uid（如 1001 / 1002），双标签页不同 uid 互发

npm run build                                  # 声明"完成"前必跑：tsc -b && vite build 零错误
```

## 关联工程
- 后端：/Users/liying/IOSProject/IMServer（协议 `docs/PROTOCOL.md`、交互蓝图 `docs/CHAT_UX.md`）
- iOS 客户端：/Users/liying/IOSProject/IMProgram（功能对齐，见 CLIENT_PARITY.md）
