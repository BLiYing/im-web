import { describe, expect, it } from "vitest";
import { loadRtcConfig, rtcConfigProblem } from "./rtcConfig";
import { buildInviteCandidates, rtcNameOf } from "./rtcProfiles";
import { callCandidates, togglePick } from "./RtcGroupCallPicker";
import { MAX_GROUP_CALL_PICK } from "./rtcCall";
import type { GroupMember } from "../sdk/protocol";

const full = { wsUrl: "ws://h:8787/v1/ws", appId: "10000002", keyId: "dbg-1", debugSecret: "s" };

describe("rtcConfig", () => {
  it("配置齐全 → 无问题", () => expect(rtcConfigProblem(full)).toBeNull());
  it("非 dbg- 密钥 ID 被拒", () => expect(rtcConfigProblem({ ...full, keyId: "k-1" })).toContain("dbg-"));
  it("信令地址必须是 ws/wss", () => expect(rtcConfigProblem({ ...full, wsUrl: "http://h" })).toContain("ws://"));
  it("缺密钥 → load 返回 null", () => {
    expect(loadRtcConfig({ VITE_RTC_WS_URL: full.wsUrl, VITE_RTC_APP_ID: "1", VITE_RTC_KEY_ID: "dbg-1" })).toBeNull();
  });
  it("环境变量齐全 → 返回配置", () => {
    expect(loadRtcConfig({
      VITE_RTC_WS_URL: full.wsUrl, VITE_RTC_APP_ID: "10000002", VITE_RTC_KEY_ID: "dbg-1", VITE_RTC_DEBUG_SECRET: "s",
    })).toEqual(full);
  });
});

describe("rtcNameOf", () => {
  const remarks = new Map([["u1", " 老王 "]]);
  it("备注最优先并去空白", () => expect(rtcNameOf(remarks, "u1", "昵称", "h")).toBe("老王"));
  it("无备注取昵称", () => expect(rtcNameOf(remarks, "u2", "小李", "h")).toBe("小李"));
  it("无昵称取 @句柄", () => expect(rtcNameOf(remarks, "u2", "  ", "lee")).toBe("@lee"));
  it("全无返回 undefined（绝不返回占位或 uid）", () => expect(rtcNameOf(remarks, "u2")).toBeUndefined());
});

describe("群通话选人", () => {
  const m = (id: string) => ({ user_id: id } as GroupMember);
  it("候选去掉自己", () => expect(callCandidates([m("a"), m("me"), m("b")], "me").map((x) => x.user_id)).toEqual(["a", "b"]));
  it("勾选与取消", () => expect(togglePick(togglePick([], "a"), "a")).toEqual([]));
  it("达上限后不再加，但仍可取消", () => {
    const full8 = Array.from({ length: MAX_GROUP_CALL_PICK }, (_, i) => `u${i}`);
    expect(togglePick(full8, "x")).toEqual(full8);
    expect(togglePick(full8, "u0")).toHaveLength(MAX_GROUP_CALL_PICK - 1);
  });
});

describe("buildInviteCandidates", () => {
  const ms = [
    { user_id: "me", nickname: "我" },
    { user_id: "a", nickname: "小李", username: "lee", avatar_url: "/u/a.png" },
    { user_id: "b", nickname: "", username: "bob" },
    { user_id: "a", nickname: "重复" },
  ];
  const none = () => undefined;
  it("排除自己与重复，名字缺失回落成员表 / @句柄", () => {
    const r = buildInviteCandidates(ms, "me", [], "", none, none);
    expect(r.map((x) => [x.uid, x.name])).toEqual([["a", "小李"], ["b", "@bob"]]);
    expect(r[0]?.avatarUrl).toBe("/u/a.png");
  });
  it("nameOf 优先（备注）", () => {
    expect(buildInviteCandidates(ms, "me", [], "", (u) => (u === "a" ? "老李" : undefined), none)[0]?.name).toBe("老李");
  });
  it("已在通话中的置灰不可选", () => {
    const r = buildInviteCandidates(ms, "me", ["me", "a"], "", none, none);
    expect(r[0]).toMatchObject({ uid: "a", selectable: false, unselectableReason: "已在通话中" });
    expect(r[1]?.selectable).toBe(true);
  });
  it("query 本地过滤；空成员给空页", () => {
    expect(buildInviteCandidates(ms, "me", [], "BOB", none, none).map((x) => x.uid)).toEqual(["b"]);
    expect(buildInviteCandidates([], "me", [], "", none, none)).toEqual([]);
  });
});
