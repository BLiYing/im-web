import type { ChatMessage } from "./sdk/protocol";

/** 只探服务端资源：相对路径（/uploads/…）或 http(s)；blob:/data:/本地占位不会被服务端清理，探了是白请求。 */
export function isProbeableUrl(key: string): boolean {
  return !!key && /^(https?:\/\/|\/(?!\/))/i.test(key);
}

export interface ExpiryProberDeps {
  fetchFn: (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number }>;
  isKnownExpired: (key: string) => boolean;
  /** 探到 404/410 时回调（调用方落持久失效标记 + 打日志）。 */
  onGone: (m: ChatMessage, status: number) => void;
  /** 并发上限：别把浏览器每主机 6 连接占满、拖慢可见图片。 */
  max?: number;
}

/**
 * 主动探失效（ranged GET `bytes=0-0`，只认 404/410）。
 * - 每地址每会话一次；`force`（进查看器那一次）无视「已探过」；
 * - 没探出结论（断网 / 5xx / 401 / 429）撤掉记号，下次进页还能再探；
 * - 并发有上限，超出的排队。
 * 抽成纯模块是为了能脱离 React 单测（此前守卫写错、没有任何测试踩到真实路径）。
 */
export function createExpiryProber(deps: ExpiryProberDeps): (m: ChatMessage, force?: boolean) => void {
  const probed = new Set<string>();
  const queue: Array<() => void> = [];
  const max = deps.max ?? 4;
  let inflight = 0;
  const pump = () => {
    while (inflight < max && queue.length > 0) {
      inflight++;
      queue.shift()!();
    }
  };
  return (m, force = false) => {
    const key = m.content;
    if (!isProbeableUrl(key) || deps.isKnownExpired(key)) return;
    if (!force && probed.has(key)) return;
    probed.add(key);
    queue.push(() => {
      void (async () => {
        try {
          const resp = await deps.fetchFn(key, { headers: { Range: "bytes=0-0" } });
          if (resp.status === 404 || resp.status === 410) deps.onGone(m, resp.status);
          else if (resp.status >= 500 || resp.status === 401 || resp.status === 429) probed.delete(key);
        } catch {
          probed.delete(key);
        } finally {
          inflight--;
          pump();
        }
      })();
    });
    pump();
  };
}
