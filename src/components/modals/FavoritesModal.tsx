import { useEffect, useMemo, useState } from "react";
import { Check, Link as LinkIcon, MessageSquareQuote, X } from "lucide-react";
import type { Favorite } from "../../sdk/protocol";
import type { FavoriteCtx, MenuAction } from "../../menus";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, isUrlText, videoFrameSrc } from "../../messageContent";
import { formatFileSize } from "../../fileMetadata";
import {
  CATEGORY_LABELS, deriveCategories, matchesCategory, type FavoriteKind,
} from "../../favoritesCategories";
import { Modal } from "../Modal";
import { AnchoredMenu } from "../AnchoredMenu";

/** 收藏项渲染类型（决定左图标列与正文样式）。语音落地前 audio/voice 暂按文件视觉兜底。 */
type FavKind = "image" | "video" | "file" | "link" | "text";
function favKind(f: Favorite): FavKind {
  const ct = f.content_type;
  if (ct === "image") return "image";
  if (ct === "video") return "video";
  if (ct === "file" || ct === "audio" || ct === "voice") return "file";
  if (ct === "link" || (ct === "text" && isUrlText(f.content))) return "link";
  return "text";
}

/** 文件名：优先后端 file_name，空则从 URL 反推（老收藏兜底）。 */
function favFileName(f: Favorite): string {
  return (f.file_name && f.file_name.trim()) || fileNameFromContent(f.content);
}

