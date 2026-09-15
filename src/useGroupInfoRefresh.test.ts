// @vitest-environment jsdom
// useGroupInfoRefresh 的「群成员表过期检测」：会话开着时有人改名再发消息 → 节流重拉群资料。
// 钉四件事：进会话只记基线不拉 / 末条昵称对不上成员表才拉 / 对得上不拉 / 5s 内只拉一次。
// 对端 iOS IMGroupSenderNameTests（IMGroupMemberNicknameStale）、Android SenderNamesTest（memberNameStale）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useGroupInfoRefresh } from "./useGroupInfoRefresh";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage, GroupInfo } from "./sdk/protocol";
import type { MsgMap } from "./messageStore";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const UID = "4820571639";
const info = (nickname: string): GroupInfo => ({ conv_id: "g1", members: [{ user_id: UID, nickname }] } as unknown as GroupInfo);
const msg = (convSeq: number, fromNickname?: string): ChatMessage =>
  ({ convId: "g1", from: UID, convSeq, fromNickname, content: "hi", contentType: "text", timestamp: convSeq, status: "sent" } as ChatMessage);

interface Props { groupConvId: string; msgsByConv: MsgMap; groupInfos: Record<string, GroupInfo> }
function mount(initial: Props) {
  const fetchGroup = vi.fn(async () => info("新昵称"));
  const clientRef = { current: { fetchGroup } as unknown as IMClient };
  const setGroupInfos = vi.fn();
  const hook = renderHook((p: Props) => useGroupInfoRefresh(clientRef, setGroupInfos, p.groupConvId, p.msgsByConv, p.groupInfos),
    { initialProps: initial });
  return { ...hook, fetchGroup };
}

describe("useGroupInfoRefresh 成员表过期检测", () => {
  it("进会话的第一次只记基线：末条是本地老快照，拿它比只会白拉一次", () => {
    const { fetchGroup } = mount({ groupConvId: "g1", msgsByConv: { g1: [msg(1, "新昵称")] }, groupInfos: { g1: info("旧昵称") } });
    expect(fetchGroup).not.toHaveBeenCalled();
  });

  it("末条换成一条昵称与成员表对不上的消息 → 重拉一次；对得上不拉", () => {
    const groupInfos = { g1: info("旧昵称") };
    const { rerender, fetchGroup } = mount({ groupConvId: "g1", msgsByConv: { g1: [msg(1, "旧昵称")] }, groupInfos });
    rerender({ groupConvId: "g1", msgsByConv: { g1: [msg(1, "旧昵称"), msg(2, "旧昵称")] }, groupInfos });
    expect(fetchGroup).not.toHaveBeenCalled();
    rerender({ groupConvId: "g1", msgsByConv: { g1: [msg(1, "旧昵称"), msg(2, "旧昵称"), msg(3, "新昵称")] }, groupInfos });
    expect(fetchGroup).toHaveBeenCalledTimes(1);
    expect(fetchGroup).toHaveBeenCalledWith("g1");
  });

  it("5s 内连着两条对不上只拉一次，过了 5s 再来才拉第二次", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const groupInfos = { g1: info("旧昵称") };
    const { rerender, fetchGroup } = mount({ groupConvId: "g1", msgsByConv: { g1: [msg(1)] }, groupInfos });
    rerender({ groupConvId: "g1", msgsByConv: { g1: [msg(1), msg(2, "新昵称")] }, groupInfos });
    rerender({ groupConvId: "g1", msgsByConv: { g1: [msg(1), msg(2, "新昵称"), msg(3, "新昵称")] }, groupInfos });
    expect(fetchGroup).toHaveBeenCalledTimes(1);
    now.mockReturnValue(106_000);
    rerender({ groupConvId: "g1", msgsByConv: { g1: [msg(1), msg(2, "新昵称"), msg(3, "新昵称"), msg(4, "新昵称")] }, groupInfos });
    expect(fetchGroup).toHaveBeenCalledTimes(2);
  });

  it("只是成员表刷新回来（末条没变）不再触发；成员表查不到这个人（超级群普通成员）也不拉", () => {
    const tail = { g1: [msg(1), msg(2, "新昵称")] };
    const { rerender, fetchGroup } = mount({ groupConvId: "g1", msgsByConv: { g1: [msg(1)] }, groupInfos: { g1: info("") } });
    rerender({ groupConvId: "g1", msgsByConv: tail, groupInfos: { g1: info("") } });
    expect(fetchGroup).not.toHaveBeenCalled(); // 成员表里名字为空 → 不算过期
    rerender({ groupConvId: "g1", msgsByConv: tail, groupInfos: { g1: info("旧昵称") } });
    expect(fetchGroup).not.toHaveBeenCalled(); // 末条没变，不因成员表变化而拉
  });
});
