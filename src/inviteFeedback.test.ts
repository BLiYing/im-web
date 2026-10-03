import { describe, expect, it } from "vitest";
import { inviteFeedback } from "./inviteFeedback";

describe("inviteFeedback", () => {
  it("pending 非空 → 待审提示（即使 added 为空也不是「已在群里」）", () => {
    expect(inviteFeedback(2, { added: [], pending: ["a", "b"] })?.key).toBe("group.invite.pending_toast");
  });
  it("added 与 pending 都空 → 都已在群里", () => {
    expect(inviteFeedback(2, { added: [], pending: [] })?.key).toBe("group.info.invite_all_in");
  });
  it("部分已在群 → 部分成功", () => {
    expect(inviteFeedback(3, { added: ["a"], pending: [] })).toEqual({ key: "group.info.invite_partial", args: { invited: 1, skipped: 2 } });
  });
  it("全部直接加入 → 无提示", () => {
    expect(inviteFeedback(2, { added: ["a", "b"], pending: [] })).toBeNull();
  });
});
