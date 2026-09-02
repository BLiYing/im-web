// @vitest-environment jsdom
// 会话详情抽屉整块（DetailPanel）的渲染 + 接线回归（阶段 2 抽出；此前 App 级对抽屉零覆盖，App.smoke 不打开它）。
// 派生逻辑（好友准入显隐 / 群 vs 单聊卡片 / 置顶·免打扰开关 / 更多菜单）与动作接线任一错了即红。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
afterEach(cleanup);
import { AppServicesProvider, type AppServices } from "../AppServicesContext";
import { ChatActionsProvider, type ChatActions } from "../ChatActionsContext";
import { DetailPanel, type DetailPanelProps } from "./DetailPanel";
import type { Conversation, FriendEntry, GroupInfo, GroupMember } from "../sdk/protocol";

const services = {
  clientRef: { current: { requestFriend: vi.fn(async () => false) } },
  setToast: vi.fn(), comingSoon: vi.fn(),
  askConfirm: vi.fn(async () => true), askPrompt: vi.fn(async () => null),
  refreshConversations: vi.fn(async () => []), refreshFriends: vi.fn(async () => {}),
  refreshGroupInfo: vi.fn(async () => null), refreshDownloadSettings: vi.fn(async () => {}),
} as unknown as AppServices;
const chatActions = {
  setViewer: vi.fn(), onGateTap: vi.fn(), onPassiveMediaError: vi.fn(async () => {}), openReadyFile: vi.fn(async () => {}),
} as unknown as ChatActions;

const gp = (over: Partial<GroupInfo> = {}): GroupInfo => ({
  conv_id: "g1", name: "测试群", my_role: "owner", members: [{ user_id: "u1", role: "owner", nickname: "我" }],
  join_approval: false, perm_invite: false, perm_edit_info: false, perm_pin: false, history_visible: false,
  announcement: "", intro: "", ...over,
} as GroupInfo);
const peerConv = (over: Partial<Conversation> = {}): Conversation => ({
  conv_id: "u_u1_u_u2", peer: "u2", peer_nickname: "小明", latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0,
  last_message: { server_msg_id: "s", from: "u2", content_type: "text", content: "hi", conv_seq: 0, timestamp: 1 },
  ...over,
} as Conversation);
const friendOf = (id: string): FriendEntry => ({ user_id: id, status: "accepted" } as FriendEntry);

function base(over: Partial<DetailPanelProps> = {}): DetailPanelProps {
  return {
    detail: { convId: "u_u1_u_u2", isGroup: false, peer: "u2" },
    conversations: [peerConv()], groupInfos: { g1: gp() }, friends: [friendOf("u2")], uid: "u1",
    detailTab: "media", detailMsgs: [], detailMore: false, manageOpen: false, adminPanelOpen: false, groupBans: null,
    groupRemark: () => "", peerNick: () => "小明", peerUsername: () => "xiaoming", peerAvatar: () => undefined,
    memberLabel: (m: GroupMember) => m.group_nickname || m.nickname || m.user_id, mediaGate: () => undefined,
    mediaSrc: (m: { content: string }) => m.content, canManageMember: () => true,
    onShareContact: vi.fn(), contactDisplayName: (id: string, fb?: string) => fb || id,
    onClose: vi.fn(), setDetailTab: vi.fn(), setDetailMore: vi.fn(), setManageOpen: vi.fn(),
    setAdminPanelOpen: vi.fn(), openAdminPicker: vi.fn(), openTransferPicker: vi.fn(), revokeAdmin: vi.fn(),
    setContactDraft: vi.fn(), setInviteDraft: vi.fn(), setMemberMenu: vi.fn(), setFileMenu: vi.fn(),
    doFriendAction: vi.fn(async () => {}), openChat: vi.fn(), openInChatSearch: vi.fn(),
    doClearHistory: vi.fn(), doToggleBlock: vi.fn(), doRemoveFriend: vi.fn(), doLeaveGroup: vi.fn(async () => {}), doDissolveGroup: vi.fn(),
    setConvPinned: vi.fn(), setConvMuted: vi.fn(), openGroupText: vi.fn(), openGroupCard: vi.fn(async () => {}),
    doEditMyGroupNickname: vi.fn(async () => {}), doEditGroupRemark: vi.fn(async () => {}), pickGroupAvatar: vi.fn(),
    openJoinRequests: vi.fn(async () => {}), openGroupBans: vi.fn(async () => {}), openPeerDetail: vi.fn(),
    ...over,
  };
}
const mount = (props: DetailPanelProps) => render(
  <AppServicesProvider value={services}><ChatActionsProvider value={chatActions}>
    <DetailPanel {...props} />
  </ChatActionsProvider></AppServicesProvider>);

