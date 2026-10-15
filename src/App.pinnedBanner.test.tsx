// @vitest-environment jsdom
/**
 * 置顶横幅（G0）与「原消息已经没了」的收敛（用户实测 2026-08-26）：
 * 置顶一条 → 立刻撤回 → 横幅必须自己消失；来不及消失时点它必须**明确提示**，
 * 而不是静默滚到那条「撤回了一条消息」的系统行上闪一下（旧行为，用户看不出发生了什么）。
 *
 * 服务端口径见 IMServer/internal/store/sqlite_message.go PinnedMessages（recalled_at = 0 / deleted_at = 0）
 * 与 conversation/pinned.go（再排除 caller「仅为我删除」）——客户端只需在撤回帧到达时重拉一次。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage, PinnedMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";

import type { Fake } from "./testing/fakeIMClient";
import { PEER, CID, makeConv as conv, installJsdomShims, enterChat } from "./testing/appHarness";
const Fake = IMClient as unknown as Fake;

const SEQ = 7; // 被置顶又被撤回的那条

const pin = (convSeq = SEQ): PinnedMessage => ({
  convSeq, serverMsgId: `s${convSeq}`, from: PEER, contentType: "text",
  content: "周五下午三点开会", timestamp: Date.now(), pinnedAt: Date.now(),
});

const msg = (convSeq = SEQ): ChatMessage => ({
  convId: CID, from: PEER, content: "周五下午三点开会", contentType: "text",
  convSeq, timestamp: Date.now(), status: "sent",
} as ChatMessage);

beforeEach(() => {
  localStorage.clear();
  Fake.conversations = [conv()];
  Fake.pinned = [];
  installJsdomShims();
});
afterEach(() => { cleanup(); Fake.pinned = []; Fake.clearPinnedError = null; vi.restoreAllMocks(); });

/** 免密登录 → 进单聊 → 等置顶横幅上屏（Fake.pinned 已预置）。 */
async function enterChatWithPinned() {
  Fake.pinned = [pin()];
  await enterChat();
  await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
  await waitFor(() => { Fake.last!.handlers.onMessage!(msg()); });
  // 横幅与气泡显同一段文字 → 两处都在（用 getAllByText，findByText 会因命中多个而抛）。
  await waitFor(() => expect(screen.getAllByText("周五下午三点开会").length).toBe(2));
}

describe("置顶横幅：原消息被撤回后的收敛", () => {
  it("置顶消息被撤回 → 重拉置顶集合，横幅自动消失", async () => {
    await enterChatWithPinned();
    Fake.pinned = []; // 服务端置顶列表已剔除撤回消息
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ, { recalledAt: Date.now() }); });
    await waitFor(() => expect(document.querySelector(".pin-banner")).not.toBeInTheDocument());
  });

  it("置顶消息被编辑 → 同样重拉，横幅显新文案（不留旧文案）", async () => {
    await enterChatWithPinned();
    Fake.pinned = [{ ...pin(), content: "改到周六上午十点" }];
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ, { editedAt: Date.now(), content: "改到周六上午十点" }); });
    await waitFor(() => expect(document.querySelector(".pin-banner-text")!.textContent).toBe("改到周六上午十点"));
  });

  it("非置顶消息被撤回 → 不做多余重拉（横幅照旧）", async () => {
    await enterChatWithPinned();
    const before = (Fake.last!.calls["fetchPinned"] ?? []).length;
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ + 1, { recalledAt: Date.now() }); });
    expect((Fake.last!.calls["fetchPinned"] ?? []).length).toBe(before);
    expect(document.querySelector(".pin-banner")).toBeInTheDocument();
  });

  it("横幅尚未收敛（重拉失败/帧未到）时从面板定位 → 提示「原消息已被撤回」，不静默滚到墓碑", async () => {
    await enterChatWithPinned();
    // 服务端置顶列表仍返回这条（模拟重拉失败/在飞）——横幅留在旧集合上。
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ, { recalledAt: Date.now() }); });
    await screen.findByText("对方撤回了一条消息");
    expect(document.querySelector(".pin-banner")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".pin-banner")!);
    fireEvent.click(await screen.findByRole("button", { name: "定位到聊天位置" }));
    expect(await screen.findByText("原消息已被撤回")).toHaveClass("toast");
    expect(document.querySelector(".pinned-modal")).not.toBeInTheDocument(); // 先关面板再定位
  });
});

// ── 置顶面板 v3（PINNED_PANEL_DESIGN 2026-10-15）：横幅去轮转 + 面板（长按取消 / 批量摘除 / 一键取消所有） ──
const three = (): PinnedMessage[] => [
  { ...pin(7), content: "第七条", pinnedAt: 100 },
  { ...pin(8), content: "第八条", pinnedAt: 300 },
  { ...pin(9), content: "第九条", pinnedAt: 200 },
];
async function enterWith(list: PinnedMessage[]) {
  Fake.pinned = list;
  await enterChat();
  await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
}
const openPanel = async () => {
  fireEvent.click(document.querySelector(".pin-banner-main")!);
  await waitFor(() => expect(document.querySelector(".pinned-modal")).toBeInTheDocument());
};
const panelSeqs = () => [...document.querySelectorAll(".pinned-item")].map((el) => Number(el.getAttribute("data-pinned-seq")));

