import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const rootDir = dirname(fileURLToPath(import.meta.url));

// 「关于我们」的版本串：package.json version + git 短 hash（取不到 git 时只显示 version）。
const appVersion: string = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")).version;
function gitShortHash(): string {
  try { return execSync("git rev-parse --short HEAD", { cwd: rootDir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}

// 开发期日志落盘（配合 src/logging/logger.ts 的 dev sink）：浏览器把结构化日志 POST 到 /__devlog，
// 这里的中间件把 NDJSON 追加到 dev-logs/im-web.log，便于直接读文件排查（生产/构建不启用）。
function devLogSink(): Plugin {
  const logPath = resolve(rootDir, "dev-logs/im-web.log");
  return {
    name: "im-dev-log-sink",
    apply: "serve",
    async configureServer(server) {
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(logPath, ""); // 每次启动 dev server 清空，避免跨会话无限增长（同会话内 append）
      server.middlewares.use("/__devlog", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          void appendFile(logPath, body.endsWith("\n") || body === "" ? body : body + "\n")
            .catch(() => { /* 落盘失败不影响开发 */ })
            .finally(() => { res.statusCode = 204; res.end(); });
        });
      });
      server.config.logger.info(`  ➜  IM 浏览器日志落盘 → ${logPath}`);
    },
  };
}

// 开发期把 /api 与 /ws 代理到本地后端，避免跨域（CORS）。
// 生产部署时由部署层（nginx 等）转发，前端用同源相对路径。
// IM_SERVER_TARGET 可覆盖后端地址（默认 localhost:8080）——压测/多后端联调时指到别的端口，
// 如：IM_SERVER_TARGET=http://localhost:8081 npm run dev（见 IMServer/docs/LOAD_TESTING.md 场景⑥）。
const target = process.env.IM_SERVER_TARGET || "http://localhost:8080";
const wsTarget = target.replace(/^http/, "ws");
export default defineConfig({
  plugins: [react(), devLogSink()],
  define: { __APP_VERSION__: JSON.stringify(appVersion), __APP_BUILD__: JSON.stringify(gitShortHash()) },
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/legal": { target, changeOrigin: true }, // 隐私政策 / 服务条款静态页（IMServer internal/legal）
      "/support": { target, changeOrigin: true }, // 技术支持静态页
      "/uploads": { target, changeOrigin: true },
      "/avatars": { target, changeOrigin: true }, // 头像独立目录（方案 C），与 /uploads 同后端
      "/ws": { target: wsTarget, ws: true },
    },
  },
});