describe("DetailPanel · 单聊", () => {
  it("好友：标题=昵称，操作排显 消息/呼叫/视频/搜索，备注名卡在；关闭钮 → onClose", () => {
    const p = base();
    const { getByText, getByTitle } = mount(p);
    expect(getByText("用户信息")).toBeTruthy();
    expect(getByText("消息")).toBeTruthy(); expect(getByText("呼叫")).toBeTruthy(); expect(getByText("视频")).toBeTruthy();
    expect(getByText("备注名")).toBeTruthy();
    fireEvent.click(getByTitle("关闭"));
    expect(p.onClose).toHaveBeenCalled();
  });
  // 回归（2026-08-31）：从**群成员头像**进来的单聊资料卡，点「搜索」要搜的是与该成员的单聊，
  // 不是当时还开着的那个群。此前 openInChatSearch 不带任何会话参数，App 侧就把搜索开在了当前
  // 会话上——静默搜错会话、没有任何提示。故 pill 必须把 (convId, peer, isGroup) 一并交出去。
  it("搜索 pill 把**本卡片对应的会话**身份交给上层（不是当前打开的会话）", () => {
    const p = base({ detail: { convId: "u_u1_u_u9", isGroup: false, peer: "u9" }, friends: [friendOf("u9")] });
    const { getByText } = mount(p);
    fireEvent.click(getByText("搜索"));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.openInChatSearch).toHaveBeenCalledWith("u_u1_u_u9", "u9", false);
  });
  // 内部 ID 零 UI 露出（docs/UI.md「用户标识」）：这一行的标签是「用户名」，
  // 值必须是公开句柄 @xxx；曾经显示的是 d.peer——10 位随机数字内部 ID，标签与内容完全对不上。
  it("「用户名」行显示 @username，绝不显示内部 ID；头部副标题不再重复它", () => {
    const { getAllByText, queryByText } = mount(base({ peerUsername: () => "xiaoming", peerPresenceText: "在线" }));
    // 只此一处：「用户名」行。头部副标题曾经也显 @句柄——同一信息在同屏出现两遍，
    // 2026-08-30 改成显示在线态（与 iOS displaySubtitle 同口径）。
    expect(getAllByText("@xiaoming").length).toBe(1);
    expect(queryByText("在线")).toBeTruthy();
    expect(queryByText("u2")).toBeNull(); // u2 是内部 ID，不得出现在任何位置
  });

  // 用户名要能拿走：点整行即复制**裸句柄**（不带 @）。iOS 那端是长按菜单，Web 上点击是其等价物。
  it("点「用户名」行复制裸句柄 + 吐司", () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { getByTitle } = mount(base({ peerUsername: () => "xiaoming" }));
    fireEvent.click(getByTitle("点击复制用户名"));
    expect(writeText).toHaveBeenCalledWith("xiaoming");
  });

  // 拿不到句柄时整行隐藏——不显示"未设置"，更不回退到内部 ID。
  it("没有 username 时「用户名」行整行不渲染", () => {
    const { queryByText } = mount(base({ peerUsername: () => undefined }));
    expect(queryByText("用户名")).toBeNull(); // 不显示"未设置"，更不回退到内部 ID
    expect(queryByText("u2")).toBeNull();
  });

  it("非好友：只显「加好友」，隐藏 消息/更多/备注名/置顶", () => {
    const { getByText, queryByText } = mount(base({ friends: [] }));
    expect(getByText("加好友")).toBeTruthy();
    expect(queryByText("消息")).toBeNull(); expect(queryByText("备注名")).toBeNull(); expect(queryByText("置顶聊天")).toBeNull();
    // 「更多」也不显（2026-08-30）：菜单里全是"已经是好友"才有意义的项（推荐/拉黑/清空/删除好友）。
    expect(queryByText("更多")).toBeNull();
  });
  it("「消息」→ close + openChat(peer)；置顶开关 → setConvPinned(conv, true)", () => {
    const p = base();
    const { getByText, container } = mount(p);
    fireEvent.click(getByText("消息"));
    expect(p.onClose).toHaveBeenCalled(); expect(p.openChat).toHaveBeenCalledWith("u2");
    fireEvent.click(container.querySelectorAll(".switch")[0]);
    expect(p.setConvPinned).toHaveBeenCalledWith(expect.objectContaining({ conv_id: "u_u1_u_u2" }), true);
  });
  it("更多菜单（detailMore=true）：清空聊天记录 → doClearHistory(convId)；拉黑 → doToggleBlock(peer, true)", () => {
    const p = base({ detailMore: true });
    const { getByText } = mount(p);
    fireEvent.click(getByText("清空聊天记录"));
    expect(p.doClearHistory).toHaveBeenCalledWith("u_u1_u_u2");
    fireEvent.click(getByText("拉黑"));
    expect(p.doToggleBlock).toHaveBeenCalledWith("u2", true);
  });
  // 删除好友此前只在通讯录左滑里有，资料卡的「更多」里找不到（2026-08-30 补齐，末位·破坏性）。
  it("更多菜单：删除好友 → doRemoveFriend(peer)；非好友时该项不存在", () => {
    const p = base({ detailMore: true });
    const { getByText } = mount(p);
    fireEvent.click(getByText("删除好友"));
    expect(p.doRemoveFriend).toHaveBeenCalledWith("u2");
    cleanup();
    const { queryByText } = mount(base({ detailMore: true, friends: [] }));
    expect(queryByText("删除好友")).toBeNull();
  });
});

