import { useEffect, useState } from "react";
import { isOwnInviteLink } from "../qr";

export type LinkPreview = { url: string; title?: string; description?: string; image?: string; site_name?: string };
export const linkPreviewCache = new Map<string, LinkPreview | null>(); // 进程内缓存（含负缓存 null=抓取失败）
const inflight = new Map<string, Promise<LinkPreview | null>>(); // 同一 URL 并发挂载时共享同一次请求，避免 N 次重复抓取

/** URL 消息渲染：始终显示可点击的 URL 文本，其下方叠加 OG 富预览卡片（拉到 OG 才显示卡片，否则仅链接）。
 *  层3：onOpenInvite 非空且 url 是本站邀请链接（/q/u、/q/g）→ 拦截点击走站内 resolve 流程（不开新标签页）。 */
export function LinkCard({ url, fetchPreview, onMediaLoad, onOpenInvite }: {
  url: string; fetchPreview: (u: string) => Promise<LinkPreview>; onMediaLoad?: () => void; onOpenInvite?: (u: string) => void;
}) {
  const [p, setP] = useState<LinkPreview | null | undefined>(linkPreviewCache.get(url));
  useEffect(() => {
    if (linkPreviewCache.has(url)) { setP(linkPreviewCache.get(url)); return; }
    let alive = true;
    // 多个气泡同 URL 同时挂载 → 复用在途 Promise，只发一次 fetchPreview。
    let req = inflight.get(url);
    if (!req) {
      req = fetchPreview(url)
        .catch((): LinkPreview | null => null)
        .then((res) => { linkPreviewCache.set(url, res); inflight.delete(url); return res; });
      inflight.set(url, req);
    }
    req.then((res) => { if (alive) setP(res); });
    return () => { alive = false; };
  }, [url, fetchPreview]);
  let host = ""; try { host = new URL(url).hostname; } catch { /* */ }
  const hasCard = !!(p && (p.title || p.image));
  const intercept = onOpenInvite && isOwnInviteLink(url, location.origin)
    ? (e: React.MouseEvent) => { e.preventDefault(); onOpenInvite(url); }
    : undefined;
  return (
    <span className="url-msg">
      <a className="btext msg-link" href={url} target="_blank" rel="noreferrer" onClick={intercept}>{url}</a>
      {hasCard && (
        <a className="link-card" href={url} target="_blank" rel="noreferrer" onClick={intercept}>
          {p!.image && <img className="link-card-img" src={p!.image} alt="" onLoad={onMediaLoad} />}
          <div className="link-card-body">
            <div className="link-card-title">{p!.title || url}</div>
            {p!.description && <div className="link-card-desc">{p!.description}</div>}
            <div className="link-card-site">{p!.site_name || host}</div>
          </div>
        </a>
      )}
    </span>
  );
}