/** 收藏时间显示：今天显时分、昨天、更早显日期（与 iOS 相对时间同心智）。 */
function favDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const hm = `${String(d.getHours()).padStart(2, "0")}:${mm}`;
  if (sameDay(d, now)) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `昨天 ${hm}`;
  return `${d.getFullYear() === now.getFullYear() ? "" : d.getFullYear() + "/"}${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 收藏列表弹窗（收藏改造 · Web 追平 FAVORITES_DESIGN §10）：
 * 分类 chips + 范围搜索（前缀 chip）+ 统一左图标列 + 右键菜单 + 文本阅读器；
 * mode="pick" 时行可勾选、底部「发送(N)」（对齐 iOS Pick）。
 * 纯展示：媒体查看器 / 链接打开 / 文件下载 / 菜单动作全部由 App 注入。
 */
export function FavoritesModal({
  favorites, mode = "browse", sourceLabel, actions,
  onOpenMedia, onOpenLink, onDownloadFile, onPick, onClose,
}: {
  favorites: Favorite[];
  mode?: "browse" | "pick";
  sourceLabel: (f: Favorite) => string;
  actions: MenuAction<FavoriteCtx>[];      // buildFavoriteActions(...)，browse 右键菜单用
  onOpenMedia: (fav: Favorite, kind: "image" | "video") => void;
  onOpenLink: (url: string) => void;
  onDownloadFile: (fav: Favorite) => void;
  onPick?: (favs: Favorite[]) => void;     // pick 模式：发送选中项到当前会话
  onClose: () => void;
}) {
  const isPick = mode === "pick";
  const [kind, setKind] = useState<FavoriteKind>("all");
  const [query, setQuery] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; f: Favorite } | null>(null);
  const [reader, setReader] = useState<Favorite | null>(null);
  // pick 模式：多选态与选中集（对齐 ForwardPicker：默认单点即发，「多选」切勾选 + 发送(N)）。
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const categories = useMemo(() => deriveCategories(favorites), [favorites]);
  // 选中分类若因数据变化消失（如删光某类），回落「全部」。
  useEffect(() => { if (!categories.includes(kind)) setKind("all"); }, [categories, kind]);

  // 过滤：先按分类（= 搜索范围），再按关键词（内容 + 文件名 + 来源显示名）。
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return favorites.filter((f) => matchesCategory(f, kind)).filter((f) => {
      if (!q) return true;
      const name = f.content_type === "file" ? favFileName(f) : "";
      return [f.content, f.caption || "", name, sourceLabel(f)].some((s) => s.toLowerCase().includes(q));
    });
  }, [favorites, kind, query, sourceLabel]);

  // 右键菜单开着时，点别处（非菜单内）关闭它。
  useEffect(() => {
    if (!ctx) return;
    const close = (e: Event) => { if ((e.target as Element)?.closest?.(".ctx-menu")) return; setCtx(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctx]);

  const delAction = actions.find((a) => a.id === "delete");

  const toggleSelect = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // 行点击语义：pick=勾选/单发；browse=按类型打开自然全貌。
  const onItemClick = (f: Favorite) => {
    if (isPick) {
      if (multi) { toggleSelect(f.id); return; }
      onPick?.([f]);                 // 单点即发（发进当前会话）
      return;
    }
    const k = favKind(f);
    if (k === "image" || k === "video") onOpenMedia(f, k);
    else if (k === "link") onOpenLink(f.content);
    else if (k === "file") onDownloadFile(f);
    else setReader(f);               // 文本 → 阅读器
  };

  const emptyText = query.trim()
    ? "未找到相关收藏"
    : kind === "all" ? "还没有收藏" : `「${CATEGORY_LABELS[kind]}」暂无收藏`;

  return (
    <Modal className="modal fav-modal" onClose={onClose}>
      <div className="modal-title fwd-title">
        <span>{isPick ? "从收藏发送" : `我的收藏（${favorites.length}）`}</span>
        {isPick && (
          <button className="section-action" onClick={() => { setMulti((v) => !v); setSelected(new Set()); }}>
            {multi ? "取消多选" : "多选"}
          </button>
        )}
      </div>

      {/* 分类 chips：全部 + 动态；选中即过滤（并作搜索范围）。 */}
      <div className="fav-chips">
        {categories.map((k) => (
          <button key={k} className={`fav-chip${k === kind ? " on" : ""}`} onClick={() => setKind(k)}>
            {CATEGORY_LABELS[k]}
          </button>
        ))}
      </div>

      {/* 范围搜索：非「全部」时前缀 chip 显分类名（删它=回全部），占位随范围变。 */}
      <div className="fav-search">
        {kind !== "all" && (
          <span className="fav-scope">
            {CATEGORY_LABELS[kind]}
            <button title="清除范围" onClick={() => setKind("all")}><X size={12} /></button>
          </span>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={kind === "all" ? "搜索收藏" : `在${CATEGORY_LABELS[kind]}中搜索`} />
      </div>

      <div className="fav-list">
        {shown.length === 0 && <div className="fwd-empty">{emptyText}</div>}
        {shown.map((f) => {
          const k = favKind(f);
          const on = selected.has(f.id);
          const size = f.content_type === "file" && f.file_size ? formatFileSize(f.file_size) : "";
          return (
            <div key={f.id} className={`fav-item${isPick && multi && on ? " on" : ""}`}
              onClick={() => onItemClick(f)}
              onContextMenu={isPick ? undefined : (e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, f }); }}>
              {/* 统一左图标列：媒体缩略 / 文件类型图标 / 文本·链接 lucide on --accent-soft。 */}
              <div className={`fav-icon ${k}`}>
                {k === "image" ? (
                  <img className="fav-thumb" src={f.content} alt="图片" />
                ) : k === "video" ? (
                  <span className="fav-thumb-wrap">
                    <video className="fav-thumb" src={videoFrameSrc(f.content)} preload="metadata" muted />
                    <span className="play-badge">▶</span>
                  </span>
                ) : k === "file" ? (
                  <FileTypeIcon name={favFileName(f)} size={28} />
                ) : k === "link" ? (
                  <LinkIcon size={22} />
                ) : (
                  <MessageSquareQuote size={22} />
                )}
              </div>

              <div className="fav-main">
                {k === "file" ? (
                  <div className="fav-content filename">{favFileName(f)}</div>
                ) : k === "link" ? (
                  <div className="fav-content link">{f.content}</div>
                ) : k === "image" || k === "video" ? (
                  <div className="fav-content">{f.caption || (k === "image" ? "[图片]" : "[视频]")}</div>
                ) : (
                  <div className="fav-content">{f.content}</div>
                )}
                {/* 图说：文件收藏的随附文字（媒体的 caption 已作正文，不重复）。 */}
                {f.caption && k === "file" && <div className="fav-caption">{f.caption}</div>}
                <div className="fav-meta">
                  <span className="fav-src">来自{sourceLabel(f)}</span>
                  {favDate(f.created_at) && <> · {favDate(f.created_at)}</>}
                  {size && <> · {size}</>}
                </div>
              </div>

              {/* 右槽：pick 多选=勾选圈；browse=删除 ✕ 快捷（保留）。 */}
              {isPick ? (
                multi && <span className={`checkbox fav-check${on ? " on" : ""}`}>{on && <Check size={13} />}</span>
              ) : (
                <button className="fav-del" title="删除收藏"
                  onClick={(e) => { e.stopPropagation(); delAction?.run({ f }); }}>✕</button>
              )}
            </div>
          );
        })}
      </div>

      {/* pick 多选态：底部发送(N)。 */}
      {isPick && multi ? (
        <div className="fwd-actions">
          <button className="link" onClick={onClose}>取消</button>
          <button className="mini-btn" disabled={selected.size === 0}
            onClick={() => onPick?.(favorites.filter((f) => selected.has(f.id)))}>
            发送{selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      ) : (
        <button className="modal-close" onClick={onClose}>{isPick ? "取消" : "关闭"}</button>
      )}

      {/* 右键菜单（browse）：数据驱动 buildFavoriteActions。 */}
      {ctx && (
        <AnchoredMenu x={ctx.x} y={ctx.y} className="ctx-menu">
          {actions.filter((a) => a.visible({ f: ctx.f })).map((a) => (
            <button key={a.id} className={a.danger ? "danger" : undefined}
              onClick={() => { a.run({ f: ctx.f }); setCtx(null); }}>
              {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}
            </button>
          ))}
        </AnchoredMenu>
      )}

      {/* 文本阅读器：只读全文、可选中复制（§5.6 Web 版）。 */}
      {reader && (
        <Modal className="modal fav-reader" onClose={() => setReader(null)}>
          <div className="modal-title">收藏内容</div>
          <div className="fav-reader-text">{reader.content}</div>
          <div className="fav-meta">
            <span className="fav-src">来自{sourceLabel(reader)}</span>
            {favDate(reader.created_at) && <> · {favDate(reader.created_at)}</>}
          </div>
          <button className="modal-close" onClick={() => setReader(null)}>关闭</button>
        </Modal>
      )}
    </Modal>
  );
}
