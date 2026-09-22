import { Check, ChevronRight, MessageSquareQuote, MessagesSquare } from "lucide-react";
import { useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { ChatMessage, Conversation, Favorite } from "../../sdk/protocol";
import type { DownloadState } from "../../download";
import { downloadText } from "../../download";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, favoriteToMessage, isPreviewableFile, looksLikeChatRecordJSON, parseChatRecord, firstURLInText } from "../../messageContent";
import { fullDate } from "../../time";
import { formatFileSize } from "../../fileMetadata";
import { favoritePreviewText, sourceGroupName, type FavoriteSourceGroup } from "../../favoritesGrouping";
import { MediaTile } from "../MediaTile";
import { FileGateIcon } from "../FileGateIcon";
import { Avatar } from "../Avatar";
import { DetailLinkItem } from "../DetailLinkItem";
import { ContactRow } from "../ContactRow";
import { CONTACT_CONTENT_TYPE, parseContactCard } from "../../contactCard";
import { VoiceBubble } from "../VoiceBubble";
import type { LinkPreview } from "../LinkCard";
import { useT } from "../../i18n";

/**
 * 收藏弹窗的各展示件（B 方案，FAVORITES_DESIGN §14 ③）：
 * 媒体 = 3 列宫格（复用详情页 MediaTile，逐格门控）；文件 = 三态行（复用详情页 detail-fileitem + FileGateIcon）；
 * 链接/文本/记录 = v1 统一图标行；聊天模式 = 来源会话分组行。纯展示，下载态/打开全由 App 注入的 glue 决定。
 */

/** 门控与打开的注入面：与聊天页/详情页同一套 useMediaDownload 机制（合成 ChatMessage 喂入，三页共享状态）。 */
export interface FavoritesMediaGlue {
  gateOf: (m: ChatMessage) => DownloadState | undefined; // undefined = 就绪
  mediaSrc: (m: ChatMessage) => string;                  // blob 缓存优先解析（语音行播放源；与聊天气泡同口径）
  onGateTap: (m: ChatMessage) => void;                   // 未下载→下载 / 下载中→取消 / 失败→重试
  onOpenFile: (m: ChatMessage) => void;                  // 就绪文件：预览或另存（openReadyFile）
  onMediaError: (m: ChatMessage) => void;                // 缩略加载失败 → 失效/不支持标记
}

/** 收藏项渲染类型（决定展示件）。 */
export type FavKind = "image" | "video" | "file" | "link" | "record" | "text" | "voice" | "contact";
export function favKind(f: Favorite): FavKind {
  const ct = f.content_type;
  if (ct === "image") return "image";
  if (ct === "video") return "video";
  if (ct === "audio" || ct === "voice") return "voice"; // 语音：内嵌迷你播放器行（2026-08-26 拍板，曾按文件行兜底）
  if (ct === "file") return "file";
  // 名片：内容也是 JSON，与 chat_record 同理须在 link/text 前拦下（否则会当纯文本显 JSON 串）。
  if (ct === CONTACT_CONTENT_TYPE) return "contact";
  // 合并转发「聊天记录」：内容是 JSON，须在 link/text 前拦下——否则会当纯文本显 JSON 串。
  if (ct === "chat_record" || looksLikeChatRecordJSON(f.content)) return "record";
  // 草图 §D：text 只要含 URL 就归"链接"分类（与聊天页/详情页 §C 视图口径一致）。
  if (ct === "link" || (ct === "text" && firstURLInText(f.content) !== null)) return "link";
  return "text";
}

/** 文件名：优先后端 file_name，空则从 URL 反推（老收藏兜底）。 */
export function favFileName(f: Favorite): string {
  return (f.file_name && f.file_name.trim()) || fileNameFromContent(f.content);
}

