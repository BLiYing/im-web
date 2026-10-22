// @vitest-environment jsdom
// 自动删除档位组：固定 5 行 + 自定义行；非固定档 ✓ 与右值归自定义行；弹窗点行等同直接选档。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { AutoDeleteTiers } from "./AutoDeleteTiers";

afterEach(cleanup);
describe("AutoDeleteTiers", () => {
  it("固定档：自身打勾，自定义行无右值", () => {
    render(<AutoDeleteTiers value={120} onPick={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: /2 分钟/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /自定义/ }).getAttribute("aria-checked")).toBe("false");
  });
  it("非固定档（3 天）：✓ 在自定义行并显示该时长；弹窗 18 行，点行回调并关闭", () => {
    const onPick = vi.fn();
    render(<AutoDeleteTiers value={3 * 86400} onPick={onPick} />);
    const custom = screen.getByRole("radio", { name: /自定义/ });
    expect(custom.getAttribute("aria-checked")).toBe("true");
    expect(custom.textContent).toContain("3 天");
    fireEvent.click(custom);
    const group = screen.getAllByRole("radiogroup")[1];
    expect(within(group).getAllByRole("radio")).toHaveLength(18);
    fireEvent.click(within(group).getByRole("radio", { name: "1 年" }));
    expect(onPick).toHaveBeenCalledWith(31536000);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
  });
  it("只读：点任意行（含自定义）只回调 onReadOnlyTap，不选、不开弹窗", () => {
    const onPick = vi.fn(); const tap = vi.fn();
    render(<AutoDeleteTiers value={120} onPick={onPick} readOnly onReadOnlyTap={tap} />);
    fireEvent.click(screen.getByRole("radio", { name: /1 天/ }));
    fireEvent.click(screen.getByRole("radio", { name: /自定义/ }));
    expect(tap).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /2 分钟/ }).getAttribute("aria-checked")).toBe("true");
  });
  it("自定义弹窗：Esc 关闭且不选档", () => {
    const onPick = vi.fn();
    render(<AutoDeleteTiers value={120} onPick={onPick} />);
    fireEvent.click(screen.getByRole("radio", { name: /自定义/ }));
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});
