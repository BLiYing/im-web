// 通话记录的宿主接线（纯函数部分）：谁发、发到哪、预览、通知、多选 / 搜索排除。
import { describe, it, expect } from "vitest";
import { planCallRecord, type CallSummaryEvent } from "./callRecord";
import { convIdFor, type ChatMessage, type Conversation } from "./sdk/protocol";
import { convPreview, isMissedCallPreview, mediaPreview } from "./convPreview";
import { notifyBodyOf, shouldNotify } from "./desktopNotify";
import { isSearchableMessage, replyPreviewOf, selectableInMultiSelect } from "./messageContent";
import { pinnedPreview } from "./pinned";

const base: CallSummaryEvent = {
  callId: "call-77a1", mediaType: "video", reason: "hangup", durationSec: 201,
  isGroup: false, role: "caller", peer: "1003", chatGroupId: "",
};

describe("planCallRecord：只主叫发", () => {
  it("1v1 主叫 → 发到「我—peer」单聊，client_msg_id = call-<call_id>", () => {
    const p = planCallRecord(base, "1001", convIdFor)!;
    expect(p.convId).toBe("u_1001_u_1003");
    expect(p.to).toBe("1003");
    expect(p.clientMsgId).toBe("call-call-77a1");
    expect(JSON.parse(p.content)).toEqual({ cid: "call-77a1", m: "video", r: "hangup", d: 201 });
  });
  it("被叫 → 不发（否则一通电话两条）", () => {
    expect(planCallRecord({ ...base, role: "callee" }, "1001", convIdFor)).toBeNull();
  });
  it("群通话主叫 → 发到群会话，带 g:1，to 为空", () => {
    const p = planCallRecord({ ...base, isGroup: true, peer: "", chatGroupId: "g_88" }, "1001", convIdFor)!;
    expect(p.convId).toBe("g_88");
    expect(p.to).toBe("");
    expect(JSON.parse(p.content).g).toBe(1);
  });
  it("目标缺失 / callId 空 → 不发", () => {
    expect(planCallRecord({ ...base, peer: "" }, "1001", convIdFor)).toBeNull();
    expect(planCallRecord({ ...base, isGroup: true, chatGroupId: "" }, "1001", convIdFor)).toBeNull();
    expect(planCallRecord({ ...base, callId: " " }, "1001", convIdFor)).toBeNull();
  });
});

const callConv = (from: string, r: string, d = 0, over: Partial<Conversation> = {}): Conversation => ({
  conv_id: "c", peer: "1003", is_group: false,
  last_message: { server_msg_id: "s", from, content_type: "call", content: JSON.stringify({ cid: "x", m: "audio", r, d }), conv_seq: 1, timestamp: 1 },
  ...over,
} as Conversation);
const deps = { uid: "1001", localNameOf: (id: string, _c: string, fb?: string) => fb || id };

describe("会话列表预览", () => {
  it("单聊：按看的人视角，不露 JSON", () => {
    expect(convPreview(callConv("1001", "reject"), deps)).toBe("[语音通话] 对方已拒绝");
    expect(convPreview(callConv("1003", "no_answer"), deps)).toBe("[语音通话] 未接来电");
    expect(mediaPreview("call", { content: "oops" })).toBe("[音视频通话]");
  });
  it("群：昵称前缀 + [群语音通话] 时长", () => {
    const c = callConv("1003", "hangup", 723, { is_group: true });
    c.last_message!.from_nickname = "张三";
    expect(convPreview(c, deps)).toBe("张三: [群语音通话] 时长 12:03");
  });
  it("只有被叫未接来电整行红", () => {
    expect(isMissedCallPreview(callConv("1003", "no_answer"), "1001")).toBe(true);
    expect(isMissedCallPreview(callConv("1001", "no_answer"), "1001")).toBe(false);
    expect(isMissedCallPreview(callConv("1003", "reject"), "1001")).toBe(false);
    expect(isMissedCallPreview(callConv("1003", "no_answer", 0, { is_group: true }), "1001")).toBe(false);
  });
});

describe("其它位置", () => {
  const callMsg = (from: string, r: string, extra: Record<string, unknown> = {}): ChatMessage => ({
    convId: "c", from, contentType: "call", content: JSON.stringify({ cid: "x", m: "audio", r, d: 0, ...extra }),
    convSeq: 3, timestamp: 1, status: "sent",
  }) as ChatMessage;
  const ctx = { selfUid: "1001", windowFocused: false, currentConvId: "", muted: false, mentionsMe: false };
  it("桌面通知：只推被叫未接来电", () => {
    expect(shouldNotify(callMsg("1003", "no_answer"), ctx)).toBe(true);
    expect(notifyBodyOf(callMsg("1003", "no_answer"))).toBe("[未接来电]");
    expect(shouldNotify(callMsg("1003", "reject"), ctx)).toBe(false);
    expect(shouldNotify(callMsg("1003", "no_answer", { g: 1 }), ctx)).toBe(false);
  });
  it("不入搜索 / 不可多选 / 引用与置顶不露 JSON", () => {
    const m = callMsg("1003", "hangup");
    expect(isSearchableMessage(m)).toBe(false);
    expect(selectableInMultiSelect(m)).toBe(false);
    expect(replyPreviewOf(m)).toBe("[音视频通话]");
    expect(pinnedPreview({ contentType: "call", content: m.content } as never)).toBe("[音视频通话]");
  });
});
