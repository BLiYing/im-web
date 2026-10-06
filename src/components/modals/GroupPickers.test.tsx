// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CreateGroupModal } from "./CreateGroupModal";
import type { CreateGroupDraft } from "./CreateGroupModal";
import { FriendPickerModal } from "./FriendPickerModal";
import type { FriendEntry } from "../../sdk/protocol";

afterEach(cleanup);

const f = (id: string, nickname: string, remark?: string): FriendEntry =>
  ({ user_id: id, nickname, remark, status: "accepted", updated_at: 0, blocked: false } as FriendEntry);
// 与全站一致的显示名口径：备注 > 昵称 > uid。
const friendLabel = (x: FriendEntry) => (x.remark?.trim() || x.nickname?.trim() || x.user_id);
const friends = [f("1001", "Alice", "老王"), f("1002", "Bob"), f("1003", "Carol")];

describe("FriendPickerModal 搜索", () => {
  const base = { selected: [], candidates: friends, friendLabel, onToggle: vi.fn(), onInvite: vi.fn(), onCancel: vi.fn() };

  it("按显示名（含备注）收窄；无命中显「没有匹配的好友」", () => {
    render(<FriendPickerModal {...base} />);
    const box = screen.getByLabelText("搜索好友");
    fireEvent.change(box, { target: { value: "老王" } });
    expect(screen.getByText("老王", { selector: ".row-label" })).toBeTruthy(); // 1001 的显示名就是备注
    expect(screen.queryByText("Bob", { selector: ".row-label" })).toBeNull();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("没有匹配的好友")).toBeTruthy();
  });

  it("候选为空时不渲染搜索框，仍显原空态文案", () => {
    render(<FriendPickerModal {...base} candidates={[]} />);
    expect(screen.queryByLabelText("搜索好友")).toBeNull();
    expect(screen.getByText("好友都已在群里了")).toBeTruthy();
  });

  // 改造时最容易碰坏的一条：selected 存的是 uid、与过滤无关。
  it("先勾选再搜索把人过滤掉，点确认时仍带上他", () => {
    const onInvite = vi.fn();
    render(<FriendPickerModal {...base} selected={["1002"]} onInvite={onInvite} />);
    fireEvent.change(screen.getByLabelText("搜索好友"), { target: { value: "Carol" } });
    expect(screen.queryByText("Bob", { selector: ".row-label" })).toBeNull(); // Bob 已被过滤掉
    expect(screen.getByText("邀请（1）")).toBeTruthy();                        // 但仍记着 1 个选中
    fireEvent.click(screen.getByText("邀请（1）"));
    expect(onInvite).toHaveBeenCalled();
  });
});

// 名片场景（CONTACT_CARD_DESIGN §8.2）：同一组件靠三处文案 prop + maxSelection 复用，不新建组件。
describe("FriendPickerModal 名片场景（文案 prop + 选择上限）", () => {
  const base = { selected: [], candidates: friends, friendLabel, onToggle: vi.fn(), onInvite: vi.fn(), onCancel: vi.fn() };

  it("自定义 title / confirmLabel / emptyText 生效", () => {
    render(<FriendPickerModal {...base} candidates={[]}
      title="选择联系人" confirmLabel="发送" emptyText="还没有好友" />);
    expect(screen.getByText("选择联系人")).toBeTruthy();
    expect(screen.getByText("发送")).toBeTruthy();
    expect(screen.getByText("还没有好友")).toBeTruthy();
  });

  it("未传上限时按钮不显分母（群邀请场景行为不变）", () => {
    render(<FriendPickerModal {...base} selected={["1001"]} />);
    expect(screen.getByText("邀请（1）")).toBeTruthy();
  });

  it("传上限时按钮显 N/M；达上限后未选中行置灰且点击不触发 onToggle", () => {
    const onToggle = vi.fn();
    render(<FriendPickerModal {...base} selected={["1001", "1002"]} maxSelection={2}
      confirmLabel="发送" onToggle={onToggle} />);
    expect(screen.getByText("发送（2/2）")).toBeTruthy();
    fireEvent.click(screen.getByText("Carol", { selector: ".row-label" })); // 未选中且已达上限
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("老王", { selector: ".row-label" }));  // 已选中的仍可点=取消
    expect(onToggle).toHaveBeenCalledWith("1001");
  });
});

const createBase = {
  draft: { name: "", selected: [] as string[] } as CreateGroupDraft, accepted: friends, friendLabel,
  myPublicName: "小明", busy: false, avatarBusy: false, maxInitialMembers: 10,
  onChange: vi.fn(), onPickAvatar: vi.fn(), onCreate: vi.fn(), onCancel: vi.fn(),
};

