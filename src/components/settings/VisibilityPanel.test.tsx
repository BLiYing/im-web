// @vitest-environment jsdom
// 「谁能看到」单选页：选中即保存并返回；PUT 只带被改项；失败 toast + 回滚且不返回。
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisibilityPanel } from "./VisibilityPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubFetch(opts: { get: Record<string, unknown>; putOk: boolean }, puts: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(opts.putOk ? { code: 0, data: {} } : { code: 100001, message: "bad" }), { status: opts.putOk ? 200 : 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ code: 0, data: opts.get }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}
const props = () => ({ token: () => "t", setToast: vi.fn(), onSaved: vi.fn(), onBack: vi.fn() });

describe("VisibilityPanel", () => {
  it("标题=行名，当前项带勾，进页 GET 校正选中项", async () => {
    stubFetch({ get: { last_seen_visibility: "nobody", avatar_visibility: "everyone" }, putOk: true }, []);
    const { getByText, container, findByText } = render(<VisibilityPanel kind="lastSeen" initial="contacts" {...props()} />);
    expect(getByText("上次上线")).toBeTruthy();
    expect(getByText("决定谁能看到你的在线状态和上次上线时间。你自己始终可见。")).toBeTruthy();
    await findByText("无人");
    await waitFor(() => expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe("无人"));
  });

  it("选中：PUT 只带被改的一项，成功后回传并返回", async () => {
    const puts: unknown[] = [];
    stubFetch({ get: {}, putOk: true }, puts);
    const p = props();
    const { getByText } = render(<VisibilityPanel kind="avatar" initial="everyone" {...p} />);
    fireEvent.click(getByText("无人"));
    await waitFor(() => expect(p.onBack).toHaveBeenCalled());
    expect(puts).toEqual([{ avatar_visibility: "nobody" }]);
    expect(p.onSaved).toHaveBeenCalledWith("nobody");
    expect(p.setToast).not.toHaveBeenCalled();
  });

  it("保存失败：toast ps.visibility.save_failed、选中态回滚、不返回", async () => {
    stubFetch({ get: { avatar_visibility: "everyone" }, putOk: false }, []);
    const p = props();
    const { getByText, container } = render(<VisibilityPanel kind="avatar" initial="everyone" {...p} />);
    fireEvent.click(getByText("我的联系人"));
    await waitFor(() => expect(p.setToast).toHaveBeenCalledWith("设置失败，请稍后重试"));
    expect(p.onBack).not.toHaveBeenCalled();
    expect(p.onSaved).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe("所有人");
  });

  it("同一帧内连点两项：只发一次 PUT（同步在途守卫）", async () => {
    const puts: unknown[] = [];
    stubFetch({ get: {}, putOk: true }, puts);
    const p = props();
    const { getByText } = render(<VisibilityPanel kind="avatar" initial="everyone" {...p} />);
    const a = getByText("无人"), b = getByText("我的联系人");
    act(() => { a.click(); b.click(); }); // 同一 act 内：中间没有重渲染，state 版 busy 守不住
    await waitFor(() => expect(p.onBack).toHaveBeenCalled());
    expect(puts).toEqual([{ avatar_visibility: "nobody" }]);
  });

  it("个人简介 / 手机号码：标题、页脚、PUT 字段各自独立（只带被改的一项）", async () => {
    const puts: unknown[] = [];
    stubFetch({ get: {}, putOk: true }, puts);
    const p = props();
    const { getByText, unmount } = render(<VisibilityPanel kind="phone" initial="nobody" {...p} />);
    expect(getByText("手机号码")).toBeTruthy();
    expect(getByText(/决定谁能在你的资料页看到手机号码/)).toBeTruthy();
    fireEvent.click(getByText("我的联系人"));
    await waitFor(() => expect(p.onBack).toHaveBeenCalled());
    expect(puts).toEqual([{ phone_visibility: "contacts" }]);
    unmount();
    const q = props();
    const r = render(<VisibilityPanel kind="bio" initial="everyone" {...q} />);
    expect(r.getByText("个人简介")).toBeTruthy();
    fireEvent.click(r.getByText("无人"));
    await waitFor(() => expect(q.onBack).toHaveBeenCalled());
    expect(puts[1]).toEqual({ bio_visibility: "nobody" });
  });
});
