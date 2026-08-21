// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
afterEach(cleanup);
import { AppServicesProvider, type AppServices } from "../AppServicesContext";
import { ChatHeader, type ChatHeaderProps, type ChatHeaderActions } from "./ChatHeader";
import type { Conversation, GroupInfo } from "../sdk/protocol";

const services = { comingSoon: vi.fn() } as unknown as AppServices;
const actions = (): ChatHeaderActions => ({ deselect: vi.fn(), openGroupPanel: vi.fn(), openPeerDetail: vi.fn(), setInviteDraft: vi.fn(), setConvMuted: vi.fn(),
  enterSelectMode: vi.fn(), doLeaveGroup: vi.fn(async () => {}), setContactDraft: vi.fn(), doToggleBlock: vi.fn(), deleteConv: vi.fn() });
const conv = (over: Partial<Conversation> = {}): Conversation => ({ conv_id: "c", peer: "u2", muted: false, ...over } as Conversation);
function base(over: Partial<ChatHeaderProps> = {}): ChatHeaderProps {
  return { searchOpen: false, isGroupChat: false, peer: "u2", groupConvId: "", searchQuery: "", setSearchQuery: vi.fn(), search: {} as ChatHeaderProps["search"],
    chatTitle: "小明", chatAvatarURL: undefined, visibleChatSubtitle: "在线", chatMenu: false, setChatMenu: vi.fn(), groupInfos: {}, groupConv: undefined,
    peerConv: conv(), peerBlocked: false, actions: actions(), ...over };
}
const mount = (p: ChatHeaderProps) => render(<AppServicesProvider value={services}><ChatHeader {...p} /></AppServicesProvider>);

describe("ChatHeader", () => {
  it("单聊：标题/副标题；返回 → deselect；身份区 → openPeerDetail(peer, true)；呼叫 → comingSoon", () => {
    const p = base(); const { getByText, getByTitle, container } = mount(p);
    expect(container.querySelector(".chat-title")?.textContent).toBe("小明"); expect(getByText("在线")).toBeTruthy(); // 头像首字也含「小」，按类定位
    fireEvent.click(getByText("‹ 会话")); expect(p.actions.deselect).toHaveBeenCalled();
    fireEvent.click(getByTitle("查看资料")); expect(p.actions.openPeerDetail).toHaveBeenCalledWith("u2", true);
    fireEvent.click(getByTitle("呼叫")); expect(services.comingSoon).toHaveBeenCalledWith("语音通话");
  });
  it("单聊菜单：编辑联系人/免打扰/选择消息/拉黑/删除会话 接线，点后关菜单", () => {
    const p = base({ chatMenu: true }); const { getByText } = mount(p);
    fireEvent.click(getByText("编辑联系人")); expect(p.actions.setContactDraft).toHaveBeenCalledWith({ peer: "u2", remark: "" });
    fireEvent.click(getByText("免打扰")); expect(p.actions.setConvMuted).toHaveBeenCalledWith(expect.objectContaining({ conv_id: "c" }), true);
    fireEvent.click(getByText("拉黑")); expect(p.actions.doToggleBlock).toHaveBeenCalledWith("u2", true);
    fireEvent.click(getByText("删除会话")); expect(p.actions.deleteConv).toHaveBeenCalled();
    expect(p.setChatMenu).toHaveBeenCalledWith(false);
  });
  it("群聊：身份区 → openGroupPanel；菜单含群资料/邀请成员/退出群聊；仅管理员可邀请 + 我是成员 → 隐藏邀请成员", () => {
    const gi = (role: string, perm: boolean) => ({ g1: { conv_id: "g1", name: "群", my_role: role, perm_invite: perm, members: [] } as unknown as GroupInfo });
    const p = base({ isGroupChat: true, groupConvId: "g1", peer: "", chatTitle: "群", chatMenu: true, groupInfos: gi("owner", true), groupConv: conv({ conv_id: "g1", is_group: true }) });
    const { getByText, getByTitle, queryByText } = mount(p);
    fireEvent.click(getByTitle("查看群资料")); expect(p.actions.openGroupPanel).toHaveBeenCalledWith("g1");
    expect(getByText("群资料")).toBeTruthy(); expect(getByText("邀请成员")).toBeTruthy();
    fireEvent.click(getByText("退出群聊")); expect(p.actions.doLeaveGroup).toHaveBeenCalledWith("g1");
    cleanup();
    const p2 = base({ isGroupChat: true, groupConvId: "g1", peer: "", chatMenu: true, groupInfos: gi("member", true), groupConv: conv({ conv_id: "g1" }) });
    mount(p2); expect(queryByText("邀请成员")).toBeNull();
  });
  it("未选会话：显「未选择会话」，无返回钮", () => {
    const { getByText, queryByText } = mount(base({ peer: "", peerConv: undefined }));
    expect(getByText("未选择会话")).toBeTruthy(); expect(queryByText("‹ 会话")).toBeNull();
  });
});
