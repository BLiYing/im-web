// 把桥两侧的方法白名单钉在一起。
//
// 这两份清单跨仓、同源不了（im-web 与 desktop 是两套独立依赖树，§7.4）。不钉的话，
// 一侧加了方法另一侧没加**不会报错**——主进程白名单不认 → 返回 undefined → 渲染侧代理
// 按兜底值处理，表现是「桌面端那一个功能静默不工作，浏览器版一切正常」。
//
// im-web 那一侧的清单放在 `localStore.types.ts`（只有 import type，跨过来不带运行时代码），
// 且那边还有一道编译期穷尽性检查：给 `LocalStore` 加方法却忘了加进清单，tsc 当场红。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IPC_STORE, STORE_METHODS, isStoreMethod } from "../src/shared/storeIpc";
import { LOCAL_STORE_METHODS } from "../../src/sdk/localStore.types";

describe("本地库桥的两侧对齐", () => {
  it("主进程白名单 === im-web 契约里的方法清单", () => {
    expect([...STORE_METHODS].sort()).toEqual([...LOCAL_STORE_METHODS].sort());
  });

  it("白名单拒绝清单外的任何东西（防把渲染进程的任意属性访问转发给主进程对象）", () => {
    expect(isStoreMethod("close")).toBe(false);      // 主进程实现上真有 close，绝不能暴露
    expect(isStoreMethod("constructor")).toBe(false);
    expect(isStoreMethod("__proto__")).toBe(false);
    expect(isStoreMethod(undefined)).toBe(false);
    for (const m of STORE_METHODS) expect(isStoreMethod(m)).toBe(true);
  });

  it("preload 里手抄的通道名与共享模块一致", () => {
    // preload 引不了共享模块（sandbox 里没有相对 require），所以那边是一份字面量。
    // 不一致时不报错，表现是「整个本地库静默不工作」——这条断言就是那份字面量的护栏。
    const src = readFileSync(join(__dirname, "../src/preload/index.ts"), "utf8");
    expect(src).toContain(`"${IPC_STORE}"`);
    // 顺带钉住：preload **不许**再去 import 相对路径的模块（会在 sandbox 里 module not found）。
    expect(src).not.toMatch(/^import .* from "\.\.?\//m);
  });
});
