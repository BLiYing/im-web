import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { IMClient, registerAccount, type ConnState } from "./sdk/imSdk";
import { chunkedTaskFor } from "./sdk/chunkedUpload";
import { loadConversation, clearMessages } from "./sdk/localStore";
import { convIdFor, type ChatMessage, type Conversation, type FriendEntry, type UserCard, type GroupInfo, type GroupMember, type GroupSummary, type Favorite } from "./sdk/protocol";
import { attachmentContentType, shouldSendAsMediaBatch, type AttachmentPickMode } from "./attachments";
import { buildMessageActions, buildConversationActions, type MenuAction } from "./menus";
import { albumMembers, albumRowPattern, isAlbumLeader, isAlbumMember } from "./album";
import { formatTime } from "./time";
import { FileTypeIcon } from "./FileTypeIcon";
import { formatFileSize } from "./fileMetadata";
import { formatMediaDuration, formatUploadProgress, mediaDisplaySize, probeMediaMetadata } from "./media";
import { LOG_TAG, logger } from "./logging/logger";
import type { LucideIcon } from "lucide-react";
import {
  Settings, Bookmark, Settings2, Gauge, Bell, Database, Lock, Folder,
  MonitorSmartphone, Languages, Smile, Phone, AtSign, Users, Megaphone,
  Headphones, ChevronLeft, ChevronRight, SquarePen, Check,
  MoreVertical, Video, Ban, Trash2, CheckSquare, BellOff,
  Image as ImageIcon, UserPlus, LogOut, Info, Pin,
  Download, LayoutGrid, MoreHorizontal,
  Search, Camera, FileText, Link2, MessageCircle, X, Pipette, Star,
} from "lucide-react";

type Phase = "login" | "app"; // 登录页 / 双栏主界面（左列表 + 右聊天，Telegram 桌面式）
type Tab = "chats" | "contacts"; // 左栏顶部：会话列表 / 通讯录
export type WallpaperChoice =
  | { kind: "preset"; value: string }
  | { kind: "image"; value: string }
  | { kind: "color"; value: string };

export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "preset", value: "meadow" };
export const WALLPAPER_PRESETS = [
  { id: "meadow", label: "青绿涂鸦", css: "radial-gradient(circle at 18% 20%, #d8eba9 0 2%, transparent 3%), radial-gradient(circle at 75% 68%, #b8d98a 0 3%, transparent 4%), linear-gradient(145deg, #dceca8, #83c9a8)" },
  { id: "lagoon", label: "蓝色海湾", css: "radial-gradient(circle at 70% 18%, #d8ffff 0 8%, transparent 30%), linear-gradient(145deg, #0aa4c4, #7be6dc 48%, #087db7)" },
  { id: "leaf", label: "翡翠叶脉", css: "repeating-linear-gradient(18deg, transparent 0 16px, rgba(255,255,255,.16) 17px 19px), linear-gradient(135deg, #0c6f3d, #95db35)" },
  { id: "violet", label: "紫色流光", css: "radial-gradient(circle at 20% 20%, #ff9fdc, transparent 34%), radial-gradient(circle at 78% 70%, #7357ff, transparent 38%), linear-gradient(145deg, #28275d, #b664d8)" },
  { id: "lighthouse", label: "深海灯塔", css: "linear-gradient(170deg, #0a5583 0 42%, #e7c174 43% 48%, #23465c 49% 100%)" },
  { id: "desert", label: "日落沙丘", css: "radial-gradient(circle at 75% 15%, #ffd59d 0 8%, transparent 9%), linear-gradient(155deg, #ffb066 0 44%, #d8673d 45% 65%, #7d3c5b)" },
  { id: "islands", label: "珊瑚群岛", css: "radial-gradient(ellipse at 22% 35%, #fff0c4 0 7%, transparent 8%), radial-gradient(ellipse at 68% 63%, #d7fff5 0 9%, transparent 10%), linear-gradient(135deg, #30b9c1, #9df1dd)" },
  { id: "water", label: "清澈水面", css: "repeating-radial-gradient(ellipse at 20% 20%, rgba(255,255,255,.25) 0 2px, transparent 3px 16px), linear-gradient(145deg, #00a8c5, #8eeadf)" },
  { id: "forest", label: "森林光斑", css: "radial-gradient(circle at 25% 18%, rgba(255,255,210,.85) 0 3%, transparent 18%), radial-gradient(circle at 70% 62%, rgba(190,255,180,.55) 0 5%, transparent 24%), linear-gradient(145deg, #174d39, #87b968)" },
  { id: "paper", label: "暖色纸张", css: "repeating-linear-gradient(8deg, rgba(130,90,30,.05) 0 1px, transparent 1px 9px), linear-gradient(145deg, #fff7db, #e7c481)" },
  { id: "shore", label: "安静海滩", css: "linear-gradient(168deg, #8ed8d1 0 48%, #e6d7ac 49% 68%, #6cb6aa 69%)" },
  { id: "mountain", label: "雪山蓝天", css: "linear-gradient(165deg, #55aee8 0 55%, #f4d9c2 56% 64%, #715d83 65% 78%, #38465d 79%)" },
] as const;

function loadWallpaper(): WallpaperChoice {
  try {
    const value = JSON.parse(localStorage.getItem("im.wallpaper") || "null") as WallpaperChoice | null;
    if (value && ["preset", "image", "color"].includes(value.kind) && typeof value.value === "string") return value;
  } catch { /* 非法偏好回退默认值 */ }
  return DEFAULT_WALLPAPER;
}

export function wallpaperCSS(choice: WallpaperChoice): string {
  if (choice.kind === "image") return `url("${choice.value}") center / cover no-repeat`;
  if (choice.kind === "color") return choice.value;
  return WALLPAPER_PRESETS.find((item) => item.id === choice.value)?.css ?? WALLPAPER_PRESETS[0].css;
}

type HSVColor = { h: number; s: number; v: number };

