// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConvRowActions } from "./useConvRowActions";
import type { Conversation } from "./sdk/protocol";

// 置顶 / 标未读 / 设已读的 PUT 一律省略 auto_delete_sec（服务端保留原值），避免本地过期缓存把别端刚设的档位清零。
const conv = { conv_id: "c", unread: 0, latest_conv_seq: 1, pinned_at: 0, muted: false, marked_unread: true, auto_delete_sec: 86400 } as unknown as Conversation;

describe("useConvRowActions: PUT body 不带 auto_delete_sec", () => {
  it("pin / markUnread / markRead", async () => {
    const client = { updateConvSettings: vi.fn(async () => {}), markRead: vi.fn() };
    const { result } = renderHook(() => useConvRowActions({
      clientRef: { current: client as never }, refreshConversations: vi.fn(async () => []), setToast: vi.fn(),
      closeConvMenu: vi.fn(), currentConvRef: { current: "" }, deselect: vi.fn(),
    }));
    const r = result.current as unknown as Record<string, (...a: unknown[]) => void>;
    await act(async () => { r.markReadConv(conv); r.markUnreadConv(conv); r.setConvPinned(conv, true); await Promise.resolve(); await Promise.resolve(); });
    expect(client.updateConvSettings).toHaveBeenCalledTimes(3);
    for (const call of client.updateConvSettings.mock.calls as unknown as [string, object][]) expect(call[1]).not.toHaveProperty("auto_delete_sec");
  });
});
