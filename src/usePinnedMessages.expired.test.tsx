// @vitest-environment jsdom
// 自动删除：服务端不物理删，置顶重拉结果里已过期的消息要本地滤掉（否则过期后横幅又指回它）。
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { usePinnedMessages } from "./usePinnedMessages";
import type { IMClient } from "./sdk/imSdk";
import type { PinnedMessage } from "./sdk/protocol";

const pin = (convSeq: number, timestamp: number): PinnedMessage => ({
  convSeq, serverMsgId: `s${convSeq}`, from: "u", contentType: "text", content: "x", timestamp, pinnedAt: convSeq,
});
const client = (items: PinnedMessage[]) => ({
  fetchPinned: async () => items, clearedUpToOf: () => 0, loadClearedUpTo: async () => 0,
}) as unknown as IMClient;

describe("usePinnedMessages 过期过滤", () => {
  it("已过期的置顶不进集合，未过期的保留", async () => {
    const ref = { current: client([pin(2, 2000), pin(1, 1000)]) } as MutableRefObject<IMClient | null>;
    const { result } = renderHook(() => usePinnedMessages(ref, "c1", (_c, ts) => ts <= 1000));
    await waitFor(() => expect(Object.keys(result.current).length).toBeGreaterThan(0));
    const all = JSON.stringify(result.current);
    expect(all).toContain("s2");
    expect(all).not.toContain("s1");
  });
});
