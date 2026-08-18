import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 单元测试配置（与 dev 的 vite.config.ts 分开，避免混入 proxy）。
// - 纯逻辑/存储模块：默认 node 环境（快），setup 注入 indexedDB + localStorage。
// - 组件/Hook 测试（.test.tsx）：在文件顶部用 `// @vitest-environment jsdom` 单独起 jsdom，
//   不拖慢已有纯逻辑用例；React 插件负责 JSX 转换。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
