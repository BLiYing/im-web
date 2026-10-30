// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClearAllConversationsPanel } from "./ClearAllConversationsPanel";
import { PrivacySecurityPanel } from "./PrivacySecurityPanel";

afterEach(cleanup);
const st = (o = {}) => ({ busy: false, error: "", count: 3, submit: vi.fn(async () => {}), ...o });

describe("ClearAllConversationsPanel", () => {
  it("警示头 + 4 条后果 + 备份提示条 + 无密码框；红按钮直接可点并触发 submit", () => {
    const s = st();
    const { getByText, container } = render(<ClearAllConversationsPanel state={s} onBack={vi.fn()} />);
    expect(getByText("清除所有对话前请确认")).toBeTruthy();
    expect(container.querySelectorAll(".delacct-li").length).toBe(4);
    expect(getByText("想留一份备份？先到「导出我的数据」导出。")).toBeTruthy();
    expect(container.querySelector("input")).toBeNull();
    const b = container.querySelector<HTMLButtonElement>(".delacct-btn")!;
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(s.submit).toHaveBeenCalled();
  });
  it("失败：.auth-err 红字原因；busy 时按钮置灰转圈", () => {
    const { container, rerender } = render(<ClearAllConversationsPanel state={st({ error: "网络异常" })} onBack={vi.fn()} />);
    expect(container.querySelector(".auth-err")!.textContent).toBe("网络异常");
    rerender(<ClearAllConversationsPanel state={st({ busy: true })} onBack={vi.fn()} />);
    expect(container.querySelector<HTMLButtonElement>(".delacct-btn")!.disabled).toBe(true);
    expect(container.querySelector(".btn-spinner")).toBeTruthy();
  });
});

describe("PrivacySecurityPanel · 数据 ▸ 清除所有对话", () => {
  it("活行：danger 底图标、非灰置，点击进二级页（不是「即将上线」）", () => {
    const onOpenClearAll = vi.fn(), onComingSoon = vi.fn();
    const { getByText, container } = render(
      <PrivacySecurityPanel blockedCount={0} autoDeleteSec={null} visibility={null} onOpenVisibility={vi.fn()} onOpenBlocked={vi.fn()} onOpenChangePwd={vi.fn()}
        onOpenAutoDelete={vi.fn()} onOpenExport={vi.fn()} onOpenClearAll={onOpenClearAll} onOpenTwoStep={vi.fn()} onComingSoon={onComingSoon} onBack={vi.fn()} />,
    );
    const row = getByText("清除所有对话").closest("button")!;
    expect(row.className).not.toContain("muted");
    expect(row.querySelector(".row-icon-tile.danger")).toBeTruthy();
    fireEvent.click(row);
    expect(onOpenClearAll).toHaveBeenCalled();
    expect(onComingSoon).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });
});
