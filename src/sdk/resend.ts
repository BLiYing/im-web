// 失败重发的出网组合：把一条**已失败**的消息按原 client_msg_id 重新发一遍。
//
// 放在 IMClient 类外（自由函数）有两个理由：① 它只是既有 sendMedia 的一次组合调用，没有新协议；
// ② `imSdk.ts` 有 1450 行硬预算（check-file-size.sh，只准降不准升），能在类外做的别往里堆。
import type { IMClient } from "./imSdk";
import type { ChatMessage } from "./protocol";

/**
 * 重发一条**已失败**的消息（ack 超时 / 断线那类；内容已就绪：正文或已上传的服务器 URL）。
 *
 * **必须沿用原 clientMsgId**：服务端按 `(conv_id, client_msg_id)` 唯一索引幂等去重
 * （PROTOCOL §超时重发），于是"上次其实已存下、只是 ack 丢了"这种情况重发只会拿回同一条的 conv_seq；
 * 换新 ID 会绕开去重索引让对端收到两条。上传失败那类（服务器上根本没有这条）走 useMediaSend 的
 * retryUpload，不走这里 —— 分流判据见 `resendPolicyFor`。
 *
 * 引用/转发溯源/@提及/媒体元数据（尺寸·时长·封面·thumb·waveform·caption）原样带回，
 * 漏一个字段收端就少一样东西。返回是否已发出（缺 clientMsgId / content 为空 → false）。
 *
 * @param to 单聊=对端 uid；群聊=""（服务端按 conv_id 写扩散）。与首发同一个取值来源。
 */
export function resendMessage(client: IMClient, m: ChatMessage, to: string): boolean {
  if (!m.clientMsgId || !m.content) return false;
  client.sendMedia(m.content, m.contentType, to, m.convId, {
    clientMsgId: m.clientMsgId, // ← 原样沿用，服务端据此幂等去重
    replyTo: m.replyToConvSeq ? { convSeq: m.replyToConvSeq, preview: m.replySnapshot ?? "", from: m.replyToFrom } : undefined,
    forwardFrom: m.forwardFrom, groupId: m.groupId, poster: m.posterUrl, thumb: m.thumb, waveform: m.waveform,
    mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration,
    fileName: m.fileName, fileSize: m.fileSize, caption: m.caption,
    mentions: m.mentions, mentionAll: m.mentionAll,
  });
  return true;
}
