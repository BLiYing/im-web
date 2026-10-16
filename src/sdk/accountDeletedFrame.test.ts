import { describe, expect, it, vi } from "vitest";
import { IMClient } from "./imSdk";

const feed = (c: IMClient, f: unknown) => (c as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));

describe("error 帧 reason=account_deleted（PROTOCOL §6.16.2）", () => {
  it("触发 onAccountDeleted；普通 error 帧不触发", () => {
    const onAccountDeleted = vi.fn();
    const c = new IMClient({ onAccountDeleted });
    feed(c, { type: "error", seq: 0, data: { code: 200005, message: "x", reason: "account_deleted", delete_at: 1 } });
    expect(onAccountDeleted).toHaveBeenCalledOnce();
    feed(c, { type: "error", seq: 0, data: { code: 300003, message: "x" } });
    expect(onAccountDeleted).toHaveBeenCalledOnce();
  });
});
