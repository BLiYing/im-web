# im-web — 项目说明（供 Codex 读取）

## 必读入口

- 每次开始主要回复前先读 `current_task.md`。
- 工程结构、完成定义和构建命令以 `CLAUDE.md` 为准。
- 协议以 `../IMServer/docs/PROTOCOL.md` 为准；聊天交互以
  `../IMServer/docs/CHAT_UX.md` 为准。
- Web 日志实现见 `docs/LOGGING.md`，三端共同日志契约见
  `../IMServer/docs/LOGGING.md`。
- **新增或修改任何 UI 前必须读取 `docs/UI_COLOR.md`**；颜色、间距和圆角统一使用
  根级 CSS 语义令牌，禁止业务组件散落颜色字面量或依赖未声明变量的 fallback。

## 硬性约定

- SDK 与 UI 分层；协议能力放 `src/sdk/`，组件不直接拼协议帧。
- 新 API 必须经过统一 SDK 和 `tracedFetch`；新增日志必须使用统一 `logger`，禁止业务代码
  直接调用 `console.*`。
- 新功能配套 Vitest；声明完成前运行 `npm test` 和 `npm run build`，并更新
  `current_task.md`。
- 提交信息使用 `类型(模块): 描述`。
- 今后新增的业务/技术 Markdown 文档一律放入 `docs/`。根目录只保留 README、
  AGENTS/CLAUDE、`current_task.md` 及既有工程入口文件。
