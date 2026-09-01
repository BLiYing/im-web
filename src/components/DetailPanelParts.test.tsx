// @vitest-environment jsdom
// 抽屉抽出的三个展示组件（GroupManagePanel / DetailTabs / MemberMenu）的渲染+接线回归。
// App.smoke 不打开详情抽屉，这里补上：任一 prop 接线错了（onXxx 传错、条件显隐反了）此测即红，
// 不必等浏览器手测。GroupManagePanel/MemberMenu 消费 AppServicesContext，故用 Provider 包裹。
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup); // test-setup 不自动清理，多次 render 会堆进 document.body → 文本重复命中
// 成员列表超过阈值会挂 VirtualList，它用 ResizeObserver 量滚动父；jsdom 没有这个 API → 打桩。
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
import { AppServicesProvider, type AppServices } from "../AppServicesContext";
import { GroupManagePanel } from "./GroupManagePanel";
import { DetailTabs, type DetailTab } from "./DetailTabs";
import { MemberMenu } from "./MemberMenu";
import type { GroupInfo, GroupMember, ChatMessage, FriendEntry } from "../sdk/protocol";

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
const withServices = (svc: AppServices, ui: React.ReactElement) =>
  render(<AppServicesProvider value={svc}>{ui}</AppServicesProvider>);

const gp = (over: Partial<GroupInfo> = {}): GroupInfo => ({
  conv_id: "g1", name: "测试群", my_role: "owner", members: [],
  join_approval: false, perm_invite: false, perm_edit_info: false, perm_pin: false, history_visible: false,
  ...over,
} as GroupInfo);
const member = (over: Partial<GroupMember> = {}): GroupMember => ({ user_id: "u2", role: "member", nickname: "小明", ...over } as GroupMember);

describe("GroupManagePanel", () => {
  it("渲染群管理项；返回按钮 → onBack；群名称行 → 走 useGroupActions(askPrompt)", () => {
    const askPrompt = vi.fn(async () => null);
    const onBack = vi.fn();
    const { getByText, container } = withServices(makeServices({ askPrompt }),
      <GroupManagePanel gp={gp()} groupBans={null} onBack={onBack}
        onPickAvatar={vi.fn()} onOpenJoinRequests={vi.fn()} onOpenBans={vi.fn()}
        onOpenAdmins={vi.fn()} onOpenTransfer={vi.fn()} />);
    expect(getByText("群管理")).toBeTruthy();
    expect(getByText("进群确认")).toBeTruthy();
    fireEvent.click(container.querySelector(".detail-manage-head .icon-btn")!);
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(getByText("群名称").closest("button")!);
    expect(askPrompt).toHaveBeenCalled(); // 群写操作确实经 Context 服务发起
  });
});

