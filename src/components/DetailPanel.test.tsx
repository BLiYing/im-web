// @vitest-environment jsdom
// 会话详情抽屉整块（DetailPanel）的渲染 + 接线回归（阶段 2 抽出；此前 App 级对抽屉零覆盖，App.smoke 不打开它）。
// 派生逻辑（好友准入显隐 / 群 vs 单聊卡片 / 置顶·免打扰开关 / 更多菜单）与动作接线任一错了即红。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
afterEach(cleanup);
import { AppServicesProvider, type AppServices } from "../AppServicesContext";
import { ChatActionsProvider, type ChatActions } from "../ChatActionsContext";
import { DetailPanel, type DetailPanelProps } from "./DetailPanel";
import type { Conversation, FriendEntry, GroupInfo } from "../sdk/protocol";

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
    detailTab: "media", detailMsgs: [], detailMore: false, manageOpen: false, groupBans: null,
    groupRemark: () => "", peerNick: () => "小明", peerAvatar: () => undefined, mediaGate: () => undefined, canManageMember: () => true,
    onClose: vi.fn(), setDetailTab: vi.fn(), setDetailMore: vi.fn(), setManageOpen: vi.fn(),
    setContactDraft: vi.fn(), setInviteDraft: vi.fn(), setMemberMenu: vi.fn(), setFileMenu: vi.fn(),
    doFriendAction: vi.fn(async () => {}), openChat: vi.fn(), openInChatSearch: vi.fn(),
    doClearHistory: vi.fn(), doToggleBlock: vi.fn(), doLeaveGroup: vi.fn(async () => {}), doDissolveGroup: vi.fn(),
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
  it("非好友：只显「加好友」，隐藏 消息/备注名/置顶", () => {
    const { getByText, queryByText } = mount(base({ friends: [] }));
    expect(getByText("加好友")).toBeTruthy();
    expect(queryByText("消息")).toBeNull(); expect(queryByText("备注名")).toBeNull(); expect(queryByText("置顶聊天")).toBeNull();
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
});
