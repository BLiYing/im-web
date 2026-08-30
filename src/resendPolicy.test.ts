import { describe, it, expect } from "vitest";
import { resendPolicyFor } from "./resendPolicy";
import type { ChatMessage } from "./sdk/protocol";

/** 我发的、失败了的一条（默认文本、无 note、convSeq=0）。 */
const failed = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  clientMsgId: "cm-1", convId: "u_1001_u_1002", from: "1001",
  content: "在吗", contentType: "text", convSeq: 0, timestamp: 1, status: "failed", ...over,
});

describe("resendPolicyFor（与 iOS IMResendPolicyForMessage 同口径）", () => {
  it("非本人 / 空消息不可重发", () => {
    expect(resendPolicyFor(null, true)).toBe("none");
    expect(resendPolicyFor(failed(), false)).toBe("none");
  });

  it("只有 failed 态可重发", () => {
    for (const status of ["sending", "sent", "received"] as const) {
      expect(resendPolicyFor(failed({ status }), true)).toBe("none");
    }
    expect(resendPolicyFor(failed(), true)).toBe("same-id");
  });

  it("已拿到 conv_seq 的不可重发（服务端已收下，再发就是重复）", () => {
    expect(resendPolicyFor(failed({ convSeq: 42 }), true)).toBe("none");
  });

  it("被服务端拒收的不可重发；判据是 note 而非瞬态的 noteCode", () => {
    expect(resendPolicyFor(failed({ note: "消息已发出，但被对方拒收了", noteCode: 200102 }), true)).toBe("none");
    // 刷新后 noteCode 丢了、note 还在 —— 仍然不可重发
    expect(resendPolicyFor(failed({ note: "消息已发出，但被对方拒收了" }), true)).toBe("none");
  });

  it("上传失败（blob: 占位 / 空 content）走重传", () => {
    expect(resendPolicyFor(failed({ content: "blob:http://x/1", contentType: "image" }), true)).toBe("retry-upload");
    expect(resendPolicyFor(failed({ content: "", contentType: "file", fileName: "a.zip" }), true)).toBe("retry-upload");
  });

  it("内容已就绪（正文 / 已上传的服务器 URL）走原 clientMsgId 重发", () => {
    expect(resendPolicyFor(failed(), true)).toBe("same-id");
    expect(resendPolicyFor(failed({ content: "/media/2026/08/a.jpg", contentType: "image" }), true)).toBe("same-id");
    expect(resendPolicyFor(failed({ content: "/media/2026/08/v.m4a", contentType: "voice" }), true)).toBe("same-id");
  });
});