/** 收藏时间显示：年月日 时:分（与 iOS IMFormatFileDateTime 一致）。 */
export function favDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${fullDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 行副信息：**时间与「来自X」分两行、颜色分开**（时间 tertiary / 来源 accent，与链接卡的来源行同色）。
 *  曾挤成一行「来自X · 年月日时分」：备注名或群昵称一长，时间就被截没（用户反馈）。
 *  与 iOS `IMFavoriteRowCell` / `IMFavoriteVoiceCell` / `IMDetailFileCell` 同款两行布局。 */
export function FavMeta({ source, ts }: { source: string; ts: number }) {
  const tr = useT();
  const dt = favDate(ts);
  return (
    <div className="fav-meta">
      {dt && <span className="fav-time">{dt}</span>}
      {source && <span className="fav-src">{tr("fav.from", { source })}</span>}
    </div>
  );
}

/** 行右槽：pick 模式=可点勾选框（独立触发，不冒泡给行 onClick）；browse=删除 ✕ 快捷。
 *  勾选框 onClick 必带 stopPropagation——否则外层行 onClick（打开预览/播放/链接）会同时触发。
 *  checkClass 让宫格覆盖层（fav-tile-check）复用同一个勾选框，勿再另写一份。 */
export function FavTrailing({ pickMulti, on, onCheck, onDelete, checkClass = "fav-check" }: {
  pickMulti: boolean; on: boolean; onCheck?: () => void; onDelete?: () => void; checkClass?: string;
}) {
  const tr = useT();
  if (pickMulti) {
    return (
      <button type="button" className={`checkbox ${checkClass}${on ? " on" : ""}`}
        title={on ? tr("fav.row.deselect") : tr("fav.row.select")} aria-pressed={on}
        onClick={(e) => { e.stopPropagation(); onCheck?.(); }}>
        {on && <Check size={13} />}
      </button>
    );
  }
  if (!onDelete) return null;
  return (
    <button className="fav-del" title={tr("fav.row.delete")} onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
  );
}

interface RowCommon {
  f: Favorite;
  on: boolean;                 // pick 多选选中
  pickMulti: boolean;
  sourceLabel: (f: Favorite) => string;
  onClick: () => void;
  onCheck?: () => void;        // pick 模式勾选框回调（不冒泡给 onClick）
  onMenu?: (e: MouseEvent) => void;
  onDelete?: () => void;
}

/** 媒体 chip：3 列宫格，逐格门控（复用详情页 MediaTile variant=detail）。视频时长角标（未下载也预显）。
 *  pick 模式下右上角勾选框独立可点（button + stopPropagation），tile 主体点击照常打开预览。 */
export function FavMediaGrid({ favs, glue, pickMulti, selected, onTileClick, onCheckToggle, onMenu }: {
  favs: Favorite[];
  glue: FavoritesMediaGlue;
  pickMulti: boolean;
  selected: Set<number>;
  onTileClick: (f: Favorite, m: ChatMessage, gate: DownloadState | undefined) => void;
  onCheckToggle?: (f: Favorite) => void;
  onMenu?: (e: MouseEvent, f: Favorite) => void;
}) {
  return (
    <div className="fav-grid">
      {favs.map((f) => {
        const m = favoriteToMessage(f);
        const gate = glue.gateOf(m);
        const on = selected.has(f.id);
        return (
          <div key={f.id} className={`fav-tile${pickMulti && on ? " on" : ""}`}>
            <MediaTile variant="detail" m={m} gate={gate}
              onClick={() => onTileClick(f, m, gate)}
              onMenu={(e) => onMenu?.(e, f)}
              onMediaError={glue.onMediaError} />
            <FavTrailing pickMulti={pickMulti} on={on} checkClass="fav-tile-check"
              onCheck={() => onCheckToggle?.(f)} />
          </div>
        );
      })}
    </div>
  );
}

/** 文件 chip：三态行（未下载 ↓ / 下载中环 / 已下载类型图标 / 失败 ↻），DOM 与详情页 detail-fileitem 同款。 */
export function FavFileRow({ f, on, pickMulti, sourceLabel, glue, onClick, onCheck, onMenu, onDelete }: Omit<RowCommon, "onClick"> & {
  glue: FavoritesMediaGlue;
  onClick: (m: ChatMessage, gate: DownloadState | undefined) => void;
}) {
  const tr = useT();
  const m = favoriteToMessage(f);
  const gate = glue.gateOf(m);
  const name = favFileName(f);
  const size = formatFileSize(f.file_size);
  const failed = !!gate && (gate.phase === "failed" || gate.phase === "expired");
  const meta = gate
    ? (gate.phase === "notStarted" ? (size ? tr("fav.file.size_not_downloaded", { size }) : tr("fav.file.not_downloaded")) : downloadText(gate, size))
    : size;
  return (
    <div className={`detail-fileitem fav-fileitem${failed ? " failed" : ""}${pickMulti && on ? " on" : ""}`}
      onClick={() => onClick(m, gate)} onContextMenu={onMenu}
      title={gate ? (gate.phase === "expired" ? tr("fav.file.expired") : tr("fav.file.click_download")) : (isPreviewableFile(name) ? tr("fav.file.click_preview") : tr("fav.file.click_download"))}>
      {gate ? <FileGateIcon state={gate} /> : <FileTypeIcon name={name} size={34} />}
      <span className="detail-file-body">
        <span className="detail-file-name">{name}</span>
        {f.caption && <span className="fav-caption">{f.caption}</span>}
        {meta && <span className="detail-file-size">{meta}</span>}
        {favDate(f.created_at) && <span className="fav-time">{favDate(f.created_at)}</span>}
        <span className="fav-src">{tr("fav.from", { source: sourceLabel(f) })}</span>
      </span>
      <FavTrailing pickMulti={pickMulti} on={on} onCheck={onCheck} onDelete={onDelete} />
    </div>
  );
}

/** 语音 chip：内嵌迷你波形播放器（复用聊天气泡 VoiceBubble，点即播/暂停；2026-08-26 拍板）。
 *  pick 模式下**主体点击照常播放**，选中只走右侧勾选框——曾用 onClickCapture 把整行吞成"选中"，
 *  用户听不了收藏语音就要盲发；与"点击其他位置=打开相关消息"的通用规则一致。 */
export function FavVoiceRow({ f, on, pickMulti, sourceLabel, uid, mediaSrc, onCheck, onMenu, onDelete }: Omit<RowCommon, "onClick"> & {
  uid: string;
  mediaSrc: (m: ChatMessage) => string; // blob 缓存优先（与聊天气泡同口径，曾传裸 content）
}) {
  const m = useMemo(() => favoriteToMessage(f), [f]); // 弹窗任意 state 变化不再逐行重建消息对象
  return (
    <div className={`fav-item voice${pickMulti && on ? " on" : ""}`} onContextMenu={onMenu}>
      <div className="fav-main">
        <VoiceBubble m={m} mine={false} uid={uid} audioSrc={mediaSrc(m)} variant="mini" />
        <FavMeta source={sourceLabel(f)} ts={f.created_at} />
      </div>
      <FavTrailing pickMulti={pickMulti} on={on} onCheck={onCheck} onDelete={onDelete} />
    </div>
  );
}

/** 名片 chip：**直接复用详情页「名片」页签的 ContactRow**（不另建一套行）——这正是
 *  "收藏页复用资料详情页"的落地方式，与文件行复用 detail-fileitem DOM 一脉相承。
 *  与详情页的差别只有一处：副行**恒显**「由 X 分享」（收藏页天然需要来源）。 */
export function FavContactRow({ f, on, pickMulti, sourceLabel, displayName, onClick, onCheck, onMenu, onDelete }: RowCommon & {
  /** 显示名（备注 > 快照昵称 > uid），由调用方解析后注入。 */
  displayName?: (userId: string, fallback?: string) => string;
}) {
  const card = parseContactCard(f.content);
  if (!card) return null; // 理论到不了：脏名片已被 matchesCategory 挡在分类之外
  return (
    <div className={`fav-item contact${pickMulti && on ? " on" : ""}`} onContextMenu={onMenu}>
      <div className="fav-main">
        <ContactRow card={card} displayName={displayName?.(card.userId, card.nickname) ?? card.nickname}
          sourceName={sourceLabel(f)} timeText={favDate(f.created_at)} onClick={onClick} />
      </div>
      <FavTrailing pickMulti={pickMulti} on={on} onCheck={onCheck} onDelete={onDelete} />
    </div>
  );
}

/** 链接 / 文本 / 聊天记录 chip：v1 统一左图标行（lucide on --accent-soft）；链接走草图 §D 的 URL 卡（DetailLinkItem）。 */
export function FavRow({ f, on, pickMulti, sourceLabel, onClick, onCheck, onMenu, onDelete, fetchLinkPreview }: RowCommon & {
  fetchLinkPreview?: (u: string) => Promise<LinkPreview>; // link kind 时必传（其它 kind 忽略）
}) {
  const tr = useT();
  const k = favKind(f);
  if (k === "link" && fetchLinkPreview) {
    // 链接分类：草图 §D——URL 卡（favicon + og:title + host+path + 时间）+ 原文引用（有正文时）+ 来源。
    // 首个 URL 起卡（多 URL 消息=一条收藏，其它 URL 保留在原文引用里）。
    const url = firstURLInText(f.content) || f.content;
    // "多 URL 混排文本"的原文引用：正文与 URL 不相等时补一行引用（草图 §D "「先扔这里：… ——晚上聊」"）。
    const originalText = f.content.trim() !== url.trim() ? f.content : null;
    return (
      <div className={`fav-item link${pickMulti && on ? " on" : ""}`} onClick={onClick} onContextMenu={onMenu}>
        <div className="fav-linkbody">
          {/* 来源与时间统一由下方 FavMeta 承担；这里再传 source 会让「来自X」在同一张卡上出现两次。 */}
          <DetailLinkItem url={url} timeText="" fetchPreview={fetchLinkPreview}
            onOpen={onClick} onContextMenu={onMenu} />
          {originalText && <div className="fav-linkquote">「{originalText}」</div>}
          <FavMeta source={sourceLabel(f)} ts={f.created_at} />
        </div>
        <FavTrailing pickMulti={pickMulti} on={on} onCheck={onCheck} onDelete={onDelete} />
      </div>
    );
  }
  let icon: ReactNode, body: ReactNode;
  if (k === "record") {
    const r = parseChatRecord(f.content);
    icon = <MessagesSquare size={22} />;
    body = <div className="fav-content">{r.t || tr("record.chat_history")}<span className="fav-record-count"> · {tr("fav.record.count", { count: r.items.length })}</span></div>;
  } else {
    icon = <MessageSquareQuote size={22} />;
    body = <div className="fav-content">{f.content}</div>;
  }
  return (
    <div className={`fav-item${pickMulti && on ? " on" : ""}`} onClick={onClick} onContextMenu={onMenu}>
      <div className={`fav-icon ${k}`}>{icon}</div>
      <div className="fav-main">
        {body}
        <FavMeta source={sourceLabel(f)} ts={f.created_at} />
      </div>
      <FavTrailing pickMulti={pickMulti} on={on} onDelete={onDelete} />
    </div>
  );
}

/** 聊天模式：来源会话分组行（头像 + 名 + 最近预览 + 计数），点进按来源过滤的分签页。 */
export function FavSourceList({ groups, conversations, myUid, convDisplayLabel, convAvatarUrl, onOpen }: {
  groups: FavoriteSourceGroup[];
  conversations: Conversation[];
  myUid: string;
  convDisplayLabel: (c: Conversation) => string;
  convAvatarUrl: (c: Conversation) => string | undefined;
  onOpen: (g: FavoriteSourceGroup) => void;
}) {
  const tr = useT();
  return (
    <div className="fav-list fav-src-list">
      {groups.map((g) => {
        const conv = g.convId ? conversations.find((c) => c.conv_id === g.convId) : undefined;
        const name = sourceGroupName(g, () => (conv ? convDisplayLabel(conv) : undefined));
        const seed = g.isMine ? myUid : conv ? (conv.is_group ? conv.conv_id : conv.peer) : g.convId || "";
        return (
          <button key={g.key} className="fav-src-row" onClick={() => onOpen(g)}>
            <Avatar url={conv ? convAvatarUrl(conv) : undefined} label={g.isMine ? tr("common.me") : name} seed={seed} />
            <span className="fav-src-main">
              <span className="fav-src-name">{name}</span>
              <span className="fav-src-preview">{favoritePreviewText(g.latest)}</span>
            </span>
            <span className="fav-src-count">{g.items.length}</span>
            <ChevronRight size={16} className="fav-src-chevron" />
          </button>
        );
      })}
    </div>
  );
}

/** 聊天模式的来源组显示名（标题「来自 X · N 条」与搜索过滤共用）。 */
export function sourceNameOf(g: FavoriteSourceGroup, conversations: Conversation[], convDisplayLabel: (c: Conversation) => string): string {
  return sourceGroupName(g, (id) => { const c = conversations.find((x) => x.conv_id === id); return c ? convDisplayLabel(c) : undefined; });
}
