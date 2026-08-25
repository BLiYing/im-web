import { useEffect, useState, type MouseEvent } from "react";
import { Link2 } from "lucide-react";
import { linkPreviewCache, type LinkPreview } from "./LinkCard";

// 详情页 / 收藏页共用的 URL 卡（草图 §C/§D）：36×36 图标 + t1 og:title(host 兜底) + t2 host+path(mono) + t3 时间。
// 图标改回统一 <Link2>（accent 色）——用户明确否决按 host 首字母生成的伪 favicon 方案。
// 详情页只显时间；收藏页额外显来源（source={会话名 · 发送人}），对齐 iOS `IMDetailFileCell.m:59` 现有约定。
// 未命中缓存时 t1 兜底 host，异步抓到 og:title 就地替换（不改行高，无需回调宿主刷表）。
export function DetailLinkItem({ url, timeText, source, fetchPreview, onContextMenu, onOpen }: {
  url: string;
  timeText: string;
  source?: string; // 收藏页传入（如"技术讨论群 · 张三"）；详情页省略
  fetchPreview: (u: string) => Promise<LinkPreview>;
  onContextMenu?: (e: MouseEvent) => void;
  onOpen?: () => void; // 详情页/收藏页可覆盖点击（否则默认 window.open）
}) {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(linkPreviewCache.get(url));
  useEffect(() => {
    if (linkPreviewCache.has(url)) { setPreview(linkPreviewCache.get(url)); return; }
    let alive = true;
    fetchPreview(url)
      .catch((): LinkPreview | null => null)
      .then((res) => { linkPreviewCache.set(url, res); if (alive) setPreview(res); });
    return () => { alive = false; };
  }, [url, fetchPreview]);

  let host = "", pathAndQuery = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    // 省略 scheme + trailing slash（草图规格）
    pathAndQuery = u.pathname === "/" ? "" : u.pathname;
    if (u.search) pathAndQuery += u.search;
  } catch { host = url; }
  const hostAndPath = pathAndQuery ? `${host}${pathAndQuery}` : host;
  const title = (preview?.title && preview.title.trim()) || host;

  // 阻断冒泡：外层 .fav-item.link 可能挂 onClick=onRowClick，DetailLinkItem 内 <a> onClick 若不 stop，
  // React 事件会冒泡到父容器，onOpen 与父级 onClick 若是同一函数会被调两次（打开两个新标签或多次 toggle）。
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    if (onOpen) { e.preventDefault(); onOpen(); }
  };

  return (
    <a className="detail-linkitem-v2" href={url} target="_blank" rel="noopener noreferrer"
       onClick={click} onContextMenu={onContextMenu}>
      <div className="detail-linkitem-favicon"><Link2 size={18} /></div>
      <div className="detail-linkitem-body">
        <div className="detail-linkitem-t1">{title}</div>
        <div className="detail-linkitem-t2">{hostAndPath}</div>
        {source && <div className="detail-linkitem-source">{source}</div>}
        <div className="detail-linkitem-t3">{timeText}</div>
      </div>
    </a>
  );
}
