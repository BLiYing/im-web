import { describe, it, expect } from "vitest";
import { platformIcon, deviceName, relativeTime, deviceSubtitle } from "./devices";
import type { DeviceView } from "./sdk/protocol";

function dev(p: Partial<DeviceView>): DeviceView {
  return {
    session_id: "s", platform: "", device_name: "", created_at: 0, last_active_at: 0,
    online: false, current: false, ...p,
  };
}

describe("platformIcon", () => {
  it("按平台给图标，未知回退终端", () => {
    expect(platformIcon("ios")).toBe("📱");
    expect(platformIcon("android")).toBe("🤖");
    expect(platformIcon("web")).toBe("💻");
    expect(platformIcon("desktop")).toBe("🖥");
    expect(platformIcon("")).toBe("📟");
    expect(platformIcon("watch")).toBe("📟");
  });
});

describe("deviceName", () => {
  it("优先 device_name", () => {
    expect(deviceName(dev({ device_name: "李默的 iPhone 15", platform: "ios" }))).toBe("李默的 iPhone 15");
  });
  it("空名按平台兜底", () => {
    expect(deviceName(dev({ platform: "web" }))).toBe("网页版");
    expect(deviceName(dev({ device_name: "   ", platform: "android" }))).toBe("Android 设备");
    expect(deviceName(dev({ platform: "xyz" }))).toBe("未知设备");
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  it("0=从未", () => expect(relativeTime(0, now)).toBe("从未"));
  it("分档", () => {
    expect(relativeTime(now - 5_000, now)).toBe("刚刚");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 小时前");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3 天前");
  });
  it("超 30 天回退日期", () => {
    const ms = Date.UTC(2023, 0, 15, 12, 0, 0);
    // 结果依赖本地时区的日历日，断言格式而非精确日
    expect(relativeTime(ms, ms + 200 * 86_400_000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("deviceSubtitle", () => {
  const now = 1_000_000_000_000;
  it("在线：在线 · 相对时间 · 位置 · IP", () => {
    const s = deviceSubtitle(dev({ online: true, last_active_at: now - 10_000, login_loc: "深圳", login_ip: "113.88.1.1" }), now);
    expect(s).toBe("在线 · 刚刚 · 深圳 · 113.88.1.1");
  });
  it("离线：N 前活跃 · 位置（不显 IP）", () => {
    const s = deviceSubtitle(dev({ online: false, last_active_at: now - 2 * 3_600_000, login_loc: "深圳", login_ip: "113.88.1.1" }), now);
    expect(s).toBe("2 小时前活跃 · 深圳");
  });
  it("缺位置/IP 自动省略", () => {
    expect(deviceSubtitle(dev({ online: true, last_active_at: now }), now)).toBe("在线 · 刚刚");
    expect(deviceSubtitle(dev({ online: false, last_active_at: now - 5 * 86_400_000 }), now)).toBe("5 天前活跃");
  });
});
