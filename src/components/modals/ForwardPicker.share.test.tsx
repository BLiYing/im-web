// @vitest-environment jsdom
// 分享选择页（SHARE_PICKER_UX_SKETCH）：好友 / 群聊入口、底部已选栏、发送确认面板，以及「添加例外」不受影响。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ForwardPicker, type ShareSources } from "./ForwardPicker";
import type { Conversation, FriendEntry } from "../../sdk/protocol";
import { friendTarget, groupTarget } from "../../shareTargets";

afterEach(cleanup);

const ME = "1";
const conv = (id: string, peer: string, extra: Partial<Conversation> = {}): Conversation =>
  ({ conv_id: id, peer, last_message: null, latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0, ...extra });
const friend = (id: string, nickname: string): FriendEntry => ({ user_id: id, nickname, avatar_url: "", status: "accepted", updated_at: 0 });

const recent = [conv("u_1_u_2", "2", { peer_nickname: "张三" }), conv("g_a", "", { is_group: true, name: "产品群" })];
const sources: ShareSources = {
  friends: [friendTarget(ME, friend("2", "张三")), friendTarget(ME, friend("3", "赵六"))],
  groups: [groupTarget({ conv_id: "g_a", name: "产品群", owner: "", avatar_url: "", created_at: 0 }),
    groupTarget({ conv_id: "g_b", name: "家庭群", owner: "", avatar_url: "", created_at: 0 })],
  preview: "[个人名片] 张三",
};
const label = (c: Conversation) => (c.is_group ? c.name ?? "" : c.peer_nickname ?? c.peer);
const base = {
  count: 1, conversations: recent, mode: "each" as const, convAvatarUrl: () => undefined, convDisplayLabel: label,
  onToggleMulti: vi.fn(), onSetMode: vi.fn(), onClose: vi.fn(),
};
const rowLabel = (text: string) => screen.queryByText(text, { selector: ".fwd-item-label" });