describe("DetailPanel · 群聊", () => {
  const groupProps = (over: Partial<DetailPanelProps> = {}) => base({
    detail: { convId: "g1", isGroup: true }, ...over,
  });
  it("群主：标题=群名，副标题成员数，显 群管理/群二维码/群邀请链接/我在本群的昵称；群管理 → setManageOpen(true)", () => {
    const p = groupProps();
    const { getByText } = mount(p);
    expect(getByText("群组信息")).toBeTruthy(); expect(getByText("测试群")).toBeTruthy(); expect(getByText("1 位成员")).toBeTruthy();
    expect(getByText("群二维码")).toBeTruthy(); expect(getByText("群邀请链接")).toBeTruthy(); expect(getByText("我在本群的昵称")).toBeTruthy();
    fireEvent.click(getByText("群管理").closest("button")!);
    expect(p.setManageOpen).toHaveBeenCalledWith(true);
  });
  it("仅管理员可邀请 + 我是普通成员 → 隐藏 群二维码/群邀请链接/群管理", () => {
    const { queryByText } = mount(groupProps({ groupInfos: { g1: gp({ my_role: "member", perm_invite: true }) } }));
    expect(queryByText("群二维码")).toBeNull(); expect(queryByText("群邀请链接")).toBeNull(); expect(queryByText("群管理")).toBeNull();
  });
  it("有公告 → 公告卡可点 → openGroupText('announcement', cid)；manageOpen → 渲染群管理二级视图", () => {
    const p = groupProps({ groupInfos: { g1: gp({ announcement: "周五团建" }) } });
    const { getByText, rerender } = mount(p);
    fireEvent.click(getByText("群公告").closest("button")!);
    expect(p.openGroupText).toHaveBeenCalledWith("announcement", "g1");
    rerender(<AppServicesProvider value={services}><ChatActionsProvider value={chatActions}>
      <DetailPanel {...p} manageOpen={true} /></ChatActionsProvider></AppServicesProvider>);
    expect(getByText("进群确认")).toBeTruthy(); // GroupManagePanel 出现
  });
  // 大群说明行：**恒显**，且不像公告/简介那样"非空才显"。
  // 最要紧的是最后一条断言——一个既没公告也没简介的大群，若这张卡只判 announcement||intro，
  // 整张卡都不出现，而那恰恰是最需要解释"为什么没有已读双勾"的场景。
  it("大群 → 公告卡出现「大群」行并可点开；既无公告也无简介时这张卡仍必须在", () => {
    const p = groupProps({ groupInfos: { g1: gp({ is_super: true }) } });
    const { getByText } = mount(p);
    const row = getByText("大群").closest("button")!;
    // 预览里的 N 数的是**被关掉的能力**（已读回执/正在输入/在线态/进出群消息 = 4），
    // 与 SUPER_GROUP_NOTICE 的条数不是一回事（那里还含"上限"和"不可撤销"两条非关闭项）。
    // 文案定稿见 SUPERGROUP_DESIGN §4.1；改列表时这条断言会提醒你同步 N。
    expect(getByText("已关闭 4 项能力")).toBeTruthy();
    fireEvent.click(row);
    expect(p.openGroupText).toHaveBeenCalledWith("super", "g1");
  });
  it("普通群 → 不出现「大群」行（标记只在大群上有意义）", () => {
    const { queryByText } = mount(groupProps({ groupInfos: { g1: gp({ is_super: false }) } }));
    expect(queryByText("大群")).toBeNull();
  });
});
