// @vitest-environment jsdom
//
// 拖文件进窗口的判据与监听。这段判错的后果都不报错：
//   · 落在聊天列外没拦 → 浏览器打开那个文件（离开应用）；桌面端整个窗口被导航到 file://；
//   · 不是文件拖拽也拦 → 输入框里拖选文字这类原生行为失灵；
//   · 不能收时照收 → 禁言/多选态下文件照样进了预览条。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { dropDecision, useFileDrop } from "./useFileDrop";

describe("dropDecision", () => {
  it("不是文件拖拽 → ignore（不碰原生行为）", () => {
    expect(dropDecision({ hasFiles: false, inZone: true, enabled: true })).toBe("ignore");
  });
  it("文件落在聊天列且能收 → accept", () => {
    expect(dropDecision({ hasFiles: true, inZone: true, enabled: true })).toBe("accept");
  });
  it("文件落在聊天列外、或此刻不能收 → block（拦住默认行为但不收）", () => {
    expect(dropDecision({ hasFiles: true, inZone: false, enabled: true })).toBe("block");
    expect(dropDecision({ hasFiles: true, inZone: true, enabled: false })).toBe("block");
  });
});

/** jsdom 没有 DataTransfer 构造器：造一个带 dataTransfer 的可取消事件。 */
function dragEvent(type: string, types: string[], files: File[] = []) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types, files, dropEffect: "" };
  Object.defineProperty(e, "dataTransfer", { value: dataTransfer });
  return { e, dataTransfer };
}

function setupDom() {
  document.body.innerHTML = `<div class="chat"><div class="msgs"><span id="in"></span></div></div><aside id="out"></aside>`;
  return { inside: document.getElementById("in")!, outside: document.getElementById("out")! };
}

// **必须 cleanup**：每个用例 renderHook 一次，不卸载的话前面用例的 window 监听还挂着，
// 会替后面的用例把事件拦下——「卸载后不再拦」那条就是被它染红的，其余几条则可能被它掩护着假绿。
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("useFileDrop", () => {
  const file = new File(["x"], "a.png", { type: "image/png" });

  it("落在聊天列里 → 拦住默认行为、光标显示可放置、文件交给 onFiles", () => {
    const { inside } = setupDom();
    const onFiles = vi.fn();
    renderHook(() => useFileDrop({ enabled: true, onFiles }));
    const over = dragEvent("dragover", ["Files"]);
    inside.dispatchEvent(over.e);
    expect(over.e.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    const drop = dragEvent("drop", ["Files"], [file]);
    inside.dispatchEvent(drop.e);
    expect(drop.e.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("**落在聊天列外 → 仍然拦住**（否则浏览器打开文件、桌面端窗口被导航走），但不收", () => {
    const { outside } = setupDom();
    const onFiles = vi.fn();
    renderHook(() => useFileDrop({ enabled: true, onFiles }));
    const over = dragEvent("dragover", ["Files"]);
    outside.dispatchEvent(over.e);
    expect(over.e.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("none");
    const drop = dragEvent("drop", ["Files"], [file]);
    outside.dispatchEvent(drop.e);
    expect(drop.e.defaultPrevented).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("此刻不能收（禁言 / 多选 / 没打开会话）→ 拦住但不收；能收之后读的是最新值", () => {
    const { inside } = setupDom();
    const onFiles = vi.fn();
    const { rerender } = renderHook((p: { enabled: boolean }) => useFileDrop({ enabled: p.enabled, onFiles }),
      { initialProps: { enabled: false } });
    const blocked = dragEvent("drop", ["Files"], [file]);
    inside.dispatchEvent(blocked.e);
    expect(blocked.e.defaultPrevented).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
    rerender({ enabled: true });
    inside.dispatchEvent(dragEvent("drop", ["Files"], [file]).e);
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it("不是文件拖拽（页面内拖文字）→ 完全不碰", () => {
    const { inside } = setupDom();
    const onFiles = vi.fn();
    renderHook(() => useFileDrop({ enabled: true, onFiles }));
    const over = dragEvent("dragover", ["text/plain"]);
    inside.dispatchEvent(over.e);
    expect(over.e.defaultPrevented).toBe(false);
    const drop = dragEvent("drop", ["text/plain"]);
    inside.dispatchEvent(drop.e);
    expect(drop.e.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("卸载后监听拆干净：不再拦、不再收", () => {
    const { inside } = setupDom();
    const onFiles = vi.fn();
    const { unmount } = renderHook(() => useFileDrop({ enabled: true, onFiles }));
    unmount();
    const drop = dragEvent("drop", ["Files"], [file]);
    inside.dispatchEvent(drop.e);
    expect(drop.e.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
