// 契约测试的 web 入口：让 IndexedDB 实现跑一遍 `runLocalStoreContract`（DESKTOP_DESIGN §7.6.4）。
//
// 断言集单独放在 localStore.contract.ts，是为了让 D4-3b 的 SQLite 实现能原样再跑一遍
// （包括在 `desktop/` 那个独立工程里，§7.4：im-web 的 npm test 不许依赖 Electron）。
//
// 与 localStore.test.ts 的分工：那个是 web 这一路的**历史回归**（本次平移前后逐字未改，
// 正是「行为没变」的证据），还带着 IndexedDB 特有的用例（store 升级、陈旧连接降级）；
// 本文件只跑**实现无关**的语义。
import { describe, expect, it } from "vitest";
import { webLocalStore } from "./localStore.web";
import { activeLocalStore } from "./localStore";
import { runLocalStoreContract } from "./localStore.contract";

runLocalStoreContract(webLocalStore);

describe("本地库实现的选择点", () => {
  it("没有桌面桥时选 web（IndexedDB），并且缓存住同一个实例", () => {
    // D4-3b 接上 SQLite 后这条要改成「有桥选 desktop、桥半残回落 web」。
    expect(activeLocalStore().name).toBe("web-indexeddb");
    expect(activeLocalStore()).toBe(webLocalStore);
  });
});
