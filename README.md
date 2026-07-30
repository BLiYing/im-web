# im-web

IM 用户 Web 客户端（React + TypeScript + Vite），与 iOS 客户端共用 IMServer 协议。

## 结构

```text
src/
├── logging/        统一日志、HTTP 正文脱敏
├── sdk/            协议 SDK、HTTP/WS、本地存储
├── App.tsx         UI（只调用 SDK）
├── main.tsx
└── styles.css
```

SDK 与 UI 分层：聊天能力沉淀在 `sdk/`，界面不直接拼协议帧。

## 开发

```bash
# 先启动后端
cd ../IMServer && go run ./cmd/imserver

# 再启动 Web
cd ../im-web
npm install
npm run dev
npm test
npm run build
```

开发服务器会把 `/api`、`/uploads` 和 `/ws` 代理到 `http://localhost:8080`。

## 日志与诊断

浏览器日志统一使用 `IM.APP`、`IM.HTTP`、`IM.WS`、`IM.STORE`、`IM.UI` Tag。所有 API
请求自动携带 `X-Request-ID`，请求与响应使用同一个 `req` 关联，并记录方法、路径、状态码、
耗时、字节数和经过脱敏的正文。

- password、token、Authorization、cookie、phone、secret 始终隐藏。
- JSON 内嵌 Data URI、上传文件和二进制只记录类型与大小。
- 单条正文最多 16 KB。
- Debug 输出脱敏后的业务正文；生产构建默认只输出 warn/error，且隐藏业务正文。
- 内存中最多保留最近 500 条日志，不写入 localStorage。

开发时可在浏览器控制台执行：

```js
await IMDiagnostics.copyLogs() // 复制诊断日志
IMDiagnostics.exportLogs()     // 返回 JSON Lines 文本
IMDiagnostics.clearLogs()      // 清空内存日志
```