describe("ForwardPicker 不传 sources（「添加例外」）行为不变", () => {
  it("不出好友 / 群聊入口，也不出底部已选栏（多选态也不出）", () => {
    render(<ForwardPicker {...base} multi targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    expect(rowLabel("我的好友")).toBeNull();
    expect(rowLabel("我的群聊")).toBeNull();
    expect(screen.queryByTestId("fwd-bar")).toBeNull();
  });
});

describe("ForwardPicker 好友 / 群聊入口与子视图", () => {
  it("单选、多选都显示两个入口行；点「我的好友」原地切到好友视图（标题变返回），返回回到主视图", () => {
    const { rerender } = render(<ForwardPicker {...base} sources={sources} multi={false} targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    expect(rowLabel("我的好友")).toBeTruthy();
    rerender(<ForwardPicker {...base} sources={sources} multi targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    expect(rowLabel("我的群聊")).toBeTruthy();
    fireEvent.click(screen.getByText("我的好友", { selector: ".fwd-item-label" }));
    const back = screen.getByText("我的好友", { selector: ".fwd-back" });
    expect(rowLabel("赵六")).toBeTruthy();
    expect(rowLabel("产品群")).toBeNull(); // 好友视图不列会话
    fireEvent.click(back);
    expect(rowLabel("产品群")).toBeTruthy();
  });

  it("勾选状态按 conv_id 跨列表同步：最近聊天里勾的张三，在好友视图里也是勾上的", () => {
    render(<ForwardPicker {...base} sources={sources} multi targets={["u_1_u_2"]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    fireEvent.click(screen.getByText("我的好友", { selector: ".fwd-item-label" }));
    const row = screen.getByText("张三", { selector: ".fwd-item-label" }).closest(".fwd-item") as HTMLElement;
    expect(row.querySelector(".checkbox.on")).toBeTruthy();
    const other = screen.getByText("赵六", { selector: ".fwd-item-label" }).closest(".fwd-item") as HTMLElement;
    expect(other.querySelector(".checkbox.on")).toBeNull();
  });

  it("多选态子视图点行回传该目标的 conv_id（群用 g_xxx，好友用本地推导的 u_a_u_b）", () => {
    const onToggleTarget = vi.fn();
    render(<ForwardPicker {...base} sources={sources} multi targets={[]} onToggleTarget={onToggleTarget} onForward={vi.fn()} />);
    fireEvent.click(screen.getByText("我的群聊", { selector: ".fwd-item-label" }));
    fireEvent.click(screen.getByText("家庭群", { selector: ".fwd-item-label" }));
    expect(onToggleTarget).toHaveBeenCalledWith("g_b");
  });

  it("单选态子视图：点没聊过的好友直接 onForward([合成目标])", () => {
    const onForward = vi.fn();
    render(<ForwardPicker {...base} sources={sources} multi={false} targets={[]} onToggleTarget={vi.fn()} onForward={onForward} />);
    fireEvent.click(screen.getByText("我的好友", { selector: ".fwd-item-label" }));
    fireEvent.click(screen.getByText("赵六", { selector: ".fwd-item-label" }));
    expect(onForward).toHaveBeenCalledWith([expect.objectContaining({ conv_id: "u_1_u_3", peer: "3", is_group: false })]);
  });

  it("群列表加载中显示加载态", () => {
    render(<ForwardPicker {...base} sources={{ ...sources, groups: null }} multi={false} targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    fireEvent.click(screen.getByText("我的群聊", { selector: ".fwd-item-label" }));
    expect(screen.getByText("加载中…")).toBeTruthy();
  });

  it("主页搜索同时搜三处、分组显示，已在最近聊天里的群不在群聊分组重复；入口行搜索时隐藏", () => {
    render(<ForwardPicker {...base} sources={sources} multi={false} targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("搜索会话"), { target: { value: "群" } });
    expect(rowLabel("我的群聊")).toBeNull();
    expect(screen.getByText("最近聊天")).toBeTruthy();
    expect(screen.getByText("群聊", { selector: ".fwd-sec" })).toBeTruthy();
    expect(screen.getAllByText("产品群", { selector: ".fwd-item-label" })).toHaveLength(1);
    expect(rowLabel("家庭群")).toBeTruthy();
  });
});

describe("ForwardPicker 底部已选栏与发送确认面板", () => {
  it("多选态已选栏常驻：没选时显示提示 + 发送禁用；标题下显示「已选 0/9」", () => {
    render(<ForwardPicker {...base} sources={sources} multi targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    const bar = screen.getByTestId("fwd-bar");
    expect(within(bar).getByText("选择最多 9 个好友或群聊")).toBeTruthy();
    expect((within(bar).getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("已选 0/9")).toBeTruthy();
  });

  it("已选栏按勾选顺序列出（含没聊过的好友），点 × 回传 onToggleTarget 取消勾选", () => {
    const onToggleTarget = vi.fn();
    render(<ForwardPicker {...base} sources={sources} multi targets={["u_1_u_3", "g_a"]} onToggleTarget={onToggleTarget} onForward={vi.fn()} />);
    const bar = screen.getByTestId("fwd-bar");
    expect([...bar.querySelectorAll(".chip-name")].map((n) => n.textContent)).toEqual(["赵六", "产品群"]);
    fireEvent.click(bar.querySelectorAll(".chip-x")[0]);
    expect(onToggleTarget).toHaveBeenCalledWith("u_1_u_3");
    expect(within(bar).getByText("发送(2)")).toBeTruthy();
  });

  it("点「发送(N)」先弹确认面板（标题 + 目标 + 预览），面板里点「发送」才 onForward（勾选顺序）", () => {
    const onForward = vi.fn();
    render(<ForwardPicker {...base} sources={sources} multi targets={["g_b", "u_1_u_3"]} onToggleTarget={vi.fn()} onForward={onForward} />);
    fireEvent.click(screen.getByText("发送(2)"));
    expect(onForward).not.toHaveBeenCalled();
    const panel = screen.getByTestId("fwd-confirm");
    expect(within(panel).getByText("分别发送给（2）")).toBeTruthy();
    expect(within(panel).getByTestId("fwd-preview").textContent).toBe("[个人名片] 张三");
    fireEvent.click(within(panel).getByRole("button", { name: "发送" }));
    expect(onForward).toHaveBeenCalledWith([
      expect.objectContaining({ conv_id: "g_b", is_group: true }),
      expect.objectContaining({ conv_id: "u_1_u_3", peer: "3" }),
    ]);
  });

  it("确认面板里 × 删除目标；删到 0 个面板关闭", () => {
    const onToggleTarget = vi.fn();
    const props = { ...base, sources, multi: true, onToggleTarget, onForward: vi.fn() };
    const { rerender } = render(<ForwardPicker {...props} targets={["g_b"]} />);
    fireEvent.click(screen.getByText("发送(1)"));
    const panel = screen.getByTestId("fwd-confirm");
    fireEvent.click(panel.querySelector(".chip-x") as HTMLElement);
    expect(onToggleTarget).toHaveBeenCalledWith("g_b");
    rerender(<ForwardPicker {...props} targets={[]} />);
    expect(screen.queryByTestId("fwd-confirm")).toBeNull();
    // 重新勾选后不会自己再弹出来（关闭是真的复位，不只是隐藏）
    rerender(<ForwardPicker {...props} targets={["g_a"]} />);
    expect(screen.queryByTestId("fwd-confirm")).toBeNull();
  });
});

describe("ForwardPicker exclude / 幽灵选中 / 群列表加载失败", () => {
  it("exclude 对三个来源一次生效：最近聊天、我的群聊、主页搜索都不出现该群", () => {
    render(<ForwardPicker {...base} sources={sources} exclude={["g_a"]} multi={false} targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    expect(rowLabel("产品群")).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索会话"), { target: { value: "群" } });
    expect(rowLabel("产品群")).toBeNull();
    expect(rowLabel("家庭群")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索会话"), { target: { value: "" } });
    fireEvent.click(screen.getByText("我的群聊", { selector: ".fwd-item-label" }));
    expect(rowLabel("产品群")).toBeNull();
    expect(rowLabel("家庭群")).toBeTruthy();
  });

  it("来源齐了还解析不到的选中 id（中途被删的好友）剔掉，保持勾选顺序", () => {
    const onPruneTargets = vi.fn();
    render(<ForwardPicker {...base} sources={sources} multi targets={["g_b", "u_1_u_999", "u_1_u_3"]}
      onPruneTargets={onPruneTargets} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    expect(onPruneTargets).toHaveBeenCalledWith(["g_b", "u_1_u_3"]);
  });

  it("群列表还在加载 / 加载失败时不剔（那时群 id 解析不到是正常的）", () => {
    const onPruneTargets = vi.fn();
    const props = { ...base, multi: true, targets: ["g_b"], onPruneTargets, onToggleTarget: vi.fn(), onForward: vi.fn() };
    const { rerender } = render(<ForwardPicker {...props} sources={{ ...sources, groups: null }} />);
    rerender(<ForwardPicker {...props} sources={{ ...sources, groups: null, groupsFailed: true }} />);
    expect(onPruneTargets).not.toHaveBeenCalled();
  });

  it("群列表加载失败：我的群聊与主页群搜索显示「加载失败，点击重试」，点击回调重试", () => {
    const onRetryGroups = vi.fn();
    render(<ForwardPicker {...base} sources={{ ...sources, groups: null, groupsFailed: true, onRetryGroups }}
      multi={false} targets={[]} onToggleTarget={vi.fn()} onForward={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("搜索会话"), { target: { value: "群" } });
    fireEvent.click(screen.getByText("加载失败，点击重试"));
    expect(onRetryGroups).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("搜索会话"), { target: { value: "" } });
    fireEvent.click(screen.getByText("我的群聊", { selector: ".fwd-item-label" }));
    fireEvent.click(screen.getByText("加载失败，点击重试"));
    expect(onRetryGroups).toHaveBeenCalledTimes(2);
  });
});
