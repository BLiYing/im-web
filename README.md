# im-web

IM 用户 **Web 客户端**（React + TypeScript + Vite）。与 iOS 端功能对齐，协议以 `IMServer/docs/PROTOCOL.md` 为准，进度见 `IMServer/docs/ROADMAP.md` / `CLIENT_PARITY.md`。

## 结构
```
src/
├── sdk/            协议 SDK（@im/sdk 雏形，对应 iOS 的 IMSocketManager）
│   ├── protocol.ts 协议常量与类型
│   └── imSdk.ts    IMClient：登录/连接/收发/心跳/重连/增量同步/回执
├── App.tsx         UI：登录 + 聊天（薄，调 SDK）
├── main.tsx
└── styles.css
```
SDK 与 UI 分层：聊天能力沉淀在 `sdk/`，界面只调用它。

## 开发运行
```bash
# 1. 先起后端（另一个终端）
cd ../IMServer && go run ./cmd/imserver        # :8080

# 2. 起 Web（dev server :5173，已配置把 /api 与 /ws 代理到 :8080）
npm install
npm run dev
```
浏览器开 http://localhost:5173 ，登录页填「我的 uid / 对方 uid」（如 1001 / 1002）。双开两个浏览器标签页用不同 uid 即可互发。

## 现状（M1 起步）
- ✅ 协议 SDK 雏形：JWT 登录换 token、WS 连接、send→ack、new_msg 接收、心跳、退避重连、`sync_req/sync_resp` 增量同步、按 conv_seq 去重、送达回执。
- ✅ 登录页 + 聊天页（发送态、气泡、连接状态）。
- ⬜ 会话列表页、本地缓存、已读/未读、群聊等：按 ROADMAP 各阶段与 iOS 同步补齐。

> 注：仓库尚未关联远程。建好 GitHub 仓库后 `git remote add origin <url> && git push -u origin main`。
