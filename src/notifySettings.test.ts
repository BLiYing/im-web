// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  DEFAULT_NOTIFY_SETTINGS, loadNotifySettings, normalizeSoundId, parseNotifySettings,
  saveNotifySettings, useNotifySettings,
} from "./notifySettings";

afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）
beforeEach(() => { localStorage.clear(); });

describe("默认值", () => {
  it("应用内提示音/振动/预览默认关（2026-09-29 用户决定），分类通知默认开", () => {
    expect(DEFAULT_NOTIFY_SETTINGS.inApp).toEqual({ sound: false, vibrate: false, preview: false });
    expect(DEFAULT_NOTIFY_SETTINGS.private.enabled).toBe(true);
    expect(DEFAULT_NOTIFY_SETTINGS.group.enabled).toBe(true);
  });
});

describe("parseNotifySettings：非法值回落，per-field 不牵连", () => {
  it("空/垃圾输入 → 全默认", () => {
    expect(parseNotifySettings(undefined)).toEqual(DEFAULT_NOTIFY_SETTINGS);
    expect(parseNotifySettings(null)).toEqual(DEFAULT_NOTIFY_SETTINGS);
    expect(parseNotifySettings("not an object")).toEqual(DEFAULT_NOTIFY_SETTINGS);
    expect(parseNotifySettings([])).toEqual(DEFAULT_NOTIFY_SETTINGS);
  });

  it("未知提示音 id 回落 default，不影响同一 type 的其它字段", () => {
    const r = parseNotifySettings({ private: { enabled: false, preview: true, sound: "xylophone" } });
    expect(r.private).toEqual({ enabled: false, preview: true, sound: "default" });
    expect(r.group).toEqual(DEFAULT_NOTIFY_SETTINGS.group); // 没给 group → 整段默认
  });

  it("音量非数字/越界 → 钳制到 0~10，不影响 desktop 其它字段", () => {
    expect(parseNotifySettings({ desktop: { enabled: false, sound: true, volume: "abc" } }).desktop.volume).toBe(7);
    expect(parseNotifySettings({ desktop: { volume: -3 } }).desktop.volume).toBe(0);
    expect(parseNotifySettings({ desktop: { volume: 99 } }).desktop.volume).toBe(10);
    expect(parseNotifySettings({ desktop: { volume: 4.6 } }).desktop.volume).toBe(5);
    expect(parseNotifySettings({ desktop: { enabled: false, sound: true, volume: -3 } }).desktop.enabled).toBe(false);
  });

  it("单个字段坏了不拖累整份——一个 badge.includeMuted 传字符串，其余字段仍各自生效", () => {
    const r = parseNotifySettings({
      badge: { includeMuted: "yes" },
      inApp: { sound: false, vibrate: true, preview: false },
    });
    expect(r.badge.includeMuted).toBe(DEFAULT_NOTIFY_SETTINGS.badge.includeMuted); // 非法 → 回落默认
    expect(r.inApp).toEqual({ sound: false, vibrate: true, preview: false }); // 合法字段原样保留
  });
});

describe("normalizeSoundId", () => {
  it("六个合法 id 原样通过，非法一律回落 default", () => {
    for (const id of ["none", "default", "chord", "chime", "rise", "drop"] as const) {
      expect(normalizeSoundId(id)).toBe(id);
    }
    expect(normalizeSoundId("xylophone")).toBe("default");
    expect(normalizeSoundId(123)).toBe("default");
    expect(normalizeSoundId(undefined)).toBe("default");
  });
});

describe("load/save 往返", () => {
  it("没有存过 → 默认值；save 后 load 拿回同一份", () => {
    expect(loadNotifySettings()).toEqual(DEFAULT_NOTIFY_SETTINGS);
    const custom = { ...DEFAULT_NOTIFY_SETTINGS, desktop: { enabled: false, sound: true, volume: 3 } };
    saveNotifySettings(custom);
    expect(loadNotifySettings()).toEqual(custom);
  });

  it("localStorage 里塞的是损坏 JSON → 回落默认，不抛异常", () => {
    localStorage.setItem("im.notif.v1", "{not json");
    expect(loadNotifySettings()).toEqual(DEFAULT_NOTIFY_SETTINGS);
  });
});

describe("useNotifySettings：一组 setter + 持久化 + 重置", () => {
  it("初始从 localStorage 恢复", () => {
    saveNotifySettings({ ...DEFAULT_NOTIFY_SETTINGS, badge: { includeMuted: true } });
    const { result } = renderHook(() => useNotifySettings());
    expect(result.current.settings.badge.includeMuted).toBe(true);
  });

  it("setPrivate/setGroup/setInApp/setBadge/setDesktop 各自 patch 并持久化", () => {
    const { result } = renderHook(() => useNotifySettings());
    act(() => result.current.setPrivate({ sound: "chime" }));
    expect(result.current.settings.private).toEqual({ enabled: true, preview: true, sound: "chime" });
    act(() => result.current.setGroup({ enabled: false }));
    expect(result.current.settings.group.enabled).toBe(false);
    act(() => result.current.setInApp({ vibrate: false }));
    expect(result.current.settings.inApp.vibrate).toBe(false);
    act(() => result.current.setBadge({ includeMuted: true }));
    expect(result.current.settings.badge.includeMuted).toBe(true);
    act(() => result.current.setDesktop({ volume: 2 }));
    expect(result.current.settings.desktop.volume).toBe(2);
    // 全部改动持久化：重新挂载应读回同一份
    const again = renderHook(() => useNotifySettings());
    expect(again.result.current.settings).toEqual(result.current.settings);
  });

  it("重置恢复默认值（不涉及任何会话免打扰状态——本 hook 本就不持有会话数据）", () => {
    const { result } = renderHook(() => useNotifySettings());
    act(() => { result.current.setDesktop({ volume: 1, enabled: false }); result.current.setBadge({ includeMuted: true }); });
    expect(result.current.settings).not.toEqual(DEFAULT_NOTIFY_SETTINGS);
    act(() => result.current.reset());
    expect(result.current.settings).toEqual(DEFAULT_NOTIFY_SETTINGS);
    expect(loadNotifySettings()).toEqual(DEFAULT_NOTIFY_SETTINGS);
  });
});