describe("DetailTabs", () => {
  const base = {
    tabs: [{ k: "members" as DetailTab, label: "成员" }, { k: "links" as DetailTab, label: "链接" }],
    activeTab: "members" as DetailTab, uid: "u1", canInvite: true,
    media: [] as ChatMessage[], files: [] as ChatMessage[], voices: [] as ChatMessage[], links: [] as ChatMessage[],
    contacts: [] as ChatMessage[], onOpenContact: vi.fn(),
    onSelectTab: vi.fn(), onAddMember: vi.fn(), onOpenMember: vi.fn(),
    canManageMember: () => true, onMemberMenu: vi.fn(),
    memberLabel: (m: GroupMember) => m.group_nickname || m.nickname || m.user_id,
    mediaGate: () => undefined, mediaSrc: (m: ChatMessage) => m.content, onGateTap: vi.fn(), onOpenViewer: vi.fn(),
    onFileMenu: vi.fn(), onMediaError: vi.fn(), onOpenFile: vi.fn(),
    fetchLinkPreview: async (u: string) => ({ url: u }), // 测试桩：不出卡（返回空 og），仅让类型对齐
  };
  it("成员页签：渲染成员行；添加成员 → onAddMember(convId)；⋯ → onMemberMenu", () => {
    const onAddMember = vi.fn(), onMemberMenu = vi.fn();
    const g = gp({ members: [member({ user_id: "u2", nickname: "小明" })] });
    const { getByText, getByTitle, container } = render(
      <DetailTabs {...base} gp={g} onAddMember={onAddMember} onMemberMenu={onMemberMenu} />);
    expect(getByText("添加成员")).toBeTruthy();
    expect(container.querySelector(".detail-member-name")?.textContent).toContain("小明");
    fireEvent.click(getByText("添加成员"));
    expect(onAddMember).toHaveBeenCalledWith("g1");
    fireEvent.click(getByTitle("管理"));
    expect(onMemberMenu).toHaveBeenCalled();
  });
  it("页签切换 → onSelectTab", () => {
    const onSelectTab = vi.fn();
    const { getByText } = render(<DetailTabs {...base} gp={gp()} onSelectTab={onSelectTab} />);
    fireEvent.click(getByText("链接"));
    expect(onSelectTab).toHaveBeenCalledWith("links");
  });
  it("无邀请权（canInvite=false）→ 隐藏「添加成员」", () => {
    const { queryByText } = render(
      <DetailTabs {...base} gp={gp({ members: [member({ user_id: "u2" })] })} canInvite={false} />);
    expect(queryByText("添加成员")).toBeNull();
  });

  // —— 成员列表虚拟化（阈值 VIRTUALIZE_MEMBERS_FROM=50）——
  // 注意断言的边界：jsdom 量不出容器高度，虚拟化器算不出可见区、返回空窗口，实际走的是
  // VirtualList 的「零高度兜底」（渲染前若干行）。所以这里钉的是**两条路径的分流、不空、行内容一致**，
  // 真实可见区计算只有浏览器测得出（2 万人群手测口径见 docs/ops/LOAD_TESTING.md）。
  const manyMembers = Array.from({ length: 200 },
    (_, i) => member({ user_id: `u${i + 2}`, nickname: `成员${i}` }));

  it("成员数 ≤ 阈值 → 全量渲染（小群不为虚拟化的失败模式买单）", () => {
    const { container } = render(
      <DetailTabs {...base} gp={gp({ members: manyMembers.slice(0, 20) })} scrollElRef={createRef<HTMLElement>()} />);
    expect(container.querySelectorAll(".detail-member").length).toBe(20);
  });

  it("成员数 > 阈值 → 只渲染一小撮行，且不为空", () => {
    const { container } = render(
      <DetailTabs {...base} gp={gp({ members: manyMembers })} scrollElRef={createRef<HTMLElement>()} />);
    const rows = container.querySelectorAll(".detail-member").length;
    expect(rows).toBeGreaterThan(0);  // 量不到容器也必须有内容——不能新增「数据已到却整列表空白」这个失败模式
    expect(rows).toBeLessThan(50);    // 200 行不再全进 DOM
  });

  it("虚拟化那条路径的行内容与全量一致（群主徽标 / ⋯ 管理按钮都在）", () => {
    const onMemberMenu = vi.fn();
    const list = [member({ user_id: "u2", nickname: "小明", role: "owner" }), ...manyMembers];
    const { container, getAllByTitle, getByText } = render(
      <DetailTabs {...base} gp={gp({ members: list })} onMemberMenu={onMemberMenu}
        scrollElRef={createRef<HTMLElement>()} />);
    expect(container.querySelectorAll(".detail-member").length).toBeLessThan(50); // 确认确实走了虚拟化
    expect(getByText("群主")).toBeTruthy();
    fireEvent.click(getAllByTitle("管理")[0]);
    expect(onMemberMenu).toHaveBeenCalled();
  });

  it("没注入 scrollElRef → 退回全量渲染（宁可慢，也不能少显示人）", () => {
    const { container } = render(<DetailTabs {...base} gp={gp({ members: manyMembers })} />);
    expect(container.querySelectorAll(".detail-member").length).toBe(200);
  });
});

describe("MemberMenu", () => {
  const friends: FriendEntry[] = [{ user_id: "u2", status: "accepted" } as FriendEntry];
  it("群主对成员：显示发送消息/设为管理员/移出；发送消息 → onClose + onOpenChat", () => {
    const onClose = vi.fn(), onOpenChat = vi.fn();
    const { getByText } = withServices(makeServices(),
      <MemberMenu menu={{ x: 10, y: 10, convId: "g1", m: member() }} gp={gp({ my_role: "owner" })}
        uid="u1" friends={friends} menuRef={createRef<HTMLDivElement>()}
        onClose={onClose} onOpenChat={onOpenChat} onFriendAction={vi.fn()} onMutePick={vi.fn()}
        memberLabel={(m) => m.group_nickname || m.nickname || m.user_id} />);
    expect(getByText("发送消息")).toBeTruthy();
    expect(getByText("设为管理员")).toBeTruthy();
    expect(getByText("移出群聊")).toBeTruthy();
    fireEvent.click(getByText("发送消息"));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenChat).toHaveBeenCalledWith("u2");
  });
  it("非好友成员：显示添加好友（而非发送消息）", () => {
    const { getByText, queryByText } = withServices(makeServices(),
      <MemberMenu menu={{ x: 10, y: 10, convId: "g1", m: member({ user_id: "u3" }) }} gp={gp()}
        uid="u1" friends={friends} menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()} onOpenChat={vi.fn()} onFriendAction={vi.fn()} onMutePick={vi.fn()}
        memberLabel={(m) => m.group_nickname || m.nickname || m.user_id} />);
    expect(getByText("添加好友")).toBeTruthy();
    expect(queryByText("发送消息")).toBeNull();
  });
});
