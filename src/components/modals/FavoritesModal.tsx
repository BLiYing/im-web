import { useEffect, useMemo, useState } from "react";
import { parseContactCard } from "../../contactCard";
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
  FavContactRow, FavFileRow, FavMediaGrid, FavRow, FavSourceList, FavVoiceRow, favDate, favFileName, favKind, sourceNameOf, type FavoritesMediaGlue,
} from "./FavoritesItems";
import { useT } from "../../i18n";

/**
 * pick 模式一次最多可选条数——**独立常量，随时可调**；与 iOS `kIMFavoritesPickMaxSelection` 拉齐。
 * 不区分类型（媒体/文件/语音/文本/链接/记录同池），超限时点勾选框吐司提示。
 * 上限只在本文件生效：超限文案由这里拼好经 onPickLimit 交给外层吐司，外层不必知道数值/单位。
 */
const FAV_PICK_MAX = 9;

/**
 * 收藏弹窗（B 方案，FAVORITES_DESIGN §14）：
 * - 消息模式 = 无「全部」的分签视图：媒体宫格 / 文件三态行 / 链接·文本·记录统一行；范围 token 恒=当前签。
 * - 聊天模式 = 按 source_conv_id 分组的来源会话列表 → 点进同一分签页按来源过滤（标题「来自 X · N 条」）。
 * - 右上 ⋯ 互斥菜单切换模式（localStorage 持久化）；pick 模式固定消息模式、隐藏 ⋯。
 * 纯展示：查看器 / 链接 / 记录 / 菜单动作 / 下载门控（glue）全部由 App 注入。
 */
