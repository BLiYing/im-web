import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const rootDir = dirname(fileURLToPath(import.meta.url));
// 开发期日志落盘（配合 src/logging/logger.ts 的 dev sink）：浏览器把结构化日志 POST 到 /__devlog，
// 这里的中间件把 NDJSON 追加到 dev-logs/im-web.log，便于直接读文件排查（生产/构建不启用）。
function devLogSink() {
    const logPath = resolve(rootDir, "dev-logs/im-web.log");
    return {
        name: "im-dev-log-sink",
        apply: "serve",
        async configureServer(server) {
            await mkdir(dirname(logPath), { recursive: true });
            await writeFile(logPath, ""); // 每次启动 dev server 清空，避免跨会话无限增长（同会话内 append）
            server.middlewares.use("/__devlog", (req, res) => {
                if (req.method !== "POST") {
                    res.statusCode = 405;
                    res.end();
                    return;
                }
                let body = "";
                req.on("data", (chunk) => { body += chunk; });
                req.on("end", () => {
                    void appendFile(logPath, body.endsWith("\n") || body === "" ? body : body + "\n")
                        .catch(() => { })
                        .finally(() => { res.statusCode = 204; res.end(); });
                });
            });
            server.config.logger.info(`  ➜  IM 浏览器日志落盘 → ${logPath}`);
        },
    };
}
// 开发期把 /api 与 /ws 代理到本地后端，避免跨域（CORS）。
// 生产部署时由部署层（nginx 等）转发，前端用同源相对路径。
export default defineConfig({
    plugins: [react(), devLogSink()],
    server: {
        port: 5173,
        proxy: {
            "/api": { target: "http://localhost:8080", changeOrigin: true },
            "/uploads": { target: "http://localhost:8080", changeOrigin: true },
            "/avatars": { target: "http://localhost:8080", changeOrigin: true }, // 头像独立目录（方案 C），与 /uploads 同后端
            "/ws": { target: "ws://localhost:8080", ws: true },
        },
    },
});
