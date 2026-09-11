// 全局快捷键的判据。真注册器由 `--shell-check` 验；这里钉的是那几条「错了也不报错」的分支：
// 被占用时谎报开启、去拆别人注册的组合键、默认就抢键、重复注册被误判成被占用。
import { describe, expect, it } from "vitest";
import {
  createGlobalShortcut, shortcutAccelerator, shortcutLabel, toggleActionFor,
  type GlobalShortcutDeps, type ShortcutRegistry,
} from "../src/main/globalShortcutCap";

/** 假注册器：`heldByOthers` 里的组合键注册必失败（模拟被别的应用占着）。 */
function fakeRegistry(heldByOthers: string[] = []) {
  const mine = new Set<string>();
  const calls: string[] = [];
  const registry: ShortcutRegistry = {
    register: (acc) => {
      calls.push(`register ${acc}`);
      if (heldByOthers.includes(acc) || mine.has(acc)) return false;   // Electron 对重复注册也回 false
      mine.add(acc);
      return true;
    },
    unregister: (acc) => { calls.push(`unregister ${acc}`); mine.delete(acc); },
    isRegistered: (acc) => mine.has(acc),
  };
  return { registry, mine, calls };
}

function setup(opts: { pref?: boolean; held?: string[]; platform?: NodeJS.Platform } = {}) {
  const reg = fakeRegistry(opts.held);
  const saved: boolean[] = [];
  const deps: GlobalShortcutDeps = {
    registry: reg.registry, platform: opts.platform ?? "darwin",
    load: () => opts.pref ?? false, save: (on) => { saved.push(on); }, onPress: () => {},
  };
  return { gs: createGlobalShortcut(deps), reg, saved };
}

const MAC = "Control+Command+W";

describe("组合键与按下后的动作", () => {
  it("macOS ⌃⌘W，Windows Ctrl+Alt+W", () => {
    expect(shortcutAccelerator("darwin")).toBe(MAC);
    expect(shortcutAccelerator("win32")).toBe("Control+Alt+W");
    expect(shortcutLabel("darwin")).toBe("⌃⌘W");
    expect(shortcutLabel("win32")).toBe("Ctrl+Alt+W");
  });

  it("窗口在前台才收起；不可见或被别的窗口挡着 → 叫出来", () => {
    expect(toggleActionFor(true, true)).toBe("hide");
    expect(toggleActionFor(true, false)).toBe("show");
    expect(toggleActionFor(false, false)).toBe("show");
  });
});

describe("createGlobalShortcut", () => {
  it("**默认关**：偏好没开时启动不注册任何组合键", () => {
    const { gs, reg } = setup({ pref: false });
    gs.restore();
    expect(reg.calls).toEqual([]);
    expect(gs.state().enabled).toBe(false);
  });

  it("偏好开着 → 启动时注册上", () => {
    const { gs, reg } = setup({ pref: true });
    gs.restore();
    expect(reg.mine.has(MAC)).toBe(true);
    expect(gs.state()).toEqual({ enabled: true, label: "⌃⌘W" });
  });

  it("打开 → 注册并记下偏好；关闭 → 释放并记下偏好", () => {
    const { gs, reg, saved } = setup();
    expect(gs.set(true)).toEqual({ enabled: true, label: "⌃⌘W" });
    expect(reg.mine.has(MAC)).toBe(true);
    expect(gs.set(false)).toEqual({ enabled: false, label: "⌃⌘W" });
    expect(reg.mine.has(MAC)).toBe(false);
    expect(saved).toEqual([true, false]);
  });

  it("**被别的应用占用** → 如实报没开（taken），不记「开」", () => {
    const { gs, saved } = setup({ held: [MAC] });
    expect(gs.set(true)).toEqual({ enabled: false, label: "⌃⌘W", taken: true });
    expect(gs.state().enabled).toBe(false);
    expect(saved).toEqual([false]);
  });

  it("**没注册上就绝不去 unregister**——那个组合键在别人手里，拆的是别人的", () => {
    const { gs, reg } = setup({ held: [MAC] });
    gs.set(true);
    gs.set(false);
    gs.dispose();
    expect(reg.calls.filter((c) => c.startsWith("unregister"))).toEqual([]);
  });

  it("偏好开着但启动时被占用 → 状态报关，但**不改偏好**（那个应用退出后下次还能拿到）", () => {
    const { gs, saved } = setup({ pref: true, held: [MAC] });
    gs.restore();
    expect(gs.state().enabled).toBe(false);
    expect(saved).toEqual([]);
  });

  it("已经开着再点开：不重复注册（Electron 对重复注册回 false，会被误判成被占用）", () => {
    const { gs, reg } = setup();
    gs.set(true);
    expect(gs.set(true)).toEqual({ enabled: true, label: "⌃⌘W" });
    expect(reg.calls.filter((c) => c.startsWith("register"))).toHaveLength(1);
  });

  it("dispose 释放自己注册的", () => {
    const { gs, reg } = setup({ pref: true });
    gs.restore();
    gs.dispose();
    expect(reg.mine.has(MAC)).toBe(false);
  });
});
