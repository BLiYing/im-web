// useForward：转发簇（阶段 6，CODING_STYLE §7「①自有状态+一组操作」）——转发选择器状态（forwarding/forwardMode/
// forwardMulti/forwardTargets）+ 逐条·合并转发到目标会话 sendForwardToTarget + 多选目标/执行/关闭 + 多选批量转发。
// 函数体逐字平移；依赖注入：clientRef/setToast/uid/peer/groupConvId/appendMsg/msgsByConv/groupInfos/selected/setMenu/exitSelectMode。
// 收藏「转发某条收藏 / 从收藏发送」复用本 Hook 的 setForwarding/sendForwardToTarget（见 useFavorites）。
import { useCallback, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import { convIdFor, type ChatMessage, type Conversation, type GroupInfo } from "./sdk/protocol";
import { toggleCapped } from "./selection";
import { fileNameFromContent, type RecordItem } from "./messageContent";

export const MAX_FORWARD_TARGETS = 9;

export interface ForwardDeps {
  uid: string;
  peer: string;
  groupConvId: string;
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  appendMsg: (convId: string, m: ChatMessage) => void;
  msgsByConv: Record<string, ChatMessage[]>;
  groupInfos: Record<string, GroupInfo>;
  selected: Set<number>;
  setMenu: (v: null) => void;
  exitSelectMode: () => void;
}

export function useForward(d: ForwardDeps) {
  const { uid, peer, groupConvId, clientRef, setToast, appendMsg, msgsByConv, groupInfos, selected, setMenu, exitSelectMode } = d;
  const [forwarding, setForwarding] = useState<ChatMessage[] | null>(null); // 待转发的消息（打开会话选择器；null=关闭）
  const [forwardMode, setForwardMode] = useState<"each" | "merged">("each"); // 逐条 / 合并转发
  const [forwardMulti, setForwardMulti] = useState(false); // 转发选择器：多选目标会话模式（对齐 iOS「多选」）
  const [forwardTargets, setForwardTargets] = useState<string[]>([]); // 多选选中的目标 conv_id（有序，上限 MAX_FORWARD_TARGETS）

  const forwardMessage = useCallback((m: ChatMessage) => { setMenu(null); setForwardMode("each"); setForwarding([m]); }, []);
  // 关闭转发选择器并复位多选态（点蒙层 / 取消 / 发送完成统一走这里）。
  const closeForwardPicker = useCallback(() => { setForwarding(null); setForwardMulti(false); setForwardTargets([]); }, []);
  // 多选态切换某个目标会话（上限 MAX_FORWARD_TARGETS，超限吐司，对齐 iOS）。
  // 副作用（吐司）在 updater 外算，避免 StrictMode 双调用致重复吐司。
  const toggleForwardTarget = useCallback((cid: string) => {
    const { next, overflow } = toggleCapped(forwardTargets, cid, MAX_FORWARD_TARGETS);
    if (overflow) { setToast(`最多选择 ${MAX_FORWARD_TARGETS} 个会话`); return; }
    setForwardTargets(next);
  }, [forwardTargets]);
  // 向单个 target 会话发出转发（逐条保留各自类型 / 合并打包 chat_record 一条）。不负责关闭弹窗/吐司。
  // msgsArg 显式传入时（从收藏发送）用之并按「逐条」发；否则用 forwarding 状态 + 当前 forwardMode（转发）。
  const sendForwardToTarget = useCallback((target: Conversation, msgsArg?: ChatMessage[]) => {
    const client = clientRef.current;
    const msgs = msgsArg ?? forwarding;
    if (!client || !msgs) return;
    const mode = msgsArg ? "each" : forwardMode;
    const to = target.is_group ? "" : target.peer;
    // 发送者显示名：自己→uid；否则群成员昵称（直接读 groupInfos 状态，避免依赖后声明的 memberNick）→ 回退 uid。
    // 末级不落 m.from：那是 10 位随机内部 ID，出现在合并转发卡片里既难看也无意义。
    // 自己的条目直接标「我」，与聊天搜索侧同口径。
    const nameOf = (m: ChatMessage) => { const gm = groupInfos[m.convId]?.members.find((x) => x.user_id === m.from); return m.from === uid ? "我" : (m.fromNickname || gm?.group_nickname || gm?.nickname || "未命名用户"); };
    const pushOptimistic = (clientMsgId: string, content: string, contentType: string, forwardFrom?: string, fileName?: string, fileSize?: number, posterUrl?: string, thumb?: string, caption?: string, mentions?: string[], mentionAll?: boolean, groupId?: string, extra?: Partial<ChatMessage>) =>
      appendMsg(target.conv_id, { clientMsgId, convId: target.conv_id, from: uid, content, contentType, fileName, fileSize, posterUrl, thumb, caption, mentions, mentionAll, groupId, convSeq: 0, timestamp: Date.now(), status: "sending", ...(forwardFrom ? { forwardFrom } : {}), ...(extra ?? {}) });

    if (mode === "merged" && msgs.length > 0) {
      const items: RecordItem[] = msgs
        .filter((m) => m.content && !m.recalledAt && m.contentType !== "system" && m.convSeq > 0)
        .map((m) => ({
          n: nameOf(m), ct: m.contentType || "text", c: m.content,
          // 文件行随包携带原名与大小（fn/fs，与 iOS 同约定）——收端不再只显「[文件]」。
          ...(m.contentType === "file"
            ? { fn: m.fileName || fileNameFromContent(m.content), ...(m.fileSize ? { fs: m.fileSize } : {}) }
            : {}),
          // 图说条目携带 caption（cap，与 iOS 同 key）——收端记录卡「有字显字」，不再只显 [图片]。
          ...(m.caption ? { cap: m.caption } : {}),
        }));
      const names = new Set(items.map((i) => i.n));
      const title = names.size <= 1 ? `${[...names][0] || "聊天"} 的聊天记录` : "群聊的聊天记录";
      const json = JSON.stringify({ t: title, items });
      const clientMsgId = client.sendMedia(json, "chat_record", to, target.conv_id);
      pushOptimistic(clientMsgId, json, "chat_record");
    } else {
      // 整体转发相册（用户要求）：同一原相册被选 ≥2 张 → 用**一个新的共享 group_id** 一起转发，收端重新聚成宫格；
      // 只选 1 张或非相册 → 单发。仅对多选转发生效（收藏发送的 msgs 无 groupId，自然走单发）。
      const albumCount = new Map<string, number>();
      for (const m of msgs) {
        if (!m.content || m.recalledAt) continue;
        if (m.groupId && (m.contentType === "image" || m.contentType === "video")) {
          albumCount.set(m.groupId, (albumCount.get(m.groupId) ?? 0) + 1);
        }
      }
      const newGidForOld = new Map<string, string>(); // 原 group_id → 本会话新 group_id
      for (const m of msgs) {
        if (!m.content || m.recalledAt) continue;
        const origin = m.forwardFrom || m.fromNickname || m.from; // 转发链保留最初作者
        const ct = m.contentType || "text";
        // 该媒体属于某原相册且被选 ≥2 张 → 分配/复用本会话的新 group_id。
        let groupId: string | undefined;
        if (m.groupId && (ct === "image" || ct === "video") && (albumCount.get(m.groupId) ?? 0) >= 2) {
          groupId = newGidForOld.get(m.groupId);
          if (!groupId) { groupId = `alb-${crypto.randomUUID()}`; newGidForOld.set(m.groupId, groupId); }
        }
        // 保留原类型：图片/视频/文件按 media 转发（否则收方收到的是 URL 文本、会话预览也丢 [图片]）。
        const clientMsgId = ct === "text"
          ? client.sendText(m.content, to, target.conv_id, { forwardFrom: origin })
          // 转发也要带上媒体尺寸/时长 + **封面/缩略图**：源消息手上就有，丢了收端就只能按未知渲染
          // （视频没 poster → 资料卡宫格只能抓首帧甚至裂图；且事后补不回来）。poster/thumb 对文件为空，无害。
          : client.sendMedia(m.content, ct, to, target.conv_id, {
              forwardFrom: origin, fileName: m.fileName, fileSize: m.fileSize,
              mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration,
              waveform: m.waveform, // 语音转发：波形指纹随包走（duration 服务端对 voice 强校验，缺则拒发）
              poster: m.posterUrl, thumb: m.thumb, caption: m.caption, // 图说随转发跟随（Telegram 模型）
              groupId, // 整体转发：同册共享新 group_id，收端聚簇成宫格
              // 配文 @ 随转发保留高亮+可点：mentions 服务端按目标群成员再过滤（非成员自动落普通文字）。
              // **不带 mentionAll**：@所有人 需群主/管理员权限，转发者在目标群无权时整条会被拒发 300204；
              // 且转发不该再次全员强提醒。丢 mention_all 后 "@所有人" 字样退化为普通文字（正确）。
              mentions: m.mentions,
            });
        pushOptimistic(clientMsgId, m.content, ct, origin, m.fileName, m.fileSize, m.posterUrl, m.thumb, m.caption, m.mentions, false, groupId,
          { duration: m.duration, waveform: m.waveform }); // 语音/视频回显行带时长与波形（否则语音气泡显 0:00 + 退化条纹）
      }
    }
  }, [forwarding, forwardMode, groupInfos, appendMsg, uid]);
  // 执行转发到一个或多个目标：全部发出后关闭弹窗、退出多选、单条吐司汇总。
  const doForwardToTargets = useCallback((targets: Conversation[]) => {
    if (targets.length === 0) return;
    targets.forEach((t) => sendForwardToTarget(t)); // 不透传 forEach 的 index 作 msgsArg
    closeForwardPicker();
    exitSelectMode();
    setToast(targets.length === 1
      ? `已转发到 ${targets[0].is_group ? (targets[0].name || "群聊") : (targets[0].peer_remark || targets[0].peer_nickname || targets[0].peer)}`
      : `已转发到 ${targets.length} 个会话`);
  }, [sendForwardToTarget, closeForwardPicker, exitSelectMode]);
  // 多选批量转发：收集选中的消息，打开选择器。
  const forwardSelected = useCallback(() => {
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    const list = (msgsByConv[cid] ?? []).filter((m) => m.convSeq > 0 && selected.has(m.convSeq) && !m.recalledAt);
    if (list.length > 0) { setForwardMode("each"); setForwarding(list); }
  }, [msgsByConv, peer, uid, groupConvId, selected]);

  return {
    forwarding, setForwarding, forwardMode, setForwardMode, forwardMulti, setForwardMulti, forwardTargets, setForwardTargets,
    forwardMessage, closeForwardPicker, toggleForwardTarget, sendForwardToTarget, doForwardToTargets, forwardSelected,
  };
}
