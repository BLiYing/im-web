// @vitest-environment jsdom
// 我的资料面板（PROFILE_BIO_DESIGN §2）：信息卡顺序 个性签名 → 用户名 → 手机；编辑态个性签名多行 + 计数，标签已移除。
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditProfilePanel, type ProfileDraft } from "./EditProfilePanel";

afterEach(cleanup);

const draft = (over: Partial<ProfileDraft> = {}): ProfileDraft => ({ nickname: "李颖", username: "liying", avatar_url: "", phone: "138", bio: "慢慢来，比较快", ...over });
const props = (over: Partial<Parameters<typeof EditProfilePanel>[0]> = {}) => ({
  draft: draft(), uid: "u1", busy: false, editing: false,
  onEnterEditing: vi.fn(), onCancelEditing: vi.fn(), onChange: vi.fn(), onSave: vi.fn(), onPickAvatar: vi.fn(), onDeleteAccount: vi.fn(), onBack: vi.fn(),
  ...over,
});

describe("EditProfilePanel · 只读态", () => {
  it("信息卡顺序：个性签名 → 用户名 → 手机", () => {
    const { container } = render(<EditProfilePanel {...props()} />);
    const items = Array.from(container.querySelectorAll(".settings-group > *")).map((e) => e.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("慢慢来，比较快");
    expect(items[1]).toContain("@liying");
    expect(items[2]).toContain("138");
  });
  it("没写签名 / 没填手机号：对应行整行不占位", () => {
    const { container } = render(<EditProfilePanel {...props({ draft: draft({ bio: "", phone: "" }) })} />);
    expect(container.querySelectorAll(".settings-group > *")).toHaveLength(1);
    expect(container.querySelector(".settings-bio")).toBeNull();
  });
});

describe("EditProfilePanel · 编辑态", () => {
  it("没有「标签」输入；个性签名是 textarea，带 n/70 计数", () => {
    const { container, queryByText } = render(<EditProfilePanel {...props({ editing: true })} />);
    expect(queryByText("标签")).toBeNull();
    expect(container.querySelector("textarea")?.value).toBe("慢慢来，比较快");
    expect(container.querySelector(".edit-bio-count")?.textContent).toBe("7/70");
  });
  it("输入：换行折空格、超长按码点截断；≥60 计数变红", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<EditProfilePanel {...props({ editing: true, onChange })} />);
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "a\nb" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bio: "a b" }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "字".repeat(90) } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bio: "字".repeat(70) }));
    rerender(<EditProfilePanel {...props({ editing: true, draft: draft({ bio: "字".repeat(60) }) })} />);
    expect(container.querySelector(".edit-bio-count")?.classList.contains("warn")).toBe(true);
  });
});

describe("EditProfilePanel · 输入法与回车", () => {
  it("组词期间不截断（拼音字母不算进上限），组词结束才按码点截断", () => {
    const onChange = vi.fn();
    const { container } = render(<EditProfilePanel {...props({ editing: true, onChange, draft: draft({ bio: "字".repeat(69) }) })} />);
    const ta = container.querySelector("textarea")!;
    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: "字".repeat(69) + "nihao" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bio: "字".repeat(69) + "nihao" })); // 组词中原样放行
    ta.value = "字".repeat(69) + "nihao"; // 受控值由父组件回灌；本测试的父组件是 mock，手动模拟 DOM 里已有的组词结果
    fireEvent.compositionEnd(ta);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bio: "字".repeat(69) + "n" })); // 提交后：72→70 码点
  });
  it("回车不换行", () => {
    const { container } = render(<EditProfilePanel {...props({ editing: true })} />);
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    container.querySelector("textarea")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
