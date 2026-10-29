// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountPanel } from "./DeleteAccountPanel";
import { EditProfilePanel } from "./EditProfilePanel";
import type { DeleteAccountState } from "../../useDeleteAccount";

afterEach(cleanup);
const state = (o: Partial<DeleteAccountState> = {}): DeleteAccountState => ({
  password: "", setPassword: vi.fn(), busy: false, error: "", ownedGroups: [], canSubmit: false, submit: vi.fn(async () => {}), ...o,
});

describe("DeleteAccountPanel", () => {
  it("警示头 + 4 条后果 + 冷静期条 + 密码框，空密码按钮置灰", () => {
    const { getByText, container } = render(<DeleteAccountPanel state={state()} onBack={vi.fn()} />);
    expect(getByText("注销前请确认")).toBeTruthy();
    expect(container.querySelectorAll(".delacct-li").length).toBe(4);
    expect(getByText("7 天内重新登录即可恢复账号；超过 7 天将永久删除。")).toBeTruthy();
    expect(container.querySelector<HTMLButtonElement>(".delacct-btn")!.disabled).toBe(true);
    expect(container.querySelector(".delacct-owned")).toBeNull();
  });
  it("填了密码 → 按钮可点，点击触发 submit", () => {
    const s = state({ password: "pw", canSubmit: true });
    const { container } = render(<DeleteAccountPanel state={s} onBack={vi.fn()} />);
    const b = container.querySelector<HTMLButtonElement>(".delacct-btn")!;
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(s.submit).toHaveBeenCalled();
  });
  it("群主阻断态：显示提示卡与群名，密码框与按钮置灰", () => {
    const s = state({ password: "pw", ownedGroups: [{ conv_id: "g1", name: "产品讨论组" }] });
    const { container, getByText } = render(<DeleteAccountPanel state={s} onBack={vi.fn()} />);
    expect(container.querySelector(".delacct-owned")!.textContent).toContain("产品讨论组");
    expect(getByText(/请先转让群主或解散群/)).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>(".delacct-pwd input")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".delacct-btn")!.disabled).toBe(true);
  });
  it("阻断态群名可点 → onOpenGroup(conv_id)", () => {
    const onOpenGroup = vi.fn();
    const s = state({ ownedGroups: [{ conv_id: "g1", name: "产品讨论组" }, { conv_id: "g2", name: "B" }] });
    const { getByText } = render(<DeleteAccountPanel state={s} onBack={vi.fn()} onOpenGroup={onOpenGroup} />);
    fireEvent.click(getByText("B"));
    expect(onOpenGroup).toHaveBeenCalledWith("g2");
  });
  it("眼睛按钮切换明文", () => {
    const { container } = render(<DeleteAccountPanel state={state()} onBack={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>(".delacct-pwd input")!;
    expect(input.type).toBe("password");
    fireEvent.click(container.querySelector(".delacct-pwd button")!);
    expect(input.type).toBe("text");
  });
});

describe("EditProfilePanel 注销入口", () => {
  const props = { draft: { nickname: "李默", username: "limo", avatar_url: "", phone: "", bio: "" }, uid: "u", busy: false,
    onEnterEditing: vi.fn(), onCancelEditing: vi.fn(), onChange: vi.fn(), onSave: vi.fn(), onPickAvatar: vi.fn(), onBack: vi.fn() };
  it("只读态底部有红字入口 + 脚注，点击回调", () => {
    const onDeleteAccount = vi.fn();
    const { getByText, container } = render(<EditProfilePanel {...props} editing={false} onDeleteAccount={onDeleteAccount} />);
    const btn = getByText("注销账号");
    expect(btn.className).toContain("settings-logout");
    expect(container.textContent).toContain("注销后账号将在 7 天后永久删除，期间重新登录可恢复。");
    fireEvent.click(btn);
    expect(onDeleteAccount).toHaveBeenCalled();
  });
  it("编辑态隐藏入口与脚注", () => {
    const { queryByText } = render(<EditProfilePanel {...props} editing={true} onDeleteAccount={vi.fn()} />);
    expect(queryByText("注销账号")).toBeNull();
    expect(queryByText(/注销后账号将在/)).toBeNull();
  });
});
