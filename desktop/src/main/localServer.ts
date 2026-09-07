// 打包版的「同源层」：在 127.0.0.1 上起一个本地服务，静态服务 dist/，并把 /api、/ws、/uploads
// 反代到真后端。**这是 DESKTOP_DESIGN §7.5 的方案 B。**
//
// 为什么不是方案 A（桥注入绝对 base URL）——两条都是实测出来的，不是推演：
//   ① 后端没有任何 CORS 处理（全仓 Access-Control-Allow-* 零命中）。实测：从 origin
//      http://localhost:5173 打 http://localhost:8080/api/v1/login → Failed to fetch；
//      打相对路径 /api/v1/login → HTTP 400（真到了后端）。所以 A 还得外加 CORS 垫片。
//   ② 消息里存的媒体地址本身就是相对路径（/uploads/xxx，服务端不知道端可达的 host，
//      故不绝对化——同一条约定见 im-android 的 data/MediaUrl.kt）。A 要改 29 个渲染点。
// B 让打包版与 dev 环境**同源、同路径、同行为**，于是上面两件事一件都不用做，
// 并且 im-web 的 src/ 零改动。代价是外壳里多一个常驻端口与它的生命周期，都在本文件里收着。
//
// 安全边界：只绑 127.0.0.1（不是 0.0.0.0）、用临时端口。本服务自身不做鉴权，
// 也不需要——它转发的后端本来就要 JWT，代理没有放大任何权限。
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect } from "node:net";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { URL } from "node:url";

/** 反代前缀。**与仓库根 vite.config.ts 的 proxy 配置是对称的**——那边加一条，这边就得加一条，
 *  否则 dev 通、打包版 404。写这行时就漏过一次 `/avatars`（头像独立目录，方案 C），
 *  是照着 vite.config.ts 核对才发现的。已在 docs/SYMMETRY.md 登记。 */
const PROXY_PREFIXES = ["/api", "/uploads", "/avatars"];
const WS_PATH = "/ws";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

export interface LocalServerHandle {
  /** 实际监听的端口。调用方要把它记下来，下次复用——见下方 startLocalServer 的说明。 */
  port: number;
  /** 页面该加载的地址，形如 http://127.0.0.1:53412/ */
  url: string;
  close(): void;
}

function isProxied(pathname: string): boolean {
  return PROXY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 把请求原样转给后端并把响应回灌。失败回 502 而不是挂着——挂着会让页面转圈到超时，查起来更费劲。 */
function proxy(req: IncomingMessage, res: ServerResponse, backend: URL): void {
  const upstream = httpRequest(
    {
      protocol: backend.protocol,
      hostname: backend.hostname,
      port: backend.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: backend.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`本地代理够不着后端 ${backend.origin}：${e.message}\n`);
  });
  req.pipe(upstream);
}

/** 静态文件。**必须防目录穿越**——这是一个真的 HTTP 服务，不是内存里的 mock。 */
function serveStatic(pathname: string, root: string, res: ServerResponse): void {
  // decodeURIComponent 可能抛（畸形 %），当作找不到处理，别让整个服务崩。
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const full = normalize(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) {
    res.writeHead(403).end();   // 穿越出 dist/ 一律拒
    return;
  }
  let file = full;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
  } catch {
    // 找不到。**带扩展名的一律 404，不回 index.html**——否则 /avatars/x.jpg 会拿到一份
    // HTTP 200 的 HTML，浏览器解码失败、页面把 <img> 换成首字母兜底，于是「代理前缀漏了一条」
    // 表现成「头像变首字母」而不是错误，查起来要命（2026-09-07 就是这么骗过第一版 e2e 检查的）。
    // 无扩展名的才回 index.html：im-web 是单页应用（无 router），这条兜「刷新到怪路径」。
    if (extname(file)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`本地同源层没有这个文件，且它不在反代前缀内（${PROXY_PREFIXES.join(" ")}）：${pathname}\n`);
      return;
    }
    file = join(root, "index.html");
  }
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

/**
 * 起本地同源层。`root` 是 dist 目录，`backendOrigin` 形如 http://localhost:8080。
 *
 * **端口必须稳定**：`localStorage` 按 origin 隔离，origin 里带端口——端口每次变，
 * 登录会话 / 主题 / 壁纸 / 字号 / 会话列表缓存每次启动全丢（D2 第一版的真实下场，
 * 2026-09-08 做 D3 实测时才照出来）。所以优先复用上次记住的端口；
 * 被别人占了就退回系统分配并记住新的——那一次会丢会话，但总比起不来强。
 */
export function startLocalServer(
  root: string,
  backendOrigin: string,
  preferredPort = 0,
): Promise<LocalServerHandle> {
  const backend = new URL(backendOrigin);
  const rootNorm = normalize(root);

  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (isProxied(pathname)) proxy(req, res, backend);
    else serveStatic(pathname, rootNorm, res);
  });

  // WebSocket：http 模块不解析 upgrade，这里自己拿裸 socket 对接后端，双向对拷。
  // 不用任何代理库——一条 TCP 隧道就够，少一个依赖少一处要跟着升级的东西。
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== WS_PATH) { socket.destroy(); return; }
    const up = netConnect(Number(backend.port), backend.hostname, () => {
      const lines = [`GET ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        const val = Array.isArray(v) ? v.join(", ") : v;
        lines.push(`${k === "host" ? "host" : k}: ${k === "host" ? backend.host : val}`);
      }
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    // 任一端断/错都把另一端拆掉，否则半开连接会攒住 fd。
    const kill = (): void => { up.destroy(); socket.destroy(); };
    up.on("error", kill);
    socket.on("error", kill);
    socket.on("close", () => up.destroy());
  });

  return new Promise((resolve, reject) => {
    const done = (): void => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { reject(new Error("拿不到本地端口")); return; }
      resolve({ port: addr.port, url: `http://127.0.0.1:${addr.port}/`, close: () => server.close() });
    };
    const onFirstError = (e: NodeJS.ErrnoException): void => {
      // 记住的端口被别人占了 → 退回系统分配。其余错误照抛。
      if (preferredPort && e.code === "EADDRINUSE") {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", done);
        return;
      }
      reject(e);
    };
    server.once("error", onFirstError);
    server.listen(preferredPort, "127.0.0.1", done);
  });
}
