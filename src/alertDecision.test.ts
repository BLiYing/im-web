// 三端共用向量（testing/alertDecision.vectors.json，源 IMServer docs/conformance/alert_decision.json）。
// 精确复刻 callRecord.test.ts 读向量的写法。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/alertDecision.vectors.json";
import { alertDecision, ALERT_THROTTLE_MS, type AlertContext } from "./alertDecision";
import type { NotifySettings } from "./notifySettings";

interface Case {
  name: string;
  ctx: AlertContext & { settings: NotifySettings };
  expect: { sound: boolean; vibrate: boolean; banner: boolean; osNotify: boolean; soundId: string | null };
}

describe("alert_decision 共用向量（32 条）", () => {
  for (const c of (vectors as { cases: Case[] }).cases) {
    it(c.name, () => {
      const r = alertDecision(c.ctx);
      expect(r).toEqual(c.expect);
    });
  }

  it("本地副本与源向量一致（源在本机时才比）", () => {
    const src = "IMServer/docs/conformance/alert_decision.json";
    const abs = new URL(`../../${src}`, import.meta.url);
    if (!existsSync(abs)) return;
    expect(JSON.parse(readFileSync(abs, "utf8"))).toEqual(vectors);
  });
});

describe("alertDecision 边界（向量之外，补几条防回归）", () => {
  const base: AlertContext = {
    platform: "desktop",
    isLive: true,
    isSelf: false,
    isSystem: false,
    isRecalled: false,
    isCallRecord: false,
    missedCallForMe: false,
    convType: "private",
    muted: false,
    mentionsMe: false,
    appActive: true,
    windowFocused: false,
    viewingConv: false,
    inCall: false,
    nowMs: 100000,
    lastSoundAtMs: 0,
    settings: {
      private: { enabled: true, preview: true, sound: "default" },
      group: { enabled: true, preview: true, sound: "default" },
      inApp: { sound: true, vibrate: true, preview: true },
      badge: { includeMuted: false },
      desktop: { enabled: true, sound: true, volume: 7 },
    },
  };

  it("节流边界精确到毫秒：差 1499ms 仍节流，差 1500ms 不节流", () => {
    expect(alertDecision({ ...base, platform: "mobile", lastSoundAtMs: base.nowMs - (ALERT_THROTTLE_MS - 1) }).sound).toBe(false);
    expect(alertDecision({ ...base, platform: "mobile", lastSoundAtMs: base.nowMs - ALERT_THROTTLE_MS }).sound).toBe(true);
  });

  it("桌面 osNotify 与 sound 相互独立：焦点内也可能只弹通知不响（enabled 但 desktop.sound 关）", () => {
    const d = alertDecision({ ...base, windowFocused: false, settings: { ...base.settings, desktop: { enabled: true, sound: false, volume: 7 } } });
    expect(d).toEqual({ sound: false, vibrate: false, banner: false, osNotify: true, soundId: null });
  });

  it("浏览器平台 osNotify 恒 false，即使桌面通知开关开着", () => {
    const d = alertDecision({ ...base, platform: "browser", windowFocused: false });
    expect(d.osNotify).toBe(false);
    expect(d.sound).toBe(true);
  });

  it("banner 仅移动端可能为 true，桌面/浏览器恒 false（即使 inApp.preview 开）", () => {
    expect(alertDecision(base).banner).toBe(false);
    expect(alertDecision({ ...base, platform: "browser" }).banner).toBe(false);
  });

  it("banner 不受节流影响：1.5 秒内连响，横幅仍照出", () => {
    const d = alertDecision({ ...base, platform: "mobile", windowFocused: true, lastSoundAtMs: base.nowMs - 1 });
    expect(d.sound).toBe(false); // 声音被节流
    expect(d.banner).toBe(true); // 横幅不受节流影响
  });

  it("banner 跟随 inApp.preview：关闭时移动端不出横幅（即使其余资格都满足）", () => {
    const d = alertDecision({
      ...base,
      platform: "mobile",
      windowFocused: true,
      settings: { ...base.settings, inApp: { ...base.settings.inApp, preview: false } },
    });
    expect(d.banner).toBe(false);
  });
});
