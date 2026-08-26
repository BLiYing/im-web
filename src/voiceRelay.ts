// voiceRelay —— 语音接力连播的选取规则（纯函数，与 iOS 同口径）。
//
// 语义对齐 IMProgram `IMChatViewController+Voice.m im_relayAfterMessageID:`（设计文档 §6.4）：
//   - 从刚播完那条往后扫同会话消息；
//   - **遇到非 voice 消息即停**——话题边界，不跨过文字/图片继续念下去；
//   - 撤回/已删的跳过（continue，不算边界）；
//   - 自己发的跳过（自己听自己没意义）；
//   - 本机"已播过"的跳过；
//   - 第一条命中的即为下一条。
//
// 抽成纯函数是为了能被 voice.test.ts 直接护栏化：真正的播放胶水在 VoiceBubble 的模块级单例
// audio 上（ended 回调拿不到 React 树里的消息列表），那部分不可测，规则这部分必须可测。

/** 接力只关心这几个字段——避免测试构造整个 ChatMessage。 */
export interface VoiceRelayMessage {
  contentType: string;
  from: string;
  convId: string;
  recalledAt?: number;
  clientMsgId?: string;
  serverMsgId?: string;
}

/** 消息的播放身份——与 VoiceBubble 内部 `mid` 同口径（入站消息无 clientMsgId，见 memory）。 */
export function voiceRelayMid(m: VoiceRelayMessage): string {
  return m.serverMsgId || m.clientMsgId || "";
}

/**
 * 挑出 `finishedIdx` 之后应当接力播放的下一条语音；没有则 null。
 * @param hasPlayed 查"本机已播过"（由调用方注入，实现在 VoiceBubble 的 localStorage 集合）。
 */
export function pickNextVoiceRelay<T extends VoiceRelayMessage>(
  messages: readonly T[],
  finishedIdx: number,
  uid: string,
  hasPlayed: (convId: string, mid: string) => boolean,
): T | null {
  if (finishedIdx < 0) return null;
  for (let i = finishedIdx + 1; i < messages.length; i++) {
    const n = messages[i];
    if (n.contentType !== "voice") return null; // 话题边界即停
    if ((n.recalledAt ?? 0) > 0) continue;      // 撤回墓碑跳过，不算边界
    if (n.from === uid) continue;               // 自己发的不接力
    const mid = voiceRelayMid(n);
    if (!mid) continue;
    if (hasPlayed(n.convId, mid)) continue;
    return n;
  }
  return null;
}
