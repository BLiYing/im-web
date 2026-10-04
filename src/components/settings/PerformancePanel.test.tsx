// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PerformancePanel } from "./PerformancePanel";
import { DEFAULT_POWER_PREFS, powerSaveActive, effectiveItem, POWER_ITEMS, type PowerItem, type PowerPrefs } from "../../powerSave";
import type { PowerSaveSnapshot } from "../../powerSaveStore";
import { t } from "../../i18n";

afterEach(cleanup);

function view(prefs: Partial<PowerPrefs>, battery: PowerSaveSnapshot["battery"]): PowerSaveSnapshot {
  const p = { ...DEFAULT_POWER_PREFS, ...prefs };
  const active = powerSaveActive({ mode: p.mode, threshold: p.threshold, level: battery.level, charging: battery.charging, followSystem: false, systemSaver: null });
  const effective = {} as Record<PowerItem, boolean>;
  for (const k of POWER_ITEMS) effective[k] = effectiveItem(p[k], active);
  return { prefs: p, battery, active, effective };
}

function setup(prefs: Partial<PowerPrefs>, battery: PowerSaveSnapshot["battery"]) {
  const h = { onSetMode: vi.fn(), onSetThreshold: vi.fn(), onToggleItem: vi.fn(), onLocked: vi.fn(), onBack: vi.fn() };
  const r = render(<PerformancePanel ps={view(prefs, battery)} {...h} />);
  return { ...h, ...r };
}
const OK = { supported: true, level: 62, charging: false };

describe("PerformancePanel（稿 w1：自动、未触发）", () => {
  it("结构：状态行 + 三个 radio-row + 阈值滑块 + 四个 switch-row，类名照稿", () => {
    const { container } = setup({ mode: "auto" }, OK);
    expect(container.querySelector(".settings-panel.perf-panel")).not.toBeNull();
    expect(container.querySelector(".settings-row.static .row-icon-tile.yellow")).not.toBeNull();
    expect(container.querySelectorAll("button.radio-row .radio-dot")).toHaveLength(3);
    expect(container.querySelectorAll("button.radio-row .radio-dot.on")).toHaveLength(1);
    const range = container.querySelector(".range-row input[type=range]") as HTMLInputElement;
    expect([range.min, range.max, range.step, range.value]).toEqual(["5", "50", "5", "15"]);
    expect(container.querySelectorAll("label.switch-row input[type=checkbox]")).toHaveLength(4);
    expect(container.querySelectorAll(".switch-row.locked")).toHaveLength(0);
    expect(container.querySelectorAll(".section-label")).toHaveLength(2);
    expect(container.querySelectorAll(".settings-foot")).toHaveLength(2);
  });
  it("状态副标题带电量；页脚 = 退出说明 + 本机保存", () => {
    setup({ mode: "auto" }, OK);
    expect(screen.getByText(t("power_saving.status.off"))).toBeTruthy();
    expect(screen.getByText(t("power_saving.status.battery_web", { percent: 62, charging: t("power_saving.status.not_charging") }))).toBeTruthy();
    expect(screen.getByText(t("power_saving.mode.footer") + t("power_saving.mode.footer_web_suffix"))).toBeTruthy();
  });
  it("滑块只在 auto 时出现；拖动回传夹后值", () => {
    const off = setup({ mode: "off" }, OK);
    expect(off.container.querySelector("input[type=range]")).toBeNull();
    cleanup();
    const { container, onSetThreshold } = setup({ mode: "auto" }, OK);
    fireEvent.change(container.querySelector("input[type=range]")!, { target: { value: "30" } });
    expect(onSetThreshold).toHaveBeenCalledWith(30);
  });
  it("选开启方式回传 mode", () => {
    const { onSetMode } = setup({ mode: "off" }, OK);
    fireEvent.click(screen.getByText(t("power_saving.mode.always")).closest("button")!);
    expect(onSetMode).toHaveBeenCalledWith("always");
  });
  it("未生效时勾选耗电项回传", () => {
    const { container, onToggleItem, onLocked } = setup({ mode: "off" }, OK);
    fireEvent.click(container.querySelectorAll("label.switch-row input")[2]);
    expect(onToggleItem).toHaveBeenCalledWith("autoDownload", false);
    expect(onLocked).not.toHaveBeenCalled();
  });
});

