# Web 日志规范

> 三端共同规则以 `../../IMServer/docs/LOGGING.md` 为准。本文只描述 im-web 的入口和操作方式。

## 统一入口

- 业务日志使用 `src/logging/logger.ts` 的 `logger` 和 `LOG_TAG`。
- 媒体（图片/视频）的探测/上传/渲染/播放统一用 `LOG_TAG.media`（`IM.MEDIA`，与 iOS 同名），
  便于一条过滤捞出整条链路；不要再塞进 `LOG_TAG.ui` / `LOG_TAG.ws`。
- 禁止在业务代码直接调用 `console.log/info/warn/error/debug`。
- `main.tsx` 调用 `installGlobalLogging()`，注册诊断导出及全局 `error` /
  `unhandledrejection` 捕获。

生产构建默认只输出 warn/error；开发构建从 debug 开始。不要为了临时排障绕过日志级别或脱敏。

## HTTP

- API 请求必须使用 `src/sdk/http.ts` 的 `tracedFetch`，或使用内部基于它实现的 SDK `api/fetchJSON`。
- 禁止新增裸 API `fetch`。普通图片/视频资源展示下载可以直接 `fetch`，但不得用于 REST API。
- `tracedFetch` 自动生成/透传 `X-Request-ID`，REQUEST/RESPONSE/ERROR 使用同一 `req`。
- 自动记录 method、path（不含 query）、status、duration、bytes 和安全正文。
- password/token/Authorization/cookie/phone/secret 始终脱敏。
- FormData、Blob、二进制、Data URI 只记录元数据；正文最多 16 KB。
- Production 隐藏业务正文和非 JSON 正文。

## WebSocket 与本地存储

- WebSocket 生命周期、重连、ACK 超时/拒绝和序号空洞使用 `IM.WS`。
- 不记录 WS URL 中的 token，也不打印完整消息正文。
- IndexedDB/localStorage 失败使用 `IM.STORE`，只记录操作、会话标识和错误。
- 高频 presence/typing/ping 不逐帧输出，避免日志洪水。

## 诊断导出

内存中最多保留最近 500 条符合当前级别的日志，不写入 localStorage。开发者可在控制台执行：

```js
await IMDiagnostics.copyLogs()
IMDiagnostics.exportLogs()
IMDiagnostics.clearLogs()
```

导出格式为 JSON Lines。分享前仍需人工复核敏感信息。

## 新增日志检查

1. 是否使用正确的 `LOG_TAG`、级别和稳定 `snake_case` 事件名。
2. 新 API 是否经过 `tracedFetch`，请求与响应的 `req` 是否一致。
3. 是否避免 JWT、密码、手机号、消息正文和二进制泄漏。
4. 新字段是否需要扩展 `sanitize.ts` 的敏感键集合。
5. 是否为脱敏、Request ID、二进制/超长边界补充 Vitest。

提交前可检查：

```bash
rg 'console\.(log|info|warn|error|debug)' src
rg '\bfetch\(' src
```

第一条只允许统一 logger 内部的动态 console 输出；第二条只允许 `http.ts` 和明确的媒体资源下载。
