import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { Check, ChevronLeft, MoreHorizontal } from "lucide-react";
import type { ChatMessage, Conversation, Favorite } from "../../sdk/protocol";
import type { DownloadState } from "../../download";
import type { FavoriteCtx, MenuAction } from "../../menus";
import {
  CATEGORY_LABELS, defaultCategory, deriveCategories, matchesCategory, type FavoriteKind,
} from "../../favoritesCategories";
import { groupFavoritesBySource, type FavoriteSourceGroup } from "../../favoritesGrouping";
import {
  loadFavoritesViewMode, saveFavoritesViewMode, VIEW_MODE_LABELS, type FavoritesViewMode,
} from "../../favoritesViewMode";
import { Modal } from "../Modal";
import { AnchoredMenu } from "../AnchoredMenu";
import {
  FavFileRow, FavMediaGrid, FavRow, FavSourceList, FavVoiceRow, favDate, favFileName, favKind, sourceNameOf, type FavoritesMediaGlue,
} from "./FavoritesItems";

/**
 * 收藏弹窗（B 方案，FAVORITES_DESIGN §14）：
 * - 消息模式 = 无「全部」的分签视图：媒体宫格 / 文件三态行 / 链接·文本·记录统一行；范围 token 恒=当前签。
 * - 聊天模式 = 按 source_conv_id 分组的来源会话列表 → 点进同一分签页按来源过滤（标题「来自 X · N 条」）。
 * - 右上 ⋯ 互斥菜单切换模式（localStorage 持久化）；pick 模式固定消息模式、隐藏 ⋯。
 * 纯展示：查看器 / 链接 / 记录 / 菜单动作 / 下载门控（glue）全部由 App 注入。
 */