const COLOR_PRESETS = [
  "#e8edf1", "#acc8dc", "#1493cd",
  "#c7e5ca", "#c5e5a4", "#65b46d",
  "#d0d3af", "#aaad9d", "#898183",
  "#f7d2a5", "#f7b269", "#df8750",
  "#cad7e8", "#c8acd3", "#168f9a",
] as const;

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function hsvToHex({ h, s, v }: HSVColor): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s) / 100;
  const val = clamp(v) / 100;
  const chroma = val * sat;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = val - chroma;
  const [r, g, b] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
    : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma]
    : hue < 300 ? [x, 0, chroma]
    : [chroma, 0, x];
  return `#${[r, g, b].map((part) => Math.round((part + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToHSV(value: string): HSVColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return { h: 156, s: 32, v: 49 };
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return {
    h: (h + 360) % 360,
    s: max ? (delta / max) * 100 : 0,
    v: max * 100,
  };
}

function hexToRGB(value: string): string {
  const normalized = hsvToHex(hexToHSV(value)).slice(1);
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16)).join(", ");
}

// 可复用头像：有 avatar_url（http 或 data: 内联图）→ 渲染 <img>；否则回退首字母圈（现 Web 用统一主色底）。
// cls 决定尺寸（avatar / settings-avatar / edit-avatar）；children 作为叠加层（如在线点、相机角标）。
function Avatar({ url, label, cls = "avatar", children, onClick }: {
  url?: string; label: string; cls?: string; children?: React.ReactNode; onClick?: () => void;
}) {
  return (
    <div className={cls} onClick={onClick} role={onClick ? "button" : undefined}
         style={onClick ? { cursor: "pointer" } : undefined}>
      {url ? <img className="avatar-img" src={url} alt="" /> : (label || "").slice(-2)}
      {children}
    </div>
  );
}

/** 整条内容就是一个 http(s) 链接 → 按链接样式渲染（URL 消息 v1，与 iOS IMLooksLikeURL 对齐）。 */
const isUrlText = (s: string) => /^https?:\/\/\S+$/.test(s);

/** 服务端冻结的英文媒体快照（[image]/[video]/[file]）本地化为中文（与 iOS IMLocalizeSnippet 对齐）。 */
/** 合并转发卡片的引用快照：`[聊天记录] 标题`。兼容存量截断快照（旧引用把 JSON 截 60 字入库，
 *  解析不出时正则抠 "t":"…" 标题）；全失败回落 `[聊天记录]`。与 iOS IMChatRecordSnippet 同语义。 */
function chatRecordSnippet(json: string): string {
  let title = "";
  try {
    const o = JSON.parse(json);
    if (o && typeof o.t === "string") title = o.t;
  } catch {
    title = /"t":"([^"]*)"/.exec(json)?.[1] ?? "";
  }
  return title ? `[聊天记录] ${title}` : "[聊天记录]";
}
const looksLikeChatRecordJSON = (s: string) => s.startsWith("{") && (s.includes('"items"') || s.includes('"t":'));

const localizeSnippet = (s: string) =>
  s === "[image]" ? "[图片]" : s === "[video]" ? "[视频]"
  : s === "[file]" ? "[文件]" : s.startsWith("[file] ") ? "[文件] " + s.slice(7) // 文件带原名（M4-x）
  : s === "[chat_record]" ? "[聊天记录]" // 旧服务端 token（无标题）兜底
  // 存量救援：旧版引用聊天记录卡片时把整段 JSON 存进快照 → 就地救成「[聊天记录] 标题」。
  : looksLikeChatRecordJSON(s) ? chatRecordSnippet(s) : s;

/** 引用某条消息时的本端快照预览：媒体 → [图片]/[视频]/[文件]，文本截 60 字。 */
const replyPreviewOf = (m: ChatMessage): string =>
  m.contentType === "image" ? "[图片]" : m.contentType === "video" ? "[视频]"
  : m.contentType === "file" ? ("[文件] " + (m.fileName || fileNameFromContent(m.content))).trimEnd()
  : m.contentType === "chat_record" ? chatRecordSnippet(m.content) : (m.content || "").slice(0, 60);

/** 多选态该消息是否可勾选：系统提示/撤回墓碑/发送中·失败的本地件（无服务端内容，转出去是空的）不可选。
 *  与 iOS isSelectableMessage: 同语义。 */
const selectableInMultiSelect = (m: ChatMessage): boolean =>
  m.convSeq > 0 && !m.recalledAt && m.contentType !== "system";

/** 相册宫格（M4+）：同 group_id 的多图/视频合并为一个 Telegram 式宫格。
 *  发送中（convSeq=0）的格子压暗 + 转圈；失败标 "!"；右键单格 → 该条成员消息的菜单（单张引用/转发/撤回）。 */
function AlbumGrid({ members, timeLabel, progress, onOpen, onMenu }: {
  members: ChatMessage[];
  timeLabel: string;
  progress: Record<string, { sent: number; total: number }>;
  onOpen: (m: ChatMessage) => void;
  onMenu: (e: React.MouseEvent, m: ChatMessage) => void;
}) {
  const W = 240, GAP = 2;
  const pattern = albumRowPattern(members.length);
  let idx = 0;
  const rows = pattern.map((cols) => members.slice(idx, (idx += cols)));
  return (
    <div className="album-grid" style={{ width: W }}>
      {rows.map((row, ri) => {
        const tileW = (W - (row.length - 1) * GAP) / row.length;
        const tileH = row.length === 1 ? 150 : tileW;
        return (
          <div className="album-row" key={ri} style={{ gap: GAP, marginTop: ri === 0 ? 0 : GAP }}>
            {row.map((m) => {
              const up = progress[m.clientMsgId ?? ""];
              const task = chunkedTaskFor(m.clientMsgId ?? "");
              const durText = m.contentType === "video" ? formatMediaDuration(m.duration) : "";
              return (
              <div key={m.clientMsgId ?? m.serverMsgId ?? m.convSeq} className="album-tile"
                style={{ width: row.length === 1 ? W : tileW, height: tileH }}
                onClick={() => onOpen(m)}
                onContextMenu={(e) => onMenu(e, m)}>
                {m.contentType === "video"
                  ? (m.posterUrl ? <img src={m.posterUrl} alt="" /> : <video src={videoFrameSrc(m.content)} muted preload="metadata" />)
                  : <img src={m.content} alt="" />}
                {m.contentType === "video" && !(m.status === "sending" && m.convSeq === 0) && <span className="play-badge">▶</span>}
                {/* 时长角标：探测出即显示（上传中也显示——宫格进度在中心，左上角是空的，与 iOS 一致）。 */}
                {durText && <span className="album-duration">{durText}</span>}
                {m.status === "sending" && m.convSeq === 0 && (
                  <span className="album-tile-dim">
                    {/* 分片任务：中心 ⏸/↑（点格子暂停/继续）；小文件（不可暂停）保留转圈。 */}
                    {up && task ? <span className="album-pause">{task.paused ? "↑" : "⏸"}</span> : <span className="album-spinner" />}
                  </span>
                )}
                {m.status === "failed" && <span className="album-tile-dim"><span className="album-fail">!</span></span>}
              </div>
              );
            })}
          </div>
        );
      })}
      <span className="album-meta">{timeLabel}</span>
    </div>
  );
}

/** 引用条内的媒体小缩略图（图片 <img> / 视频首帧 <video>），无媒体返回 null。 */
function QuoteThumb({ m }: { m?: ChatMessage }) {
  if (!m || m.recalledAt) return null;
  if (m.contentType === "image") return <img className="quote-thumb" src={m.content} alt="" />;
  if (m.contentType === "video") return m.posterUrl ? <img className="quote-thumb" src={m.posterUrl} alt="" /> : <video className="quote-thumb" src={videoFrameSrc(m.content)} muted preload="metadata" />;
  if (m.contentType === "file") return <FileTypeIcon name={m.fileName || m.content} size={32} className="quote-thumb" />;
  return null;
}

/** 合并转发「聊天记录」结构（与 iOS chat_record 一致）：t=标题,
 *  items=[{n发送者, ct类型, c内容/URL, 文件另带 fn文件名/fs字节数}]。老记录无 fn 时从 URL 反推原名兜底。 */
type RecordItem = { n: string; ct: string; c: string; fn?: string; fs?: number };
type ChatRecord = { t: string; items: RecordItem[] };
function parseChatRecord(content: string): ChatRecord {
  try {
    const o = JSON.parse(content);
    if (o && typeof o === "object") return { t: typeof o.t === "string" ? o.t : "聊天记录", items: Array.isArray(o.items) ? o.items : [] };
  } catch { /* 非法 JSON */ }
  return { t: "聊天记录", items: [] };
}
const recordItemPreview = (it: RecordItem): string =>
  it.ct === "image" ? "[图片]" : it.ct === "video" ? "[视频]"
  : it.ct === "file" ? `[文件] ${it.fn || fileNameFromContent(it.c)}`.trimEnd() : it.c;

/** 从文件消息 URL 取原始显示名：存储名 <随机>__<原名>.<ext> → 取 "__" 之后并解码（与后端/iOS 对齐）。 */
function fileNameFromContent(content: string): string {
  const last = (content.split("/").pop() || content).split(/[?#]/, 1)[0];
  let decoded = last;
  try { decoded = decodeURIComponent(last); } catch { /* 保留原串 */ }
  const i = decoded.indexOf("__");
  return i >= 0 && i + 2 < decoded.length ? decoded.slice(i + 2) : decoded;
}

/** 把图片写入系统剪贴板（浏览器剪贴板图片仅稳定支持 image/png → 用 canvas 转 PNG）。失败抛错由调用方回退复制链接。 */
async function copyImageToClipboard(url: string): Promise<void> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bmp, 0, 0);
  const png: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

type LinkPreview = { url: string; title?: string; description?: string; image?: string; site_name?: string };
const linkPreviewCache = new Map<string, LinkPreview | null>(); // 进程内缓存（含负缓存 null=抓取失败）

/**
 * 媒体气泡定框：拿到协议下发的原始像素时按比例算出 CSS 尺寸（与 iOS 同算法）；
 * **尺寸未知**（老消息 / 老客户端 / 转发件）则不锁死方框，交给 `.auto` 让图片按自身比例显示，
 * 否则 object-fit:cover 会把老图永久裁成正方形（Web 没有 iOS 那样的加载后重排）。
 */
function mediaBoxProps(m: ChatMessage): { className: string; style?: CSSProperties } {
  if (!m.mediaW || !m.mediaH) return { className: "msg-media auto" };
  const box = mediaDisplaySize(m.mediaW, m.mediaH);
  return { className: "msg-media", style: { width: `${box.width}px`, height: `${box.height}px` } };
}

/** URL 消息渲染：始终显示可点击的 URL 文本，其下方叠加 OG 富预览卡片（拉到 OG 才显示卡片，否则仅链接）。 */
function LinkCard({ url, fetchPreview, onMediaLoad }: { url: string; fetchPreview: (u: string) => Promise<LinkPreview>; onMediaLoad?: () => void }) {
  const [p, setP] = useState<LinkPreview | null | undefined>(linkPreviewCache.get(url));
  useEffect(() => {
    if (linkPreviewCache.has(url)) { setP(linkPreviewCache.get(url)); return; }
    let alive = true;
    fetchPreview(url)
      .then((res) => { linkPreviewCache.set(url, res); if (alive) setP(res); })
      .catch(() => { linkPreviewCache.set(url, null); if (alive) setP(null); });
    return () => { alive = false; };
  }, [url, fetchPreview]);
  let host = ""; try { host = new URL(url).hostname; } catch { /* */ }
  const hasCard = !!(p && (p.title || p.image));
  return (
    <span className="url-msg">
      <a className="btext msg-link" href={url} target="_blank" rel="noreferrer">{url}</a>
      {hasCard && (
        <a className="link-card" href={url} target="_blank" rel="noreferrer">
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

/** 可复用的锚定弹出菜单：以 (x,y) 为锚点，若超出视口右/下边界则自动向左/上翻转（右键消息/会话菜单共用）。 */
function AnchoredMenu({ x, y, className, children }: { x: number; y: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let left = x, top = y;
    if (left + r.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - r.width - margin);
    if (top + r.height > window.innerHeight - margin) top = Math.max(margin, y - r.height); // 下方放不下 → 上翻
    setPos({ left, top });
  }, [x, y]);
  return (
    <div ref={ref} className={className} style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/** 保持登录（与 iOS IMSessionStore 一致的 dev 骨架）：登录成功落 localStorage，刷新后静默重登。
 *  存凭据而非 token——token 24h 过期且断线重连本就要用密码重新换 token；生产应换更安全的方案。 */
const SESSION_KEY = "im.session";
function loadSession(): { uid: string; pwd: string } | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return s && typeof s.uid === "string" && s.uid ? { uid: s.uid, pwd: typeof s.pwd === "string" ? s.pwd : "" } : null;
  } catch { return null; }
}

/** 从视频文件抓取首帧封面（JPEG File），供上传作视频消息封面（M4+）。
 *  浏览器解不了码（如 HEVC）或抓帧失败 → 返回 null（消息则无封面，收端回退 <video>）。 */
function captureVideoPoster(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (result: File | null) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(result); };
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onloadeddata = () => { try { video.currentTime = Math.min(0.1, (video.duration || 0.2) / 2); } catch { finish(null); } };
    video.onseeked = () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { finish(null); return; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { finish(null); return; }
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob((blob) => finish(blob ? new File([blob], "poster.jpg", { type: "image/jpeg" }) : null), "image/jpeg", 0.8);
    };
    video.onerror = () => finish(null); // 解不了码（HEVC 等）
    window.setTimeout(() => finish(null), 8000); // 兜底超时，避免卡住发送
  });
}

/** 视频回退 <video> 的 src：非 blob 时追加 #t=0.1，促使浏览器画出首帧（无 poster 封面时的兜底）。 */
function videoFrameSrc(url: string): string {
  return url && !url.startsWith("blob:") ? url + "#t=0.1" : url;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("login");
  const [uid, setUid] = useState(() => loadSession()?.uid || "1001");
  const [password, setPassword] = useState(""); // 登录密码（空=走开发期免密）
  const restoreRef = useRef<{ uid: string; pwd: string } | null>(loadSession()); // 待静默重登的已存会话
  const [restoring, setRestoring] = useState(() => !!restoreRef.current); // 恢复中：登录页显示过渡态
  const [authBusy, setAuthBusy] = useState(false); // 登录/注册请求进行中
  const [authErr, setAuthErr] = useState(""); // 登录/注册错误文案
  const [state, setState] = useState<ConnState>("disconnected");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [msgsByConv, setMsgsByConv] = useState<Record<string, ChatMessage[]>>({});
  const [peer, setPeer] = useState("");
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState<Record<string, string>>({}); // user -> online/offline
  const [peerReadSeq, setPeerReadSeq] = useState<Record<string, number>>({}); // convId -> 对端已读位点
  const [typingConv, setTypingConv] = useState<string | null>(null);
  const [entryUnread, setEntryUnread] = useState(0); // 进会话时的未读数（红点/↓N 计数，服务端 cap 999）
  const [entryReadSeq, setEntryReadSeq] = useState(0); // 进会话时的已读位点（精确定位未读分割线，CHAT_UX §4）
  const [showJump, setShowJump] = useState(false); // 右下角"跳到底部"按钮是否显示
  const [jumpCount, setJumpCount] = useState(0); // 按钮上的未读条数
  const [menu, setMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 长按/右键菜单
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null); // 正在引用回复的目标消息（撤回后清）
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null); // 正在编辑的消息（M4-5，编辑态）
  const [translations, setTranslations] = useState<Record<number, string>>({}); // convSeq -> 译文（挂气泡下，M4-5）
  const [forwarding, setForwarding] = useState<ChatMessage[] | null>(null); // 待转发的消息（打开会话选择器；null=关闭）
  const [forwardMode, setForwardMode] = useState<"each" | "merged">("each"); // 逐条 / 合并转发
  const [recordView, setRecordView] = useState<ChatRecord | null>(null); // 合并转发详情弹窗
  const [favorites, setFavorites] = useState<Favorite[] | null>(null); // 收藏列表弹窗（null=关闭，M4-4）
  const [attachPanel, setAttachPanel] = useState(false); // 附件面板（图片或视频/文件，M4-6）
  // 媒体查看器（镜像 iOS）：图片/视频全屏 + 下载/媒体库/更多；fromGallery=从媒体库进入（不再显示媒体库按钮）。
  const [viewer, setViewer] = useState<{ m: ChatMessage; fromGallery?: boolean } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false); // 会话媒体库（蒙层网格）
  const [viewerMore, setViewerMore] = useState(false);   // 查看器「更多」浮层（hover 显示）
  // 本浏览器解不了该视频的编码（HEVC 等）→ 换成"下载后本地播放"的降级卡片，避免黑屏。
  // 按被查看的 URL 复位：换一条视频要重新给它一次播放机会，否则一次失败会连累后面每条。
  const [videoUnplayable, setVideoUnplayable] = useState(false);
  const viewedContent = viewer?.m.content;
  useEffect(() => { setVideoUnplayable(false); }, [viewedContent]);
  const [selectMode, setSelectMode] = useState(false); // 多选态
  const [selected, setSelected] = useState<Set<number>>(new Set()); // 已选消息的 convSeq 集合
  const [tab, setTab] = useState<Tab>("chats"); // 左栏当前 Tab：会话 / 通讯录
  const [friends, setFriends] = useState<FriendEntry[]>([]); // 全量好友/申请关系（含 pending/requested/accepted）
  const [searchQ, setSearchQ] = useState(""); // 找人搜索框
  const [searchResults, setSearchResults] = useState<UserCard[] | null>(null); // null=未搜索；[]=搜过无结果
  const [busyUser, setBusyUser] = useState<string | null>(null); // 正在执行好友动作的对端 uid（防重复点击）
  const [profileDraft, setProfileDraft] = useState<{ nickname: string; avatar_url: string; phone: string; tags: string } | null>(null); // 编辑资料弹窗（null=关闭）
  const [profileBusy, setProfileBusy] = useState(false);
  const [friendMenu, setFriendMenu] = useState<{ x: number; y: number; userId: string } | null>(null); // 好友行 ⋯ 菜单
  const [blockedList, setBlockedList] = useState<FriendEntry[] | null>(null); // 黑名单弹窗（null=关闭）
  const [convMenu, setConvMenu] = useState<{ x: number; y: number; c: Conversation } | null>(null); // 会话行右键菜单
  const [chatMenu, setChatMenu] = useState(false); // 聊天页右上 ⋮ 下拉菜单
  const [contactDraft, setContactDraft] = useState<{ peer: string; remark: string } | null>(null); // 编辑联系人（备注名）弹窗
  const [toast, setToast] = useState<string | null>(null); // 轻量浮层提示（如"xx（开发中）"）
  const [accountCard, setAccountCard] = useState(false); // 左上角头像气泡卡片
  const [showSettings, setShowSettings] = useState(false); // 设置面板（占据侧栏列，右侧聊天保留）
  const [myInfo, setMyInfo] = useState<{ nickname: string; phone: string; avatar_url: string } | null>(null); // 设置页顶部资料展示
  const [generalOpen, setGeneralOpen] = useState(false); // 通用设置子面板
  const [wallpaperOpen, setWallpaperOpen] = useState(false); // 通用设置 ▸ 聊天壁纸
  const [wallpaper, setWallpaper] = useState<WallpaperChoice>(loadWallpaper);
  const [wallpaperBlur, setWallpaperBlur] = useState(() => localStorage.getItem("im.wallpaperBlur") === "1");
  const [wallpaperColorOpen, setWallpaperColorOpen] = useState(false);
  const [colorHSV, setColorHSV] = useState<HSVColor>(() => hexToHSV("#567e71"));
  // 通用设置项：theme / timeFormat / fontSize / sendKey / wallpaper 均为本机真功能。
  // ---- 群聊（M3-4）----
  const [groupConvId, setGroupConvId] = useState(""); // 当前打开的群会话 conv_id（"" = 单聊模式，peer 生效）
  const [groupInfos, setGroupInfos] = useState<Record<string, GroupInfo>>({}); // conv_id -> 群资料缓存（标题/气泡昵称回退/资料面板共用）
  // 会话详情面板（右侧抽屉，对齐 iOS IMChatDetailViewController；单聊/群聊共用）。null=关闭。
  const [detail, setDetail] = useState<{ convId: string; isGroup: boolean; peer?: string } | null>(null);
  const [detailTab, setDetailTab] = useState<"members" | "media" | "files" | "links">("media");
  const [detailMsgs, setDetailMsgs] = useState<ChatMessage[]>([]); // 详情页签数据源（本地历史）
  const [manageOpen, setManageOpen] = useState(false); // 群管理二级视图（改名/头像/占位项）
  const [detailMore, setDetailMore] = useState(false);  // 详情「更多」菜单开合
  const [groupsModal, setGroupsModal] = useState<GroupSummary[] | null>(null); // 通讯录「群聊」列表弹窗
  const [createDraft, setCreateDraft] = useState<{ name: string; selected: string[] } | null>(null); // 建群弹窗（群名 + 选中好友）
  const [createBusy, setCreateBusy] = useState(false);
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; convId: string; m: GroupMember } | null>(null); // 成员行 ⋯ 菜单
  const [inviteDraft, setInviteDraft] = useState<{ convId: string; selected: string[] } | null>(null); // 邀请成员弹窗
  const [typingFrom, setTypingFrom] = useState(""); // 正在输入的对端 uid（群聊显示"谁"在输入）
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => (localStorage.getItem("im.theme") as "light" | "dark" | "system") || "system");
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem("im.fontSize")) || 15);
  const [timeFormat, setTimeFormat] = useState<"12" | "24">(() => (localStorage.getItem("im.timeFormat") as "12" | "24") || "24");
  const [sendKey, setSendKey] = useState<"enter" | "cmd">(() => (localStorage.getItem("im.sendKey") as "enter" | "cmd") || "enter");

  const clientRef = useRef<IMClient | null>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null); // 隐藏的本机图片选择 input
  const wallpaperFileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null); // 聊天输入框（自适应高度 + 发送键策略）
  const seenByConv = useRef<Record<string, Set<number>>>({});
  const currentConvRef = useRef<string>(""); // 当前打开的会话（供消息回调判断是否标记已读）
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef<number>(0);
  const msgsRef = useRef<HTMLDivElement>(null); // 消息滚动容器
  const messagesRef = useRef<ChatMessage[]>([]); // 当前会话已加载消息镜像（供定义在派生之前的回调读取，如 jumpToSeq）
  const dividerRef = useRef<HTMLDivElement>(null); // 未读分割线（进会话定位用）
  const histAnchorRef = useRef<{ h: number; t: number } | null>(null); // 上滚加载历史前的滚动锚点（保位）
  const pendingScrollRef = useRef(false); // 刚进会话，待定位到未读/底部
  const wasNearBottomRef = useRef(true); // 追加消息前用户是否贴近底部
  const prevMaxSeqRef = useRef(0); // 上次渲染的最大 conv_seq（判断底部是否来了更新的消息）
  const entryUnreadRef = useRef(0); // 进会话时的未读数（按钮初始计数）
  const prevMinSeqRef = useRef(0); // 上次渲染的最小 conv_seq（判断顶部是否插了更早历史）
  const prevLenRef = useRef(0); // 上次渲染的消息条数（区分"新增消息"与"原条状态变更"如被拒收）
  const loadingOlderRef = useRef(false); // 是否正在上滚加载更早历史
  const loadingNewerRef = useRef(false); // 是否正在下滚加载更新历史
  const latestSeqRef = useRef(0); // 该会话服务端最新 conv_seq（判断下方是否还有未加载）
  const forceBottomRef = useRef(false); // jumpToBottom 触发的"强制定位到底"（忽略未读分割线）
  const maxReadReportedRef = useRef(0); // 已上报的最大已读 conv_seq（可见即读，单调不回退）
  const pendingReadRef = useRef(0); // 已滚入视口的最大 conv_seq（节流后上报）
  const readTimerRef = useRef<number | null>(null); // 可见即读上报的节流定时器
  const conversationRefreshTimerRef = useRef<number | null>(null); // sync 批量消息只触发一次会话列表刷新
  // 会话列表刷新节流：ack/receipt/conv_update/group/msg_op 都会触发一次 fetchConversations，
  // 高频收发时叠成请求风暴（日志见同时 3-4 个 GET 在飞、300-400ms）。合并进 400ms 窗口只发一次，
  // 且串行化（在飞时置脏，回来后再补一次），避免并发拉取。
  const listRefreshTimerRef = useRef<number | null>(null);
  const listRefreshInFlightRef = useRef(false);
  const listRefreshDirtyRef = useRef(false);

  const appendMsg = useCallback((convId: string, m: ChatMessage) => {
    setMsgsByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] ?? []), m] }));
  }, []);

  const refreshConversations = useCallback(async (): Promise<Conversation[]> => {
    try {
      const convs = await clientRef.current?.fetchConversations();
      if (convs) {
        setConversations(convs);
        clientRef.current?.cacheConversations(convs); // 缓存：刷新/离线先秒显
        return convs;
      }
    } catch {
      /* 忽略 */
    }
    return [];
  }, []);

  // 登录后从本地库（IndexedDB）预载各会话历史 → 打开会话即秒显，刷新不丢已下载的历史；
  // 同时读取独立的连续同步游标；本地消息最大值与服务端 latest 都不能证明中间没有空洞。
  const preloadLocal = useCallback(async (convs: Conversation[]) => {
    const client = clientRef.current;
    if (!client) return;
    const loaded: Record<string, ChatMessage[]> = {};
    for (const c of convs) {
      const local = await client.loadLocal(c.conv_id);
      const continuousCursor = await client.loadSyncCursor(c.conv_id);
      client.trackConversation(c.conv_id, continuousCursor);
      if (local.length === 0) continue;
      loaded[c.conv_id] = local;
      const seen = (seenByConv.current[c.conv_id] ??= new Set());
      local.forEach((m) => m.convSeq > 0 && seen.add(m.convSeq)); // 防服务端同步重复回显
    }
    if (Object.keys(loaded).length) setMsgsByConv((prev) => ({ ...loaded, ...prev }));
  }, []);

  const scheduleConversationRefresh = useCallback(() => {
    if (conversationRefreshTimerRef.current !== null) {
      clearTimeout(conversationRefreshTimerRef.current);
    }
    conversationRefreshTimerRef.current = window.setTimeout(() => {
      conversationRefreshTimerRef.current = null;
      void refreshConversations().then(async (latest) => {
        if (latest.length === 0) return;
        await preloadLocal(latest); // 新会话也立即登记，避免等刷新页面后才补洞
        clientRef.current?.syncTracked();
      });
    }, 150);
  }, [refreshConversations, preloadLocal]);

  // 会话列表节流刷新：把一阵 ack/receipt/conv_update 风暴合并成 400ms 一发，并串行化拉取。
  // 与 scheduleConversationRefresh 的区别：那条负责 sync 批量新消息（还要 preloadLocal + syncTracked），
  // 这条只重拉列表，供纯"列表要变"的实时事件用，最省资源。
  const scheduleListRefresh = useCallback(() => {
    if (listRefreshTimerRef.current !== null) return; // 窗口内已排队，本次并入
    listRefreshTimerRef.current = window.setTimeout(() => {
      listRefreshTimerRef.current = null;
      if (listRefreshInFlightRef.current) { listRefreshDirtyRef.current = true; return; } // 有在飞的：置脏待补
      void (async () => {
        listRefreshInFlightRef.current = true;
        try {
          do {
            listRefreshDirtyRef.current = false;
            await refreshConversations();
          } while (listRefreshDirtyRef.current); // 拉取期间又来了事件 → 再补一次，收敛到最新
        } finally {
          listRefreshInFlightRef.current = false;
        }
      })();
    }, 400);
  }, [refreshConversations]);

  const refreshFriends = useCallback(async () => {
    try {
      const list = await clientRef.current?.listFriends();
      if (list) setFriends(list);
    } catch {
      /* 忽略：通讯录加载失败不阻断主流程 */
    }
  }, []);

  // 拉群资料进缓存（best-effort）：失败（被移出/群没了）则清缓存。返回最新资料或 null。
  const refreshGroupInfo = useCallback(async (cid: string): Promise<GroupInfo | null> => {
    try {
      const info = await clientRef.current?.fetchGroup(cid);
      if (info) setGroupInfos((prev) => ({ ...prev, [cid]: info }));
      return info ?? null;
    } catch {
      setGroupInfos((prev) => {
        const { [cid]: _drop, ...rest } = prev;
        return rest;
      });
      return null;
    }
  }, []);

  // 打开群会话：与 openChat 同一套进会话定位逻辑，只是标识从 peer 换成 conv_id。
  const openGroupChat = useCallback((cid: string) => {
    if (!cid) return;
    setPeer("");
    setGroupConvId(cid);
    currentConvRef.current = cid;
    const conv = conversations.find((c) => c.conv_id === cid);
    const readSeq = conv?.read_seq ?? 0;
    const latestSeq = conv?.latest_conv_seq ?? 0;
    setEntryUnread(conv?.unread ?? 0);
    entryUnreadRef.current = conv?.unread ?? 0;
    setEntryReadSeq(readSeq);
    latestSeqRef.current = latestSeq;
    pendingScrollRef.current = true;
    forceBottomRef.current = false;
    setShowJump(false);
    setJumpCount(0);
    maxReadReportedRef.current = readSeq;
    pendingReadRef.current = readSeq;
    clientRef.current?.openConversation(cid, readSeq, latestSeq);
    void refreshGroupInfo(cid); // 群资料：标题成员数 / 气泡昵称回退 / 资料面板
    // 进会话即清手动"标未读"（IM 通行做法）；多端经 conv_update 同步。
    if (conv?.marked_unread) {
      void clientRef.current?.updateConvSettings(cid, { pinned_at: conv.pinned_at ?? 0, muted: !!conv.muted, marked_unread: false }).then(() => refreshConversations()).catch(() => {});
    }
    void refreshConversations();
  }, [conversations, refreshConversations, refreshGroupInfo]);

  const doSearch = useCallback(async () => {
    const q = searchQ.trim();
    if (!q) { setSearchResults(null); return; }
    try {
      const users = await clientRef.current?.searchUsers(q);
      setSearchResults(users ?? []);
    } catch (e) {
      alert(`搜索失败：${(e as Error).message}`);
    }
  }, [searchQ]);

  // 好友动作（申请/同意/拒绝/删除）统一走这里：执行 → 刷新关系 → 解锁按钮。
  const doFriendAction = useCallback(async (userId: string, fn: () => Promise<void>) => {
    setBusyUser(userId);
    try {
      await fn();
      await refreshFriends();
    } catch (e) {
      alert(`操作失败：${(e as Error).message}`);
    } finally {
      setBusyUser(null);
    }
  }, [refreshFriends]);

  // 加载本人资料到 myInfo（左上角头像 / 设置页头部共用同一份数据）。失败静默回退首字母圈。
  const loadMyInfo = useCallback(async () => {
    try {
      const p = await clientRef.current?.fetchMyProfile();
      if (p) setMyInfo({ nickname: p.nickname ?? "", phone: p.phone ?? "", avatar_url: p.avatar_url ?? "" });
    } catch { /* 忽略：头像回退首字母圈 */ }
  }, []);

  // 打开"编辑资料"弹窗：拉本人资料填入草稿（tags 以空格连接成可编辑串）。
  const openProfile = useCallback(async () => {
    try {
      const p = await clientRef.current?.fetchMyProfile();
      // phone 后端是 omitempty：空时 JSON 无该键 → undefined，须兜底为 ""，否则 input 由非受控变受控告警。
      if (p) setProfileDraft({ nickname: p.nickname ?? "", avatar_url: p.avatar_url ?? "", phone: p.phone ?? "", tags: (p.tags ?? []).join(" ") });
    } catch (e) {
      alert(`加载资料失败：${(e as Error).message}`);
    }
  }, []);

  // 打开黑名单弹窗：拉 status=blocked 的关系。
  const openBlacklist = useCallback(async () => {
    try {
      const list = await clientRef.current?.listFriends("blocked");
      setBlockedList(list ?? []);
    } catch (e) {
      alert(`加载黑名单失败：${(e as Error).message}`);
    }
  }, []);

  // 解除拉黑：unblock 后从弹窗列表移除。
  const unblock = useCallback(async (userId: string) => {
    setBusyUser(userId);
    try {
      await clientRef.current?.friendAction("unblock", userId);
      setBlockedList((prev) => (prev ?? []).filter((f) => f.user_id !== userId));
      void refreshFriends(); // 同步主好友态：聊天页"已拉黑"横幅随之消失、输入恢复

    } catch (e) {
      alert(`解除失败：${(e as Error).message}`);
    } finally {
      setBusyUser(null);
    }
  }, [refreshFriends]);

  // 保存资料：tags 按空格/逗号切分去空，PUT 整体替换。
  const saveProfile = useCallback(async () => {
    if (!profileDraft) return;
    setProfileBusy(true);
    try {
      const updated = await clientRef.current?.updateMyProfile({
        nickname: profileDraft.nickname.trim(),
        avatar_url: profileDraft.avatar_url.trim(),
        phone: profileDraft.phone.trim(),
        tags: profileDraft.tags.split(/[\s,]+/).filter(Boolean),
      });
      // 保存后刷新设置页顶部名片（否则头像/昵称仍显旧值）。
      if (updated) setMyInfo({ nickname: updated.nickname ?? "", phone: updated.phone ?? "", avatar_url: updated.avatar_url ?? "" });
      setProfileDraft(null);
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileDraft]);

  // 选本机图片做头像：<input type=file> 浏览器自动用当前系统(Mac/Windows/Linux)的原生文件框，无需检测系统。
  // 读图 → canvas 缩放到 ≤192px → JPEG data URL（超 240KB 再降质，保证 < 后端 256KB 上限）→ 存 avatar_url。
  const onPickAvatar = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setToast("读取图片失败，请重试");
    reader.onload = () => {
      const img = new Image();
      // 浏览器无法解码该格式（如 HEIC/HEIF）时 onload 不触发 → 提示换 JPG/PNG。
      img.onerror = () => setToast("无法识别该图片格式，请改用 JPG / PNG");
      img.onload = () => {
        const max = 192;
        let w = img.width, h = img.height;
        if (w >= h && w > max) { h = Math.round((h * max) / w); w = max; }
        else if (h > max) { w = Math.round((w * max) / h); h = max; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.82;
        let dataUrl = canvas.toDataURL("image/jpeg", q);
        while (dataUrl.length > 240 * 1024 && q > 0.4) { q -= 0.15; dataUrl = canvas.toDataURL("image/jpeg", q); }
        setProfileDraft((d) => (d ? { ...d, avatar_url: dataUrl } : d));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const enterApp = useCallback(async (pwd: string) => {
    if (!uid) {
      setAuthErr("请填写用户名");
      return;
    }
    setAuthBusy(true);
    setAuthErr("");
    const client = new IMClient({
      onState: (nextState) => {
        setState(nextState);
        // 离线冷启动后重连成功：补取权威会话列表、登记新会话并从各自连续游标同步。
        if (nextState === "connected" && clientRef.current) {
          void refreshConversations().then(async (latest) => {
            if (latest.length === 0) return;
            await preloadLocal(latest);
            clientRef.current?.syncTracked();
          });
        }
      },
      onMessage: (m) => {
        const seen = (seenByConv.current[m.convId] ??= new Set());
        if (m.convSeq > 0) {
          if (seen.has(m.convSeq)) {
            // ACK/另一条同步路径可能先创建了同序号消息；权威重拉仍需把文件元数据补到当前屏幕。
            setMsgsByConv((prev) => {
              const list = prev[m.convId] ?? [];
              return {
                ...prev,
                [m.convId]: list.map((existing) => existing.convSeq === m.convSeq
                  ? {
                      ...existing,
                      serverMsgId: m.serverMsgId || existing.serverMsgId,
                      fileName: m.fileName || existing.fileName,
                      fileSize: m.fileSize !== undefined && m.fileSize > 0 ? m.fileSize : existing.fileSize,
                      recalledAt: m.recalledAt || existing.recalledAt,
                      recalledBy: m.recalledBy || existing.recalledBy,
                      editedAt: m.editedAt || existing.editedAt,
                      pinnedAt: m.pinnedAt || existing.pinnedAt,
                    }
                  : existing),
              };
            });
            return;
          }
          seen.add(m.convSeq);
        }
        appendMsg(m.convId, m);
        // 可见即读：不在收到时立即标已读；新消息若落在视口内（贴底）会由滚动/布局后的 markVisibleRead 读到，
        // 在上方看历史时则不读，留到滚下去再读。
        // 全量/多页同步会连续投递很多消息，只批量刷新一次；同账号另一端新建的会话也必须覆盖。
        scheduleConversationRefresh();
      },
      onAck: (clientMsgId, ok, convSeq, serverTs) => {
        setMsgsByConv((prev) => {
          const out: Record<string, ChatMessage[]> = {};
          for (const [cid, list] of Object.entries(prev)) {
            out[cid] = list.map((m) => {
              if (m.clientMsgId !== clientMsgId) return m;
              // 防 sync_resp/carbon 重复回显自己发的：把 ack 拿到的 conv_seq 登记进去重集
              // （new_msg/sync 无 client_msg_id，只能按 conv_seq 去重；与 iOS handleSendResult 一致）。
              if (ok && convSeq > 0) (seenByConv.current[cid] ??= new Set()).add(convSeq);
              // 成功后把时间戳换成服务器时间（消除"乐观发送用客户端钟"在排序上的时钟偏差）。
              return { ...m, status: ok ? "sent" : "failed", convSeq, timestamp: ok && serverTs ? serverTs : m.timestamp };
            });
          }
          return out;
        });
        // 自己发送成功 → 刷新列表：新发起的会话首条消息后即出现在左侧、更新最后一条。
        // 走节流：连发/群发时每条 ack 不再各拉一次列表（否则叠成 GET 风暴）。
        if (ok) scheduleListRefresh();
      },
      onReceipt: (convId, from, status, upToSeq) => {
        if (status !== "read") return;
        if (from === uid) {
          // 多端已读同步（M1）：我在另一端已读 → 本端列表未读清零（服务端已记位点，刷新即得）。
          scheduleListRefresh();
        } else {
          setPeerReadSeq((prev) => ({ ...prev, [convId]: Math.max(prev[convId] ?? 0, upToSeq) }));
          // 对端已读 → 刷新左侧列表，让"我发的最后一条"在列表里也即时变绿✓✓（否则要切会话才更新）。
          scheduleListRefresh();
        }
      },
      onPresence: (user, status) => setPresence((prev) => ({ ...prev, [user]: status })),
      onTyping: (convId, from) => {
        if (from === uid) return;
        setTypingConv(convId);
        setTypingFrom(from); // 群聊显示"谁"在输入
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setTypingConv(null), 3000);
      },
      // 好友关系实时变更：刷新通讯录（"新的朋友"红点/列表即时更新，无需切 Tab）。
      onFriend: () => { void refreshFriends(); },
      // 群成员/资料实时变更：刷新会话列表 + 该群资料缓存；自己被移出 → 提示并退出该会话。
      onGroup: (event, cid, _from, target) => {
        scheduleListRefresh();
        if (event !== "dissolve") void refreshGroupInfo(cid); // 被移出时 fetch 报 300203 → 自动清缓存；解散后群已不存在，无需再拉
        // 被移出（remove 且 target=自己）或群被解散（dissolve，管理端处置，对全体生效）→ 提示并退出该会话。
        if ((event === "remove" && target === uid) || event === "dissolve") {
          setToast(event === "dissolve" ? "该群已被解散" : "你已被移出群聊");
          setDetail((d) => (d?.convId === cid ? null : d));
          if (currentConvRef.current === cid) {
            currentConvRef.current = "";
            setGroupConvId("");
          }
        }
      },
      // 某条消息被拒收（被拉黑）→ 标记该条发送失败 + 把原因挂到该条 note（微信式：红❗+下方居中系统行，不弹窗）。
      onMsgRejected: (clientMsgId, msg) => {
        setMsgsByConv((prev) => {
          const out: Record<string, ChatMessage[]> = {};
          for (const [cid, list] of Object.entries(prev)) {
            out[cid] = list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, status: "failed", note: msg } : m));
          }
          return out;
        });
      },
      // 消息操作（撤回/编辑/置顶）应用到某条消息（按 conv_seq 定位）→ 就地打补丁（撤回→墓碑，编辑→改文本）。
      onMsgOp: (cid, targetSeq, patch) => {
        setMsgsByConv((prev) => {
          const list = prev[cid];
          if (!list) return prev;
          return { ...prev, [cid]: list.map((m) => (m.convSeq === targetSeq ? { ...m, ...patch } : m)) };
        });
        scheduleListRefresh(); // 撤回后会话列表预览也要更新（"撤回了一条消息"）
      },
      // 我发起的操作被拒（如撤回超时 300008）→ toast 提示（不改消息本身）。
      onMsgOpFailed: (_op, _cid, _seq, msg) => setToast(msg),
      // 会话级设置变更（置顶/免打扰/标未读/删除会话，M4.5）：多端同步 → 重新拉取权威会话列表覆盖本地。
      onConvUpdate: () => { scheduleListRefresh(); },
      // 鉴权失效（账号没了/密码错/token 失效）→ 弹框让用户选，不强制踢走：
      // 确定→重新登录；取消→留在当前界面继续看本地聊天记录（socket 已停重连，不刷屏）。
      onAuthError: (msg) => {
        if (window.confirm(`${msg}。点"确定"重新登录；"取消"可继续查看本地聊天记录。`)) {
          logout();
          setAuthErr(msg); // logout 会清 authErr，故放其后
        }
      },
    });
    clientRef.current = client;
    try {
      await client.connect(uid, pwd); // 首次登录失败（密码错误等）会抛错
    } catch (e) {
      const code = (e as { code?: number }).code;
      const cached = client.cachedConversations();
      if (code === undefined && cached.length > 0) {
        // 服务器不可达不是登录态失效：保留 client 的后台重连，直接进入本地会话页显示“未连接”。
        clientRef.current = client;
        setConversations(cached);
        await preloadLocal(cached);
        localStorage.setItem(SESSION_KEY, JSON.stringify({ uid, pwd }));
        setAuthBusy(false);
        setPhase("app");
        return;
      }
      client.disconnect();
      clientRef.current = null;
      setAuthBusy(false);
      setAuthErr((e as Error).message || "登录失败");
      return;
    }
    // 先用缓存的会话列表 + 本地消息秒显（刷新/弱网即时可见）。
    const cached = client.cachedConversations();
    if (cached.length) {
      setConversations(cached);
      await preloadLocal(cached);
    }
    // 再拉服务端最新会话列表，预载本地消息并按本地位点增量同步补新消息。
    const convs = await refreshConversations();
    if (convs.length) await preloadLocal(convs);
    client.syncTracked(); // OPEN 前调用安全无副作用；onopen 会从各会话连续持久化位点补拉到最新
    void refreshFriends(); // 拉好友关系：让"通讯录"Tab 的新申请红点即时显示
    void loadMyInfo();     // 拉本人资料：左上角头像 / 设置页头部立即可用
    localStorage.setItem(SESSION_KEY, JSON.stringify({ uid, pwd })); // 保持登录：刷新后静默重登（Web #4）
    setAuthBusy(false);
    setPhase("app");
  }, [uid, appendMsg, refreshConversations, preloadLocal, scheduleConversationRefresh, scheduleListRefresh, refreshFriends, loadMyInfo, refreshGroupInfo]);

  // 静默恢复登录（Web #4）：挂载后若有已存会话 → 直接用存储凭据重登（成功直达主界面；
  // 网络失败且有本地会话缓存时直接进入会话页显示“未连接”；鉴权失败或无缓存才回登录页。
  useEffect(() => {
    const r = restoreRef.current;
    if (!r || phase !== "login") return;
    restoreRef.current = null;
    void enterApp(r.pwd).finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 注册账号（用户名+密码，密码≥6位）→ 成功后直接登录。
  const doRegister = useCallback(async () => {
    if (!uid || password.length < 6) {
      setAuthErr("用户名必填，密码至少 6 位");
      return;
    }
    setAuthBusy(true);
    setAuthErr("");
    try {
      await registerAccount(uid, password);
    } catch (e) {
      setAuthBusy(false);
      setAuthErr((e as Error).message || "注册失败");
      return;
    }
    await enterApp(password); // 注册成功 → 直接用同一密码登录
  }, [uid, password, enterApp]);

  const openChat = useCallback((p: string) => {
    if (!p || p === uid) {
      alert("请输入有效的对方 uid");
      return;
    }
    const cid = convIdFor(uid, p);
    setPeer(p);
    setGroupConvId(""); // 切回单聊模式
    currentConvRef.current = cid;
    // 进会话定位（CHAT_UX §3）：以 read_seq 为锚点——有未读则停在首条未读，否则到最新。
    const conv = conversations.find((c) => c.conv_id === cid);
    const readSeq = conv?.read_seq ?? 0;
    const latestSeq = conv?.latest_conv_seq ?? 0;
    // 进会话即用服务端已知的对端已读位点给聊天详情播种（否则只靠实时回执：对方早前已读、本标签页没在场时，
    // 列表显✓✓而详情仍显✓）。取较大值，避免覆盖刚到的更新回执。
    setPeerReadSeq((prev) => ({ ...prev, [cid]: Math.max(prev[cid] ?? 0, conv?.peer_read_seq ?? 0) }));
    setEntryUnread(conv?.unread ?? 0);
    entryUnreadRef.current = conv?.unread ?? 0;
    setEntryReadSeq(readSeq);
    latestSeqRef.current = latestSeq;
    pendingScrollRef.current = true;
    forceBottomRef.current = false;
    setShowJump(false);
    setJumpCount(0);
    // 可见即读：已读起点=进入前位点；只有滚入视口超过它的消息才上报（见 markVisibleRead）。
    maxReadReportedRef.current = readSeq;
    pendingReadRef.current = readSeq;
    clientRef.current?.openConversation(cid, readSeq, latestSeq); // 加载锚点窗口，余下双向分页
    // 进会话即清手动"标未读"（IM 通行做法：打开视为已处理）；多端经 conv_update 同步。
    if (conv?.marked_unread) {
      void clientRef.current?.updateConvSettings(cid, { pinned_at: conv.pinned_at ?? 0, muted: !!conv.muted, marked_unread: false }).then(() => refreshConversations()).catch(() => {});
    }
    void refreshConversations(); // 选会话后刷新列表（更新其他会话 / 排序）
  }, [uid, conversations, refreshConversations]);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY); // 显式退出/鉴权失效才清会话；网络失败不清（下次刷新仍自动重登）
    clientRef.current?.disconnect();
    clientRef.current = null;
    if (conversationRefreshTimerRef.current !== null) {
      clearTimeout(conversationRefreshTimerRef.current);
      conversationRefreshTimerRef.current = null;
    }
    seenByConv.current = {};
    currentConvRef.current = "";
    setConversations([]);
    setMsgsByConv({});
    setPresence({});
    setPeerReadSeq({});
    setFriends([]);
    setSearchResults(null);
    setSearchQ("");
    setTab("chats");
    // 登录页不保留任何已登录态面板；否则重新登录后设置面板会继续覆盖左栏。
    setShowSettings(false);
    setProfileDraft(null);
    setGeneralOpen(false);
    setWallpaperOpen(false);
    setWallpaperColorOpen(false);
    setMyInfo(null);
    setPassword("");
    setAuthErr("");
    setGroupConvId("");
    setGroupInfos({});
    setDetail(null);
    setGroupsModal(null);
    setPhase("login");
  }, []);

  const deselect = useCallback(() => {
    currentConvRef.current = "";
    setPeer("");
    setGroupConvId("");
    setTypingConv(null);
    void refreshConversations();
  }, [refreshConversations]);

  // 媒体上传进度（M4+）：key=本地占位 clientMsgId，值为**媒体本体**已传/总字节数，
  // 在气泡左上角显“3.9 MB / 7.9 MB”（镜像 iOS）。传完/失败即删键，角标切回视频时长。
  // 失败的媒体/文件消息要能重试，就必须留住原始 File（浏览器无法从消息里还原它）。仅内存，刷新即失效。
  // 记 convId/groupId：重试时按**原会话/原相册**重发（不耦合当前打开的会话，宫格成员回原格）。
  const pendingFilesRef = useRef<Map<string, { file: File; mode: AttachmentPickMode; convId: string; groupId?: string }>>(new Map());
  // 已被用户取消的出箱件：发送流水线（sendMediaBatch/uploadAndSend）在每个边界检查它，
  // 跳过后续上传与 sendMedia——因为 cancel() 只能中断在飞的**分片**任务，小文件 XHR、排队中的
  // 相册成员、以及"上传完成→poster→sendMedia"窗口都没有可 abort 的任务，必须靠这个集合拦住。
  const cancelledSendsRef = useRef<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<Record<string, { sent: number; total: number }>>({});
  const clearUploadProgress = useCallback((key: string) => {
    setUploadProgress((prev) => { if (!(key in prev)) return prev; const nx = { ...prev }; delete nx[key]; return nx; });
  }, []);

  // 从会话列表移除一条本地行（取消/重试/删除共用）。
  const removeMsgRow = useCallback((cid: string, key: string) => {
    setMsgsByConv((prev) => {
      const list = prev[cid];
      if (!list) return prev;
      return { ...prev, [cid]: list.filter((x) => x.clientMsgId !== key) };
    });
  }, []);

  // 停掉一条出箱件的上传并清理其副作用（取消发送 / 删除发送中消息共用）：abort 分片任务、清进度、
  // 丢留存 File。**不**移除气泡（调用方按需移除），也不 revoke blobURL（由发送循环在边界统一 revoke）。
  // active=该件是否有正在跑的发送循环（媒体/文件且 sending）——只有它才需要标进取消集合让循环在边界跳过；
  // 文本行、已 failed 行没有循环消费该键，加了就成永不回收的孤儿（键是唯一 uuid，不会误伤后续上传，但会泄漏）。
  const teardownOutboxUpload = useCallback((key: string, active: boolean) => {
    if (!key) return;
    if (active) cancelledSendsRef.current.add(key);
    chunkedTaskFor(key)?.cancel();
    pendingFilesRef.current.delete(key);
    clearUploadProgress(key);
  }, [clearUploadProgress]);

  // 该消息是否有正在跑的发送流水线（据此决定是否需要取消集合拦截）。
  const hasActiveSend = (m: ChatMessage) =>
    m.status === "sending" && (m.contentType === "image" || m.contentType === "video" || m.contentType === "file");

  // 暂停 ↔ 继续（仅 ≥8MB 的分片任务可暂停；恢复以服务端 offset 为准续传）。返回是否有任务被切换。
  // 暂停态的唯一真相是 task.paused（渲染直接读 chunkedTaskFor(key)?.paused）；这里仅 bump 进度对象触发重渲染。
  const toggleUploadPause = useCallback((m: ChatMessage): boolean => {
    const key = m.clientMsgId ?? "";
    const task = chunkedTaskFor(key);
    if (!task) return false;
    if (task.paused) task.resume(); else task.pause();
    setUploadProgress((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key] } } : prev));
    return true;
  }, []);

  // 取消发送（右键菜单）：停上传 + 移除气泡。与 iOS 长按「取消发送」同语义。
  const cancelSendMessage = useCallback((m: ChatMessage) => {
    const key = m.clientMsgId ?? "";
    teardownOutboxUpload(key, hasActiveSend(m));
    removeMsgRow(m.convId, key);
    logger.info(LOG_TAG.media, "media_send_cancelled", { conv_id: m.convId, client_msg_id: key, content_type: m.contentType });
  }, [teardownOutboxUpload, removeMsgRow]);

  // 粘贴图片（Web #2）：Ctrl/Cmd+V 粘贴剪贴板中的图片 → 输入区上方预览 → 发送时作为图片上传。
  // 粘贴攒批（对齐 iOS 预览条）：图片与**任意文件**都先进预览条，发送键统一发出。
  const [pastedImages, setPastedImages] = useState<{ file: File; url: string; kind: "image" | "file" }[]>([]);
  const addPastedFiles = useCallback((files: File[]) => {
    if (files.length) setPastedImages((prev) => [...prev, ...files.map((f) => ({
      file: f, url: URL.createObjectURL(f),
      kind: (f.type.startsWith("image/") ? "image" : "file") as "image" | "file",
    }))]);
  }, []);
  const removePastedImage = useCallback((idx: number) => {
    setPastedImages((prev) => { const nx = prev.slice(); const [rm] = nx.splice(idx, 1); if (rm) URL.revokeObjectURL(rm.url); return nx; });
  }, []);
  const onComposerPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); addPastedFiles(files); }
  }, [addPastedFiles]);

  // 按 clientMsgId 就地打补丁（相册批量发送：本地占位 → 上传完成换服务器 URL/真 ID）。
  const patchMsg = useCallback((cid: string, clientMsgId: string, patch: Partial<ChatMessage>) => {
    setMsgsByConv((prev) => {
      const list = prev[cid];
      if (!list) return prev;
      return { ...prev, [cid]: list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, ...patch } : m)) };
    });
  }, []);

  // 相册批量发送（M4+）：**选完秒上屏**——每张先用本地 blob URL 占位（≥2 张共享 group_id → 宫格聚簇），
  // 逐张上传后原地替换为服务器 URL 并走 socket 发送（带 group_id）；单张失败标该格不阻塞后续。
  const sendMediaBatch = useCallback(async (files: File[], opts?: { convId?: string; groupId?: string }) => {
    const client = clientRef.current;
    // opts 用于重试：按原会话/原相册重发（不耦合当前打开的会话）。
    const cid = opts?.convId ?? (peer ? convIdFor(uid, peer) : groupConvId);
    if (!client || !cid || files.length === 0) return;
    const groupId = opts?.groupId ?? (files.length > 1 ? `alb-${crypto.randomUUID()}` : undefined);
    const locals = files.map((f) => ({ f, localId: `outbox-${crypto.randomUUID()}`, blobUrl: URL.createObjectURL(f), posterFile: null as File | null, posterBlobUrl: undefined as string | undefined, meta: { width: 0, height: 0, durationMs: 0 } }));
    for (const l of locals) {
      appendMsg(cid, {
        clientMsgId: l.localId, convId: cid, from: uid, content: l.blobUrl,
        contentType: l.f.type.startsWith("video/") ? "video" : "image",
        convSeq: 0, timestamp: Date.now(), status: "sending", groupId,
      });
      setUploadProgress((prev) => ({ ...prev, [l.localId]: { sent: 0, total: l.f.size } })); // 排队中：先显“等待中”
    }
    // 视频：先在本地抓首帧 → 立刻用 blob 封面显示（发送端不必等上传就见封面）；抓到的 File 复用做上传。
    // 同时量出像素尺寸与时长 → 本地气泡立刻按原比例排版，并随消息上行给收端。
    await Promise.all(locals.map(async (l) => {
      l.meta = await probeMediaMetadata(l.f);
      if (l.meta.width > 0) { patchMsg(cid, l.localId, { mediaW: l.meta.width, mediaH: l.meta.height, duration: l.meta.durationMs, fileSize: l.f.size }); }
      if (!l.f.type.startsWith("video/")) return;
      const pf = await captureVideoPoster(l.f);
      if (pf) { l.posterFile = pf; l.posterBlobUrl = URL.createObjectURL(pf); patchMsg(cid, l.localId, { posterUrl: l.posterBlobUrl }); }
    }));
    for (let i = 0; i < locals.length; i++) {
      const l = locals[i];
      // 成功后哪些本地 blob 被服务器 URL 取代、成了可安全回收的孤儿（失败/回退仍在用的不能碰）。
      let mainOrphaned = false;   // 主体内容已切服务器 URL
      let posterOrphaned = false; // 封面已切服务器 URL（封面上传失败回退本地 blob 时为 false）
      // 取消：立即回收 blob（气泡已被移除，无需等 60s 换 URL），并从集合摘除。
      const revokeNow = () => { URL.revokeObjectURL(l.blobUrl); if (l.posterBlobUrl) URL.revokeObjectURL(l.posterBlobUrl); };
      const takeCancelled = () => { if (cancelledSendsRef.current.delete(l.localId)) { revokeNow(); return true; } return false; };
      if (takeCancelled()) continue; // 排队中就被取消：这一项根本不发起上传
      try {
        // 分母用**媒体本体字节数**：XHR 报的 total 是 multipart 整包（含 boundary/头），会比文件属性大一截。
        // key=localId：≥8MB 走分片，气泡的 ⏸/↑/右键取消经 chunkedTaskFor(localId) 定位任务。
        const { url, contentType } = await client.uploadFile(l.f, (sent, total) => {
          const ratio = total > 0 ? Math.min(sent / total, 1) : 0;
          setUploadProgress((prev) => ({ ...prev, [l.localId]: { sent: Math.round(ratio * l.f.size), total: l.f.size } }));
        }, l.localId);
        if (takeCancelled()) continue; // 小文件 XHR 无法 abort：传完了但用户已取消 → 不发消息
        // 视频封面：上传本地已抓的首帧图，随消息带 poster URL（收端直显免解码）；上传失败则保留本地 blob 封面不阻塞。
        let poster: string | undefined;
        if (l.posterFile) { try { poster = (await client.uploadFile(l.posterFile)).url; } catch { /* 封面上传失败：保留本地 blob 封面 */ } }
        if (takeCancelled()) continue; // poster 上传窗口（大视频可达数秒）内被取消 → 不发消息
        const clientMsgId = client.sendMedia(url, contentType, peer, cid, {
          groupId, poster, mediaW: l.meta.width, mediaH: l.meta.height, duration: l.meta.durationMs, fileSize: l.f.size,
        });
        patchMsg(cid, l.localId, { clientMsgId, content: url, contentType, posterUrl: poster || l.posterBlobUrl });
        clearUploadProgress(l.localId); // 传完：左上角进度胶囊消失，切回时长角标
        mainOrphaned = true;      // 主体已切服务器 URL → 本地 blob 可回收
        posterOrphaned = !!poster; // 仅当封面也上到服务器才回收本地封面 blob（回退时还在显）
      } catch (e) {
        clearUploadProgress(l.localId);
        if ((e as Error).name === "UploadCancelledError") { takeCancelled(); revokeNow(); continue; } // 分片任务被 cancel()
        patchMsg(cid, l.localId, { status: "failed" });
        pendingFilesRef.current.set(l.localId, { file: l.f, mode: "media", convId: cid, groupId }); // 留住 File+分组：点失败气泡按原相册重试
        // 用户只看到一句 toast；失败的会话/消息定位靠这条（可与 HTTP 层同 request_id 的上传日志对账）。
        logger.warn(LOG_TAG.media, "media_send_failed", {
          conv_id: cid, client_msg_id: l.localId, mime: l.f.type, bytes: l.f.size,
          media_w: l.meta.width, media_h: l.meta.height, error: (e as Error).message,
        });
        setToast(`第 ${i + 1} 项发送失败：${(e as Error).message}`);
      }
      // 延迟释放**已被服务器 URL 取代**的本地 blob（等重渲染切换后再回收，避免闪图）。
      // 关键：失败气泡仍用本地 blob 当内容、封面上传失败回退本地 blob 时也仍在显——这些绝不能 revoke，
      // 否则 <img>/<video> 引用已释放的 blob → ERR_FILE_NOT_FOUND 反复重试刷屏（纯噪音但很吵）。
      // 未回收的 blob 会在页面刷新时随文档一起释放。
      window.setTimeout(() => {
        if (mainOrphaned) URL.revokeObjectURL(l.blobUrl);
        if (posterOrphaned && l.posterBlobUrl) URL.revokeObjectURL(l.posterBlobUrl);
      }, 60_000);
    }
  }, [peer, groupConvId, uid, appendMsg, patchMsg, clearUploadProgress]);

  // 注意：uploadAndSend 必须声明在 send 之前——send 的 useCallback deps 数组在组件体内即时求值，
  // 后置声明会踩 const TDZ（ReferenceError）。
  const uploadAndSend = useCallback(async (file: File, pickMode: AttachmentPickMode = "media", convIdOverride?: string) => {
    const client = clientRef.current;
    // convIdOverride 用于重试：按原会话重发（不耦合当前打开的会话）。
    const cid = convIdOverride ?? (peer ? convIdFor(uid, peer) : groupConvId);
    if (!client || !cid) return;
    // 先上屏一条占位消息再上传：大文件传几十秒，原先"传完才出现"期间界面毫无反馈，用户以为卡死。
    const localId = `outbox-${crypto.randomUUID()}`;
    appendMsg(cid, {
      clientMsgId: localId, convId: cid, from: uid, content: "", contentType: attachmentContentType(pickMode, "file"),
      fileName: file.name, fileSize: file.size, convSeq: 0, timestamp: Date.now(), status: "sending",
    });
    setUploadProgress((prev) => ({ ...prev, [localId]: { sent: 0, total: file.size } }));
    pendingFilesRef.current.set(localId, { file, mode: pickMode, convId: cid }); // 失败时据此重试
    const takeCancelled = () => cancelledSendsRef.current.delete(localId); // 取消：文件无 blobURL，无需 revoke
    try {
      const { url, contentType: uploadedContentType, size } = await client.uploadFile(file, (sent, total) => {
        const ratio = total > 0 ? Math.min(sent / total, 1) : 0;
        setUploadProgress((prev) => ({ ...prev, [localId]: { sent: Math.round(ratio * file.size), total: file.size } }));
      }, localId);
      if (takeCancelled()) return; // 小文件 XHR 无法 abort：传完了但用户已取消 → 不发消息
      const contentType = attachmentContentType(pickMode, uploadedContentType);
      let poster: string | undefined;
      if (pickMode === "media" && contentType === "video") {
        const pf = await captureVideoPoster(file);
        if (pf) { try { poster = (await client.uploadFile(pf)).url; } catch { /* 封面上传失败：不阻塞 */ } }
      }
      if (takeCancelled()) return; // poster 窗口内被取消 → 不发消息
      const options = contentType === "file" ? { fileName: file.name, fileSize: size } : (poster ? { poster } : undefined);
      const clientMsgId = client.sendMedia(url, contentType, peer, cid, options);
      patchMsg(cid, localId, { clientMsgId, content: url, contentType, posterUrl: poster });
      clearUploadProgress(localId);
      pendingFilesRef.current.delete(localId);
    } catch (e) {
      clearUploadProgress(localId);
      if ((e as Error).name === "UploadCancelledError") { takeCancelled(); return; } // 分片任务被 cancel()
      patchMsg(cid, localId, { status: "failed" });
      logger.warn(LOG_TAG.media, "file_send_failed", {
        conv_id: cid, client_msg_id: localId, mime: file.type, bytes: file.size, error: (e as Error).message,
      });
      setToast(`发送失败：${(e as Error).message}`);
    }
  }, [peer, groupConvId, uid, appendMsg, patchMsg, clearUploadProgress]);

  const send = useCallback(() => {
    const text = input.trim();
    const client = clientRef.current;
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    if (!client || !cid) return;
    // 先发预览条攒的粘贴件（Web #2）：图片走相册批量通道（≥2 张聚簇成宫格），
    // 文件走既有文件通道（≥8MB 自动分片可暂停续传）；文字随后补发一条文本。
    if (pastedImages.length) {
      const items = pastedImages;
      setPastedImages([]);
      const imgs = items.filter((pi) => pi.kind === "image");
      if (imgs.length) void sendMediaBatch(imgs.map((pi) => pi.file));
      for (const pi of items) {
        if (pi.kind === "file") void uploadAndSend(pi.file, "file");
        window.setTimeout(() => URL.revokeObjectURL(pi.url), 60_000);
      }
    }
    if (!text) return;
    // 编辑态（M4-5）：发 msg_op edit 而非新消息；内容由服务端广播回 onMsgOp 更新。
    if (editingMsg && editingMsg.convSeq > 0) {
      client.editMessage(cid, editingMsg.convSeq, text);
      setEditingMsg(null); setInput("");
      return;
    }
    // 引用回复（M4-2）：带上目标 conv_seq + 本端即时快照（媒体→[图片]等；服务端会冻结权威快照给收件方）。
    const rt = replyTo && replyTo.convSeq > 0
      ? { convSeq: replyTo.convSeq, preview: replyPreviewOf(replyTo), from: replyTo.from }
      : undefined;
    const clientMsgId = client.sendText(text, peer, cid, rt ? { replyTo: rt } : undefined); // 群聊 to 为空：服务端按 conv_id 查成员写扩散
    appendMsg(cid, {
      clientMsgId, convId: cid, from: uid, content: text, contentType: "text",
      convSeq: 0, timestamp: Date.now(), status: "sending",
      replyToConvSeq: rt?.convSeq, replySnapshot: rt?.preview, replyToFrom: rt?.from,
    });
    setInput("");
    setReplyTo(null);
  }, [input, peer, groupConvId, uid, appendMsg, replyTo, editingMsg, pastedImages, sendMediaBatch, uploadAndSend]);

  // 引用某条消息（M4-2）：进入引用态（输入框上方显示引用条，发送时带上）。
  const replyMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    setReplyTo(m);
  }, []);

  // 上传并发送图片/文件（M4-6）：上传 → 发 content_type=image|video|file 消息（content=URL）+ 乐观上屏。
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentPickModeRef = useRef<AttachmentPickMode>("media");
  const attachAnchorRef = useRef<HTMLDivElement>(null);
  const attachCloseTimerRef = useRef<number | null>(null);
  const cancelAttachClose = useCallback(() => {
    if (attachCloseTimerRef.current === null) return;
    window.clearTimeout(attachCloseTimerRef.current);
    attachCloseTimerRef.current = null;
  }, []);
  const scheduleAttachClose = useCallback(() => {
    cancelAttachClose();
    attachCloseTimerRef.current = window.setTimeout(() => {
      setAttachPanel(false);
      attachCloseTimerRef.current = null;
    }, 1000);
  }, [cancelAttachClose]);
  useEffect(() => cancelAttachClose, [cancelAttachClose]);
  useEffect(() => {
    if (!attachPanel) return;
    const closeOutside = (event: PointerEvent) => {
      if (!attachAnchorRef.current?.contains(event.target as Node)) {
        cancelAttachClose();
        setAttachPanel(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [attachPanel, cancelAttachClose]);
  // （声明已前移到 uploadProgress 附近：cancelSendMessage 也要用它。）


  /// 重试失败的媒体/文件消息（图片/视频/文件通吃）：移除旧占位，用留存的 File 按**原会话/原相册**
  /// 重发（新的 localId）。媒体走批量通道（保留 groupId → 宫格成员回原格）；文件走单发通道。
  const retryUpload = useCallback((m: ChatMessage) => {
    const key = m.clientMsgId ?? "";
    const kept = pendingFilesRef.current.get(key);
    if (!kept) { setToast("原文件已失效，请重新选择"); return; }
    pendingFilesRef.current.delete(key);
    removeMsgRow(m.convId, key);
    if (kept.mode === "media") void sendMediaBatch([kept.file], { convId: kept.convId, groupId: kept.groupId });
    else void uploadAndSend(kept.file, kept.mode, kept.convId);
  }, [removeMsgRow, sendMediaBatch, uploadAndSend]);

  /// 媒体气泡点按路由（与 iOS 中心按钮状态机一致）：失败 ↻ 重试；上传中 ⏸↔↑ 暂停恢复
  /// （仅 ≥8MB 分片任务；小文件几秒传完不可暂停，点击忽略）；已发出 → 打开查看器。
  const onMediaBubbleTap = useCallback((m: ChatMessage, openViewer: () => void) => {
    const mine = m.from === uid;
    if (mine && m.status === "failed" && m.convSeq === 0 && pendingFilesRef.current.has(m.clientMsgId ?? "")) {
      retryUpload(m);
      return;
    }
    if (mine && m.status === "sending" && m.convSeq === 0 && uploadProgress[m.clientMsgId ?? ""]) {
      toggleUploadPause(m); // 无任务（小文件）时返回 false，无副作用——上传中本就不可查看
      return;
    }
    openViewer();
  }, [uid, uploadProgress, retryUpload, toggleUploadPause]);

  // 附件面板项（数据驱动，M4-6）：加入口 = 数组加一行。Web 只图片或视频 / 文件。
  const attachItems = useMemo(() => [
    { id: "media", label: "图片或视频", accept: "image/*,video/*", icon: ImageIcon },
    { id: "file", label: "文件", accept: "*/*", icon: FileText },
  ], []);
  const pickFile = useCallback((mode: AttachmentPickMode, accept: string) => {
    cancelAttachClose();
    setAttachPanel(false);
    attachmentPickModeRef.current = mode;
    const inp = fileInputRef.current;
    if (inp) { inp.accept = accept; inp.multiple = accept !== "*/*"; inp.value = ""; inp.click(); } // 图片/视频可多选（相册）
  }, [cancelAttachClose]);
  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const mode = attachmentPickModeRef.current;
    if (shouldSendAsMediaBatch(mode)) { void sendMediaBatch(files); }
    else { for (const f of files) void uploadAndSend(f, "file"); }
  }, [uploadAndSend, sendMediaBatch]);

  // 收藏（M4-4）：内容快照到服务端（原消息撤回/删除后仍在），toast 反馈。
  const favoriteMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    void (async () => {
      try {
        await clientRef.current?.addFavorite({
          content_type: m.contentType, content: m.content,
          source_conv_id: m.convId, source_conv_seq: m.convSeq, source_from: m.from,
        });
        setToast("已收藏");
      } catch (e) { setToast(`收藏失败：${(e as Error).message}`); }
    })();
  }, []);
  // 打开收藏列表弹窗。
  const openFavorites = useCallback(() => {
    void (async () => {
      try { setFavorites(await clientRef.current?.listFavorites() ?? []); }
      catch (e) { setToast(`加载收藏失败：${(e as Error).message}`); }
    })();
  }, []);
  const removeFavorite = useCallback((id: number) => {
    void (async () => {
      try {
        await clientRef.current?.deleteFavorite(id);
        setFavorites((prev) => (prev ? prev.filter((f) => f.id !== id) : prev));
      } catch (e) { setToast(`删除失败：${(e as Error).message}`); }
    })();
  }, []);

  // 转发（M4-3）：打开会话选择器，选目标后逐条转发（带 forward_from 溯源）。
  // 链接富预览抓取（供 LinkCard；稳定引用避免重复请求）。
  const fetchLinkPreview = useCallback(async (url: string): Promise<LinkPreview> => {
    const c = clientRef.current;
    if (!c) throw new Error("未连接");
    return c.linkPreview(url);
  }, []);
  const forwardMessage = useCallback((m: ChatMessage) => { setMenu(null); setForwardMode("each"); setForwarding([m]); }, []);
  // 进入多选态（M4-3）：预选当前消息。
  const enterSelectMode = useCallback((m: ChatMessage) => {
    setMenu(null); setSelectMode(true);
    setSelected(new Set(m.convSeq > 0 ? [m.convSeq] : []));
  }, []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  const toggleSelected = useCallback((seq: number) => {
    setSelected((prev) => { const n = new Set(prev); n.has(seq) ? n.delete(seq) : n.add(seq); return n; });
  }, []);
  // 执行转发：逐条（保留各自类型）或合并（打包 chat_record 一条）发到 target 会话。
  const doForwardTo = useCallback((target: Conversation) => {
    const client = clientRef.current;
    const msgs = forwarding;
    if (!client || !msgs) return;
    const to = target.is_group ? "" : target.peer;
    // 发送者显示名：自己→uid；否则群成员昵称（直接读 groupInfos 状态，避免依赖后声明的 memberNick）→ 回退 uid。
    const nameOf = (m: ChatMessage) => (m.from === uid ? uid : (m.fromNickname || groupInfos[m.convId]?.members.find((x) => x.user_id === m.from)?.nickname || m.from));
    const pushOptimistic = (clientMsgId: string, content: string, contentType: string, forwardFrom?: string, fileName?: string, fileSize?: number) =>
      appendMsg(target.conv_id, { clientMsgId, convId: target.conv_id, from: uid, content, contentType, fileName, fileSize, convSeq: 0, timestamp: Date.now(), status: "sending", ...(forwardFrom ? { forwardFrom } : {}) });

    if (forwardMode === "merged" && msgs.length > 0) {
      const items: RecordItem[] = msgs
        .filter((m) => m.content && !m.recalledAt && m.contentType !== "system" && m.convSeq > 0)
        .map((m) => ({
          n: nameOf(m), ct: m.contentType || "text", c: m.content,
          // 文件行随包携带原名与大小（fn/fs，与 iOS 同约定）——收端不再只显「[文件]」。
          ...(m.contentType === "file"
            ? { fn: m.fileName || fileNameFromContent(m.content), ...(m.fileSize ? { fs: m.fileSize } : {}) }
            : {}),
        }));
      const names = new Set(items.map((i) => i.n));
      const title = names.size <= 1 ? `${[...names][0] || "聊天"} 的聊天记录` : "群聊的聊天记录";
      const json = JSON.stringify({ t: title, items });
      const clientMsgId = client.sendMedia(json, "chat_record", to, target.conv_id);
      pushOptimistic(clientMsgId, json, "chat_record");
    } else {
      for (const m of msgs) {
        if (!m.content || m.recalledAt) continue;
        const origin = m.forwardFrom || m.fromNickname || m.from; // 转发链保留最初作者
        const ct = m.contentType || "text";
        // 保留原类型：图片/视频/文件按 media 转发（否则收方收到的是 URL 文本、会话预览也丢 [图片]）。
        const clientMsgId = ct === "text"
          ? client.sendText(m.content, to, target.conv_id, { forwardFrom: origin })
          // 转发也要带上媒体尺寸/时长：源消息手上就有，丢了收端就只能按未知渲染（且事后补不回来）。
          : client.sendMedia(m.content, ct, to, target.conv_id, {
              forwardFrom: origin, fileName: m.fileName, fileSize: m.fileSize,
              mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration,
            });
        pushOptimistic(clientMsgId, m.content, ct, origin, m.fileName, m.fileSize);
      }
    }
    setForwarding(null);
    exitSelectMode();
    setToast(`已转发到 ${target.is_group ? (target.name || "群聊") : (target.peer_remark || target.peer_nickname || target.peer)}`);
  }, [forwarding, forwardMode, groupInfos, exitSelectMode, appendMsg, uid]);
  // 多选批量转发：收集选中的消息，打开选择器。
  const forwardSelected = useCallback(() => {
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    const list = (msgsByConv[cid] ?? []).filter((m) => m.convSeq > 0 && selected.has(m.convSeq) && !m.recalledAt);
    if (list.length > 0) { setForwardMode("each"); setForwarding(list); }
  }, [msgsByConv, peer, uid, groupConvId, selected]);
  // 多选批量删除（仅本端）。
  const deleteSelected = useCallback(() => {
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    setMsgsByConv((prev) => {
      const list = (prev[cid] ?? []).filter((m) => !(m.convSeq > 0 && selected.has(m.convSeq)));
      return { ...prev, [cid]: list };
    });
    selected.forEach((s) => seenByConv.current[cid]?.delete(s));
    exitSelectMode();
  }, [peer, uid, groupConvId, selected, exitSelectMode]);

  // 跳转到被引用的原消息（点击气泡引用条）：高亮该行并滚入视口。
  const jumpToSeq = useCallback((seq: number) => {
    const box = msgsRef.current;
    if (!box) { setToast("原消息不在当前视图"); return; }
    let el = box.querySelector(`[data-seq="${seq}"]`);
    const list = messagesRef.current;
    if (!el) {
      // 相册宫格从行不渲染自己的 data-seq（只有主行有）：目标在模型里且属于宫格 → 定位到宫格主行。
      const target = list.find((x) => x.convSeq === seq);
      if (target?.groupId) {
        const leader = list.find((x) => x.groupId === target.groupId && isAlbumMember(x));
        if (leader) el = box.querySelector(`[data-seq="${leader.convSeq}"]`);
      }
    }
    if (!el) {
      // 跳不到分两种，**按模型判定而非 DOM**（宫格从行/未来虚拟化都可能不渲染节点）：
      // 目标比已加载最早一条还早 → 还没上拉加载到；落在已加载窗口内却缺失 → 已被本地删除。
      // 窗口内无任何已确认消息（minSeq=0）判不出方向 → 回退通用提示。
      const earliest = minSeqOf(list);
      setToast(earliest === 0 ? "原消息不在当前视图"
        : seq < earliest ? "原消息较早，请上拉加载后重试" : "原消息已被删除");
      return;
    }
    const node = el;
    const flash = () => {
      node.classList.add("flash");
      window.setTimeout(() => node.classList.remove("flash"), 1200);
    };
    // 目标已在视口内 → 立即闪；否则先平滑滚动，**到位后**再闪（原先边滚边闪，目标离得远时
    // 1.2s 动画在滚动途中就放完了，人到了什么都看不见）。scrollend 一次性监听，老浏览器降级定时。
    const r = node.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const visible = r.top >= br.top && r.bottom <= br.bottom;
    if (visible) { flash(); return; }
    // 同「进未读会话定位」：不用 scrollIntoView（会连带滚动 html/#root 把 .app 顶出视口、间距塌陷），
    // 只动 .msgs 自身 scrollTop，把目标行滚到容器纵向居中。
    box.scrollTo({
      top: box.scrollTop + (r.top - br.top) - (box.clientHeight - r.height) / 2,
      behavior: "smooth",
    });
    if ("onscrollend" in box) {
      let done = false;
      const once = () => { if (!done) { done = true; flash(); } };
      box.addEventListener("scrollend", once, { once: true });
      window.setTimeout(once, 1500); // 防御：极端情况 scrollend 不触发（如无需滚动）
    } else {
      window.setTimeout(flash, 700); // 无 scrollend 的老浏览器：按平滑滚动典型时长延迟
    }
  }, []);

  // 本地删除一条消息（仅本端：从内存列表 + 去重集移除，不影响对端）。
  const deleteMessage = useCallback((m: ChatMessage) => {
    // 删除一条仍在发送的本地出箱件：必须同时停掉上传（abort 分片 + 取消集合拦住小文件/poster/sendMedia），
    // 否则"删除"只抹掉气泡而上传照跑、消息照发（幽灵送达）。已发出的消息（convSeq>0）走纯本地删除。
    if (m.from === uid && m.convSeq === 0 && m.clientMsgId) teardownOutboxUpload(m.clientMsgId, hasActiveSend(m));
    setMsgsByConv((prev) => {
      const list = (prev[m.convId] ?? []).filter((x) =>
        m.clientMsgId ? x.clientMsgId !== m.clientMsgId : x.convSeq !== m.convSeq
      );
      return { ...prev, [m.convId]: list };
    });
    if (m.convSeq > 0) seenByConv.current[m.convId]?.delete(m.convSeq);
    setMenu(null);
  }, [uid, teardownOutboxUpload]);

  const copyMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    // 图片：复制真实图片字节（可粘贴回输入框直接发图）；失败或非图片：复制文本/URL。
    if (m.contentType === "image") {
      copyImageToClipboard(m.content).then(() => setToast("已复制图片"))
        .catch(() => { void navigator.clipboard?.writeText(m.content); setToast("已复制链接"); });
      return;
    }
    void navigator.clipboard?.writeText(m.content);
  }, []);

  // 撤回自己的消息（M4-1）：发 msg_op；成功由服务端广播回 msg_op 帧应用（onMsgOp），失败（超窗）toast。
  const recallMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    if (m.convSeq > 0) clientRef.current?.recallMessage(m.convId, m.convSeq);
  }, []);

  // 编辑自己的文本消息（M4-5）：进入编辑态（回填输入框，发送时走 msg_op edit）。
  const editMessage = useCallback((m: ChatMessage) => {
    setMenu(null); setReplyTo(null);
    setEditingMsg(m); setInput(m.content);
  }, []);

  // 翻译一条消息（M4-5）：调服务端翻译接口，译文挂气泡下方。
  const translateMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    if (m.convSeq <= 0) return;
    void (async () => {
      try {
        const t = await clientRef.current?.translate(m.content);
        if (t) setTranslations((prev) => ({ ...prev, [m.convSeq]: t }));
      } catch (e) { setToast(`翻译失败：${(e as Error).message}`); }
    })();
  }, []);

  // 举报（AG-3）：举报某条消息 / 举报发送者。仅对“对方的消息”可用。
  const reportMessage = useCallback(async (m: ChatMessage, kind: "message" | "user") => {
    setMenu(null);
    const what = kind === "message" ? "举报这条消息" : `举报用户 ${m.from}`;
    const reason = window.prompt(`${what}\n请填写举报理由：`, "");
    if (reason === null) return; // 取消
    try {
      if (kind === "message") {
        // 用 (conv_id, conv_seq) 定位消息：客户端无需持有 server_msg_id（本地库存的是复合键）。
        await clientRef.current?.report("message", String(m.convSeq), reason, m.convId);
      } else {
        await clientRef.current?.report("user", m.from, reason);
      }
      alert("举报已提交，感谢反馈。");
    } catch (e) {
      alert(`举报失败：${(e as Error).message}`);
    }
  }, []);

  // 轻量浮层提示：约 1.8s 自动消失。未接后端的功能统一用它提示"开发中"。
  const comingSoon = useCallback((label: string) => setToast(`${label}（开发中）`), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // 会话"设为已读"：推进已读位点（清未读数）+ 清除手动"标未读"标记，再刷新列表。
  const markReadConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        if (c.unread > 0) clientRef.current?.markRead(c.conv_id, c.latest_conv_seq);
        if (c.marked_unread) {
          await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: false });
        }
        await refreshConversations();
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 会话"标为未读"：手动置红点（不改已读位点，不计数）。
  const markUnreadConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: true });
        await refreshConversations();
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 会话置顶/取消置顶：pinned_at=现在/0（后端据此把置顶会话排在列表顶）。
  const setConvPinned = useCallback((c: Conversation, pinned: boolean) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: pinned ? Date.now() : 0, muted: !!c.muted, marked_unread: !!c.marked_unread });
        await refreshConversations();
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 会话免打扰/取消：muted 切换（弱提示，不改红点/未读）。
  const setConvMuted = useCallback((c: Conversation, muted: boolean) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted, marked_unread: !!c.marked_unread });
        await refreshConversations();
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 删除会话（仅本人，后端记 cleared_at 不删消息）：若删的是当前打开会话则退出，否则刷新列表。
  const deleteConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.deleteConversation(c.conv_id);
        if (currentConvRef.current === c.conv_id) deselect(); // deselect 内部会 refreshConversations
        else await refreshConversations();
      } catch (e) { setToast(`删除失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations, deselect]);

  // 消息菜单动作（数据驱动）：copy/delete/report* 接真实实现，其余 comingSoon。useMemo 避免每次渲染重建。
  const messageActions = useMemo<MenuAction<{ m: ChatMessage; uid: string }>[]>(
    () => buildMessageActions({
      copy: copyMessage,
      reply: replyMessage,
      forward: forwardMessage,
      favorite: favoriteMessage,
      edit: editMessage,
      translate: translateMessage,
      multiSelect: enterSelectMode,
      recall: recallMessage,
      delete: deleteMessage,
      reportMsg: (m) => void reportMessage(m, "message"),
      reportUser: (m) => void reportMessage(m, "user"),
      cancelSend: cancelSendMessage,
      comingSoon,
    }),
    [copyMessage, replyMessage, forwardMessage, favoriteMessage, editMessage, translateMessage, enterSelectMode, recallMessage, deleteMessage, reportMessage, cancelSendMessage, comingSoon],
  );

  // 会话菜单动作（数据驱动，M4.5 全接后端）：置顶/免打扰切换、标已读/未读、删除会话。
  const conversationActions = useMemo<MenuAction<{ c: Conversation }>[]>(
    () => buildConversationActions({
      setPinned: setConvPinned,
      setMuted: setConvMuted,
      markRead: markReadConv,
      markUnread: markUnreadConv,
      delete: deleteConv,
    }),
    [setConvPinned, setConvMuted, markReadConv, markUnreadConv, deleteConv],
  );

  // 菜单打开时：点空白/滚动/Esc 关闭。
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // 好友 ⋯ 菜单：点空白 / Esc 关闭。
  useEffect(() => {
    if (!friendMenu) return;
    const close = () => setFriendMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFriendMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [friendMenu]);

  // 会话右键菜单：点空白/滚动/Esc 关闭（与消息菜单一致）。
  useEffect(() => {
    if (!convMenu) return;
    const close = () => setConvMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConvMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [convMenu]);

  // 群成员 ⋯ 菜单：点空白/滚动/Esc 关闭。
  useEffect(() => {
    if (!memberMenu) return;
    const close = () => setMemberMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMemberMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [memberMenu]);

  // 左上角头像卡片：点空白/Esc 关闭。
  useEffect(() => {
    if (!accountCard) return;
    const close = () => setAccountCard(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAccountCard(false); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountCard]);

  // 聊天页 ⋮ 下拉：点空白/Esc 关闭。
  useEffect(() => {
    if (!chatMenu) return;
    const close = () => setChatMenu(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setChatMenu(false); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [chatMenu]);

  // 打开设置时刷新本人资料（与左上角头像共用 loadMyInfo / myInfo）。
  useEffect(() => {
    if (!showSettings) return;
    void loadMyInfo();
  }, [showSettings]);

  // 主题：真功能——写 <html data-theme> 驱动 CSS 变量切换（浅/深/跟随系统）+ 持久化。
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("im.theme", theme);
  }, [theme]);
  // 消息字体大小：真功能——写 CSS 变量 --msg-font 驱动消息气泡文本字号 + 持久化。
  useEffect(() => {
    localStorage.setItem("im.fontSize", String(fontSize));
    document.documentElement.style.setProperty("--msg-font", `${fontSize}px`);
  }, [fontSize]);
  useEffect(() => { localStorage.setItem("im.timeFormat", timeFormat); }, [timeFormat]);
  useEffect(() => { localStorage.setItem("im.sendKey", sendKey); }, [sendKey]);
  useEffect(() => {
    document.documentElement.style.setProperty("--chat-wallpaper", wallpaperCSS(wallpaper));
    try {
      localStorage.setItem("im.wallpaper", JSON.stringify(wallpaper));
    } catch {
      setToast("图片较大，壁纸仅在本次页面有效");
    }
  }, [wallpaper]);
  useEffect(() => {
    document.documentElement.style.setProperty("--wallpaper-blur", wallpaperBlur ? "10px" : "0px");
    document.documentElement.style.setProperty("--wallpaper-scale", wallpaperBlur ? "1.06" : "1");
    localStorage.setItem("im.wallpaperBlur", wallpaperBlur ? "1" : "0");
  }, [wallpaperBlur]);

  const pickWallpaperImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("请选择图片文件");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setToast("图片不能超过 8 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setWallpaper({ kind: "image", value: reader.result });
    };
    reader.onerror = () => setToast("读取图片失败");
    reader.readAsDataURL(file);
  };

  const resetWallpaper = () => {
    setWallpaper(DEFAULT_WALLPAPER);
    setWallpaperBlur(false);
  };

  const applyWallpaperColor = (next: HSVColor) => {
    const normalized = { h: clamp(next.h, 0, 360), s: clamp(next.s), v: clamp(next.v) };
    setColorHSV(normalized);
    setWallpaper({ kind: "color", value: hsvToHex(normalized) });
  };

  const openWallpaperColor = () => {
    setColorHSV(hexToHSV(wallpaper.kind === "color" ? wallpaper.value : "#567e71"));
    setWallpaperColorOpen(true);
  };

  const updateColorFromSpectrum = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    applyWallpaperColor({
      h: colorHSV.h,
      s: clamp(((event.clientX - rect.left) / rect.width) * 100),
      v: clamp(100 - ((event.clientY - rect.top) / rect.height) * 100),
    });
  };

  // 输入框随内容自适应高度（换行时变高，最多 ~5 行；发送清空后回到单行）。
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const onInputChange = useCallback((val: string) => {
    setInput(val);
    const now = Date.now();
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    if (val && cid && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      clientRef.current?.sendTyping(cid);
    }
  }, [peer, groupConvId, uid]);

  const stateText = { connected: "已连接", connecting: "连接中…", disconnected: "未连接" }[state];

  const convId = peer ? convIdFor(uid, peer) : groupConvId;
  // 按时间戳排序（发送中/失败的 convSeq=0 但有发送时刻，故按时间能正确落位——
  // 否则它们会被挤到末尾，导致"解除拉黑后新发的消息排在更早的失败消息之前"）。
  // conv_seq 仅作同一毫秒内的次级排序，保证已送达消息间仍按服务端顺序。
  const messages = (msgsByConv[convId] ?? [])
    .slice()
    .sort((a, b) => (a.timestamp - b.timestamp) || ((a.convSeq || Number.MAX_SAFE_INTEGER) - (b.convSeq || Number.MAX_SAFE_INTEGER)));
  messagesRef.current = messages; // 每次渲染同步镜像（jumpToSeq 等早于此处定义，经 ref 取当前值）
  // 首条未读下标：conv_seq > read_seq 的第一条对端消息（精确，CHAT_UX §4）。
  const firstUnreadIdx =
    entryUnread > 0 ? messages.findIndex((m) => m.from !== uid && m.convSeq > entryReadSeq) : -1;
  // 末条"自己消息"的状态签名：被拒收/ack 会改其 status/note（条数不变），用它当滚动 effect 的依赖，
  // 否则仅 messages.length 不变 → effect 不重跑 → 系统行变高后不贴底（问题1）。
  const tail = messages[messages.length - 1];
  const tailSig = tail && tail.from === uid ? `${tail.status}|${tail.note ?? ""}` : "";

  // 进会话定位 / 新消息贴底 / 顶部插历史保位 / 在上看历史累加跳转计数（纯 DOM 滚动）。
  useLayoutEffect(() => {
    if (phase !== "app" || !convId) return;
    const box = msgsRef.current;
    if (!box) return;
    const curMin = minSeqOf(messages);
    const curMax = maxSeqOf(messages);
    // 条数是否增加：新增消息=true；仅原条状态变更（被拒收/ack 改 status/note）=false。
    const grew = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;

    if (pendingScrollRef.current) {
      if (messages.length === 0) return; // 等锚点窗口到达再定位
      if (firstUnreadIdx >= 0 && !forceBottomRef.current && dividerRef.current) {
        // 停在首条未读（分割线滚到容器顶）。不用 Element.scrollIntoView——它会沿祖先链一路把
        // 能滚的都滚，含 html/#root，导致整个 .app 被顶出视口、顶部与卡片间距"塌陷"（刷新才复位）；
        // 改为只动 .msgs 自身的 scrollTop，把分割线顶对齐到容器顶，滚动严格限定在消息容器内。
        box.scrollTop += dividerRef.current.getBoundingClientRect().top - box.getBoundingClientRect().top;
        // 定位后实测是否已贴底：未读不多、整屏放得下时分割线滚到顶仍贴底 → 不显示 ↓N（CHAT_UX §7）。
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        wasNearBottomRef.current = nearBottom;
        setShowJump(!nearBottom && entryUnreadRef.current > 0);
        setJumpCount(nearBottom ? 0 : entryUnreadRef.current);
      } else {
        box.scrollTop = box.scrollHeight; // 无未读 / 强制到底
        wasNearBottomRef.current = true;
        setShowJump(false);
      }
      pendingScrollRef.current = false;
      forceBottomRef.current = false;
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    const wasLoadingNewer = loadingNewerRef.current;
    if (curMin < prevMinSeqRef.current) loadingOlderRef.current = false;
    if (curMax > prevMaxSeqRef.current) loadingNewerRef.current = false;

    // 顶部插入更早历史 → 用插入前后的 scrollHeight 差补偿，保持视觉位置不跳。
    if (curMin < prevMinSeqRef.current && curMax <= prevMaxSeqRef.current) {
      if (histAnchorRef.current) {
        box.scrollTop = box.scrollHeight - histAnchorRef.current.h + histAnchorRef.current.t;
        histAnchorRef.current = null;
      }
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 下滚分页加载的更新历史（≤ latest）：插在下方，位置不动。
    if (curMax > prevMaxSeqRef.current && curMax <= latestSeqRef.current && wasLoadingNewer) {
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 真·新消息（live）或自己发送。
    const newPeer = messages.filter((m) => m.from !== uid && m.convSeq > prevMaxSeqRef.current).length;
    const lastMine = messages[messages.length - 1]?.from === uid;
    prevMinSeqRef.current = curMin;
    prevMaxSeqRef.current = curMax;
    if (curMax > latestSeqRef.current) latestSeqRef.current = curMax;

    if (lastMine) {
      // 新发消息始终贴底；末条状态变更（如被拒收挂系统行致变高）仅在原本贴底时贴底，
      // 不打断已上滚看历史的用户（CHAT_UX §9）。
      if (grew || wasNearBottomRef.current) {
        box.scrollTop = box.scrollHeight;
        wasNearBottomRef.current = true;
        setShowJump(false);
        setJumpCount(0);
      }
    } else if (newPeer > 0) {
      if (wasNearBottomRef.current) {
        box.scrollTop = box.scrollHeight;
        setShowJump(false);
        setJumpCount(0);
      } else {
        setJumpCount((n) => n + newPeer);
        setShowJump(true);
      }
    }
  }, [phase, convId, messages.length, uid, firstUnreadIdx, tailSig]);

  // 图片/视频是异步加载的：贴底 useLayoutEffect 触发时元素高度≈0，加载完成后气泡才撑高，
  // 而依赖数组里没有值随之改变 → effect 不重跑 → 媒体被挤出视口下方（发图/发视频不贴底，问题2）。
  // 故媒体加载完成后，若此前处于贴底状态则再贴一次底。图片(onLoad)/视频(onLoadedData)共用此回调。
  const onMediaLoad = useCallback(() => {
    const box = msgsRef.current;
    if (box && wasNearBottomRef.current) box.scrollTop = box.scrollHeight;
  }, []);

  // 可见即读（CHAT_UX §6 完整语义）：扫描在视口内的消息，取最大 conv_seq；超过已滚入位点则节流上报。
  // 同时把"↓N"更新为视口下方仍未读的对端消息数（随滚动递减，滚到底为 0）。
  const markVisibleRead = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    const boxBottom = box.getBoundingClientRect().bottom;
    const items = box.querySelectorAll<HTMLElement>(".msg-item[data-seq]");
    let maxSeq = 0;
    items.forEach((el) => {
      const seq = Number(el.dataset.seq);
      // 元素顶部已进入容器可见底边 → 视为已滚入（被看到过）；其中最大 seq = 当前看到的最深位置。
      if (seq > 0 && el.getBoundingClientRect().top < boxBottom) maxSeq = Math.max(maxSeq, seq);
    });
    if (maxSeq > pendingReadRef.current) {
      pendingReadRef.current = maxSeq;
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
      readTimerRef.current = window.setTimeout(() => {
        if (pendingReadRef.current > maxReadReportedRef.current) {
          maxReadReportedRef.current = pendingReadRef.current;
          clientRef.current?.markRead(currentConvRef.current, maxReadReportedRef.current);
          void refreshConversations(); // 已读推进后刷新左侧列表，红点未读数随滚动递减
        }
      }, 300);
    }
    // ↓N = 视口下方仍未读的对端消息数（conv_seq 超过已滚入位点、且是对端消息）。
    let below = 0;
    items.forEach((el) => {
      if (Number(el.dataset.seq) > pendingReadRef.current && el.querySelector(".row.them")) below++;
    });
    setJumpCount(below);
  }, [refreshConversations]);

  // 进会话/新消息渲染后扫一遍可见消息（覆盖"整屏放得下、不触发滚动"的短会话；滚动另由 onMsgsScroll 处理）。
  useEffect(() => {
    if (phase === "app" && convId) markVisibleRead();
  }, [phase, convId, messages.length, markVisibleRead]);

  const onMsgsScroll = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    markVisibleRead(); // 可见即读：滚到哪、读到哪
    const cid = currentConvRef.current;
    const list = msgsByConv[cid] ?? [];
    const nearBottomPx = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const newest = maxSeqOf(list);
    const oldest = minSeqOf(list);
    const moreBelow = newest < latestSeqRef.current; // 下方还有未加载的更新历史
    const atTrueBottom = nearBottomPx && !moreBelow;
    wasNearBottomRef.current = atTrueBottom;
    setShowJump(!atTrueBottom);
    if (atTrueBottom) setJumpCount(0);

    const busy = loadingOlderRef.current || loadingNewerRef.current;
    if (nearBottomPx && moreBelow && !busy) {
      loadingNewerRef.current = true; // 下滚到底 → 加载更新一页
      clientRef.current?.loadNewer(cid, newest);
    } else if (box.scrollTop < 120 && oldest > 1 && !busy) {
      loadingOlderRef.current = true; // 上滚到顶 → 加载更早一页（保位）
      histAnchorRef.current = { h: box.scrollHeight, t: box.scrollTop };
      clientRef.current?.loadOlder(cid, oldest);
    }
  }, [msgsByConv]);

  const jumpToBottom = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    const cid = currentConvRef.current;
    const newest = maxSeqOf(msgsByConv[cid] ?? []);
    if (newest < latestSeqRef.current) {
      // 下方还有大段未加载 → 重载最近一页再贴底。
      setEntryUnread(0);
      forceBottomRef.current = true;
      pendingScrollRef.current = true;
      clientRef.current?.openConversation(cid, latestSeqRef.current, latestSeqRef.current);
    } else {
      box.scrollTop = box.scrollHeight;
    }
    wasNearBottomRef.current = true;
    setShowJump(false);
    setJumpCount(0);
  }, [msgsByConv]);

  // ---- 登录 ----
  if (phase === "login") {
    if (restoring) {
      // 恢复登录过渡态（Web #4）：有已存会话时不闪登录表单，静默重登成功直达主界面。
      return (
        <div className="login">
          <img className="login-logo" src="/im-logo.png" alt="" aria-hidden="true" />
          <h1>IM Web</h1>
          <p className="hint">正在恢复登录（{uid}）…</p>
        </div>
      );
    }
    return (
      <div className="login">
        <img className="login-logo" src="/im-logo.png" alt="" aria-hidden="true" />
        <h1>IM Web 登录</h1>
        <label>用户名<input value={uid} autoFocus onChange={(e) => setUid(e.target.value.trim())} /></label>
        <label>密码<input type="password" value={password} placeholder="≥ 6 位"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void enterApp(password); }} /></label>
        {authErr && <p className="auth-err">{authErr}</p>}
        <button disabled={authBusy} onClick={() => void enterApp(password)}>登录</button>
        <button className="secondary" disabled={authBusy} onClick={() => void doRegister()}>注册并登录</button>
        <p className="hint">
          真账号密码登录。先启动后端 <code>go run ./cmd/imserver</code>。<br />
          仅调试：<button className="link-inline" disabled={authBusy} onClick={() => void enterApp("")}>免密登录</button>（需后端开启 dev-login）。
        </p>
      </div>
    );
  }

  // ---- 双栏主界面（左会话列表常驻 + 右聊天详情） ----
  const readSeq = peerReadSeq[convId] ?? 0;
  const peerOnline = presence[peer] === "online";
  const peerBlocked = !!peer && friends.some((f) => f.user_id === peer && f.blocked); // 我拉黑了对方（blocked 标记，与 status 正交）

  // 通讯录派生：我对每个对端的关系状态、收到的申请、已是好友、新申请红点数。
  // 拉黑的好友 status 仍是 accepted，但搜索结果按"已拉黑"展示，故 blocked 覆盖 status。
  const friendStatus = new Map(friends.map((f) => [f.user_id, f.blocked ? "blocked" : f.status]));
  const blockedSet = new Set(friends.filter((f) => f.blocked).map((f) => f.user_id));
  const incoming = friends.filter((f) => f.status === "pending"); // 别人申请我，待我同意/拒绝
  const accepted = friends.filter((f) => f.status === "accepted").sort((a, b) => b.updated_at - a.updated_at);
  const incomingCount = incoming.length;
  const labelOf = (id: string, nick: string) => (nick && nick.trim()) || id; // 有昵称显昵称，否则显 uid
  // 好友显示名优先级：备注名 > 昵称 > uid（§头像/显示名规则）。
  const friendLabel = (f: FriendEntry) => (f.remark && f.remark.trim()) || (f.nickname && f.nickname.trim()) || f.user_id;
  // 会话对端显示名优先级：备注 > 昵称 > uid。
  const convLabel = (c: Conversation) => (c.peer_remark && c.peer_remark.trim()) || (c.peer_nickname && c.peer_nickname.trim()) || c.peer;
  // 当前聊天对端的会话项与显示名（聊天页标题/备注预填用）。
  const peerConv = conversations.find((c) => c.peer === peer);
  const peerLabel = peerConv ? convLabel(peerConv) : peer;
  const groupConv = conversations.find((c) => c.conv_id === groupConvId); // 当前群会话（供头部菜单静音/删除，M4.5）

  // ---- 群聊派生 + 动作（早退 return 之后：全部普通函数，禁用 Hook）----
  const isGroupChat = !!groupConvId;
  const activeGroupInfo = groupConvId ? groupInfos[groupConvId] : undefined;
  const activeGroupConv = groupConvId ? conversations.find((c) => c.conv_id === groupConvId) : undefined;
  const chatTitle = isGroupChat ? (activeGroupInfo?.name || activeGroupConv?.name || "群聊") : peerLabel;
  const chatMemberCount = activeGroupInfo?.members.length ?? activeGroupConv?.member_count ?? 0;
  const chatAvatarURL = isGroupChat
    ? (activeGroupInfo?.avatar_url || activeGroupConv?.avatar_url)
    : peerConv?.peer_avatar_url;
  const chatSubtitle = isGroupChat
    ? (chatMemberCount > 0 ? `${chatMemberCount} 位成员` : "群聊")
    : (peerOnline ? "在线" : "最近上线");
  // 群成员昵称（气泡/正在输入回退用）：优先消息自带 from_nickname，其次成员表缓存，最后 uid。
  const memberNick = (cid: string, id: string): string => {
    const m = groupInfos[cid]?.members.find((x) => x.user_id === id);
    return (m?.nickname && m.nickname.trim()) || "";
  };
  const senderLabel = (m: ChatMessage): string => m.fromNickname || memberNick(m.convId, m.from) || m.from;
  // 群成员头像 URL（气泡左侧头像列用）：从群资料成员表按 uid 取；无则空（Avatar 回退首字母圈）。
  const senderAvatar = (m: ChatMessage): string | undefined =>
    groupInfos[m.convId]?.members.find((x) => x.user_id === m.from)?.avatar_url;
  // 两条消息是否属于同一「连续段」：同发送者、非系统/撤回、同一天（跨天有日期分隔断段）。
  const sameSenderRun = (a?: ChatMessage, b?: ChatMessage): boolean =>
    !!a && !!b && a.from === b.from && a.from !== uid &&
    a.contentType !== "system" && b.contentType !== "system" &&
    !a.recalledAt && !b.recalledAt && isSameDay(a.timestamp, b.timestamp);
  // 上/下一「可见消息」（跳过相册零高从行；多选态相册展开为独立行则不跳）——用于连续段首/末判定。
  const prevVisibleMsg = (list: ChatMessage[], i: number): ChatMessage | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      if (!selectMode && isAlbumMember(list[j]) && !isAlbumLeader(list, j)) continue;
      return list[j];
    }
    return undefined;
  };
  const nextVisibleMsg = (list: ChatMessage[], i: number): ChatMessage | undefined => {
    for (let j = i + 1; j < list.length; j++) {
      if (!selectMode && isAlbumMember(list[j]) && !isAlbumLeader(list, j)) continue;
      return list[j];
    }
    return undefined;
  };
  // 会话列表项显示名/头像/预览（群聊 vs 单聊）。
  const convDisplayLabel = (c: Conversation) => (c.is_group ? (c.name || "群聊") : convLabel(c));
  const convAvatarUrl = (c: Conversation) => (c.is_group ? c.avatar_url : c.peer_avatar_url);
  const mediaPreview = (ct: string): string | null =>
    ct === "image" ? "[图片]" : ct === "video" ? "[视频]" : ct === "file" ? "[文件]" : ct === "chat_record" ? "[聊天记录]" : null;
  const convPreview = (c: Conversation): string => {
    if (!c.last_message) return "（无消息）";
    // 撤回消息预览（后端已脱敏 content）：显示"撤回了一条消息"（微信式）。
    if (c.last_message.recalled_at) {
      const who = c.last_message.from === uid ? "你" : (c.is_group ? (c.last_message.from_nickname || c.last_message.from) : "对方");
      return `${who}撤回了一条消息`;
    }
    const media = mediaPreview(c.last_message.content_type); // 图片/视频/文件 → [图片] 等
    const text = media ?? c.last_message.content;
    if (!c.is_group) return text;
    if (c.last_message.content_type === "system") return c.last_message.content; // 系统消息无发送者前缀
    const who = c.last_message.from === uid ? "我" : (c.last_message.from_nickname || c.last_message.from);
    return `${who}: ${text}`;
  };

  // 群动作统一包装：执行 → 刷新群资料 + 会话列表；失败 alert。
  const doGroupAction = async (cid: string, fn: () => Promise<void>) => {
    try {
      await fn();
      void refreshGroupInfo(cid);
      void refreshConversations();
    } catch (e) {
      alert(`操作失败：${(e as Error).message}`);
    }
  };

  // 打开「群聊」列表弹窗（通讯录入口）。
  const openGroupsModal = async () => {
    try {
      const list = await clientRef.current?.listGroups();
      setGroupsModal(list ?? []);
    } catch (e) {
      alert(`加载群列表失败：${(e as Error).message}`);
    }
  };

  // 加载详情页签数据源（本地历史消息，供 媒体/文件/链接 页签过滤）。
  const loadDetailMsgs = (cid: string) => {
    void loadConversation(uid, cid).then(setDetailMsgs).catch(() => setDetailMsgs([]));
  };

  // 打开群聊详情面板（拉最新资料 + 本地消息）。默认页签=成员（对齐 iOS 群聊成员恒第一）。
  const openGroupPanel = (cid: string) => {
    setManageOpen(false); setDetailMore(false); setDetailTab("members");
    setDetail({ convId: cid, isGroup: true });
    setDetailMsgs([]); loadDetailMsgs(cid);
    void refreshGroupInfo(cid);
  };

  // 打开单聊详情面板（对方资料）。默认页签=媒体。
  const openPeerDetail = (peer: string) => {
    if (!peer || peer === uid) return;
    const cid = convIdFor(uid, peer);
    setManageOpen(false); setDetailMore(false); setDetailTab("media");
    setDetail({ convId: cid, isGroup: false, peer });
    setDetailMsgs([]); loadDetailMsgs(cid);
  };

  // 清空聊天记录（仅本机，对齐 iOS）：清 IndexedDB → 通知聊天区刷新 → 关面板。
  const doClearHistory = (cid: string) => {
    if (!window.confirm("清空聊天记录？将删除此会话在本机的全部消息，且无法恢复。")) return;
    void (async () => {
      await clearMessages(uid, cid);
      setMsgsByConv((prev) => ({ ...prev, [cid]: [] })); // 内存同步清空（当前会话/缓存）
      setDetailMsgs([]);
      setToast("聊天记录已清空");
    })();
  };

  // 解散群（仅群主，二次确认）。
  const doDissolveGroup = (cid: string) => {
    if (!window.confirm("删除并解散该群？所有成员将被移出，且不可恢复。")) return;
    void (async () => {
      try {
        await clientRef.current!.dissolveGroup(cid);
        setDetail(null);
        setGroupInfos((prev) => { const { [cid]: _drop, ...rest } = prev; return rest; });
        if (currentConvRef.current === cid) deselect();
        void refreshConversations();
      } catch (e) { alert(`解散失败：${(e as Error).message}`); }
    })();
  };

  // 单聊拉黑/取消拉黑（拉黑二次确认）。
  const doToggleBlock = (peer: string, block: boolean) => {
    if (block && !window.confirm("拉黑该联系人？拉黑后将不再收到对方消息。")) return;
    void (async () => {
      try {
        await clientRef.current!.friendAction(block ? "block" : "unblock", peer);
        void refreshFriends();
        setToast(block ? "已拉黑" : "已取消拉黑");
      } catch (e) { alert(`操作失败：${(e as Error).message}`); }
    })();
  };

  // 建群：校验 → POST → 进入新群会话。
  const doCreateGroup = async () => {
    if (!createDraft) return;
    const name = createDraft.name.trim();
    if (!name) { setToast("请输入群名"); return; }
    if (createDraft.selected.length === 0) { setToast("请至少选择一位好友"); return; }
    setCreateBusy(true);
    try {
      const info = await clientRef.current!.createGroup(name, createDraft.selected);
      setGroupInfos((prev) => ({ ...prev, [info.conv_id]: info }));
      setCreateDraft(null);
      setGroupsModal(null);
      setTab("chats");
      await refreshConversations();
      openGroupChat(info.conv_id);
    } catch (e) {
      alert(`建群失败：${(e as Error).message}`);
    } finally {
      setCreateBusy(false);
    }
  };

  // 退出群聊（群主会被服务端拦：需先转让）。
  const doLeaveGroup = async (cid: string) => {
    if (!window.confirm("确定退出该群聊？")) return;
    try {
      await clientRef.current!.leaveGroup(cid);
      setDetail(null);
      setGroupInfos((prev) => { const { [cid]: _drop, ...rest } = prev; return rest; });
      if (currentConvRef.current === cid) deselect();
      void refreshConversations();
    } catch (e) {
      alert(`退出失败：${(e as Error).message}`);
    }
  };

  // 改群名（群主/管理员）：轻量 prompt，回车确定。
  const doRenameGroup = async (gp: GroupInfo) => {
    const name = window.prompt("群名（1~30 字）", gp.name);
    if (name === null || !name.trim() || name.trim() === gp.name) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, name.trim(), gp.avatar_url));
  };

  // 设置群头像（仅群主/管理员）：选图片 → 上传 → updateGroup 带新 URL。
  const pickGroupAvatar = (gp: GroupInfo) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          setToast("上传中…");
          const { url } = await clientRef.current!.uploadFile(file);
          await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, gp.name, url));
          setToast("群头像已更新");
        } catch (e) { alert(`设置群头像失败：${(e as Error).message}`); }
      })();
    };
    input.click();
  };

  // 邀请成员：提交选中的好友。
  const doInvite = async () => {
    if (!inviteDraft || inviteDraft.selected.length === 0) { setToast("请选择要邀请的好友"); return; }
    const { convId: cid, selected } = inviteDraft;
    try {
      await clientRef.current!.inviteToGroup(cid, selected);
      setInviteDraft(null);
      void refreshGroupInfo(cid);
      void refreshConversations();
    } catch (e) {
      alert(`邀请失败：${(e as Error).message}`);
    }
  };

  // 成员行是否显示 ⋯ 管理菜单：不能管自己；owner 管所有人，admin 只管普通成员。
  const canManageMember = (gp: GroupInfo, m: GroupMember): boolean =>
    m.user_id !== uid && (gp.my_role === "owner" || (gp.my_role === "admin" && m.role === "member"));

  // 保存好友备注名：写后端 → 刷新会话列表/好友列表（两处显示名随之更新）→ 关弹窗。
  // 注意：本函数在 login early-return 之后，绝不能用 Hook（useCallback）——否则违反 Hooks 规则导致崩溃。
  const saveRemark = async () => {
    if (!contactDraft) return;
    try {
      await clientRef.current?.setRemark(contactDraft.peer, contactDraft.remark.trim());
      setContactDraft(null);
      void refreshConversations();
      void refreshFriends();
    } catch (e) {
      alert(`保存备注失败：${(e as Error).message}`);
    }
  };
  const openFriendChat = (id: string) => { setTab("chats"); openChat(id); };

  // 通用菜单行：图标可选、右侧值/箭头可选、danger 红色。account card / settings / contacts entries 共用。
  type Row = { id: string; label: string; icon?: LucideIcon; value?: string; danger?: boolean; chevron?: boolean; onClick: () => void };

  // 左上角头像卡片的行（≈ Telegram Web 汉堡菜单；数据驱动：加一项 = append 一条）。
  // 「我的资料」不再单列——资料在设置页顶部展示、经铅笔进入编辑；退出登录移到设置页底部。
  const accountRows: Row[] = [
    { id: "settings", label: "设置", icon: Settings, chevron: true, onClick: () => { setAccountCard(false); setShowSettings(true); } },
    { id: "favorites", label: "收藏消息", icon: Bookmark, chevron: true, onClick: () => { setAccountCard(false); openFavorites(); } },
  ];

  // 设置列表（对齐 Telegram **Web** 版布局；数据驱动：加一行 = append 一条；接后端 = 换 onClick）。
  // Web 版条目与 iOS 版不同——各自镜像对应平台的 Telegram 客户端。
  const settingsGroups: Row[][] = [
    [
      { id: "general", label: "通用设置", icon: Settings2, chevron: true, onClick: () => setGeneralOpen(true) },
      { id: "animations", label: "动画与性能", icon: Gauge, chevron: true, onClick: () => comingSoon("动画与性能") },
      { id: "notifications", label: "通知", icon: Bell, chevron: true, onClick: () => comingSoon("通知") },
      { id: "data", label: "数据与存储", icon: Database, chevron: true, onClick: () => comingSoon("数据与存储") },
      { id: "privacy", label: "隐私与安全", icon: Lock, chevron: true, onClick: () => void openBlacklist() },
      { id: "folders", label: "聊天文件夹", icon: Folder, chevron: true, onClick: () => comingSoon("聊天文件夹") },
      { id: "devices", label: "已登录设备", icon: MonitorSmartphone, chevron: true, onClick: () => comingSoon("已登录设备") },
      { id: "language", label: "语言", icon: Languages, value: "简体中文", chevron: true, onClick: () => comingSoon("语言") },
      { id: "stickers", label: "贴纸与表情", icon: Smile, chevron: true, onClick: () => comingSoon("贴纸与表情") },
    ],
  ];

  // 设置页顶部名片下的资料卡（手机号/用户名）。
  const settingsInfoRows: Row[] = [
    { id: "phone", label: myInfo?.phone || "未设置", icon: Phone, value: "手机号", onClick: () => void openProfile() },
    { id: "username", label: `@${uid}`, icon: AtSign, value: "用户名", onClick: () => void openProfile() },
  ];

  // 通讯录顶部入口行（数据驱动）。
  const contactEntries: Row[] = [
    { id: "groups", label: "群聊", icon: Users, chevron: true, onClick: () => void openGroupsModal() },
    { id: "official", label: "公众号", icon: Megaphone, chevron: true, onClick: () => comingSoon("公众号") },
    { id: "service", label: "服务号", icon: Headphones, chevron: true, onClick: () => comingSoon("服务号") },
  ];

  // 通用行渲染（cls 区分容器样式）。
  const renderRow = (r: Row, cls: string) => (
    <button key={r.id} className={`${cls}${r.danger ? " danger" : ""}`} onClick={r.onClick}>
      {r.icon && <r.icon size={20} className="row-icon" />}
      <span className="row-label">{r.label}</span>
      {r.value && <span className="row-value">{r.value}</span>}
      {r.chevron && <ChevronRight size={18} className="row-chevron" />}
    </button>
  );

  return (
    <div className={`app ${peer || groupConvId ? "has-sel" : "no-sel"}`}>
      <aside className="sidebar">
        <header>
          <div className="account-anchor">
            <button className="account-avatar" title="账号"
              onClick={(e) => { e.stopPropagation(); setAccountCard((v) => !v); }}>
              <Avatar url={myInfo?.avatar_url} label={myInfo?.nickname || uid} cls="account-avatar-inner" />
            </button>
            {accountCard && (
              <div className="menu-card" onClick={(e) => e.stopPropagation()}>
                {accountRows.map((r) => renderRow(r, "menu-card-row"))}
              </div>
            )}
          </div>
          <span className="account-meta">{uid} · {stateText}</span>
        </header>
        <div className="tabs">
          <button className={`tab ${tab === "chats" ? "active" : ""}`} onClick={() => setTab("chats")}>会话</button>
          <button className={`tab ${tab === "contacts" ? "active" : ""}`}
            onClick={() => { setTab("contacts"); void refreshFriends(); }}>
            通讯录{incomingCount > 0 && <span className="tab-badge">{incomingCount > 99 ? "99+" : incomingCount}</span>}
          </button>
        </div>
        {tab === "chats" ? (
        <div className="convlist">
          {conversations.length === 0 && <div className="empty">还没有会话，去「通讯录」找人发起一个吧</div>}
          {conversations.map((c) => (
            <div key={c.conv_id} className={`convitem ${c.conv_id === convId ? "active" : ""} ${c.pinned_at ? "pinned" : ""}`}
              onClick={() => (c.is_group ? openGroupChat(c.conv_id) : openChat(c.peer))}
              onContextMenu={(e) => { e.preventDefault(); setConvMenu({ x: e.clientX, y: e.clientY, c }); }}>
              <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)}>
                {!c.is_group && presence[c.peer] === "online" && <span className="presence-dot" />}
              </Avatar>
              <div className="convbody">
                <div className="convtop">
                  <span className="convpeer">
                    {c.pinned_at ? <Pin size={12} className="conv-pin" /> : null}
                    {convDisplayLabel(c)}
                    {c.muted ? <BellOff size={12} className="conv-mute" /> : null}
                  </span>
                  <span className="convtime">
                    {!c.is_group && c.last_message?.from === uid && (
                      <span className={c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "convck read" : "convck"}>
                        {c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "✓✓ " : "✓ "}
                      </span>
                    )}
                    {c.last_message ? formatTime(c.last_message.timestamp, timeFormat) : ""}
                  </span>
                </div>
                <div className="convlast">{convPreview(c)}</div>
              </div>
              {c.unread > 0
                ? <span className={`badge ${c.muted ? "muted" : ""}`}>{c.unread > 99 ? "99+" : c.unread}</span>
                : c.marked_unread ? <span className={`badge dot ${c.muted ? "muted" : ""}`} aria-label="未读" /> : null}
            </div>
          ))}
        </div>
        ) : (
        <div className="contacts">
          <div className="newchat">
            <input value={searchQ} placeholder="对方完整 uid 或手机号"
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }} />
            <button onClick={() => void doSearch()}>搜索</button>
          </div>
          <div className="contact-entries">
            {contactEntries.map((r) => renderRow(r, "entry-row"))}
          </div>
          <div className="convlist">
            {searchResults !== null && (
              <>
                <div className="section-label">搜索结果</div>
                {searchResults.length === 0 && <div className="empty">没有找到匹配的用户</div>}
                {searchResults.map((u) => {
                  const st = friendStatus.get(u.user_id);
                  return (
                    <div key={`s-${u.user_id}`} className="convitem static">
                      <Avatar url={u.avatar_url} label={labelOf(u.user_id, u.nickname)} />
                      <div className="convbody">
                        <div className="convpeer">{labelOf(u.user_id, u.nickname)}</div>
                        <div className="convlast">{u.user_id}{u.tags.length > 0 ? ` · ${u.tags.join(" ")}` : ""}</div>
                      </div>
                      <div className="row-actions">
                        {st === "accepted" ? (
                          <button className="mini-btn" onClick={() => openFriendChat(u.user_id)}>发消息</button>
                        ) : st === "requested" ? (
                          <button className="mini-btn ghost" disabled>已申请</button>
                        ) : st === "pending" ? (
                          <button className="mini-btn" disabled={busyUser === u.user_id}
                            onClick={() => void doFriendAction(u.user_id, () => clientRef.current!.friendAction("accept", u.user_id))}>同意</button>
                        ) : st === "blocked" ? (
                          <button className="mini-btn ghost" disabled>已拉黑</button>
                        ) : (
                          <button className="mini-btn" disabled={busyUser === u.user_id}
                            onClick={() => void doFriendAction(u.user_id, () => clientRef.current!.friendAction("request", u.user_id))}>加好友</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {incoming.length > 0 && (
              <>
                <div className="section-label">新的朋友（{incoming.length}）</div>
                {incoming.map((f) => (
                  <div key={`p-${f.user_id}`} className="convitem static">
                    <Avatar url={f.avatar_url} label={labelOf(f.user_id, f.nickname)} />
                    <div className="convbody">
                      <div className="convpeer">{labelOf(f.user_id, f.nickname)}</div>
                      <div className="convlast">请求加你为好友</div>
                    </div>
                    <div className="row-actions">
                      <button className="mini-btn" disabled={busyUser === f.user_id}
                        onClick={() => void doFriendAction(f.user_id, () => clientRef.current!.friendAction("accept", f.user_id))}>同意</button>
                      <button className="mini-btn ghost" disabled={busyUser === f.user_id}
                        onClick={() => void doFriendAction(f.user_id, () => clientRef.current!.friendAction("reject", f.user_id))}>拒绝</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="section-label">好友（{accepted.length}）</div>
            {accepted.length === 0 && <div className="empty">还没有好友，上面搜索用户添加吧</div>}
            {accepted.map((f) => (
              <div key={`f-${f.user_id}`} className="convitem" onClick={() => openFriendChat(f.user_id)}>
                <Avatar url={f.avatar_url} label={friendLabel(f)}>
                  {presence[f.user_id] === "online" && <span className="presence-dot" />}
                </Avatar>
                <div className="convbody">
                  <div className="convpeer">{friendLabel(f)}{f.blocked && <span className="tag-blocked">已拉黑</span>}</div>
                  <div className="convlast">{f.user_id}</div>
                </div>
                <div className="row-actions">
                  <button className="mini-btn ghost" title="更多"
                    onClick={(e) => { e.stopPropagation(); setFriendMenu({ x: e.clientX, y: e.clientY, userId: f.user_id }); }}>⋯</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* 设置面板：占据侧栏列（绝对定位），右侧聊天 .main 保持不动、可继续聊（对齐 Telegram Web）。 */}
        {showSettings && (
          <div className="settings-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setShowSettings(false)}><ChevronLeft size={24} /></button>
              <span className="settings-title">设置</span>
              <button className="icon-btn" title="编辑资料" onClick={() => void openProfile()}><SquarePen size={20} /></button>
            </header>
            <div className="settings-body">
              <div className="settings-profile">
                <Avatar url={myInfo?.avatar_url} label={myInfo?.nickname || uid} cls="settings-avatar" />
                <div className="settings-name">{myInfo?.nickname || uid}</div>
                <div className="settings-status">{stateText}</div>
              </div>
              <div className="settings-group">
                {settingsInfoRows.map((r) => renderRow(r, "settings-row info"))}
              </div>
              {settingsGroups.map((group, gi) => (
                <div key={gi} className="settings-group">
                  {group.map((r) => renderRow(r, "settings-row"))}
                </div>
              ))}
              <button className="settings-logout" onClick={logout}>退出登录</button>
            </div>
          </div>
        )}

        {/* 编辑资料面板：经设置页铅笔进入，叠在设置面板之上（对齐 Telegram Web「Edit profile」）。 */}
        {profileDraft && (
          <div className="settings-panel edit-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setProfileDraft(null)}><ChevronLeft size={24} /></button>
              <span className="settings-title">编辑资料</span>
              <button className="icon-btn save" title="保存" disabled={profileBusy} onClick={() => void saveProfile()}><Check size={22} /></button>
            </header>
            <div className="settings-body">
              {/* 点头像 → 选本机图片（隐藏的 file input，浏览器自动用系统原生文件框，跨平台无需检测系统）。 */}
              <button className="edit-avatar" title="更换头像" onClick={() => avatarFileRef.current?.click()}>
                <Avatar url={profileDraft.avatar_url} label={profileDraft.nickname || uid} cls="edit-avatar-inner" />
                <span className="edit-cam"><SquarePen size={15} /></span>
              </button>
              <input ref={avatarFileRef} type="file" accept="image/*" hidden
                onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="settings-group edit-fields">
                <label className="edit-field"><span>昵称</span>
                  <input value={profileDraft.nickname} maxLength={32}
                    onChange={(e) => setProfileDraft({ ...profileDraft, nickname: e.target.value })} /></label>
                <label className="edit-field"><span>手机号</span>
                  <input value={profileDraft.phone}
                    onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} /></label>
                <label className="edit-field"><span>标签</span>
                  <input value={profileDraft.tags} placeholder="空格或逗号分隔"
                    onChange={(e) => setProfileDraft({ ...profileDraft, tags: e.target.value })} /></label>
              </div>
            </div>
          </div>
        )}

        {/* 通用设置子面板：设置 ▸ 通用设置进入，叠在设置之上。主题已接通真功能，其余先 UI。 */}
        {generalOpen && (
          <div className="settings-panel general-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setGeneralOpen(false)}><ChevronLeft size={24} /></button>
              <span className="settings-title">通用设置</span>
              <span className="icon-btn-spacer" />
            </header>
            <div className="settings-body">
              <div className="section-label">设置</div>
              <div className="settings-group">
                <div className="range-row">
                  <div className="range-top"><span className="row-label">消息字体大小</span><span className="row-value">{fontSize}</span></div>
                  <input type="range" min={12} max={24} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
                </div>
                <button className="settings-row" onClick={() => setWallpaperOpen(true)}>
                  <ImageIcon size={20} className="row-icon" /><span className="row-label">聊天壁纸</span><ChevronRight size={18} className="row-chevron" />
                </button>
              </div>

              <div className="section-label">主题</div>
              <div className="settings-group">
                {([{ v: "light", t: "浅色" }, { v: "dark", t: "深色" }, { v: "system", t: "跟随系统" }] as const).map((o) => (
                  <button key={o.v} className="radio-row" onClick={() => setTheme(o.v)}>
                    <span className={`radio-dot${theme === o.v ? " on" : ""}`} /><span className="row-label">{o.t}</span>
                  </button>
                ))}
              </div>

              <div className="section-label">时间格式</div>
              <div className="settings-group">
                {([{ v: "12", t: "12 小时制" }, { v: "24", t: "24 小时制" }] as const).map((o) => (
                  <button key={o.v} className="radio-row" onClick={() => setTimeFormat(o.v)}>
                    <span className={`radio-dot${timeFormat === o.v ? " on" : ""}`} /><span className="row-label">{o.t}</span>
                  </button>
                ))}
              </div>

              <div className="section-label">键盘</div>
              <div className="settings-group">
                {([{ v: "enter", t: "按 Enter 发送", s: "Shift + Enter 换行" }, { v: "cmd", t: "按 Cmd + Enter 发送", s: "Enter 换行" }] as const).map((o) => (
                  <button key={o.v} className="radio-row" onClick={() => setSendKey(o.v)}>
                    <span className={`radio-dot${sendKey === o.v ? " on" : ""}`} />
                    <span className="radio-text"><span className="row-label">{o.t}</span><span className="row-sub">{o.s}</span></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {wallpaperOpen && (
          <div className="settings-panel wallpaper-panel">
            <header className="settings-head wallpaper-head">
              <button className="icon-btn" title="返回" onClick={() => setWallpaperOpen(false)}><ChevronLeft size={24} /></button>
              <span className="settings-title">聊天壁纸</span>
              <span className="icon-btn-spacer" />
            </header>
            <div className="settings-body wallpaper-body">
              <div className="wallpaper-actions">
                <button className="wallpaper-action" onClick={() => wallpaperFileRef.current?.click()}>
                  <Camera size={24} /><span>上传图片</span>
                </button>
                <button className="wallpaper-action" onClick={openWallpaperColor}>
                  <Pipette size={24} /><span>设置颜色</span>
                </button>
                <button className="wallpaper-action" onClick={resetWallpaper}>
                  <Star size={24} /><span>恢复默认</span>
                </button>
                <button className="wallpaper-action" onClick={() => setWallpaperBlur((value) => !value)}>
                  <span className={`wallpaper-check${wallpaperBlur ? " on" : ""}`}>{wallpaperBlur && <Check size={17} />}</span>
                  <span>模糊</span>
                </button>
              </div>
              <input ref={wallpaperFileRef} type="file" accept="image/*" hidden
                onChange={(event) => {
                  pickWallpaperImage(event.target.files?.[0]);
                  event.target.value = "";
                }} />
              <div className="wallpaper-grid">
                {WALLPAPER_PRESETS.map((item) => {
                  const selected = wallpaper.kind === "preset" && wallpaper.value === item.id;
                  return (
                    <button key={item.id} className={`wallpaper-tile${selected ? " selected" : ""}`}
                      title={item.label} aria-label={`使用${item.label}壁纸`}
                      style={{ background: item.css } as CSSProperties}
                      onClick={() => setWallpaper({ kind: "preset", value: item.id })}>
                      {selected && <span className="wallpaper-selected"><Check size={18} /></span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {wallpaperColorOpen && (
          <div className="settings-panel wallpaper-color-panel">
            <header className="settings-head wallpaper-head">
              <button className="icon-btn" title="返回" onClick={() => setWallpaperColorOpen(false)}><ChevronLeft size={24} /></button>
              <span className="settings-title">设置颜色</span>
              <span className="icon-btn-spacer" />
            </header>
            <div className="settings-body wallpaper-color-body">
              <div className="color-editor-card" style={{ "--picker-hue": `${colorHSV.h}` } as CSSProperties}>
                <div className="color-spectrum"
                  role="slider" aria-label="调整颜色饱和度和亮度" aria-valuenow={Math.round(colorHSV.v)}
                  onPointerDown={updateColorFromSpectrum}
                  onPointerMove={(event) => { if (event.buttons === 1) updateColorFromSpectrum(event); }}>
                  <span className="color-cursor"
                    style={{ left: `${colorHSV.s}%`, top: `${100 - colorHSV.v}%` }} />
                </div>
                <input className="hue-slider" type="range" min="0" max="360" value={colorHSV.h}
                  aria-label="调整色相"
                  onChange={(event) => applyWallpaperColor({ ...colorHSV, h: Number(event.target.value) })} />
                <div className="color-values">
                  <label>
                    <span>HEX</span>
                    <input value={hsvToHex(colorHSV)} readOnly />
                  </label>
                  <label>
                    <span>RGB</span>
                    <input value={hexToRGB(hsvToHex(colorHSV))} readOnly />
                  </label>
                </div>
              </div>
              <div className="color-preset-grid">
                {COLOR_PRESETS.map((color) => {
                  const selected = hsvToHex(colorHSV).toLowerCase() === color;
                  return (
                    <button key={color} className={`color-preset${selected ? " selected" : ""}`}
                      title={color} aria-label={`使用颜色 ${color}`}
                      style={{ background: color }}
                      onClick={() => applyWallpaperColor(hexToHSV(color))}>
                      {selected && <Check size={20} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* chat 面板始终挂载（即使未选会话），让 VList 在 app 加载时就测到稳定高度；
          未选会话时用 .main-empty 覆盖层遮住。否则条件挂载会让 virtua 在布局未定时测到 0。 */}
      <main className="main">
        <div className="chat">
          <header>
            {(peer || isGroupChat) && <button className="link back-btn" onClick={deselect}>‹ 会话</button>}
            {(isGroupChat || peer) ? (
              <button className="chat-identity"
                title={isGroupChat ? "查看群资料" : "查看资料"}
                onClick={() => isGroupChat ? openGroupPanel(groupConvId) : openPeerDetail(peer)}>
                <Avatar url={chatAvatarURL} label={chatTitle} cls="chat-avatar" />
                <span className="chat-identity-copy">
                  <span className="chat-title">{chatTitle}</span>
                  <span className="chat-subtitle">{chatSubtitle}</span>
                </span>
              </button>
            ) : (
              <span className="muted">未选择会话</span>
            )}
            <span className="chat-head-right">
              {(peer || isGroupChat) && (
                <>
                  <button className="icon-btn" title="搜索" onClick={() => comingSoon("聊天内搜索")}><Search size={20} /></button>
                  {!isGroupChat && <button className="icon-btn" title="呼叫" onClick={() => comingSoon("语音通话")}><Phone size={20} /></button>}
                  <span className="chat-anchor">
                    <button className="icon-btn" title="更多" onClick={(e) => { e.stopPropagation(); setChatMenu((v) => !v); }}><MoreVertical size={20} /></button>
                  {chatMenu && (
                    <div className="menu-card chat-menu" onClick={(e) => e.stopPropagation()}>
                      {(isGroupChat ? [
                        { id: "info", label: "群资料", icon: Info, run: () => openGroupPanel(groupConvId) },
                        { id: "invite", label: "邀请成员", icon: UserPlus, run: () => setInviteDraft({ convId: groupConvId, selected: [] }) },
                        { id: "mute", label: groupConv?.muted ? "取消免打扰" : "免打扰", icon: BellOff, run: () => { if (groupConv) setConvMuted(groupConv, !groupConv.muted); } },
                        { id: "leave", label: "退出群聊", icon: LogOut, danger: true, run: () => void doLeaveGroup(groupConvId) },
                      ] : [
                        { id: "edit", label: "编辑联系人", icon: SquarePen, run: () => setContactDraft({ peer, remark: peerConv?.peer_remark ?? "" }) },
                        { id: "call", label: "视频通话", icon: Video, run: () => comingSoon("视频通话") },
                        { id: "mute", label: peerConv?.muted ? "取消免打扰" : "免打扰", icon: BellOff, run: () => { if (peerConv) setConvMuted(peerConv, !peerConv.muted); } },
                        { id: "select", label: "选择消息", icon: CheckSquare, run: () => comingSoon("选择消息") },
                        { id: "block", label: "屏蔽用户", icon: Ban, run: () => comingSoon("屏蔽用户") },
                        { id: "del", label: "删除会话", icon: Trash2, danger: true, run: () => { if (peerConv) deleteConv(peerConv); } },
                      ]).map((r) => (
                        <button key={r.id} className={`menu-card-row${"danger" in r && r.danger ? " danger" : ""}`}
                          onClick={() => { setChatMenu(false); r.run(); }}>
                          <r.icon size={18} className="row-icon" /><span className="row-label">{r.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  </span>
                </>
              )}
            </span>
          </header>
          <div className="msgs" ref={msgsRef} onScroll={onMsgsScroll}>
            {messages.map((m, i) => {
              const mine = m.from === uid;
              const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
              const showDate = m.timestamp > 0 && (i === 0 || !isSameDay(m.timestamp, messages[i - 1].timestamp));
              // Telegram 式连续消息分组（群聊对方）：连续同发送者只首条显名、末条显头像；非首条收紧上间距。
              const grpThem = isGroupChat && !mine;
              const showSender = grpThem && !sameSenderRun(prevVisibleMsg(messages, i), m);
              const showAvatar = grpThem && !sameSenderRun(m, nextVisibleMsg(messages, i));
              const grouped = grpThem && sameSenderRun(prevVisibleMsg(messages, i), m);
              // 系统消息（群邀请/移除/转让/禁言等留痕）：居中灰字，无气泡/勾/菜单。
              if (m.contentType === "system") {
                return (
                  <div className="msg-item" data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                    {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                    {i === firstUnreadIdx && (
                      <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                    )}
                    <div className="sys-line"><span>{m.content}</span></div>
                  </div>
                );
              }
              // 撤回消息（M4-1）：居中系统行"撤回了一条消息"，隐藏原气泡；本人文本可"重新编辑"回填输入框。
              if (m.recalledAt) {
                const canReEdit = mine && m.contentType === "text" && !!m.content;
                return (
                  <div className="msg-item" data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                    {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                    {i === firstUnreadIdx && (
                      <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                    )}
                    <div className="sys-line">
                      <span>{mine ? "你撤回了一条消息" : `${isGroupChat ? senderLabel(m) : "对方"}撤回了一条消息`}</span>
                      {canReEdit && (
                        <button className="reedit-btn" onClick={() => setInput(m.content)}>重新编辑</button>
                      )}
                    </div>
                  </div>
                );
              }
              // 相册宫格（M4+）：同 group_id 聚簇——主行渲染整个宫格，从行跳过；多选态展开为独立行（逐条可勾选）。
              if (!selectMode && isAlbumMember(m)) {
                if (!isAlbumLeader(messages, i)) return null;
                const members = albumMembers(messages, m.groupId!);
                const last = members[members.length - 1];
                const grid = (
                  <AlbumGrid members={members}
                    timeLabel={last?.timestamp ? formatTime(last.timestamp, timeFormat) : ""}
                    progress={uploadProgress}
                    onOpen={(mm) => onMediaBubbleTap(mm, () => setViewer({ m: mm }))}
                    onMenu={(e, mm) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m: mm }); }} />
                );
                return (
                  <div className={`msg-item${grouped ? " grouped" : ""}`} data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                    {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                    {i === firstUnreadIdx && (
                      <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                    )}
                    <div className={`row ${mine ? "me" : "them"}`}>
                      {grpThem ? (
                        <div className="them-wrap">
                          <div className="avatar-col">
                            {showAvatar && <Avatar cls="avatar bubble-avatar" url={senderAvatar(m)} label={senderLabel(m)} onClick={() => openPeerDetail(m.from)} />}
                          </div>
                          <div className="them-stack">
                            {showSender && <span className="sender-name">{senderLabel(m)}</span>}
                            {grid}
                          </div>
                        </div>
                      ) : grid}
                    </div>
                  </div>
                );
              }
              // 媒体气泡：时间/已读压在图上（右下角），故不再渲染气泡下方的 .bmeta 行。
              const isMediaBubble = m.contentType === "image" || m.contentType === "video";
              const uploading = uploadProgress[m.clientMsgId ?? ""];
              // 暂停态唯一真相=分片任务（toggleUploadPause bump 进度对象触发重渲染）；小文件无任务恒 false。
              const uploadPaused = !!chunkedTaskFor(m.clientMsgId ?? "")?.paused;
              const durationText = m.contentType === "video" ? formatMediaDuration(m.duration) : "";
              const bubbleBlock = (
                <>
                  <div className="bubble-line">
                    {mine && m.status === "failed" && (
                      <span className="fail-badge" title={m.note || "发送失败"}>!</span>
                    )}
                    <div className={`bubble${isMediaBubble ? " media" : ""}`}
                      onContextMenu={(e) => { if (selectMode) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }}>
                      {m.forwardFrom ? <span className="forward-from">转发自 {m.forwardFrom}</span> : null}
                      {m.replyToConvSeq ? (
                        // 引用条：媒体内嵌小缩略图；群聊两行式——被引用者昵称（accent）+ 内容预览（M4-x，单聊不显示发送者）。
                        <div className="quote-bar" onClick={() => jumpToSeq(m.replyToConvSeq!)}>
                          <QuoteThumb m={messages.find((x) => x.convSeq === m.replyToConvSeq)} />
                          <span className="quote-lines">
                            {isGroupChat && m.replyToFrom && (
                              <span className="quote-who">{m.replyToFrom === uid ? "你" : (memberNick(m.convId, m.replyToFrom) || m.replyToFrom)}</span>
                            )}
                            <span className="quote-text">{localizeSnippet(m.replySnapshot || "") || "原消息"}</span>
                          </span>
                        </div>
                      ) : null}
                      {isMediaBubble ? (
                        // 图片/视频：按 media_w/media_h 的原始比例定框（未知回退方块），
                        // 左上角时长或上传进度、右下角时间+已读态、视频居中播放角标——与 iOS 同版式。
                        // 点按走状态机（与 iOS 中心按钮一致）：失败 ↻ 重试 / 上传中 ⏸↔↑ / 其余打开查看器。
                        <span {...mediaBoxProps(m)} onClick={() => onMediaBubbleTap(m, () => setViewer({ m }))}>
                          {m.contentType === "video"
                            ? (m.posterUrl
                                ? <img className="msg-image" src={m.posterUrl} alt="视频" onLoad={onMediaLoad} />
                                : <video className="msg-image" src={videoFrameSrc(m.content)} preload="metadata" muted onLoadedData={onMediaLoad} />)
                            : <img className="msg-image" src={m.content} alt="图片" onLoad={onMediaLoad} />}
                          {uploading
                            ? (chunkedTaskFor(m.clientMsgId ?? "") && <span className="play-badge">{uploadPaused ? "↑" : "⏸"}</span>)
                            : (mine && m.status === "failed" && m.convSeq === 0 && pendingFilesRef.current.has(m.clientMsgId ?? ""))
                              ? <span className="play-badge">↻</span>
                              : m.contentType === "video" && <span className="play-badge">▶</span>}
                          {uploading
                            ? <span className="media-badge media-badge-tl">{uploadPaused ? "⏸ " : ""}{formatUploadProgress(uploading.sent, uploading.total)}</span>
                            : (durationText && <span className="media-badge media-badge-tl">{durationText}</span>)}
                          <span className="media-badge media-badge-br">
                            {mine
                              // 只有真正在传输才显「发送中…」；暂停时回落显示时间（与 iOS 一致）。
                              ? (m.status === "sending" ? (uploadPaused ? formatTime(m.timestamp, timeFormat) : "发送中…")
                                // 被拒收（有 note）时失败已由红❗+下方系统行表达，角标只显时间，不重复报错（与 iOS 一致）。
                                : m.status === "failed" ? (m.note ? formatTime(m.timestamp, timeFormat) : "未发送 ✗")
                                : <>{formatTime(m.timestamp, timeFormat)}<span className={readByPeer ? "ck read" : "ck"}>{readByPeer ? " ✓✓" : " ✓"}</span></>)
                              : formatTime(m.timestamp, timeFormat)}
                          </span>
                        </span>
                      ) : m.contentType === "chat_record" ? (
                        // 合并转发卡片（镜像 iOS）：标题 + 前几条预览 + 脚注，点击进详情。
                        (() => { const r = parseChatRecord(m.content); return (
                          <div className="record-card" onClick={() => setRecordView(r)}>
                            <div className="record-title">{r.t}</div>
                            <div className="record-preview">{r.items.slice(0, 4).map((it, i) => (
                              <div key={i} className="record-line">{it.n}: {recordItemPreview(it)}</div>
                            ))}</div>
                            <div className="record-foot">聊天记录</div>
                          </div>
                        ); })()
                      ) : m.contentType === "file" ? (
                        // 上传中（content 还没有 URL）不渲染成可点下载的 <a>，改显进度条 + 已传/总大小。
                        uploading || !m.content ? (
                          <span className={`msg-file${m.status === "failed" ? " failed" : ""}`}
                                onClick={m.status === "failed" ? () => retryUpload(m)
                                       : uploading ? () => toggleUploadPause(m) : undefined}>
                            <FileTypeIcon name={m.fileName || ""} size={30} />
                            <span className="msg-file-body">
                              <span className="msg-file-name">{m.fileName || "文件"}</span>
                              <span className="msg-file-size">
                                {m.status === "failed"
                                  ? `${formatFileSize(m.fileSize)} · 上传失败，点击重试`
                                  : uploading
                                    ? `${formatUploadProgress(uploading.sent, uploading.total)}${
                                        chunkedTaskFor(m.clientMsgId ?? "") ? (uploadPaused ? " · 已暂停，点击继续" : " · 点击暂停") : ""}`
                                    : formatFileSize(m.fileSize)}
                              </span>
                              {/* 失败态不显进度条：0% 的空条会让人以为"还没开始传"。 */}
                              {m.status !== "failed" && (
                                <span className="file-progress">
                                  <span className="file-progress-bar"
                                        style={{ width: `${uploading && uploading.total > 0 ? Math.round((uploading.sent / uploading.total) * 100) : 0}%` }} />
                                </span>
                              )}
                            </span>
                          </span>
                        ) : (
                          <a className="msg-file" href={m.content} download={m.fileName} target="_blank" rel="noreferrer">
                            <FileTypeIcon name={m.fileName || fileNameFromContent(m.content)} size={30} />
                            <span className="msg-file-body">
                              <span className="msg-file-name">{m.fileName || fileNameFromContent(m.content)}</span>
                              {formatFileSize(m.fileSize) && <span className="msg-file-size">{formatFileSize(m.fileSize)}</span>}
                            </span>
                          </a>
                        )
                      ) : isUrlText(m.content) ? (
                        // 纯 URL 消息：可点击 URL 文本 + 下方 OG 富预览卡片（引用/普通消息一致）。
                        <LinkCard url={m.content} fetchPreview={fetchLinkPreview} onMediaLoad={onMediaLoad} />
                      ) : (
                        <span className="btext">{m.content}</span>
                      )}
                      {!isMediaBubble && (
                        <span className="bmeta">
                          {m.editedAt ? <span className="edited-tag">已编辑 </span> : null}
                          {mine ? (
                            m.status === "sending" ? "发送中…"
                              : m.status === "failed" ? (m.note ? null : <span className="failed">发送失败 ✗</span>)
                                : <>{formatTime(m.timestamp, timeFormat)}<span className={readByPeer ? "ck read" : "ck"}>{readByPeer ? " ✓✓" : " ✓"}</span></>
                          ) : (
                            formatTime(m.timestamp, timeFormat)
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  {m.convSeq > 0 && translations[m.convSeq] && (
                    <div className="translation"><span>{translations[m.convSeq]}</span></div>
                  )}
                </>
              );
              return (
                <div className={`msg-item${grouped ? " grouped" : ""}`} data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                  {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                  {i === firstUnreadIdx && (
                    <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                  )}
                  <div className={`row ${mine ? "me" : "them"}${selectMode ? " selecting" : ""}`}
                    onClick={!selectMode ? undefined
                      : selectableInMultiSelect(m) ? () => toggleSelected(m.convSeq)
                      // 发送中/失败的本地件：无勾选圈，点按直接提示原因（系统行/撤回墓碑静默）。
                      : m.convSeq <= 0 && m.contentType !== "system" ? () => setToast("发送中/失败的消息不可选择")
                      : undefined}>
                    {selectMode && selectableInMultiSelect(m) && (
                      <span className={`sel-check${selected.has(m.convSeq) ? " on" : ""}`}>{selected.has(m.convSeq) ? "✓" : ""}</span>
                    )}
                    {grpThem ? (
                      // 群聊对方：左侧头像列（连续段末条显头像）+ 昵称（连续段首条）在气泡上方。
                      <div className="them-wrap">
                        <div className="avatar-col">
                          {showAvatar && <Avatar cls="avatar bubble-avatar" url={senderAvatar(m)} label={senderLabel(m)} onClick={() => openPeerDetail(m.from)} />}
                        </div>
                        <div className="them-stack">
                          {showSender && <span className="sender-name">{senderLabel(m)}</span>}
                          {bubbleBlock}
                        </div>
                      </div>
                    ) : bubbleBlock}
                  </div>
                  {mine && m.status === "failed" && m.note && (
                    <div className="sys-note"><span>{m.note}</span></div>
                  )}
                </div>
              );
            })}
          </div>
          {showJump && convId && (
            <button className="jump-btn" onClick={jumpToBottom} title="跳到最新消息">
              ↓{jumpCount > 0 && <span className="jump-badge">{jumpCount > 99 ? "99+" : jumpCount}</span>}
            </button>
          )}
          {convId && typingConv === convId && (
            <div className="typing">
              {isGroupChat ? `${memberNick(convId, typingFrom) || typingFrom} 正在输入…` : "对方正在输入…"}
            </div>
          )}
          {peerBlocked && peer && (
            // 微信式单向：拉黑者仍可发、对方能收到；这里只给一条非阻断提示 + 解除入口，不禁用输入。
            <div className="block-hint">已将对方加入黑名单（TA 发来的消息会被拒收）<button className="link-inline" onClick={() => void unblock(peer)}>解除拉黑</button></div>
          )}
          {editingMsg && (
            // 编辑态条（M4-5）：输入框上方显示"编辑消息" + 取消（恢复普通发送）。
            <div className="reply-compose">
              <div className="reply-compose-text">
                <span className="reply-who">编辑消息</span>
                <span className="reply-snippet">{(editingMsg.content || "").slice(0, 80)}</span>
              </div>
              <button className="reply-cancel" onClick={() => { setEditingMsg(null); setInput(""); }} title="取消编辑">✕</button>
            </div>
          )}
          {replyTo && (
            // 引用回复条（M4-2）：输入框上方显示被引用消息预览 + 取消；图片/视频显示小缩略图。
            <div className="reply-compose">
              <QuoteThumb m={replyTo} />
              <div className="reply-compose-text">
                <span className="reply-who">回复 {replyTo.from === uid ? "自己" : (isGroupChat ? senderLabel(replyTo) : peerLabel)}</span>
                <span className="reply-snippet">{replyPreviewOf(replyTo)}</span>
              </div>
              <button className="reply-cancel" onClick={() => setReplyTo(null)} title="取消引用">✕</button>
            </div>
          )}
          {selectMode ? (
            // 多选态工具栏（M4-3）：批量 转发/删除，替换输入区。
            <footer className="select-bar">
              <button className="link-inline" onClick={exitSelectMode}>取消</button>
              <span className="select-count">已选 {selected.size}</span>
              <button disabled={selected.size === 0} onClick={forwardSelected}>转发</button>
              <button className="danger" disabled={selected.size === 0} onClick={deleteSelected}>删除</button>
            </footer>
          ) : (
            <>
              {pastedImages.length > 0 && (
                // 粘贴预览条（Web #2）：图片显缩略图、文件显类型图标+文件名；逐个 ✕ 移除，点发送统一发出。
                <div className="paste-preview">
                  {pastedImages.map((pi, i) => (
                    pi.kind === "image" ? (
                      <div key={pi.url} className="paste-thumb">
                        <img src={pi.url} alt="待发送图片" />
                        <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                      </div>
                    ) : (
                      <div key={pi.url} className="paste-thumb paste-file">
                        <FileTypeIcon name={pi.file.name} size={26} />
                        <span className="paste-file-name" title={pi.file.name}>{pi.file.name}</span>
                        <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                      </div>
                    )
                  ))}
                </div>
              )}
              <footer>
                <div className="attach-anchor" ref={attachAnchorRef}
                  onMouseEnter={() => { cancelAttachClose(); if (convId) setAttachPanel(true); }}
                  onMouseLeave={scheduleAttachClose}>
                  <button className="attach-btn" disabled={!convId} title="附件"
                    aria-expanded={attachPanel && !!convId}
                    onClick={() => setAttachPanel(true)}>＋</button>
                  {attachPanel && convId && (
                    // 毛玻璃气泡菜单：悬停或点击加号均打开，功能仍由数据数组驱动。
                    <div className="attach-popover" role="menu"
                      onMouseEnter={cancelAttachClose} onMouseLeave={scheduleAttachClose}>
                      {attachItems.map((it) => (
                        <button key={it.id} className="attach-item" role="menuitem" onClick={() => pickFile(it.id as AttachmentPickMode, it.accept)}>
                          <it.icon size={24} aria-hidden="true" />
                          <span>{it.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFilePicked} />
                <textarea ref={composerRef} value={input} rows={1} disabled={!convId}
                  placeholder={convId ? (sendKey === "cmd" ? "输入消息，Cmd+Enter 发送…" : "输入消息，回车发送…") : "先选择左侧的会话…"}
                  onChange={(e) => onInputChange(e.target.value)}
                  onPaste={onComposerPaste}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // 中文输入法组词中不触发
                    // enter 模式：Enter 发送、Shift+Enter 换行；cmd 模式：Cmd/Ctrl+Enter 发送、Enter 换行。
                    const shouldSend = sendKey === "cmd" ? (e.metaKey || e.ctrlKey) : !e.shiftKey;
                    if (shouldSend) { e.preventDefault(); send(); }
                  }} />
                <button onClick={send} disabled={!convId}>发送</button>
              </footer>
            </>
          )}
        </div>
        {!convId && <div className="main-empty">选择左侧的会话开始聊天</div>}
      </main>

      {viewer && (
        // 媒体查看器（镜像 iOS）：图片/视频 + 右下 下载/媒体库/更多（hover 浮层 6 功能）。点击遮罩关闭。
        <div className="modal-mask viewer-mask" onClick={() => { setViewer(null); setViewerMore(false); }}>
          {viewer.m.contentType === "video" ? (
            // 浏览器解不了码（对端发来的 HEVC 等）时 <video> 只会黑屏 → 降级成明确提示 + 下载入口，
            // 而不是让用户对着黑框以为坏了。封面仍能显示（poster 是 JPEG，与视频编码无关）。
            videoUnplayable ? (
              <div className="viewer-unplayable" onClick={(e) => e.stopPropagation()}>
                {viewer.m.posterUrl && <img src={viewer.m.posterUrl} alt="" />}
                <p>当前浏览器不支持该视频的编码格式（如 HEVC）。</p>
                <a className="viewer-unplayable-btn" href={viewer.m.content} download>下载后用本地播放器打开</a>
              </div>
            ) : (
              <video className="image-viewer" src={viewer.m.content} controls
                     onClick={(e) => e.stopPropagation()}
                     onError={() => {
                       logger.warn(LOG_TAG.media, "video_playback_unsupported", {
                         conv_id: viewer.m.convId, conv_seq: viewer.m.convSeq, has_poster: Boolean(viewer.m.posterUrl),
                       });
                       setVideoUnplayable(true);
                     }} />
            )
          ) : (
            <img className="image-viewer" src={viewer.m.content} alt="大图" onClick={(e) => e.stopPropagation()} />
          )}
          <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
            <a className="viewer-btn" href={viewer.m.content} download title="下载"><Download size={18} /></a>
            {!viewer.fromGallery && (
              <button className="viewer-btn" title="媒体库" onClick={() => setGalleryOpen(true)}><LayoutGrid size={18} /></button>
            )}
            <div className="viewer-more-wrap" onMouseEnter={() => setViewerMore(true)} onMouseLeave={() => setViewerMore(false)}>
              <button className="viewer-btn" title="更多"><MoreHorizontal size={18} /></button>
              {viewerMore && (
                <div className="viewer-more-pop">
                  <button onClick={() => { const seq = viewer.m.convSeq; setViewer(null); setGalleryOpen(false); if (seq > 0) jumpToSeq(seq); }}>定位到聊天位置</button>
                  <button onClick={() => favoriteMessage(viewer.m)}>收藏</button>
                  <a href={viewer.m.content} download>下载</a>
                  <button onClick={() => {
                    // 图片：复制图片字节（可粘贴回输入框直接发图）；视频等：复制链接。
                    if (viewer.m.contentType === "image") {
                      copyImageToClipboard(viewer.m.content).then(() => setToast("已复制图片"))
                        .catch(() => { void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast("已复制链接"); });
                    } else {
                      void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast("已复制链接");
                    }
                  }}>复制</button>
                  <button onClick={() => { const mm = viewer.m; setViewer(null); setGalleryOpen(false); setForwarding([mm]); }}>转发</button>
                  <button className="danger" onClick={() => { deleteMessage(viewer.m); setViewer(null); }}>删除</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {galleryOpen && (
        // 会话媒体库：蒙层 + 时间序网格；点击复用查看器（fromGallery=不再显示媒体库按钮）。
        <div className="modal-mask" onClick={() => setGalleryOpen(false)}>
          <div className="gallery-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">图片与视频</div>
            <div className="gallery-grid">
              {messages.filter((mm) => (mm.contentType === "image" || mm.contentType === "video") && !mm.recalledAt).length === 0 && (
                <div className="fwd-empty">暂无图片或视频</div>
              )}
              {messages
                .filter((mm) => (mm.contentType === "image" || mm.contentType === "video") && !mm.recalledAt)
                .map((mm) => (
                  <div key={mm.clientMsgId} className="gallery-item" onClick={() => setViewer({ m: mm, fromGallery: true })}>
                    {mm.contentType === "video"
                      ? <>{mm.posterUrl ? <img src={mm.posterUrl} alt="" /> : <video src={videoFrameSrc(mm.content)} preload="metadata" muted />}<span className="play-badge">▶</span></>
                      : <img src={mm.content} alt="" />}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {favorites && (
        // 收藏列表（M4-4）：内容快照 + 删除；原消息撤回/删除后仍在。
        <div className="modal-mask" onClick={() => setFavorites(null)}>
          <div className="modal fav-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">我的收藏（{favorites.length}）</div>
            <div className="fav-list">
              {favorites.length === 0 && <div className="fwd-empty">还没有收藏</div>}
              {favorites.map((f) => (
                <div key={f.id} className="fav-item">
                  <div className="fav-content">
                    {f.content_type === "image" ? (
                      <img className="fav-thumb" src={f.content} alt="图片" onClick={() => { setFavorites(null); setViewer({ m: { clientMsgId: `fav-${f.id}`, convId: "", from: "", content: f.content, contentType: "image", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }} />
                    ) : f.content_type === "video" ? (
                      <span className="fav-thumb-wrap" onClick={() => { setFavorites(null); setViewer({ m: { clientMsgId: `fav-${f.id}`, convId: "", from: "", content: f.content, contentType: "video", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }}>
                        <video className="fav-thumb" src={videoFrameSrc(f.content)} preload="metadata" muted /><span className="play-badge">▶</span>
                      </span>
                    ) : f.content_type === "file" ? (
                      <a className="msg-file" href={f.content} download={fileNameFromContent(f.content)} target="_blank" rel="noreferrer">
                        <FileTypeIcon name={f.content} size={30} />
                        <span>{fileNameFromContent(f.content)}</span>
                      </a>
                    ) : isUrlText(f.content) ? (
                      <a className="msg-link" href={f.content} target="_blank" rel="noreferrer">{f.content}</a>
                    ) : (
                      f.content
                    )}
                  </div>
                  <button className="fav-del" title="删除收藏" onClick={() => removeFavorite(f.id)}>✕</button>
                </div>
              ))}
            </div>
            <button className="modal-close" onClick={() => setFavorites(null)}>关闭</button>
          </div>
        </div>
      )}

      {forwarding && (
        // 转发会话选择器（M4-3）：从会话列表选目标，逐条转发。
        <div className="modal-mask" onClick={() => setForwarding(null)}>
          <div className="modal fwd-picker" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">转发到（{forwarding.length} 条）</div>
            {forwarding.length > 1 && (
              <div className="fwd-mode">
                <button className={forwardMode === "each" ? "on" : ""} onClick={() => setForwardMode("each")}>逐条转发</button>
                <button className={forwardMode === "merged" ? "on" : ""} onClick={() => setForwardMode("merged")}>合并转发</button>
              </div>
            )}
            <div className="fwd-list">
              {conversations.length === 0 && <div className="fwd-empty">暂无会话</div>}
              {conversations.map((c) => (
                <button key={c.conv_id} className="fwd-item" onClick={() => doForwardTo(c)}>
                  {convDisplayLabel(c)}
                </button>
              ))}
            </div>
            <button className="modal-close" onClick={() => setForwarding(null)}>取消</button>
          </div>
        </div>
      )}

      {recordView && (
        // 合并转发详情（镜像 iOS）：列出全部消息；图片/视频点击进查看器。
        <div className="modal-mask" onClick={() => setRecordView(null)}>
          <div className="modal record-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{recordView.t}</div>
            <div className="record-list">
              {recordView.items.map((it, i) => (
                <div key={i} className="record-item">
                  <div className="record-item-name">{it.n}</div>
                  {it.ct === "image" ? (
                    <img className="record-item-media" src={it.c} alt="图片" onClick={() => { setRecordView(null); setViewer({ m: { clientMsgId: `rec-${i}`, convId: "", from: "", content: it.c, contentType: "image", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }} />
                  ) : it.ct === "video" ? (
                    <span className="fav-thumb-wrap" onClick={() => { setRecordView(null); setViewer({ m: { clientMsgId: `rec-${i}`, convId: "", from: "", content: it.c, contentType: "video", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }}>
                      <video className="record-item-media" src={videoFrameSrc(it.c)} preload="metadata" muted /><span className="play-badge">▶</span>
                    </span>
                  ) : it.ct === "file" ? (
                    <a className="msg-file" href={it.c} download={it.fn || fileNameFromContent(it.c)} target="_blank" rel="noreferrer">
                      <FileTypeIcon name={it.fn || it.c} size={30} />
                      <span>{it.fn || fileNameFromContent(it.c)}</span>
                      {it.fs ? <span className="msg-file-size">{formatFileSize(it.fs)}</span> : null}
                    </a>
                  ) : (
                    <div className="record-item-text">{it.c}</div>
                  )}
                </div>
              ))}
            </div>
            <button className="modal-close" onClick={() => setRecordView(null)}>关闭</button>
          </div>
        </div>
      )}

      {menu && (
        <AnchoredMenu x={menu.x} y={menu.y} className="ctx-menu">
          {messageActions
            .filter((a) => a.visible({ m: menu.m, uid }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => { a.run({ m: menu.m, uid }); setMenu(null); }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </AnchoredMenu>
      )}

      {convMenu && (
        <AnchoredMenu x={convMenu.x} y={convMenu.y} className="ctx-menu">
          {conversationActions
            .filter((a) => a.visible({ c: convMenu.c }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => { a.run({ c: convMenu.c }); setConvMenu(null); }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </AnchoredMenu>
      )}

      {friendMenu && (
        <div className="ctx-menu" style={{ left: friendMenu.x, top: friendMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.removeFriend(id)); }}>删除好友</button>
          {blockedSet.has(friendMenu.userId) ? (
            <button onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void unblock(id); }}>解除拉黑</button>
          ) : (
            <button className="danger" onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.friendAction("block", id)); }}>拉黑</button>
          )}
        </div>
      )}

      {contactDraft && (
        <div className="modal-mask" onClick={() => setContactDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>编辑联系人</h3>
            <label>备注名（Notes）<input value={contactDraft.remark} maxLength={32} placeholder="设置备注名"
              onChange={(e) => setContactDraft({ ...contactDraft, remark: e.target.value })} /></label>
            <div className="modal-hint">备注名仅你可见，显示优先级高于对方昵称。</div>
            <div className="modal-actions">
              <button className="link" onClick={() => setContactDraft(null)}>取消</button>
              <button className="mini-btn" onClick={() => void saveRemark()}>保存</button>
            </div>
          </div>
        </div>
      )}

      {blockedList !== null && (
        <div className="modal-mask" onClick={() => setBlockedList(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>黑名单（{blockedList.length}）</h3>
            {blockedList.length === 0 && <div className="empty">没有拉黑的用户</div>}
            {blockedList.map((f) => (
              <div key={f.user_id} className="convitem static">
                <Avatar url={f.avatar_url} label={friendLabel(f)} />
                <div className="convbody">
                  <div className="convpeer">{friendLabel(f)}</div>
                  <div className="convlast">{f.user_id}</div>
                </div>
                <div className="row-actions">
                  <button className="mini-btn ghost" disabled={busyUser === f.user_id} onClick={() => void unblock(f.user_id)}>解除</button>
                </div>
              </div>
            ))}
            <div className="modal-actions">
              <button className="link" onClick={() => setBlockedList(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 「群聊」列表弹窗（通讯录入口）：我的群 + 创建群聊。 */}
      {groupsModal !== null && (
        <div className="modal-mask" onClick={() => setGroupsModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>群聊（{groupsModal.length}）</h3>
            <button className="mini-btn wide" onClick={() => setCreateDraft({ name: "", selected: [] })}>
              <UserPlus size={16} className="menu-icon" />创建群聊
            </button>
            {groupsModal.length === 0 && <div className="empty">还没有加入任何群聊</div>}
            <div className="modal-list">
              {groupsModal.map((g) => (
                <div key={g.conv_id} className="convitem"
                  onClick={() => { setGroupsModal(null); setTab("chats"); openGroupChat(g.conv_id); }}>
                  <Avatar url={g.avatar_url} label={g.name} />
                  <div className="convbody">
                    <div className="convpeer">{g.name}</div>
                    <div className="convlast">{g.owner === uid ? "我是群主" : `群主 ${g.owner}`}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="link" onClick={() => setGroupsModal(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 建群弹窗：群名 + 好友多选。 */}
      {createDraft && (
        <div className="modal-mask" onClick={() => setCreateDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>创建群聊</h3>
            <label>群名<input value={createDraft.name} maxLength={30} placeholder="1~30 字" autoFocus
              onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })} /></label>
            <div className="section-label">选择好友（已选 {createDraft.selected.length}）</div>
            {accepted.length === 0 && <div className="empty">还没有好友，先去通讯录添加吧</div>}
            <div className="modal-list">
              {accepted.map((f) => {
                const on = createDraft.selected.includes(f.user_id);
                return (
                  <button key={f.user_id} className="check-row"
                    onClick={() => setCreateDraft({
                      ...createDraft,
                      selected: on ? createDraft.selected.filter((x) => x !== f.user_id) : [...createDraft.selected, f.user_id],
                    })}>
                    <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>
                    <Avatar url={f.avatar_url} label={friendLabel(f)} />
                    <span className="row-label">{friendLabel(f)}</span>
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="link" onClick={() => setCreateDraft(null)}>取消</button>
              <button className="mini-btn" disabled={createBusy} onClick={() => void doCreateGroup()}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 会话详情抽屉（对齐 iOS IMChatDetailViewController）：单聊/群聊共用——头部 + 操作排 + 设置 + 页签。 */}
      {detail && (() => {
        const d = detail;
        const conv = conversations.find((c) => c.conv_id === d.convId);
        const gp = d.isGroup ? groupInfos[d.convId] : undefined;
        const canManage = !!gp && gp.my_role !== "member";
        const isOwner = !!gp && gp.my_role === "owner";
        const title = d.isGroup ? (gp?.name ?? conv?.name ?? "群聊")
          : (conv?.peer_remark || conv?.peer_nickname || d.peer || "");
        const avatarUrl = d.isGroup ? (gp?.avatar_url ?? conv?.avatar_url) : conv?.peer_avatar_url;
        const subtitle = d.isGroup ? `${gp?.members.length ?? conv?.member_count ?? 0} 位成员` : (d.peer ?? "");
        const pinned = (conv?.pinned_at ?? 0) > 0;
        const muted = !!conv?.muted;
        const peerBlocked = !d.isGroup && !!friends.find((f) => f.user_id === d.peer)?.blocked;
        // 好友准入（微信式，任务一 P0）：非好友不显示「消息/呼叫/视频」，改显「加好友」。
        // 拉黑的好友 status 仍 accepted（仍算好友，可发消息），故只看 status 不看 blocked。
        const detailPeerIsFriend = !d.isGroup && !!d.peer && friends.some((f) => f.user_id === d.peer && f.status === "accepted");
        // 页签数据（本地历史）
        const media = detailMsgs.filter((m) => m.contentType === "image" || m.contentType === "video")
          .sort((a, b) => b.convSeq - a.convSeq);
        const files = detailMsgs.filter((m) => m.contentType === "file").sort((a, b) => b.convSeq - a.convSeq);
        const links = detailMsgs.filter((m) => isUrlText(m.content)).sort((a, b) => b.convSeq - a.convSeq);
        const tabs: Array<{ k: typeof detailTab; label: string }> = d.isGroup
          ? [{ k: "members", label: "成员" }, { k: "media", label: "媒体" }, { k: "files", label: "文件" }, { k: "links", label: "链接" }]
          : [{ k: "media", label: "媒体" }, { k: "files", label: "文件" }, { k: "links", label: "链接" }];
        const activeTab = tabs.some((t) => t.k === detailTab) ? detailTab : tabs[0].k;
        const close = () => { setDetail(null); setDetailMore(false); setManageOpen(false); };

        return (
          <div className="detail-mask" onClick={close}>
            <aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
              {!manageOpen && (
                <>
                  <button className="detail-close" title="关闭" onClick={close}><X size={20} /></button>
                  <div className="detail-topbar">{d.isGroup ? "群组信息" : "用户信息"}</div>
                </>
              )}

              {manageOpen && gp ? (
                /* ---- 群管理二级视图（改名 / 群头像 / 占位项） ---- */
                <div className="detail-manage">
                  <div className="detail-manage-head">
                    <button className="icon-btn" onClick={() => setManageOpen(false)}><ChevronLeft size={20} /></button>
                    <span>群管理</span>
                  </div>
                  <div className="detail-manage-avatar">
                    <button className="detail-manage-avatar-btn" onClick={() => pickGroupAvatar(gp)}>
                      <Avatar url={gp.avatar_url} label={gp.name} cls="detail-avatar" />
                      <span className="detail-manage-cam"><Camera size={18} /></span>
                    </button>
                    <div className="detail-manage-caption">设置新头像</div>
                  </div>
                  <div className="detail-card">
                    <button className="detail-row" onClick={() => void doRenameGroup(gp)}>
                      <span className="detail-row-ic"><SquarePen size={18} /></span><span>群名称</span>
                      <span className="detail-row-val">{gp.name}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                    <div className="detail-row disabled"><span className="detail-row-ic"><Info size={18} /></span><span>简介</span><span className="detail-row-val muted">即将上线</span></div>
                  </div>
                  <div className="detail-card">
                    {[["进群确认"], ["全员禁言"], ["自定义壁纸"]].map(([label]) => (
                      <div key={label} className="detail-row disabled"><span className="detail-row-ic"><Lock size={18} /></span><span>{label}</span><span className="detail-row-val muted">即将上线</span></div>
                    ))}
                  </div>
                  <div className="detail-foot-note">进群确认 / 全员禁言 / 自定义壁纸即将上线（待后端）。</div>
                </div>
              ) : (
                <>
                  {/* ---- 头部：头像 + 名 + 副标题 ---- */}
                  <div className="detail-header">
                    <div className="detail-avatar-wrap">
                      <Avatar url={avatarUrl} label={title} cls="detail-avatar" />
                      {canManage && (
                        <button className="detail-cam" title="设置群头像" onClick={() => pickGroupAvatar(gp!)}><Camera size={15} /></button>
                      )}
                    </div>
                    <div className="detail-name">{title}</div>
                    <div className="detail-sub">{subtitle}</div>
                  </div>

                  {/* ---- 操作排 pills ---- */}
                  <div className="detail-pills">
                    {!d.isGroup && !detailPeerIsFriend && (
                      <button className="detail-pill" onClick={() => void doFriendAction(d.peer!, async () => { await clientRef.current!.friendAction("request", d.peer!); setToast("已发送好友申请"); })}><UserPlus size={20} /><span>加好友</span></button>
                    )}
                    {!d.isGroup && detailPeerIsFriend && (
                      <button className="detail-pill" onClick={() => { close(); openChat(d.peer!); }}><MessageCircle size={20} /><span>消息</span></button>
                    )}
                    {!d.isGroup && detailPeerIsFriend && <button className="detail-pill" onClick={() => comingSoon("语音通话")}><Phone size={20} /><span>呼叫</span></button>}
                    {!d.isGroup && detailPeerIsFriend && <button className="detail-pill" onClick={() => comingSoon("视频通话")}><Video size={20} /><span>视频</span></button>}
                    <button className="detail-pill" onClick={() => comingSoon("聊天内搜索")}><Search size={20} /><span>搜索</span></button>
                    <div className="detail-pill-anchor">
                      <button className="detail-pill" onClick={() => setDetailMore((v) => !v)}><MoreHorizontal size={20} /><span>更多</span></button>
                      {detailMore && (
                        <div className="menu-card detail-more" onClick={(e) => e.stopPropagation()}>
                          <button className="menu-item" onClick={() => { setDetailMore(false); doClearHistory(d.convId); }}><Trash2 size={16} className="menu-icon" />清空聊天记录</button>
                          {!d.isGroup && (
                            <button className={`menu-item ${peerBlocked ? "" : "danger"}`} onClick={() => { setDetailMore(false); doToggleBlock(d.peer!, !peerBlocked); }}><Ban size={16} className="menu-icon" />{peerBlocked ? "取消拉黑" : "拉黑"}</button>
                          )}
                          {d.isGroup && (
                            <button className="menu-item danger" onClick={() => { setDetailMore(false); void doLeaveGroup(d.convId); }}><LogOut size={16} className="menu-icon" />退出群组</button>
                          )}
                          {isOwner && (
                            <button className="menu-item danger" onClick={() => { setDetailMore(false); doDissolveGroup(d.convId); }}><Trash2 size={16} className="menu-icon" />删除群组</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ---- 设置：置顶 / 免打扰 (+群管理) ---- */}
                  <div className="detail-card">
                    <div className="detail-row"><span className="detail-row-ic"><Pin size={18} /></span><span>置顶聊天</span>
                      <button className={`switch ${pinned ? "on" : ""}`} disabled={!conv} onClick={() => conv && setConvPinned(conv, !pinned)} /></div>
                    <div className="detail-row"><span className="detail-row-ic"><BellOff size={18} /></span><span>消息免打扰</span>
                      <button className={`switch ${muted ? "on" : ""}`} disabled={!conv} onClick={() => conv && setConvMuted(conv, !muted)} /></div>
                    {canManage && (
                      <button className="detail-row" onClick={() => setManageOpen(true)}>
                        <span className="detail-row-ic"><Settings2 size={18} /></span><span>群管理</span>
                        <span className="detail-row-val muted">仅群主/管理员</span><ChevronRight size={16} className="detail-row-chev" />
                      </button>
                    )}
                  </div>

                  {/* ---- 单聊：备注名 / 用户名 ---- */}
                  {!d.isGroup && (
                    <div className="detail-card">
                      <button className="detail-row" onClick={() => setContactDraft({ peer: d.peer!, remark: conv?.peer_remark ?? "" })}>
                        <span className="detail-row-ic"><SquarePen size={18} /></span><span>备注名</span>
                        <span className="detail-row-val">{conv?.peer_remark || "点击设置"}</span><ChevronRight size={16} className="detail-row-chev" />
                      </button>
                      <div className="detail-row"><span className="detail-row-ic"><AtSign size={18} /></span><span>用户名</span><span className="detail-row-val accent">{d.peer}</span></div>
                    </div>
                  )}

                  {/* ---- 页签 ---- */}
                  <div className="detail-tabs">
                    {tabs.map((t) => (
                      <button key={t.k} className={`detail-tab ${activeTab === t.k ? "active" : ""}`} onClick={() => setDetailTab(t.k)}>{t.label}</button>
                    ))}
                  </div>
                  <div className="detail-tabbody">
                    {activeTab === "members" && gp && (
                      <div className="detail-members">
                        <button className="detail-row accent" onClick={() => setInviteDraft({ convId: gp.conv_id, selected: [] })}>
                          <span className="detail-row-ic"><UserPlus size={18} /></span><span>添加成员</span>
                        </button>
                        {gp.members.map((m) => (
                          <div key={m.user_id} className="detail-member"
                            onClick={() => m.user_id !== uid && openPeerDetail(m.user_id)} role="button">
                            <Avatar url={m.avatar_url} label={m.nickname || m.user_id} />
                            <div className="detail-member-body">
                              <div className="detail-member-name">{m.nickname || m.user_id}{m.user_id === uid && <span className="me-tag">我</span>}</div>
                              <div className="detail-member-sub">{m.user_id}</div>
                            </div>
                            {m.role === "owner" && <span className="role-badge owner">群主</span>}
                            {m.role === "admin" && <span className="role-badge">管理员</span>}
                            {canManageMember(gp, m) && (
                              <button className="mini-btn ghost" title="管理"
                                onClick={(e) => { e.stopPropagation(); setMemberMenu({ x: e.clientX, y: e.clientY, convId: gp.conv_id, m }); }}>⋯</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {activeTab === "media" && (
                      media.length === 0 ? <div className="detail-empty">暂无媒体</div> : (
                        <div className="detail-media-grid">
                          {media.map((m) => (
                            <button key={m.serverMsgId || m.convSeq} className="detail-media-tile" onClick={() => setViewer({ m })}>
                              <img src={m.contentType === "video" ? (m.posterUrl || m.content) : m.content} alt="" />
                              {m.contentType === "video" && <span className="detail-media-play">▶</span>}
                            </button>
                          ))}
                        </div>
                      )
                    )}
                    {activeTab === "files" && (
                      files.length === 0 ? <div className="detail-empty">暂无文件</div> : (
                        <div className="detail-filelist">
                          {files.map((m) => (
                            <a key={m.serverMsgId || m.convSeq} className="detail-fileitem" href={m.content} target="_blank" rel="noreferrer">
                              <FileTypeIcon name={m.fileName || fileNameFromContent(m.content)} size={34} />
                              <span className="detail-file-body">
                                <span className="detail-file-name">{m.fileName || fileNameFromContent(m.content)}</span>
                                {formatFileSize(m.fileSize) && <span className="detail-file-size">{formatFileSize(m.fileSize)}</span>}
                              </span>
                            </a>
                          ))}
                        </div>
                      )
                    )}
                    {activeTab === "links" && (
                      links.length === 0 ? <div className="detail-empty">暂无链接</div> : (
                        <div className="detail-filelist">
                          {links.map((m) => (
                            <a key={m.serverMsgId || m.convSeq} className="detail-linkitem" href={m.content} target="_blank" rel="noreferrer">
                              <Link2 size={16} /><span className="detail-file-name">{m.content}</span>
                            </a>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        );
      })()}

      {/* 邀请成员弹窗：不在群内的好友多选。 */}
      {inviteDraft && (() => {
        const inGroup = new Set((groupInfos[inviteDraft.convId]?.members ?? []).map((m) => m.user_id));
        const candidates = accepted.filter((f) => !inGroup.has(f.user_id));
        return (
          <div className="modal-mask" onClick={() => setInviteDraft(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>邀请成员</h3>
              {candidates.length === 0 && <div className="empty">好友都已在群里了</div>}
              <div className="modal-list">
                {candidates.map((f) => {
                  const on = inviteDraft.selected.includes(f.user_id);
                  return (
                    <button key={f.user_id} className="check-row"
                      onClick={() => setInviteDraft({
                        ...inviteDraft,
                        selected: on ? inviteDraft.selected.filter((x) => x !== f.user_id) : [...inviteDraft.selected, f.user_id],
                      })}>
                      <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>
                      <Avatar url={f.avatar_url} label={friendLabel(f)} />
                      <span className="row-label">{friendLabel(f)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="modal-actions">
                <button className="link" onClick={() => setInviteDraft(null)}>取消</button>
                <button className="mini-btn" disabled={inviteDraft.selected.length === 0} onClick={() => void doInvite()}>
                  邀请{inviteDraft.selected.length > 0 ? `（${inviteDraft.selected.length}）` : ""}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 群成员管理 ⋯ 菜单（按角色矩阵显隐；服务端仍会二次校验）。 */}
      {memberMenu && (() => {
        const gp = groupInfos[memberMenu.convId];
        const m = memberMenu.m;
        const cid = memberMenu.convId;
        if (!gp) return null;
        const run = (fn: () => Promise<void>) => { setMemberMenu(null); void doGroupAction(cid, fn); };
        // 好友准入（微信式，任务一 P0）：好友 → 「发送消息」；非好友 → 「添加好友」（非好友发消息会被 200103 拒收）。
        const isSelf = m.user_id === uid;
        const isMemberFriend = friends.some((f) => f.user_id === m.user_id && f.status === "accepted");
        return (
          // 锚定在点击点的左上方（right/bottom 定位，菜单向左上展开）：⋯ 按钮贴屏幕右缘、成员行偏下，
          // 原 left/top 向右下展开会把菜单推出视口（选项被截断看不到）。
          <div className="ctx-menu" style={{ right: window.innerWidth - memberMenu.x, bottom: window.innerHeight - memberMenu.y }} onClick={(e) => e.stopPropagation()}>
            {!isSelf && isMemberFriend && (
              <button onClick={() => { setMemberMenu(null); openChat(m.user_id); }}>发送消息</button>
            )}
            {!isSelf && !isMemberFriend && (
              <button onClick={() => { setMemberMenu(null); void doFriendAction(m.user_id, async () => { await clientRef.current!.friendAction("request", m.user_id); setToast("已发送好友申请"); }); }}>添加好友</button>
            )}
            {gp.my_role === "owner" && m.role === "member" && (
              <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "admin"))}>设为管理员</button>
            )}
            {gp.my_role === "owner" && m.role === "admin" && (
              <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "member"))}>撤销管理员</button>
            )}
            {gp.my_role === "owner" && (
              <button onClick={() => {
                setMemberMenu(null);
                if (window.confirm(`确定把群主转让给 ${m.nickname || m.user_id}？你将变为普通成员。`)) {
                  void doGroupAction(cid, () => clientRef.current!.transferGroup(cid, m.user_id));
                }
              }}>转让群主</button>
            )}
            <button className="danger" onClick={() => {
              setMemberMenu(null);
              if (window.confirm(`确定把 ${m.nickname || m.user_id} 移出群聊？`)) {
                void doGroupAction(cid, () => clientRef.current!.removeGroupMember(cid, m.user_id));
              }
            }}>移出群聊</button>
          </div>
        );
      })()}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// 两个毫秒时间戳是否同一自然日（聊天页按日期分组用）。
function isSameDay(a: number, b: number): boolean {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

// 毫秒时间戳 → 日期分隔文案：今天/昨天/M月d日（今年）/yyyy年M月d日（往年）。
function dayHeader(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(ts, now.getTime())) return "今天";
  if (isSameDay(ts, yesterday.getTime())) return "昨天";
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 消息列表里的最大 conv_seq（发送中的 0 不计）。
function maxSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > m) m = x.convSeq;
  return m;
}

// 消息列表里的最小 conv_seq（发送中的 0 不计；空列表返回 0）。
function minSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > 0 && (m === 0 || x.convSeq < m)) m = x.convSeq;
  return m;
}