describe("CreateGroupModal 搜索与全选", () => {
  const base = createBase;

  it("无搜索词时「全选」= 选中全部（与加搜索前行为一致）", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} onChange={onChange} />);
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1001", "1002", "1003"] }));
  });

  // 搜了「张」还去勾上没显示的两百人，用户不会预期——全选只作用于当前可见行。
  it("有搜索词时「全选」只并上可见行，已选的人不被清掉", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1003"] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("搜索好友"), { target: { value: "老王" } });
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1003", "1001"] }));
  });

  it("有搜索词时「取消全选」只摘掉可见行，不动被过滤掉的已选", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1001", "1003"] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("搜索好友"), { target: { value: "老王" } });
    expect(screen.getByText("取消全选")).toBeTruthy(); // 可见行已全部选中
    fireEvent.click(screen.getByText("取消全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1003"] }));
  });

  it("全选并集仍受 maxInitialMembers 上限截断", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} maxInitialMembers={2} onChange={onChange} />);
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1001", "1002"] }));
  });

  it("上限截断时已选保留：先留已选，再按可见顺序补到上限", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1003"] }} maxInitialMembers={2} onChange={onChange} />);
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1003", "1001"] }));
  });

  it("已选本身已超上限（如配置后到）时，全选不丢已选也不再新增", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1002", "1003"] }} maxInitialMembers={1} onChange={onChange} />);
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1002", "1003"] }));
  });

  it("手点同样受上限约束：已达上限时未选行点不动并提示，已选行仍可取消", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1001", "1002"] }} maxInitialMembers={2} onChange={onChange} />);
    expect(screen.getByText(/已达本群成员上限（3 人）/)).toBeTruthy(); // {max} 含群主
    fireEvent.click(screen.getByText("Carol", { selector: ".row-label" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("老王", { selector: ".row-label" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1002"] }));
  });

  it("无搜索时全部选中后变「取消全选」，点后清空", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1001", "1002", "1003"] }} onChange={onChange} />);
    fireEvent.click(screen.getByText("取消全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: [] }));
  });

  it("可见行为 0（搜索无命中 / 无好友）时不显示全选与取消全选", () => {
    render(<CreateGroupModal {...base} />);
    fireEvent.change(screen.getByLabelText("搜索好友"), { target: { value: "zzzz不存在" } });
    expect(screen.queryByText("全选")).toBeNull();
    expect(screen.queryByText("取消全选")).toBeNull();
    cleanup();
    render(<CreateGroupModal {...base} accepted={[]} />);
    expect(screen.queryByText("全选")).toBeNull();
  });
});

// 第二步（群资料）是有状态的：draft 由调用方持有，弹窗内部只有 step。
// 这个壳子替代 App 承担那一半，好让"下一步 → 改名 → ＋添加 → 再下一步"这种整段操作能跑起来。
function CreateHarness({ initial, myPublicName = "小明" }: { initial: CreateGroupDraft; myPublicName?: string }) {
  const [draft, setDraft] = useState<CreateGroupDraft>(initial);
  return <CreateGroupModal {...createBase} draft={draft} myPublicName={myPublicName} onChange={setDraft} />;
}

describe("CreateGroupModal 两步流", () => {
  it("「下一步」预填群名：我打头，成员按勾选顺序，且一律用**公开名**不用备注", () => {
    render(<CreateHarness initial={{ name: "", selected: ["1001", "1002"] }} />);
    fireEvent.click(screen.getByText("下一步"));
    const input = screen.getByPlaceholderText("群聊名称") as HTMLInputElement;
    // 1001 的备注是「老王」、昵称是 Alice——群名会广播给全群，只能取昵称。
    expect(input.value).toBe("小明、Alice、Bob");
  });

  it("手改过群名后，增删成员不再覆盖它", () => {
    render(<CreateHarness initial={{ name: "", selected: ["1001", "1002"] }} />);
    fireEvent.click(screen.getByText("下一步"));
    const input = screen.getByPlaceholderText("群聊名称") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "周末爬山" } });
    fireEvent.click(screen.getAllByTitle("移除")[0]); // 删掉一个成员
    expect((screen.getByPlaceholderText("群聊名称") as HTMLInputElement).value).toBe("周末爬山");
  });

  it("没手改过群名时，删成员会重算预填名", () => {
    render(<CreateHarness initial={{ name: "", selected: ["1001", "1002"] }} />);
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getAllByTitle("移除")[0]); // 删掉 1001
    expect((screen.getByPlaceholderText("群聊名称") as HTMLInputElement).value).toBe("小明、Bob");
  });

  it("不允许删到 0 人：点最后一位的 ✕ 不移除，只提示", () => {
    render(<CreateHarness initial={{ name: "", selected: ["1001"] }} />);
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getAllByTitle("移除")[0]);
    expect(screen.getByText("至少选择一位好友")).toBeTruthy();
    expect(screen.getAllByTitle("移除").length).toBe(1); // 人还在
  });

  it("群名清空后「创建」置灰；第一步选 0 人时「下一步」置灰", () => {
    render(<CreateHarness initial={{ name: "", selected: ["1001"] }} />);
    expect((screen.getByText("下一步") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("下一步"));
    expect((screen.getByText("创建") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByPlaceholderText("群聊名称"), { target: { value: "   " } });
    expect((screen.getByText("创建") as HTMLButtonElement).disabled).toBe(true);
  });

  it("「＋ 添加」与「上一步」都回到第一步，勾选原样还在", () => {
    render(<CreateHarness initial={{ name: "", selected: ["1001", "1002"] }} />);
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("＋ 添加"));
    expect(screen.getByText("选择好友（已选 2）")).toBeTruthy();
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("上一步"));
    expect(screen.getByText("选择好友（已选 2）")).toBeTruthy();
  });

  it("群名超 30 字被就地截断（按 rune 计数）", () => {
    render(<CreateHarness initial={{ name: "", selected: ["1001"] }} />);
    fireEvent.click(screen.getByText("下一步"));
    const input = screen.getByPlaceholderText("群聊名称") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "字".repeat(40) } });
    expect((screen.getByPlaceholderText("群聊名称") as HTMLInputElement).value.length).toBe(30);
  });
});
