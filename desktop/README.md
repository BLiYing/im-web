# im-desktop —— IM 桌面端外壳（Electron）

**这不是一个独立客户端**：它是 `im-web` 的第二个产物。界面与 SDK 全部来自仓库根的 `src/`，
本目录只提供窗口、身份，以及将来（D4）的托盘 / 通知 / 自启等宿主能力。

方案与全部论证见 IMServer 的 `docs/design/DESKTOP_DESIGN.md`；分期见其 §10。
**打包 / 签名 / 公证、开发版 Electron 要先临时签名、通知弹不出的排查**见 IMServer 的 `docs/ops/DESKTOP_RELEASE.md`。

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

## 桥上有什么（2026-09-11）

身份两项（`deviceId` / `deviceName`）+ 未读角标 / 系统通知 / 开机自启（D4-2）+ 本地消息库 SQLite（D4-3）+
另存 / 外链 / 唤醒信号（D4-4）+ 深链 / 全局快捷键（D4 收尾）。`voiceRecording` 刻意不实现——页面那套探测在
Electron 里给的就是正确答案（DESKTOP_DESIGN §7.8）。桥缺哪个，`platform/desktop.ts` 就逐能力回退 web。
还没做的是 D5 音视频与 D6 打包分发（DESKTOP_DESIGN §10）。

自检：`npm run smoke` / `e2e` / `shell-check` / `c3-check` / `perf`。
**不要和正在运行的 IM Desktop 同时跑**：单实例锁会拒掉后起的那个并 exit 11。
