import { describe, expect, it } from "vitest";
import { IMClient } from "./imSdk";
import { groupEventKeepsFloor } from "./groupFloor";

describe("groupEventKeepsFloor", () => {
  it("设置变更 / 解散 / 未知事件：丢下界", () => {
    expect(groupEventKeepsFloor("settings", "", "me")).toBe(false);
    expect(groupEventKeepsFloor("dissolve", "", "me")).toBe(false);
    expect(groupEventKeepsFloor("brand_new_event", "x", "me")).toBe(false);
  });
  it("别人被邀请 / 退群 / 移出：保留；轮到我：丢", () => {
    for (const ev of ["invite", "leave", "remove"]) {
      expect(groupEventKeepsFloor(ev, "other", "me")).toBe(true);
      expect(groupEventKeepsFloor(ev, "me", "me")).toBe(false);
      expect(groupEventKeepsFloor(ev, "", "me")).toBe(false);
    }
  });
  it("资料 / 公告 / 角色 / 转让 / 禁言：保留", () => {
    for (const ev of ["profile", "announcement", "role", "transfer", "member_mute"]) {
      expect(groupEventKeepsFloor(ev, "me", "me")).toBe(true);
    }
  });
});

// 调用点：纯函数绿不代表 imSdk 的 `case T.GROUP` 真的接上了（conv_id / this.uid / 删的是 floorSeq）。
describe("IMClient 收 group 帧后的可见下界", () => {
  const CID = "g_floor";
  const ME = "1002";

  /** 已知 uid 的白盒客户端，喂一条 has_before=false 的窗口把下界记成 5。 */
  function clientWithFloor(owner: string): { client: IMClient; feed: (f: unknown) => void } {
    const client = new IMClient({});
    (client as unknown as { uid: string }).uid = owner;
    const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
    const row = (seq: number) => ({
      server_msg_id: `s${seq}`, conv_id: CID, from: "peer", content: `#${seq}`,
      content_type: "text", conv_seq: seq, timestamp: 1_700_000_000_000 + seq,
    });
    feed({ type: "window_resp", data: { conv_id: CID, anchor: 6, anchor_found: true, has_before: false, has_after: false, messages: [row(5), row(6)] } });
    return { client, feed };
  }

  const group = (event: string, target = "", convId = CID) => ({ type: "group", data: { event, conv_id: convId, from: "1001", target } });

  it("影响下界的帧丢缓存，不影响的保留", () => {
    const { client, feed } = clientWithFloor(ME);
    expect(client.visibleFloorOf(CID)).toBe(4); // floorSeq=5 → 开区间 4

    feed(group("profile"));
    feed(group("invite", "1003")); // 别人入群
    feed(group("leave", "1003", "g_other")); // 别的群的帧不碰这个群
    expect(client.visibleFloorOf(CID)).toBe(4);

    feed(group("settings")); // 群主翻「仅可见入群后」
    expect(client.visibleFloorOf(CID)).toBe(0);
  });

  it("轮到我被邀请 / 入群审批通过：丢缓存", () => {
    for (const ev of ["invite", "join_result"]) {
      const { client, feed } = clientWithFloor(ME);
      feed(group(ev, ME));
      expect(client.visibleFloorOf(CID), ev).toBe(0);
    }
  });
});
