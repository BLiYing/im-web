// @vitest-environment jsdom
//
// 平台适配层的**契约测试**：web 与 desktop 两套实现跑同一组断言（DESKTOP_DESIGN §7.1）。
//
// 为什么是「同一组断言」而不是各测各的：这一层的价值全在「同一能力在两端语义一致」。
// 各测各的等于把两份实现当成两个独立模块，那正是 SYMMETRY.md 在防的那种分叉。
//
// 下面这两条断言看着像形式主义，其实各钉着一个真实的坑，改签名前先读 platform/types.ts：
//   · openExternal 必须**同步**——脱离用户手势的调用栈就会被弹窗拦截器吃掉；
//   · deviceId 必须**同步且稳定**——IMClient 拼登录帧时同步取用，且后端按 (uid, device_id) 顶替去重。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webPlatform } from "./web";
import { createDesktopPlatform, isBridgeUsable, type DesktopBridge } from "./desktop";
import { platform, resetPlatformForTests } from "./index";
import type { Platform } from "./types";

/** 一座「什么可选能力都没有」的桥：桌面实现应当逐个退回 web。 */
const bareBridge: DesktopBridge = { contract: 1, deviceId: "desk-fixed-id", deviceName: "IM Desktop · macOS 15" };

beforeEach(() => {
  resetPlatformForTests();
  localStorage.clear();
  // jsdom 的 window.open / 锚点导航都是「Not implemented」，会把噪声打进测试输出；桩掉。
  vi.spyOn(window, "open").mockReturnValue(null);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); resetPlatformForTests(); });

const cases: [string, () => Platform][] = [
  ["web", () => webPlatform],
  ["desktop（裸桥，能力全回退）", () => createDesktopPlatform(bareBridge)],
];

describe.each(cases)("Platform 契约 —— %s", (_name, make) => {
  it("身份两项：非空、且多次调用稳定不变", () => {
    const p = make();
    const id1 = p.deviceId();
    const id2 = p.deviceId();
    expect(id1).toBeTruthy();
    expect(id2).toBe(id1);           // 后端按 (uid, device_id) 顶替去重，飘一次就多一条僵尸 session
    expect(p.deviceName()).toBeTruthy();
  });

  it("name 与 isDesktop 必须自洽", () => {
    const p = make();
    expect(p.isDesktop).toBe(p.name === "desktop");
  });

  it("openExternal 是同步的（返回 undefined，不是 thenable）——保用户手势，防弹窗拦截", () => {
    const p = make();
    const ret: unknown = p.openExternal("https://example.com/x");
    expect(ret).toBeUndefined();
  });

  it("saveFile 可 await 且不抛", async () => {
    const p = make();
    await expect(p.saveFile({ url: "blob:fake", name: "a.zip" })).resolves.toBeUndefined();
  });

  it("notify / setBadge 返回 Promise<boolean>，且如实上报「有没有真的做」", async () => {
    const p = make();
    // **必须是异步**：同步就得用 sendSync，会与「主进程 await 渲染进程」互等死锁（types.ts 有现场记录）。
    expect(typeof await p.notify({ title: "t", body: "b" })).toBe("boolean");
    expect(typeof await p.setBadge(3)).toBe("boolean");
  });

  it("voiceRecording 返回完整探测形状", () => {
    const p = make();
    const v = p.voiceRecording();
    expect(v).toEqual({ supported: expect.any(Boolean), mime: expect.any(String), ext: expect.any(String) });
  });

  it("autoStart 三件：supported 为 false 时 get 必须也是 false（不能显示一个点不动的开关）", async () => {
    const p = make();
    if (!p.autoStartSupported()) expect(await p.getAutoStart()).toBe(false);
    expect(typeof await p.setAutoStart(true)).toBe("boolean");
  });

  it("subscribeOpenConversation 返回可调用的拆除函数（调用方不必分平台写 cleanup）", () => {
    const p = make();
    const stop = p.subscribeOpenConversation(() => {});
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
    expect(() => stop()).not.toThrow();   // 重复拆除也不许炸
  });

  it("subscribeWake：收得到浏览器 online 信号，拆除后不再回调", () => {
    const p = make();
    const seen: string[] = [];
    const stop = p.subscribeWake((r) => seen.push(r));
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual(["browser_online"]);
    stop();
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual(["browser_online"]);   // 不拆的话换号后旧 client 会跟着醒（sdk/wake.ts 记的 2026-08-22 那个坑）
  });
});

describe("web 侧特有", () => {
  it("localStorage 抛错时 deviceId 仍返回可用值（降级为不去重，但不阻断登录）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(webPlatform.deviceId()).toBeTruthy();
  });

  it("deviceId 会落 localStorage，刷新后复用同一个", () => {
    const first = webPlatform.deviceId();
    expect(localStorage.getItem("im.deviceId")).toBe(first);
    expect(webPlatform.deviceId()).toBe(first);
  });

  it("notify / setBadge 恒 false —— im-web 至今没有通知功能，如实上报而非假装做了", async () => {
    expect(await webPlatform.notify({ title: "t", body: "b" })).toBe(false);
    expect(await webPlatform.setBadge(1)).toBe(false);
  });
});

