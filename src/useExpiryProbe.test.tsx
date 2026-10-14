// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChatActionsProvider, type ChatActions } from "./ChatActionsContext";
import { useExpiryProbe } from "./useExpiryProbe";
import type { DownloadState } from "./download";
import type { ChatMessage } from "./sdk/protocol";

const msg = (o: Partial<ChatMessage>): ChatMessage => ({
  convId: "g1", convSeq: 1, contentType: "image", content: "/uploads/a.jpg", sender: "u", timestamp: 1, ...o,
} as ChatMessage);
const gated: DownloadState = { phase: "notStarted", received: 0, total: 0 };
const expired: DownloadState = { phase: "expired", received: 0, total: 0 };

function setup(messages: ChatMessage[], gateOf: (m: ChatMessage) => DownloadState | undefined) {
  const probeExpiry = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ChatActionsProvider value={{ probeExpiry } as unknown as ChatActions}>{children}</ChatActionsProvider>
  );
  const r = renderHook(({ ms }) => useExpiryProbe(ms, gateOf), { wrapper, initialProps: { ms: messages } });
  return { probeExpiry, ...r };
}

describe("useExpiryProbe：聊天页进会话主动探失效", () => {
  it("被门控挡着的图片探；放行的图片自己会请求、不探（缓存命中的留到进查看器再复验）", () => {
    const a = msg({ convSeq: 1, content: "/uploads/gated.jpg" });
    const b = msg({ convSeq: 2, content: "/uploads/open.jpg" });
    const { probeExpiry } = setup([a, b], (m) => (m.convSeq === 1 ? gated : undefined));
    expect(probeExpiry).toHaveBeenCalledTimes(1);
    expect(probeExpiry.mock.calls[0][0].content).toBe("/uploads/gated.jpg");
  });

  it("视频只拉封面、不会请求视频本体：无论门控与否都探（失效视频不被漏标）", () => {
    const v = msg({ convSeq: 3, contentType: "video", content: "/uploads/v.mp4" });
    const { probeExpiry } = setup([v], () => undefined);
    expect(probeExpiry).toHaveBeenCalledTimes(1);
  });

  it("已失效 / 已撤回 / 未入库(convSeq<=0) / 非媒体：不探", () => {
    const ms = [
      msg({ convSeq: 1 }),
      msg({ convSeq: 2, recalledAt: 5 } as Partial<ChatMessage>),
      msg({ convSeq: 0 }),
      msg({ convSeq: 4, contentType: "text", content: "hi" }),
    ];
    const { probeExpiry } = setup(ms, (m) => (m.convSeq === 1 ? expired : gated));
    expect(probeExpiry).not.toHaveBeenCalled();
  });

  it("重渲染但消息窗口没变（新数组同内容）：不重扫", () => {
    const a = msg({ convSeq: 1, content: "/uploads/gated.jpg" });
    const { probeExpiry, rerender } = setup([a], () => gated);
    expect(probeExpiry).toHaveBeenCalledTimes(1);
    rerender({ ms: [{ ...a }] });
    expect(probeExpiry).toHaveBeenCalledTimes(1);
    rerender({ ms: [a, msg({ convSeq: 2, content: "/uploads/new.jpg" })] }); // 新消息进来 → 重扫
    expect(probeExpiry.mock.calls.length).toBeGreaterThan(1);
  });
});
