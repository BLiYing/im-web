import { defineConfig } from "vitest/config";

// **必须排掉 `out/`**：`tsc -b` 会把 `src/**/*.test.ts` 一并编译成 `out/**/*.test.js`，
// 而 vitest 默认的 include 会把那份编译产物也当测试跑——它是 CommonJS，
// `require("vitest")` 当场报「Vitest cannot be imported in a CommonJS module」。
// 表现是「跑过一次 compile / dev / e2e 之后，npm test 就红一个莫名其妙的用例」。
// 这不是本次改动引入的，是 `npm test` 与 `tsc -b` 共存以来一直在的坑，顺手修掉。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["out/**", "node_modules/**"],
  },
});