describe("desktop 侧特有", () => {
  it("桥缺身份两项或缺契约版本 → 一律当没有桥（宁可当浏览器跑，也不半残）", () => {
    expect(isBridgeUsable(undefined)).toBe(false);
    expect(isBridgeUsable({})).toBe(false);
    expect(isBridgeUsable({ contract: 1, deviceId: "a" })).toBe(false);          // 缺 deviceName
    expect(isBridgeUsable({ deviceId: "a", deviceName: "b" })).toBe(false);      // 缺 contract
    expect(isBridgeUsable(bareBridge)).toBe(true);
  });

  it("身份两项走桥，不走浏览器那套 UA 猜测", () => {
    const p = createDesktopPlatform(bareBridge);
    expect(p.deviceId()).toBe("desk-fixed-id");
    expect(p.deviceName()).toBe("IM Desktop · macOS 15");
  });

  it("桥实现了某能力就走桥", async () => {
    const saved: string[] = [];
    const opened: string[] = [];
    const p = createDesktopPlatform({
      ...bareBridge,
      saveFile: async (url, name) => { saved.push(`${url}|${name}`); },
      openExternal: (url) => { opened.push(url); },
      notify: async () => true,
      setBadge: async () => true,
      voiceRecording: () => ({ supported: true, mime: "audio/mp4", ext: ".m4a" }),
    });
    await p.saveFile({ url: "u", name: "n.zip" });
    p.openExternal("https://x/y");
    expect(saved).toEqual(["u|n.zip"]);
    expect(opened).toEqual(["https://x/y"]);
    expect(await p.notify({ title: "t", body: "b" })).toBe(true);
    expect(await p.setBadge(2)).toBe(true);
    expect(p.voiceRecording().supported).toBe(true);
  });

  it("桥来的 open-conversation 事件要能传到订阅者，拆除后不再传", () => {
    // 用一个容器持有回调：直接用 let + null 会被 TS 在闭包外窄成 never。
    const box: { emit: ((id: string) => void) | null } = { emit: null };
    let stopped = false;
    const p = createDesktopPlatform({
      ...bareBridge,
      subscribeOpenConversation: (cb) => { box.emit = cb; return () => { stopped = true; box.emit = null; }; },
    });
    const got: string[] = [];
    const stop = p.subscribeOpenConversation((id) => got.push(id));
    box.emit?.("c-42");
    expect(got).toEqual(["c-42"]);
    stop();
    expect(stopped).toBe(true);   // 不拆的话换号后点通知会打开已作废的会话
  });

  it("setAutoStart 如实透传桥读回来的实际值，不回显入参", async () => {
    // 桥模拟「设不上」：无论传什么，读回来都是 false。
    const p = createDesktopPlatform({ ...bareBridge, setAutoStart: async () => false, getAutoStart: async () => false });
    expect(await p.setAutoStart(true)).toBe(false);
  });

  it("桥说通知没发出去（权限被拒/勿扰）就如实回 false，不许谎报成功", async () => {
    const p = createDesktopPlatform({ ...bareBridge, notify: async () => false, setBadge: async () => false });
    expect(await p.notify({ title: "t", body: "b" })).toBe(false);   // 谎报 true 会让调用方跳过应用内兜底
    expect(await p.setBadge(3)).toBe(false);
  });

  it("桥有自己的唤醒源时**叠加**浏览器信号，拆除要两边都拆", () => {
    const seen: string[] = [];
    let bridgeStopped = false;
    const p = createDesktopPlatform({
      ...bareBridge,
      subscribeWake: (cb) => { setTimeout(() => cb("window_focus"), 0); return () => { bridgeStopped = true; }; },
    });
    const stop = p.subscribeWake((r) => seen.push(r));
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual(["browser_online"]);   // 渲染进程本身还是网页，丢掉这一半等于少一半唤醒
    stop();
    expect(bridgeStopped).toBe(true);
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual(["browser_online"]);
  });
});

describe("platform() 单一判定点", () => {
  it("无桥 → web", () => {
    expect(platform().name).toBe("web");
  });

  it("有可用桥 → desktop", () => {
    window.imDesktop = bareBridge;
    try {
      expect(platform().name).toBe("desktop");
    } finally { delete window.imDesktop; }
  });

  it("半残的桥 → 回落 web，不半残地跑", () => {
    window.imDesktop = { deviceId: "x" } as unknown as DesktopBridge;
    try {
      expect(platform().name).toBe("web");
    } finally { delete window.imDesktop; }
  });

  it("结果被缓存：同一次会话里前后拿到的是同一个实现", () => {
    const a = platform();
    window.imDesktop = bareBridge;
    try {
      expect(platform()).toBe(a);   // 桥不会在运行中凭空长出来；前后不一致比慢一点难查得多
    } finally { delete window.imDesktop; }
  });
});
