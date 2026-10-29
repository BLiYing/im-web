import { describe, expect, it, vi } from "vitest";
import { applyClearAllLocal } from "./clearAllLocal";

const res = { cleared: 2, items: [{ convId: "a", clearedAt: 7 }, { convId: "b", clearedAt: 9 }] };
function deps(over: Partial<Parameters<typeof applyClearAllLocal>[1]> = {}) {
  const order: string[] = [];
  const d = {
    clearAllToFloors: vi.fn(async () => { order.push("store"); }),
    dropConversations: vi.fn(() => { order.push("list"); }),
    clearMediaCache: vi.fn(() => { order.push("media"); }),
    clearNotifications: vi.fn(() => { order.push("notif"); }),
    ...over,
  };
  return { d, order };
}

describe("applyClearAllLocal", () => {
  it("先存储批量清除（位点取服务端值）→ 摘列表项 → 清媒体 → 逐会话收回通知", async () => {
    const { d, order } = deps();
    await applyClearAllLocal(res, d);
    expect(d.clearAllToFloors).toHaveBeenCalledWith(res.items);
    expect(d.dropConversations).toHaveBeenCalledWith(new Set(["a", "b"]));
    expect(d.clearNotifications).toHaveBeenCalledWith({ convId: "a", upTo: 7 });
    expect(d.clearNotifications).toHaveBeenCalledWith({ convId: "b", upTo: 9 });
    expect(order).toEqual(["store", "list", "media", "notif", "notif"]);
  });
  it("服务端 0 个会话：本机什么都不动", async () => {
    const { d } = deps();
    await applyClearAllLocal({ cleared: 0, items: [] }, d);
    expect(d.clearAllToFloors).not.toHaveBeenCalled();
    expect(d.dropConversations).not.toHaveBeenCalled();
    expect(d.clearMediaCache).not.toHaveBeenCalled();
  });
  it("存储清除抛错：不中断，列表 / 媒体 / 通知照做（回声帧与下次列表快照会补对齐）", async () => {
    const { d } = deps({ clearAllToFloors: vi.fn(async () => { throw new Error("idb"); }) });
    await expect(applyClearAllLocal(res, d)).resolves.toBeUndefined();
    expect(d.dropConversations).toHaveBeenCalled();
    expect(d.clearMediaCache).toHaveBeenCalled();
  });
});