describe("PerformancePanel（稿 w2：始终开启 · 读不到电量 · 锁定）", () => {
  const NO = { supported: false, level: null, charging: null };
  it("auto 行置灰禁用、换副标题；页脚换不支持版本", () => {
    const { container } = setup({ mode: "always" }, NO);
    const autoBtn = screen.getByText(t("power_saving.mode.auto")).closest("button") as HTMLButtonElement;
    expect(autoBtn.disabled).toBe(true);
    expect(autoBtn.classList.contains("dim")).toBe(true);
    expect(screen.getByText(t("power_saving.mode.auto_unsupported"))).toBeTruthy();
    expect(screen.getByText(t("power_saving.mode.footer_unsupported") + t("power_saving.mode.footer_web_suffix"))).toBeTruthy();
    expect(container.querySelector("input[type=range]")).toBeNull();
  });
  it("状态行：已开启 + 原因 + 4 项已暂停", () => {
    setup({ mode: "always" }, NO);
    expect(screen.getByText(t("power_saving.status.on"))).toBeTruthy();
    expect(screen.getByText(t("power_saving.status.active", { reason: t("power_saving.reason.always"), count: 4 }))).toBeTruthy();
  });
  it("四行锁定：复选框 aria-disabled 不勾、副标题=已暂停；点整行 → onLocked，不改值", () => {
    const { container, onToggleItem, onLocked } = setup({ mode: "always" }, NO);
    const rows = container.querySelectorAll("label.switch-row.locked");
    expect(rows).toHaveLength(4);
    rows.forEach((r) => {
      const cb = r.querySelector("input") as HTMLInputElement;
      expect(cb.getAttribute("aria-disabled")).toBe("true");
      expect(cb.disabled).toBe(false); // 保持可聚焦，键盘也能触发锁定提示
      expect(cb.checked).toBe(false);
      expect(r.textContent).toContain(t("power_saving.item.paused"));
    });
    fireEvent.click(rows[1]);
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(onToggleItem).not.toHaveBeenCalled();
  });
  it("auto 触发的原因文案带阈值", () => {
    setup({ mode: "auto", threshold: 20 }, { supported: true, level: 10, charging: false });
    expect(screen.getByText(t("power_saving.status.active", { reason: t("power_saving.reason.battery", { percent: 20 }), count: 4 }))).toBeTruthy();
  });
});

describe("PerformancePanel 状态行暂停数", () => {
  it("只数用户值为开的项：关了动画和毛玻璃 → 2 项已暂停；行仍全部锁定显示已暂停", () => {
    const { container } = setup({ mode: "always", animations: false, blur: false }, { supported: false, level: null, charging: null });
    expect(screen.getByText(t("power_saving.status.active", { reason: t("power_saving.reason.always"), count: 2 }))).toBeTruthy();
    expect(container.querySelectorAll("label.switch-row.locked")).toHaveLength(4);
  });
});

describe("PerformancePanel 无障碍", () => {
  it("开启方式：radiogroup 由「开启方式」标签命名；radio 带 aria-checked", () => {
    const { container } = setup({ mode: "auto" }, OK);
    const g = container.querySelector('[role="radiogroup"]')!;
    const label = container.querySelector(`#${g.getAttribute("aria-labelledby")}`)!;
    expect(label.textContent).toBe(t("power_saving.mode.header"));
    const radios = container.querySelectorAll('button[role="radio"]');
    expect([...radios].map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });
  it("阈值滑块：aria-label + aria-valuetext", () => {
    const { container } = setup({ mode: "auto", threshold: 20 }, OK);
    const r = container.querySelector("input[type=range]")!;
    expect(r.getAttribute("aria-label")).toBe(t("power_saving.threshold.label"));
    expect(r.getAttribute("aria-valuetext")).toBe("20%");
  });
  it("锁定行：键盘（直接点复选框，Space 等价）也弹锁定提示、不改值；点整行只触发一次", () => {
    const { container, onLocked, onToggleItem } = setup({ mode: "always" }, { supported: false, level: null, charging: null });
    const cb = container.querySelector("label.switch-row.locked input") as HTMLInputElement;
    cb.focus();
    expect(document.activeElement).toBe(cb);
    fireEvent.click(cb);
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(cb.checked).toBe(false);
    fireEvent.click(screen.getAllByText(t("power_saving.item.paused"))[0]);
    expect(onLocked).toHaveBeenCalledTimes(2);
    expect(onToggleItem).not.toHaveBeenCalled();
  });
});
