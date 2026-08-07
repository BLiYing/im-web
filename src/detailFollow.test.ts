import { describe, it, expect } from "vitest";
import { resolveDetailFollow } from "./detailFollow";

describe("resolveDetailFollow", () => {
  it("卡片没开时不动", () => {
    expect(
      resolveDetailFollow({ detailOpen: false, detailConvId: "", activeCid: "g:1", isGroup: true }),
    ).toEqual({ action: "none" });
  });

  it("没有当前会话（activeCid 空）时不动——由 deselect 负责关闭", () => {
    expect(
      resolveDetailFollow({ detailOpen: true, detailConvId: "u:a__b", activeCid: "", isGroup: false }),
    ).toEqual({ action: "none" });
  });

  it("已是当前会话的卡片时不动", () => {
    expect(
      resolveDetailFollow({ detailOpen: true, detailConvId: "g:1", activeCid: "g:1", isGroup: true }),
    ).toEqual({ action: "none" });
  });

  it("切到另一个群会话 → 跟随成该群卡片，携带目标 convId", () => {
    expect(
      resolveDetailFollow({ detailOpen: true, detailConvId: "g:1", activeCid: "g:2", isGroup: true }),
    ).toEqual({ action: "group", convId: "g:2" });
  });

  it("从群卡片切到单聊会话 → 跟随成单聊卡片", () => {
    expect(
      resolveDetailFollow({ detailOpen: true, detailConvId: "g:1", activeCid: "u:a__b", isGroup: false }),
    ).toEqual({ action: "peer" });
  });

  it("从单聊卡片切到另一个单聊会话 → 跟随成单聊卡片", () => {
    expect(
      resolveDetailFollow({ detailOpen: true, detailConvId: "u:a__b", activeCid: "u:a__c", isGroup: false }),
    ).toEqual({ action: "peer" });
  });

  it("从单聊卡片切到群会话 → 跟随成群卡片", () => {
    expect(
      resolveDetailFollow({ detailOpen: true, detailConvId: "u:a__b", activeCid: "g:9", isGroup: true }),
    ).toEqual({ action: "group", convId: "g:9" });
  });
});
