# im-desktop —— IM 桌面端外壳（Electron）

**这不是一个独立客户端**：它是 `im-web` 的第二个产物。界面与 SDK 全部来自仓库根的 `src/`，
本目录只提供窗口、身份，以及将来（D4）的托盘 / 通知 / 自启等宿主能力。

方案与全部论证见 IMServer 的 `docs/design/DESKTOP_DESIGN.md`；分期见其 §10。

## 三条硬规矩（DESKTOP_DESIGN §7.3）

1. **桥只有一座**：主进程能力经 `src/preload/` 挂到 `window.imDesktop`，页面一律走
   `im-web/src/platform/`。组件层直接摸 `window.imDesktop` 会让浏览器版在那一处崩。
2. **平台判定只有一处**：`im-web/src/platform/index.ts`。
3. **桥缺什么退回 web**：外壳与页面各自发版，桥落后于页面是常态，不是过渡期的将就。

## 跑

```bash
# 1) 先在仓库根起 Vite（外壳 dev 模式加载 http://localhost:5173）
cd .. && npm run dev

# 2) 另开一个终端
cd desktop
npm install          # 首次：会下载 Electron 二进制（约 100~150 MB）
npm run dev          # 编译 main/preload 后启动外壳

# 无人值守自检：走与真实启动完全同一条路，查桥/平台判定/身份一致性，用退出码表态
npm run smoke

# 出一个未签名 .app（release/）
npm run pack
```

`IM_DEV_URL` 可覆盖 dev 加载地址（压测 / 多实例时用）。

## D2 只做了什么

桥当前**只提供身份两项**（`deviceId` / `deviceName`，契约版本 1）。
`saveFile` / `openExternal` / `notify` / `setBadge` / `subscribeWake` / `voiceRecording`
一概未实现——`platform/desktop.ts` 会逐能力回退到 web 实现。这些归 D4/D5。
