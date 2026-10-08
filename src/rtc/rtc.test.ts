import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRtcConfig, rtcConfigProblem } from "./rtcConfig";
import { rtcTokenProvider, signToken } from "./rtcEngine";
import { buildInviteCandidates, rtcNameOf } from "./rtcProfiles";
import { callCandidates, togglePick } from "./RtcGroupCallPicker";
import { MAX_GROUP_CALL_PICK } from "./rtcCall";
import type { GroupMember } from "../sdk/protocol";

const full = { wsUrl: "ws://h:8787/v1/ws" };

describe("rtcConfig", () => {
  it("配置齐全 → 无问题", () => expect(rtcConfigProblem(full)).toBeNull());
  it("信令地址必须是 ws/wss", () => expect(rtcConfigProblem({ ...full, wsUrl: "http://h" })).toContain("ws://"));
  it("缺信令地址 → load 返回 null", () => {
    expect(loadRtcConfig({})).toBeNull();
  });
  it("环境变量齐全 → 返回配置", () => {
    expect(loadRtcConfig({ VITE_RTC_WS_URL: full.wsUrl })).toEqual(full);
  });
});

/** 造一个信封响应，供 stubFetch 用。 */
function envelope(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** 记录每次请求，按路径给出预置响应（与 sdk/tokenSession.test.ts 同款写法）。 */
function stubFetch(routes: Record<string, unknown>) {
  const calls: { path: string; auth: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    calls.push({ path, auth: new Headers(init?.headers).get("Authorization") || "" });
    if (!(path in routes)) throw new Error(`unexpected request: ${path}`);
    return envelope(routes[path]);
  }));
  return calls;
}

describe("signToken", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("带上当前 IM 会话 token 换票，返回 im-rtc 接入票", async () => {
    const calls = stubFetch({
      "/api/v1/rtc/token": { code: 0, data: { token: "rtc-jwt", expires_at_ms: 1, expires_in_sec: 43200 } },
    });
    const got = await signToken(() => "IM-TOKEN");
    expect(got).toBe("rtc-jwt");
    expect(calls).toEqual([{ path: "/api/v1/rtc/token", auth: "Bearer IM-TOKEN" }]);
  });

  it("取不到 IM token（未登录）直接拒绝，不发请求", async () => {
    const calls = stubFetch({});
    await expect(signToken(() => "")).rejects.toThrow("尚未登录");
    expect(calls).toEqual([]);
  });

  it("IMServer 未配置 im-rtc → 600001，原样按业务码抛出", async () => {
    stubFetch({ "/api/v1/rtc/token": { code: 600001, message: "rtc not configured" } });
    await expect(signToken(() => "IM-TOKEN")).rejects.toMatchObject({ code: 600001 });
  });

  // signal 透传（防 StrictMode 下重复换票，见 RtcHost.tsx 的 AbortController）：mock fetch 里
  // 读 init.signal 来断言它真的传到了底层 fetch，而不是半路被 callJson/fetchEnvelope 弄丢。
  it("signal 已中止 → 请求被中止而失败，不是拿到响应后才拒绝", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return envelope({ code: 0, data: { token: "should-not-be-reached" } });
    }));
    await expect(signToken(() => "IM-TOKEN", controller.signal)).rejects.toThrow();
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

describe("rtcTokenProvider（交给 Kit 的取票函数，im-rtc 2.2.0）", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("成功时给 Kit 一张票", async () => {
    stubFetch({ "/api/v1/rtc/token": { code: 0, data: { token: "rtc-jwt", expires_at_ms: 1, expires_in_sec: 43200 } } });
    await expect(rtcTokenProvider(() => "IM-TOKEN")()).resolves.toEqual({ token: "rtc-jwt" });
  });

  it("换票失败时 reject（Kit 据此退避重试 / 拨号时提示），不吞成空票", async () => {
    stubFetch({ "/api/v1/rtc/token": { code: 600001, message: "rtc not configured" } });
    await expect(rtcTokenProvider(() => "IM-TOKEN")()).rejects.toMatchObject({ code: 600001 });
  });
});
