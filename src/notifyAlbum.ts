// 桌面系统通知的相册（宫格）聚合：同一相册的多张图片 / 视频只占一个通知位。
//
// 九宫格逐条转发 / 一次发 9 张，页面收到的是 9 条独立消息（共享 `groupId`），不聚合就会连弹 9 条。
// 与手机推送同口径（`IMServer/internal/push/album.go`）：第一张照常弹，后到的成员把正文换成
// 「[N 张图片]」、**替换**同相册那条通知（主进程按 albumKey 关掉旧的再弹），不再响提示音。
//
// 纯逻辑、不碰 DOM / electron：调用方每收到一条要弹的消息调一次 `note`，据返回值决定正文与是否静音。
import type { ChatMessage } from "./sdk/protocol";
import { t as i18nT } from "./i18n";

/** 相册聚合状态的保质期：成员几秒内发完，过了它再来的同 groupId 当新相册（同服务端 albumTTL）。 */
export const ALBUM_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

export type AlbumKind = "image" | "video" | "mixed";

export interface AlbumProgress {
  /** 含本条；1 = 第一张（照常弹），≥2 = 后到成员（替换、静音）。 */
  count: number;
  kind: AlbumKind;
  /** 同相册通知的替换键（会话 + 相册 id）。 */
  key: string;
}

/** 消息作为相册成员的类型；不是（无 groupId，或不是图 / 视频）返回 null。 */
export function albumKindOf(m: Pick<ChatMessage, "groupId" | "contentType">): "image" | "video" | null {
  if (!m.groupId) return null;
  if (m.contentType === "image") return "image";
  if (m.contentType === "video") return "video";
  return null;
}

interface State { seqs: Set<number>; kind: AlbumKind; at: number }

export interface AlbumTracker {
  note(m: ChatMessage, nowMs: number): AlbumProgress | null;
}

export function createAlbumTracker(): AlbumTracker {
  const byKey = new Map<string, State>();
  return {
    note(m, nowMs) {
      const kind = albumKindOf(m);
      if (!kind || !m.convId || !m.groupId) return null;
      const key = `${m.convId}|${m.groupId}`;
      let st = byKey.get(key);
      if (st && nowMs - st.at > ALBUM_TTL_MS) st = undefined;
      if (!st) {
        if (byKey.size >= MAX_ENTRIES) byKey.delete(byKey.keys().next().value as string); // 最旧的（Map 按插入序）
        st = { seqs: new Set(), kind, at: nowMs };
      } else if (st.kind !== kind) {
        st.kind = "mixed";
      }
      st.seqs.add(m.convSeq); // 同一 convSeq 重复来（重投）不加数
      st.at = nowMs;
      byKey.delete(key);
      byKey.set(key, st);
      return { count: st.seqs.size, kind: st.kind, key };
    },
  };
}

/** 聚合后的摘要文案（同 `push.*` 的 `preview.album_*`）。count<2 不该调用。 */
export function albumBody(kind: AlbumKind, count: number): string {
  if (kind === "video") return i18nT("preview.album_videos", { count });
  if (kind === "mixed") return i18nT("preview.album_media", { count });
  return i18nT("preview.album_images", { count });
}
