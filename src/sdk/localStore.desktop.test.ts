// 桌面代理的契约测试：**同一组断言**经过一座回环桥再跑一遍。
//
// 它验的不是存储语义（那由 web / SQLite 各自的契约跑批负责），而是**跨进程那一跳有没有丢东西**：
// 参数少传一个、返回值没透传、`undefined` 被吃掉、兜底值取反……这些在真机上表现为
// 「桌面版某个功能静默失灵、浏览器版一切正常」，是最难查的一类。
//
// 回环桥刻意经过 `structuredClone`——那正是 Electron IPC 的序列化语义。传了不可克隆的东西
// （函数、类实例）在这里就会炸，而不是等到真机上才发现。
import { describe, expect, it, vi } from "vitest";
import { webLocalStore } from "./localStore.web";
import { createDesktopLocalStore, isStoreBridgeUsable, STORE_BRIDGE_METHODS } from "./localStore.desktop";
import { runLocalStoreContract } from "./localStore.contract";
import type { LocalStore } from "./localStore.types";

type AnyFn = (...args: unknown[]) => Promise<unknown>;

/** 一座把调用转给 web 实现的假桥，进出各克隆一次（= 跨进程边界）。 */
function loopbackBridge(): { call: (m: string, args: unknown[]) => Promise<unknown> } {
  return {
    call: async (method: string, args: unknown[]) => {
      const sent = structuredClone(args);
      const result = await (webLocalStore[method as keyof typeof webLocalStore] as AnyFn)(...sent);
      return structuredClone(result);
    },
  };
}

const proxied = createDesktopLocalStore(loopbackBridge());
if (!proxied) throw new Error("回环桥应当可用");
runLocalStoreContract(proxied as LocalStore);

describe("桌面代理的桥校验与降级", () => {
  it("没有转发口 / 桥不是对象 → null（整体回落 IndexedDB，不给半套）", () => {
    // 半套的后果：14 个方法写 SQLite、1 个读 IndexedDB，同一份数据分裂在两个库里，
    // 比"整体用旧的"糟得多。所以校验不通过时返回 null，而不是逐方法降级。
    expect(createDesktopLocalStore(undefined)).toBeNull();
    expect(createDesktopLocalStore(null)).toBeNull();
    expect(createDesktopLocalStore("nope")).toBeNull();
    expect(createDesktopLocalStore({})).toBeNull();
    expect(createDesktopLocalStore({ call: 42 })).toBeNull();
    expect(isStoreBridgeUsable(loopbackBridge())).toBe(true);
  });

  it("方法名清单是 16 个、无重复——它是与主进程白名单对齐的那一侧", () => {
    // 另一侧在 desktop/src/shared/storeIpc.ts，两者相等由 desktop/test/storeBridge.test.ts 断言。
    expect(STORE_BRIDGE_METHODS).toHaveLength(16);
    expect(new Set(STORE_BRIDGE_METHODS).size).toBe(16);
  });

  it("IPC 失败一律降级成兜底值，**绝不 reject**", async () => {
    // 主进程崩了 / 通道没装 / 白名单拒了，表现都是 invoke reject。而调用方大多是
    // `void localStore.xxx(...)`——一个未捕获的 rejection 就挂在那里，且持久化只是增强，
    // 不该让收发主流程跟着断。
    const boom = { call: vi.fn(async () => { throw new Error("ipc gone"); }) };
    const s = createDesktopLocalStore(boom);
    expect(s).not.toBeNull();
    const st = s as LocalStore;
    const m = { convId: "c1", from: "a", content: "x", contentType: "text", convSeq: 1, timestamp: 1, status: "received" as const };
    await expect(st.saveMessage("o", m)).resolves.toBeUndefined();
    await expect(st.loadConversation("o", "c1")).resolves.toEqual([]);
    await expect(st.loadSyncCursor("o", "c1")).resolves.toBe(0);
    await expect(st.loadRanges("o", "c1")).resolves.toEqual({ ranges: [], head: 0 });
    await expect(st.loadDeletedSeqs("o", "c1")).resolves.toEqual([]);
    await expect(st.searchMessages("o", { q: "x", limit: 5 })).resolves.toEqual([]);
    await expect(st.registerRange("o", "c1", 1, 2)).resolves.toEqual([]);
    // **整页写失败必须回 false**：回 true 等于谎报"这一页落库了"，调用方据此继续往下翻，
    // 那一页就永久漏了。宁可重拉，不可漏拉。
    await expect(st.saveIncomingPage("o", [m], 1, 1, 1)).resolves.toBe(false);
  });

  it("通道拒绝（主进程回 undefined）也走兜底，不把 undefined 当结果", async () => {
    const silent = { call: vi.fn(async () => undefined) };
    const st = createDesktopLocalStore(silent) as LocalStore;
    await expect(st.loadSyncCursor("o", "c1")).resolves.toBe(0);
    await expect(st.loadConversation("o", "c1")).resolves.toEqual([]);
    await expect(st.saveIncomingPage("o", [], 0, 0, 0)).resolves.toBe(false);
  });
});
