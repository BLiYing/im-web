import { describe, it, expect, vi } from "vitest";
import { makeConvClearedHandler } from "./convClearedHandler";
import type { ChatMessage } from "./sdk/protocol";

const m = (convId: string, convSeq: number): ChatMessage => ({ convId, from: "u", content: "x", contentType: "image", convSeq, timestamp: 1, status: "received" });
function deps(open = "") {
  const detail: { v: ChatMessage[] } = { v: [m("c1", 5), m("c1", 25), m("c2", 5)] };
  const viewer: { v: { m: ChatMessage } | null } = { v: { m: m("c1", 5) } };
  const reader: { v: ChatMessage | null } = { v: m("c1", 6) };
  const d = {
    clearThrough: vi.fn(), dropArchive: vi.fn(), pinnedDrop: vi.fn(), pinnedRefresh: vi.fn(), closeChat: vi.fn(),
    currentConv: () => open,
    setDetailMsgs: (f: (p: ChatMessage[]) => ChatMessage[]) => { detail.v = f(detail.v); },
    setViewer: (f: (p: { m: ChatMessage } | null) => { m: ChatMessage } | null) => { viewer.v = f(viewer.v); },
    setTextReader: (f: (p: ChatMessage | null) => ChatMessage | null) => { reader.v = f(reader.v); },
  };
  return { d, detail, viewer, reader };
}

describe("makeConvClearedHandler —— 会话被清除到位点后 UI 各处同步（触发点①②③共用）", () => {
  it("清内存消息、详情页签数据、服务端页、置顶、查看器 / 阅读器；只动该会话 <=位点 的", () => {
    const t = deps();
    makeConvClearedHandler(t.d)("c1", 20, true, { source: "frame", retained: false });
    expect(t.d.clearThrough).toHaveBeenCalledWith("c1", 20);
    expect(t.detail.v.map((x) => `${x.convId}:${x.convSeq}`)).toEqual(["c1:25", "c2:5"]);
    expect(t.d.dropArchive).toHaveBeenCalledWith("c1", 20);
    expect(t.d.pinnedDrop).toHaveBeenCalledWith("c1", 20);
    expect(t.d.pinnedRefresh).toHaveBeenCalledWith("c1");
    expect(t.viewer.v).toBeNull();
    expect(t.reader.v).toBeNull();
    expect(t.d.closeChat).not.toHaveBeenCalled();
  });
  it("正开着的会话被清：只有本机删除关聊天页；别端删除帧（无论是否复现）与列表对齐都只清不关", () => {
    const t3 = deps("c1");
    makeConvClearedHandler(t3.d)("c1", 20, true, { source: "local", retained: true });
    expect(t3.d.closeChat).toHaveBeenCalledTimes(1);
    for (const retained of [false, true]) for (const source of ["frame", "align"] as const) {
      const t = deps("c1");
      makeConvClearedHandler(t.d)("c1", 20, true, { source, retained });
      expect(t.d.clearThrough).toHaveBeenCalledWith("c1", 20);
      expect(t.d.closeChat).not.toHaveBeenCalled();
    }
  });
  it("没推进位点（本机删除的回声帧 / 对齐先到）：不重复清，也不关", () => {
    const t = deps("c1");
    makeConvClearedHandler(t.d)("c1", 20, false, { source: "frame", retained: false });
    expect(t.d.clearThrough).not.toHaveBeenCalled();
    expect(t.d.closeChat).not.toHaveBeenCalled();
  });
  it("开着的是别的会话：不关", () => {
    const t = deps("c2");
    makeConvClearedHandler(t.d)("c1", 20, true, { source: "frame", retained: false });
    expect(t.d.closeChat).not.toHaveBeenCalled();
  });
  it("（旧用例）别端删除帧但会话已复现 / 列表对齐：只清 <=位点，不关聊天页", () => {
    const a = deps("c1");
    makeConvClearedHandler(a.d)("c1", 20, true, { source: "frame", retained: true });
    expect(a.d.clearThrough).toHaveBeenCalledWith("c1", 20);
    expect(a.d.closeChat).not.toHaveBeenCalled();
    const b = deps("c1");
    makeConvClearedHandler(b.d)("c1", 20, true, { source: "align", retained: false });
    expect(b.d.clearThrough).toHaveBeenCalledWith("c1", 20);
    expect(b.d.closeChat).not.toHaveBeenCalled();
  });
  it("批量（清除所有对话）：置顶服务端重拉只给正开着的会话，其余会话不发网络请求；本地清理照做", () => {
    const t = deps("c1");
    const h = makeConvClearedHandler(t.d);
    h("c2", 20, true, { source: "align", retained: false, batch: true });
    expect(t.d.pinnedRefresh).not.toHaveBeenCalled();
    expect(t.d.pinnedDrop).toHaveBeenCalledWith("c2", 20);
    h("c1", 20, true, { source: "align", retained: false, batch: true });
    expect(t.d.pinnedRefresh).toHaveBeenCalledWith("c1");
    expect(t.d.closeChat).not.toHaveBeenCalled();   // 正开着的聊天页保持打开
  });
});