describe("置顶横幅：不轮转，恒显最新置顶，点击 = 打开面板", () => {
  it("多条：显 pinned_at 最大那条 + kicker「· 3 条」；点横幅打开面板而不是跳转/轮转", async () => {
    await enterWith(three());
    expect(document.querySelector(".pin-banner-text")!.textContent).toBe("第八条");
    expect(document.querySelector(".pin-banner-kicker")!.textContent).toContain("· 3 条");
    await openPanel();
    expect(panelSeqs()).toEqual([7, 8, 9]); // 面板顺序 = 服务端顺序（pinned_at 倒序由服务端排好）
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".pinned-modal")).not.toBeInTheDocument());
    expect(document.querySelector(".pin-banner-text")!.textContent).toBe("第八条"); // 没轮转
  });

  it("单条：≡ 也显示，kicker 无计数", async () => {
    await enterWith([pin()]);
    expect(document.querySelector(".pin-banner-list")).toBeInTheDocument();
    expect(document.querySelector(".pin-banner-kicker")!.textContent).not.toContain("条");
  });
});

describe("置顶面板", () => {
  it("长按（右键）菜单里的「取消置顶」只作用于所长按那条，不确认；菜单渲染在面板遮罩之内（层级在面板之上）", async () => {
    await enterWith(three());
    await openPanel();
    const row9 = document.querySelector('.pinned-item[data-pinned-seq="9"] .bubble')!;
    fireEvent.contextMenu(row9, { clientX: 10, clientY: 10 });
    const menu = await waitFor(() => { const m = document.querySelector(".pinned-ctx-menu"); expect(m).toBeInTheDocument(); return m!; });
    expect(menu.closest(".modal-mask")).not.toBeNull();
    expect([...menu.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["取消置顶", "复制", "定位到聊天位置"]);
    fireEvent.click(screen.getByText("取消置顶", { selector: ".pinned-ctx-menu button" }));
    expect(Fake.last!.calls["pinMessage"]).toEqual([[CID, 9, false]]);
    expect(document.querySelector(".pinned-ctx-menu")).not.toBeInTheDocument();
    expect(document.querySelector(".confirm-modal")).not.toBeInTheDocument(); // 不确认
  });

  it("批量取消帧（targets 逐条 pinnedAt=0）→ 面板实时摘除对应行；摘空自动收起、横幅消失", async () => {
    await enterWith(three());
    await openPanel();
    Fake.pinned = [three()[1]];
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, 7, { pinnedAt: 0 }); Fake.last!.handlers.onMsgOp!(CID, 9, { pinnedAt: 0 }); });
    await waitFor(() => expect(panelSeqs()).toEqual([8]));
    Fake.pinned = [];
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, 8, { pinnedAt: 0 }); });
    await waitFor(() => expect(document.querySelector(".pinned-modal")).not.toBeInTheDocument());
    expect(document.querySelector(".pin-banner")).not.toBeInTheDocument();
  });

  it("取消所有置顶：二次确认后调一次批量接口，成功收起面板、横幅消失", async () => {
    await enterWith(three());
    await openPanel();
    fireEvent.click(screen.getByText("取消所有置顶"));
    expect(await screen.findByText("将取消本会话全部 3 条置顶，所有成员都不再看到。")).toBeInTheDocument();
    fireEvent.click(screen.getByText("全部取消"));
    await waitFor(() => expect(document.querySelector(".pinned-modal")).not.toBeInTheDocument());
    expect(Fake.last!.calls["clearPinned"]).toEqual([[CID]]);
    expect(Fake.last!.calls["pinMessage"]).toBeUndefined(); // 不在客户端循环发 pin
    await waitFor(() => expect(document.querySelector(".pin-banner")).not.toBeInTheDocument());
  });

  it("取消所有置顶失败 → toast + 重拉对齐，面板保留", async () => {
    await enterWith(three());
    await openPanel();
    Fake.clearPinnedError = Object.assign(new Error("无权限执行该操作"), { code: 300006 });
    const before = (Fake.last!.calls["fetchPinned"] ?? []).length;
    fireEvent.click(screen.getByText("取消所有置顶"));
    fireEvent.click(await screen.findByText("全部取消"));
    expect(await screen.findByText("无权限执行该操作")).toHaveClass("toast");
    await waitFor(() => expect((Fake.last!.calls["fetchPinned"] ?? []).length).toBeGreaterThan(before));
    expect(document.querySelector(".pinned-modal")).toBeInTheDocument();
  });
});
