// 主进程 SQLite 实现跑**同一组契约断言**（DESKTOP_DESIGN §7.6.4 的 D4-3b 验收）。
//
// 断言集来自 im-web 的 `src/sdk/localStore.contract.ts`——**它只有 `import type`**，
// 所以在这里 import 它不会把浏览器侧的任何运行时代码拖进来（这正是当初把它放在
// 非 `*.test.ts` 文件里的原因，§7.4：两套独立依赖树）。
//
// 本文件放在 `test/` 而不是 `src/`：`src/` 归 `tsc -b` 编译进 out/，rootDir 限制在 src 内，
// 跨边界 import 会 TS6059。类型检查由 `tsconfig.test.json` 负责（npm test 会跑）。
//
// **下面那句 `const store: LocalStore = ...` 是有分量的**：它让 tsc 在类型这一侧确认
// SQLite 实现结构上满足契约。少一个方法、参数顺序错了、返回类型不对，在这里就红——
// 不必等运行时。
import { afterAll } from "vitest";
import type { LocalStore } from "../../src/sdk/localStore.types";
import { runLocalStoreContract } from "../../src/sdk/localStore.contract";
import { createSqliteStore } from "../src/main/sqliteStore";

const impl = createSqliteStore(":memory:", () => { /* 契约里有大量空参用例，噪声不必进输出 */ });
const store: LocalStore = impl;

runLocalStoreContract(store);

afterAll(() => { impl.close(); });
