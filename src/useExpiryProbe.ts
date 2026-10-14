import { useEffect, useRef } from "react";
import { useProbeExpiry } from "./ChatActionsContext";
import type { DownloadState } from "./download";
import type { ChatMessage } from "./sdk/protocol";

/**
 * 聊天页：进会话 / 新消息进来时，对可能已被服务端清理、却不会自己发请求的媒体各主动探一次：
 *  - 图片：只探**被门控挡着**的（磨砂 thumb、不请求原件）；放行的图片 <img> 自己会请求（失败走复验），
 *    命中浏览器缓存的不在列表里批量探——进查看器那一次再复验（见 MediaViewer）。
 *  - 视频：有封面就不会请求视频本体，无论门控与否都探。
 * 与群资料媒体页签同一套失效登记（expiredSet 持久 + `useMediaDownload.probeExpiry` 每地址每会话一次、仅 http(s)）。
 * `messages` 每次渲染都是新数组（visibleSlice），故以「窗口签名」判重，渲染本身不触发重扫。
 */
export function useExpiryProbe(messages: ChatMessage[], gateOf: (m: ChatMessage) => DownloadState | undefined): void {
  const probe = useProbeExpiry();
  const latest = useRef({ messages, gateOf });
  latest.current = { messages, gateOf };
  const first = messages[0], last = messages[messages.length - 1];
  const sig = `${messages.length}:${first?.convSeq ?? 0}:${last?.convSeq ?? 0}:${last?.content ?? ""}`;
  useEffect(() => {
    if (!probe) return;
    const { messages: ms, gateOf: gate } = latest.current;
    for (const m of ms) {
      if ((m.contentType !== "image" && m.contentType !== "video") || !m.content || m.convSeq <= 0 || m.recalledAt) continue;
      const g = gate(m);
      if (g?.phase === "expired") continue;
      // 图片：只探被门控挡着的（放行的自己会加载；命中浏览器缓存的不在列表里批量探，进查看器那一次再复验）
      if (m.contentType === "video" || g) probe(m);
    }
  }, [sig, probe]);
}
