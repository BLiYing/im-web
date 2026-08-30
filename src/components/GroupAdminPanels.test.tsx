// @vitest-environment jsdom
// 群管理页「管理员 + 转让群组」三个新展示件的渲染 + 接线回归：
// GroupManagePanel 两张新卡（含 owner-only 显隐）、AdminListPanel（群主 / 管理员两种视角）、
// AdminPickerModal（≤5 截断）、TransferOwnerModal（单选即回调）。
// 设计见 IMServer/docs/design/GROUP_ADMIN_TRANSFER_DESIGN.md §9。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup); // test-setup 不自动清理，多次 render 会堆进 document.body → 文本重复命中
import { AppServicesProvider, type AppServices } from "../AppServicesContext";
import { GroupManagePanel } from "./GroupManagePanel";
import { AdminListPanel } from "./AdminListPanel";
import { AdminPickerModal } from "./modals/AdminPickerModal";
import { TransferOwnerModal } from "./modals/TransferOwnerModal";
import type { GroupInfo, GroupMember } from "../sdk/protocol";

function makeServices(over: Partial<Record<keyof AppServices, unknown>> = {}) {
  return {
    clientRef: { current: {} },
    setToast: vi.fn(), comingSoon: vi.fn(),
    askConfirm: vi.fn(async () => true), askPrompt: vi.fn(async () => null),
    refreshConversations: vi.fn(async () => []), refreshFriends: vi.fn(async () => {}),
    refreshGroupInfo: vi.fn(async () => null), refreshDownloadSettings: vi.fn(async () => {}),
    ...over,
  } as unknown as AppServices;
}
const withServices = (ui: React.ReactElement) =>
  render(<AppServicesProvider value={makeServices()}>{ui}</AppServicesProvider>);

const mem = (over: Partial<GroupMember>): GroupMember =>
  ({ user_id: "0000000000", nickname: "", avatar_url: "", role: "member", joined_at: 0, ...over } as GroupMember);

const gp = (over: Partial<GroupInfo> = {}): GroupInfo => ({
  conv_id: "g1", name: "产品三组", owner: "1000000001", avatar_url: "", my_role: "owner",
  join_approval: false, perm_invite: false, perm_edit_info: false, perm_pin: false, history_visible: false,
  members: [
    mem({ user_id: "1000000001", nickname: "老王", username: "laowang", role: "owner", joined_at: 1 }),
    mem({ user_id: "4820571639", nickname: "小明", username: "xiaoming", role: "admin", joined_at: 30 }),
    mem({ user_id: "4820571641", nickname: "小丽", username: "xiaoli", role: "member", joined_at: 40 }),
  ],
  ...over,
} as GroupInfo);

const label = (m: GroupMember) => m.group_nickname || m.nickname || m.user_id;

describe("GroupManagePanel 的两张新卡", () => {
  it("群主：见「管理员」（带计数）与「转让群组」，各自接对回调", () => {
    const onOpenAdmins = vi.fn(), onOpenTransfer = vi.fn();
    const { getByText } = withServices(
      <GroupManagePanel gp={gp()} groupBans={null} onBack={vi.fn()} onPickAvatar={vi.fn()}
        onOpenJoinRequests={vi.fn()} onOpenBans={vi.fn()}
        onOpenAdmins={onOpenAdmins} onOpenTransfer={onOpenTransfer} />);
    expect(getByText("1 人")).toBeTruthy();
    // 「管理员」既是卡标题也是行标题，取那个真正可点的行。
    fireEvent.click(getByText("1 人").closest("button")!);
    expect(onOpenAdmins).toHaveBeenCalledWith("g1");
    fireEvent.click(getByText("转让群组").closest("button")!);
    expect(onOpenTransfer).toHaveBeenCalledWith("g1");
  });

  it("管理员视角：「转让群组」整卡不渲染（仅群主可见）", () => {
    const { queryByText, getAllByText } = withServices(
      <GroupManagePanel gp={gp({ my_role: "admin" })} groupBans={null} onBack={vi.fn()} onPickAvatar={vi.fn()}
        onOpenJoinRequests={vi.fn()} onOpenBans={vi.fn()} onOpenAdmins={vi.fn()} onOpenTransfer={vi.fn()} />);
    expect(getAllByText("管理员").length).toBeGreaterThan(0);
    expect(queryByText("转让群组")).toBeNull();
  });

  it("0 管理员时右值显「未设置」——不做红点角标，这不是待办", () => {
    const noAdmin = gp({ members: [mem({ user_id: "1000000001", nickname: "老王", role: "owner", joined_at: 1 })] });
    const { getByText } = withServices(
      <GroupManagePanel gp={noAdmin} groupBans={null} onBack={vi.fn()} onPickAvatar={vi.fn()}
        onOpenJoinRequests={vi.fn()} onOpenBans={vi.fn()} onOpenAdmins={vi.fn()} onOpenTransfer={vi.fn()} />);
    expect(getByText("未设置")).toBeTruthy();
  });
});