export function FavoritesModal({
  favorites, mode = "browse", sourceLabel, actions, glue, myUid, conversations, convDisplayLabel, convAvatarUrl,
  onOpenMedia, onOpenLink, onOpenRecord, onPick, onClose, fetchLinkPreview,
}: {
  favorites: Favorite[];
  mode?: "browse" | "pick";
  sourceLabel: (f: Favorite) => string;
  actions: MenuAction<FavoriteCtx>[];      // buildFavoriteActions(...)，browse 右键菜单用
  glue: FavoritesMediaGlue;                // 门控/打开：与聊天页、详情页同一套 useMediaDownload
  myUid: string;
  conversations: Conversation[];
  convDisplayLabel: (c: Conversation) => string;
  convAvatarUrl: (c: Conversation) => string | undefined;
  onOpenMedia: (fav: Favorite, kind: "image" | "video") => void;
  onOpenLink: (url: string) => void;
  onOpenRecord: (fav: Favorite) => void;   // 聊天记录 → 打开记录查看器（recordStack）
  onPick?: (favs: Favorite[]) => void;     // pick 模式：发送选中项到当前会话
  onClose: () => void;
  fetchLinkPreview: (u: string) => Promise<{ url: string; title?: string; description?: string; image?: string; site_name?: string }>;
}) {
  const isPick = mode === "pick";
  const [viewMode, setViewMode] = useState<FavoritesViewMode>(() => (isPick ? "messages" : loadFavoritesViewMode()));
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const [source, setSource] = useState<FavoriteSourceGroup | null>(null); // 聊天模式：已点进的来源组
  const [kind, setKind] = useState<FavoriteKind | null>(null);
  const [query, setQuery] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; f: Favorite } | null>(null);
  const [reader, setReader] = useState<Favorite | null>(null);
  // pick 模式：多选态与选中集（对齐 ForwardPicker：默认单点即发，「多选」切勾选 + 发送(N)）。
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const pickMulti = isPick && multi;

  // 来源过滤态下，收藏列表变化（删除）要同步刷新该组；组被删空则退回来源列表。
  const groups = useMemo(() => groupFavoritesBySource(favorites, myUid), [favorites, myUid]);
  const liveSource = source ? groups.find((g) => g.key === source.key) ?? null : null;
  useEffect(() => { if (source && !liveSource) setSource(null); }, [source, liveSource]);

  const scoped = liveSource ? liveSource.items : favorites;
  const categories = useMemo(() => deriveCategories(scoped, { includeAll: false }), [scoped]);
  // 默认停「媒体」，无则首个存在签；当前签消失（删光某类）亦回落默认。
  useEffect(() => { if (!kind || !categories.includes(kind)) setKind(defaultCategory(categories)); }, [categories, kind]);

  // 过滤：先按当前签（= 搜索范围），再按关键词（内容 + 文件名 + 来源显示名）。
  const shown = useMemo(() => {
    if (!kind) return [];
    const q = query.trim().toLowerCase();
    return scoped.filter((f) => matchesCategory(f, kind)).filter((f) => {
      if (!q) return true;
      const name = favKind(f) === "file" ? favFileName(f) : "";
      return [f.content, f.caption || "", name, sourceLabel(f)].some((s) => s.toLowerCase().includes(q));
    });
  }, [scoped, kind, query, sourceLabel]);

  // 聊天模式来源列表：搜索 = 搜来源会话名。
  const shownGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? groups.filter((g) => sourceNameOf(g, conversations, convDisplayLabel).toLowerCase().includes(q)) : groups;
  }, [groups, query, conversations, convDisplayLabel]);

  // 浮层（右键菜单 / 模式菜单）开着时，点别处（非菜单内）关闭。
  useEffect(() => {
    if (!ctx && !modeMenu) return;
    const close = (e: Event) => { if ((e.target as Element)?.closest?.(".ctx-menu")) return; setCtx(null); setModeMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctx, modeMenu]);

  const delAction = actions.find((a) => a.id === "delete");
  const toggleSelect = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openMenu = isPick ? undefined : (e: MouseEvent, f: Favorite) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, f }); };
  const deleteOf = isPick || !delAction ? undefined : (f: Favorite) => () => delAction.run({ f });

  /** pick 语义统一：多选=勾选；单选=单点即发。返回 true 表示已被 pick 消化。 */
  const pickIfNeeded = (f: Favorite): boolean => {
    if (!isPick) return false;
    if (multi) toggleSelect(f.id); else onPick?.([f]);
    return true;
  };
  const onTileClick = (f: Favorite, m: ChatMessage, gate: DownloadState | undefined) => {
    if (pickIfNeeded(f)) return;
    if (gate) glue.onGateTap(m); else onOpenMedia(f, f.content_type === "video" ? "video" : "image");
  };
  const onFileClick = (f: Favorite) => (m: ChatMessage, gate: DownloadState | undefined) => {
    if (pickIfNeeded(f)) return;
    if (gate) glue.onGateTap(m); else glue.onOpenFile(m);
  };
  const onRowClick = (f: Favorite) => () => {
    if (pickIfNeeded(f)) return;
    const k = favKind(f);
    if (k === "link") onOpenLink(f.content);
    else if (k === "record") onOpenRecord(f);
    else setReader(f);
  };

  const switchMode = (m: FavoritesViewMode) => {
    setViewMode(m); saveFavoritesViewMode(m); setModeMenu(null); setSource(null); setQuery("");
  };
  const openSource = (g: FavoriteSourceGroup) => { setSource(g); setQuery(""); };

  const inSourceList = viewMode === "chats" && !liveSource;
  const sourceTitle = liveSource ? `来自 ${sourceNameOf(liveSource, conversations, convDisplayLabel)} · ${liveSource.items.length} 条` : "";
  const label = kind ? CATEGORY_LABELS[kind] : "";
  const emptyText = query.trim() ? "未找到相关收藏" : categories.length === 0 ? "还没有收藏" : `暂无${label}`;

  return (
    <Modal className="modal fav-modal" onClose={onClose}>
      <div className="modal-title fwd-title fav-head">
        <span className="fav-head-main">
          {liveSource && (
            <button className="fav-back" title="返回来源列表" onClick={() => { setSource(null); setQuery(""); }}><ChevronLeft size={18} /></button>
          )}
          <span className="fav-head-titles">
            <span>{liveSource ? sourceTitle : isPick ? "从收藏发送" : `我的收藏（${favorites.length}）`}</span>
            {!isPick && <span className="fav-subtitle">{VIEW_MODE_LABELS[viewMode]}</span>}
          </span>
        </span>
        {isPick ? (
          <button className="section-action" onClick={() => { setMulti((v) => !v); setSelected(new Set()); }}>
            {multi ? "取消多选" : "多选"}
          </button>
        ) : (
          <button className="fav-more" title="查看方式"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setModeMenu({ x: r.right - 180, y: r.bottom + 4 }); }}>
            <MoreHorizontal size={18} />
          </button>
        )}
      </div>

      {inSourceList ? (
        <>
          <div className="fav-search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索来源会话" />
          </div>
          {shownGroups.length === 0
            ? <div className="fwd-empty">{query.trim() ? "未找到相关会话" : "还没有收藏"}</div>
            : <FavSourceList groups={shownGroups} conversations={conversations} myUid={myUid}
                convDisplayLabel={convDisplayLabel} convAvatarUrl={convAvatarUrl} onOpen={openSource} />}
        </>
      ) : (
        <>
          {/* 分签 chips：无「全部」，仅存在者；选中即过滤（并作搜索范围）。 */}
          {categories.length > 0 && (
            <div className="fav-chips">
              {categories.map((k) => (
                <button key={k} className={`fav-chip${k === kind ? " on" : ""}`} onClick={() => setKind(k)}>
                  {CATEGORY_LABELS[k]}
                </button>
              ))}
            </div>
          )}
          {/* 范围搜索：token 恒=当前签（不可删，切签即换），只在当前签内搜。 */}
          {kind && (
            <div className="fav-search">
              <span className="fav-scope">{label}</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`在${label}中搜索`} />
            </div>
          )}

          {shown.length === 0 ? (
            <div className="fav-list"><div className="fwd-empty">{emptyText}</div></div>
          ) : kind === "media" ? (
            <div className="fav-list">
              <FavMediaGrid favs={shown} glue={glue} pickMulti={pickMulti} selected={selected} onTileClick={onTileClick} onMenu={openMenu} />
            </div>
          ) : kind === "voice" ? (
            // 语音分类（2026-08-26 拍板）：内嵌迷你波形播放器行（曾按文件三态行兜底）。
            <div className="fav-list fav-voices">
              {shown.map((f) => (
                <FavVoiceRow key={f.id} f={f} on={selected.has(f.id)} pickMulti={pickMulti} sourceLabel={sourceLabel}
                  uid={myUid} pick={() => pickIfNeeded(f)}
                  onMenu={openMenu && ((e) => openMenu(e, f))} onDelete={deleteOf?.(f)} />
              ))}
            </div>
          ) : kind === "file" ? (
            <div className="fav-list detail-filelist fav-files">
              {shown.map((f) => (
                <FavFileRow key={f.id} f={f} on={selected.has(f.id)} pickMulti={pickMulti} sourceLabel={sourceLabel} glue={glue}
                  onClick={onFileClick(f)} onMenu={openMenu && ((e) => openMenu(e, f))} onDelete={deleteOf?.(f)} />
              ))}
            </div>
          ) : (
            <div className="fav-list">
              {shown.map((f) => (
                <FavRow key={f.id} f={f} on={selected.has(f.id)} pickMulti={pickMulti} sourceLabel={sourceLabel}
                  onClick={onRowClick(f)} onMenu={openMenu && ((e) => openMenu(e, f))} onDelete={deleteOf?.(f)}
                  fetchLinkPreview={fetchLinkPreview} />
              ))}
            </div>
          )}
        </>
      )}

      {/* pick 多选态：底部发送(N)。 */}
      {pickMulti ? (
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

      {/* 模式菜单（互斥 ✓）：以消息模式 / 以聊天模式查看。 */}
      {modeMenu && (
        <AnchoredMenu x={modeMenu.x} y={modeMenu.y} className="ctx-menu fav-mode-menu">
          {(["messages", "chats"] as FavoritesViewMode[]).map((m) => (
            <button key={m} className={m === viewMode ? "on" : undefined} onClick={() => switchMode(m)}>
              <span>{VIEW_MODE_LABELS[m]}</span>
              {m === viewMode && <Check size={15} className="fav-mode-check" />}
            </button>
          ))}
        </AnchoredMenu>
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