export function FavoritesModal({
  favorites, total, loadingMore, onLoadMore,
  mode = "browse", sourceLabel, actions, glue, myUid, conversations, convDisplayLabel, convAvatarUrl,
  onOpenMedia, onOpenLink, onOpenRecord, onOpenContact, contactDisplayName, onPick, onPickLimit, onClose, fetchLinkPreview,
}: {
  favorites: Favorite[];
  /** 服务端总条数（可能大于已加载的 favorites.length）。 */
  total: number;
  loadingMore: boolean;
  /** 滚到底时调用，追加下一页。 */
  onLoadMore: () => void;
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
  onOpenContact: (userId: string) => void; // 名片 → 名片里那个人的资料页（与点气泡同一落点）
  /** 名片行显示名（备注 > 快照昵称 > uid）；调用方按 remarks 解析后注入。 */
  contactDisplayName?: (userId: string, fallback?: string) => string;
  onPick?: (favs: Favorite[]) => void;     // pick 模式：发送选中项到当前会话
  onPickLimit?: (msg: string) => void;      // pick 模式勾选超上限时的提示回调（一般 = setToast）
  onClose: () => void;
  fetchLinkPreview: (u: string) => Promise<{ url: string; title?: string; description?: string; image?: string; site_name?: string }>;
}) {
  const tr = useT();
  const isPick = mode === "pick";
  const [viewMode, setViewMode] = useState<FavoritesViewMode>(() => (isPick ? "messages" : loadFavoritesViewMode()));
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const [source, setSource] = useState<FavoriteSourceGroup | null>(null); // 聊天模式：已点进的来源组
  const [kind, setKind] = useState<FavoriteKind | null>(null);
  const [query, setQuery] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; f: Favorite } | null>(null);
  const [reader, setReader] = useState<Favorite | null>(null);
  // pick 模式：**常驻多选**（对齐 iOS，勾选框独立触发；曾用「多选」toggle 切单点即发，与 iOS 语义不一致）。
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
      // voice 也按 file_name 搜（语音收藏的 content 是 URL、无 caption，file_name 是唯一可读检索字段；
      // 曾随 favKind 拆分把 voice 移出 "file" 后搜索静默失效）。
      const name = ["file", "voice"].includes(favKind(f)) ? favFileName(f) : "";
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
  /** 勾选框独立触发：加入前查上限，超限提示、不写入。已选可无限取消。
   *  上限判定与吐司在 updater **之外**算——同 useForward.toggleForwardTarget，避免 StrictMode 双调用重复吐司。 */
  const toggleSelect = (id: number) => {
    if (selected.has(id)) { setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; }); return; }
    if (selected.size >= FAV_PICK_MAX) { onPickLimit?.(tr("fav.pick_limit", { max: FAV_PICK_MAX })); return; }
    setSelected((prev) => new Set(prev).add(id));
  };
  const openMenu = isPick ? undefined : (e: MouseEvent, f: Favorite) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, f }); };
  const deleteOf = isPick || !delAction ? undefined : (f: Favorite) => () => delAction.run({ f });

  // 勾选（tile 覆盖层 / 行右槽 checkbox）**只**由勾选框触发，行/tile 主体点击不消化。
  // 点媒体格恒开预览（图片=viewer/视频=video player）——即使 pick 模式；选中只走右上角勾选框。
  const onTileClick = (f: Favorite, m: ChatMessage, gate: DownloadState | undefined) => {
    if (gate) glue.onGateTap(m); else onOpenMedia(f, f.content_type === "video" ? "video" : "image");
  };
  // 点文件行恒预览/下载；选中只走行右侧勾选框。
  const onFileClick = (m: ChatMessage, gate: DownloadState | undefined) => {
    if (gate) glue.onGateTap(m); else glue.onOpenFile(m);
  };
  // 点非媒体行恒打开该项（链接/记录/文本阅读器）；语音行主体点击=播放（VoiceBubble 自带）；选中走勾选框。
  const onRowClick = (f: Favorite) => () => {
    const k = favKind(f);
    if (k === "link") onOpenLink(f.content);
    else if (k === "record") onOpenRecord(f);
    else if (k === "contact") { const c = parseContactCard(f.content); if (c) onOpenContact(c.userId); }
    else setReader(f);
  };

  const switchMode = (m: FavoritesViewMode) => {
    setViewMode(m); saveFavoritesViewMode(m); setModeMenu(null); setSource(null); setQuery("");
  };
  const openSource = (g: FavoriteSourceGroup) => { setSource(g); setQuery(""); };

  const inSourceList = viewMode === "chats" && !liveSource;
  const sourceTitle = liveSource ? tr("fav.source_title", { name: sourceNameOf(liveSource, conversations, convDisplayLabel), count: liveSource.items.length }) : "";
  const label = kind ? CATEGORY_LABELS[kind] : "";
  const emptyText = query.trim() ? tr("fav.empty_search") : categories.length === 0 ? tr("fav.empty") : tr("fav.empty_category", { label });

  // 滚到底自动加载下一页。留 120px 余量提前触发，让加载发生在用户真正见底之前。
  //
  // **不能拿 `!kind` 当"未过滤"判据**：上面那个 effect 保证 kind 恒为某个存在的分类（B 方案页签无「全部」），
  // 于是 `!kind` 恒 false、整个分页从未触发过一次——第一页(60 条)之后的收藏根本拉不出来（2026-08-30 修）。
  // 真正需要挡的是**搜索**与**来源分组**：它们对已加载集合做客户端过滤，列表可能一开始就在底部。
  // 分类签不在此列：它恒有值，且用户把某一类翻到底时，想要的正是"接着往下拉"。
  // 列表不可滚时浏览器压根不发 scroll 事件，故短列表也不会被自动拉光。
  const canAutoLoad = !liveSource && !query.trim() && favorites.length < total;
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!canAutoLoad || loadingMore) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) onLoadMore();
  };
  const listProps = { onScroll: onListScroll };

  return (
    <Modal className="modal fav-modal" onClose={onClose}>
      <div className="modal-title fwd-title fav-head">
        <span className="fav-head-main">
          {liveSource && (
            <button className="fav-back" title={tr("fav.back_to_sources")} onClick={() => { setSource(null); setQuery(""); }}><ChevronLeft size={18} /></button>
          )}
          <span className="fav-head-titles">
            {/* 显示**服务端总数**而非已加载条数：分页后 favorites.length 只是当前已拉到的部分。 */}
            <span>{liveSource ? sourceTitle : isPick ? tr("fav.pick_title") : tr("fav.title", { count: total || favorites.length })}</span>
            {!isPick && <span className="fav-subtitle">{VIEW_MODE_LABELS[viewMode]}</span>}
          </span>
        </span>
        {isPick ? null : (
          <button className="fav-more" title={tr("fav.view_mode")}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setModeMenu({ x: r.right - 180, y: r.bottom + 4 }); }}>
            <MoreHorizontal size={18} />
          </button>
        )}
      </div>

      {inSourceList ? (
        <>
          <div className="fav-search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("fav.search_sources")} />
          </div>
          {shownGroups.length === 0
            ? <div className="fwd-empty">{query.trim() ? tr("fav.no_matching_chats") : tr("fav.empty")}</div>
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
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("fav.search_in", { label })} />
            </div>
          )}

          {shown.length === 0 ? (
            <div className="fav-list" {...listProps}><div className="fwd-empty">{emptyText}</div></div>
          ) : kind === "media" ? (
            <div className="fav-list" {...listProps}>
              <FavMediaGrid favs={shown} glue={glue} pickMulti={isPick} selected={selected}
                onTileClick={onTileClick} onCheckToggle={(f) => toggleSelect(f.id)} onMenu={openMenu} />
            </div>
          ) : kind === "voice" ? (
            // 语音分类（2026-08-26 拍板）：内嵌迷你波形播放器行（曾按文件三态行兜底）。
            <div className="fav-list fav-voices" {...listProps}>
              {shown.map((f) => (
                <FavVoiceRow key={f.id} f={f} on={selected.has(f.id)} pickMulti={isPick} sourceLabel={sourceLabel}
                  uid={myUid} mediaSrc={glue.mediaSrc} onCheck={() => toggleSelect(f.id)}
                  onMenu={openMenu && ((e) => openMenu(e, f))} onDelete={deleteOf?.(f)} />
              ))}
            </div>
          ) : kind === "contact" ? (
            // 名片分类：行复用详情页的 ContactRow；点行 → 名片里那个人的资料页（与点气泡同一落点，§6）。
            <div className="fav-list fav-contacts" {...listProps}>
              {shown.map((f) => (
                <FavContactRow key={f.id} f={f} on={selected.has(f.id)} pickMulti={isPick} sourceLabel={sourceLabel}
                  displayName={contactDisplayName} onClick={onRowClick(f)} onCheck={() => toggleSelect(f.id)}
                  onMenu={openMenu && ((e) => openMenu(e, f))} onDelete={deleteOf?.(f)} />
              ))}
            </div>
          ) : kind === "file" ? (
            <div className="fav-list detail-filelist fav-files" {...listProps}>
              {shown.map((f) => (
                <FavFileRow key={f.id} f={f} on={selected.has(f.id)} pickMulti={isPick} sourceLabel={sourceLabel} glue={glue}
                  onClick={onFileClick} onCheck={() => toggleSelect(f.id)}
                  onMenu={openMenu && ((e) => openMenu(e, f))} onDelete={deleteOf?.(f)} />
              ))}
            </div>
          ) : (
            <div className="fav-list" {...listProps}>
              {shown.map((f) => (
                <FavRow key={f.id} f={f} on={selected.has(f.id)} pickMulti={isPick} sourceLabel={sourceLabel}
                  onClick={onRowClick(f)} onCheck={() => toggleSelect(f.id)}
                  onMenu={openMenu && ((e) => openMenu(e, f))} onDelete={deleteOf?.(f)}
                  fetchLinkPreview={fetchLinkPreview} />
              ))}
            </div>
          )}
        </>
      )}

      {/* pick 多选态：底部发送(N)。 */}
      {isPick ? (
        <div className="fwd-actions">
          <button className="link" onClick={onClose}>{tr("common.cancel")}</button>
          <button className="mini-btn" disabled={selected.size === 0}
            onClick={() => onPick?.(favorites.filter((f) => selected.has(f.id)))}>
            {selected.size > 0 ? tr("common.send_count", { count: selected.size }) : tr("common.send")}
          </button>
        </div>
      ) : (
        <button className="modal-close" onClick={onClose}>{isPick ? tr("common.cancel") : tr("common.close")}</button>
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
          <div className="modal-title">{tr("fav.reader.title")}</div>
          <div className="fav-reader-text">{reader.content}</div>
          <div className="fav-meta">
            <span className="fav-src">{tr("fav.from", { source: sourceLabel(reader) })}</span>
            {favDate(reader.created_at) && <> · {favDate(reader.created_at)}</>}
          </div>
          <button className="modal-close" onClick={() => setReader(null)}>{tr("common.close")}</button>
        </Modal>
      )}
    </Modal>
  );
}