describe("AdminListPanel", () => {
  it("群主：有「添加管理员」与每行「撤销」，副行显 @句柄而非内部 ID", () => {
    const onAdd = vi.fn(), onRevoke = vi.fn();
    const { getByText, queryByText, container } = render(
      <AdminListPanel gp={gp()} uid="1000000001" memberLabel={label}
        onBack={vi.fn()} onAdd={onAdd} onRevoke={onRevoke} onOpenMember={vi.fn()} />);
    expect(getByText("管理员 · 1")).toBeTruthy();
    expect(getByText("@xiaoming")).toBeTruthy();
    expect(queryByText("4820571639")).toBeNull(); // 10 位内部 ID 绝不出现在界面上
    fireEvent.click(getByText("添加管理员").closest("button")!);
    expect(onAdd).toHaveBeenCalled();
    fireEvent.click(container.querySelector(".mini-btn.danger")!);
    expect(onRevoke).toHaveBeenCalledWith(expect.objectContaining({ user_id: "4820571639" }));
  });

  it("管理员视角：整页只读——无「添加管理员」、无「撤销」，脚注说明只有群主能增减", () => {
    const { queryByText, container, getByText } = render(
      <AdminListPanel gp={gp({ my_role: "admin" })} uid="4820571639" memberLabel={label}
        onBack={vi.fn()} onAdd={vi.fn()} onRevoke={vi.fn()} onOpenMember={vi.fn()} />);
    expect(queryByText("添加管理员")).toBeNull();
    expect(container.querySelector(".mini-btn.danger")).toBeNull();
    expect(getByText("只有群主可以增减管理员。")).toBeTruthy();
  });

  it("0 管理员：占位「还没有管理员」，「添加管理员」仍在（群里只有我时也不该神秘消失）", () => {
    const noAdmin = gp({ members: [mem({ user_id: "1000000001", nickname: "老王", role: "owner", joined_at: 1 })] });
    const { getByText } = render(
      <AdminListPanel gp={noAdmin} uid="1000000001" memberLabel={label}
        onBack={vi.fn()} onAdd={vi.fn()} onRevoke={vi.fn()} onOpenMember={vi.fn()} />);
    expect(getByText("还没有管理员")).toBeTruthy();
    expect(getByText("添加管理员")).toBeTruthy();
  });
});

describe("AdminPickerModal（多选 ≤5）", () => {
  const many = Array.from({ length: 7 }, (_, i) =>
    mem({ user_id: `482057160${i}`, nickname: `成员${i}`, username: `member${i}` }));

  it("选满 5 个后其余行置灰不可点，且给出上限说明", () => {
    const onToggle = vi.fn();
    const selected = many.slice(0, 5).map((m) => m.user_id);
    const { getByText, container } = render(
      <AdminPickerModal candidates={many} selected={selected} memberLabel={label}
        onToggle={onToggle} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(getByText("一次最多添加 5 位管理员。")).toBeTruthy();
    const rows = container.querySelectorAll(".check-row");
    fireEvent.click(rows[5]); // 第 6 个人
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(rows[0]); // 已选中的仍可点（=取消），否则用户卡死在满选态
    expect(onToggle).toHaveBeenCalledWith("4820571600");
  });

  it("空候选 → 空态「群里还没有其他成员」，确认按钮不可点", () => {
    const { getByText } = render(
      <AdminPickerModal candidates={[]} selected={[]} memberLabel={label}
        onToggle={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(getByText("群里还没有其他成员")).toBeTruthy();
    expect((getByText("添加").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TransferOwnerModal（单选即确认）", () => {
  it("点某一行立即回调该成员——不需要再点一次「确定」", () => {
    const onPick = vi.fn();
    const candidates = [mem({ user_id: "4820571639", nickname: "小明", username: "xiaoming", role: "admin" })];
    const { container, getByText } = render(
      <TransferOwnerModal candidates={candidates} memberLabel={label} onPick={onPick} onCancel={vi.fn()} />);
    expect(getByText("管理员")).toBeTruthy(); // 管理员也能被选为新群主
    fireEvent.click(container.querySelector(".check-row")!);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ user_id: "4820571639" }));
  });
});
