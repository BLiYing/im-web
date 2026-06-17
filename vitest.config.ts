import { defineConfig } from "vitest/config";

// 单元测试配置（与 dev 的 vite.config.ts 分开，避免混入 proxy/React 插件）。
// jsdom 提供 localStorage/DOM；fake-indexeddb/auto 在每个测试文件前 polyfill 全局 indexedDB。
export default defineConfig({
    test: {
    environment: "node", // 纯逻辑/存储模块，无需 DOM；setup 里注入 indexedDB + localStorage
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
