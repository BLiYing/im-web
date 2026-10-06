// useVoiceSend：语音发送 + 上传失败重试（对齐 iOS `im_uploadAndSendVoice`/`im_resendVoiceMessage:`，见
// IMChatViewController+Voice.m）。原实现（App.tsx 旧版 sendVoice）等上传成功才上屏，上传失败只有一句
// toast——没有气泡、没有红❗、录的那段音频直接丢了，用户唯一的补救是重新按住录一遍。iOS 早改成
// "松手立即插入 Sending 占位，上传失败占位就地转 Failed（红❗可点，重传同一份字节，不重录）"，
// Web 一直没跟——这是 2026-09-24 用户报告"web 端没有解决发送失败重发"里唯一命中的真缺口
// （文本/图片/视频/文件的失败重发本已实现，见 resendPolicy.ts/sdk/resend.ts/useMediaSend.ts）。
import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage } from "./sdk/protocol";
import { LOG_TAG, logger } from "./logging/logger";

export interface VoiceSendDeps {
  uid: string;
  /** 当前打开的会话（未指定 targetConvId 时的默认落点，与旧实现同语义）。 */
  convId: string;
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  appendMsg: (convId: string, m: ChatMessage) => void;
  patchMsg: (cid: string, clientMsgId: string, patch: Partial<ChatMessage>) => void;
  removeMsgRow: (cid: string, key: string) => void;
}

interface PendingVoice { blob: Blob; blobUrl: string; fileName: string; waveform: string; duration: number; convId: string; to: string }

/** 目标会话推收件人：群聊 to 留空（服务端按 conv_id 写扩散），单聊从 conv_id 里摘对方 uid。
 *  不能用"当前打开的会话"的 peer——录音条长驻，A 录到一半切到 B 再发，发的其实是这段录音**录的时候**
 *  所属的会话（用户实测过的坑，2026-08 前的实现踩过）。 */
function toFor(cid: string, uid: string): string {
  return cid.startsWith("g_") ? "" : (cid.replace(/^u_/, "").split("_u_").find((x) => x !== uid) ?? "");
}

export function useVoiceSend(d: VoiceSendDeps) {
  const { uid, convId, clientRef, setToast, appendMsg, patchMsg, removeMsgRow } = d;
  // 上传失败留存的原始 Blob（红❗重试据此重新上传，不重录）；键=占位 clientMsgId。
  // 仅内存、不跨刷新——与图片/文件的 pendingFilesRef 同一取舍（Web 平台限制，见 current_task.md 已知坑）。
  const pendingVoiceRef = useRef<Map<string, PendingVoice>>(new Map());
  // 上传途中被「取消发送」的占位键：uploadVoice 无法 abort，传完必须在这里拦住，否则会照常 sendMedia（僵尸发送）。
  const cancelledVoiceRef = useRef<Set<string>>(new Set());

  /** 上传 + 发送共用尾段：占位 localId 已在库里、content 是本地 blobUrl（首发或重试都先插好）。 */
  const uploadAndSendVoice = useCallback(async (kept: PendingVoice, localId: string) => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const { url, size } = await client.uploadVoice(kept.blob, kept.fileName);
      pendingVoiceRef.current.delete(localId);
      if (cancelledVoiceRef.current.delete(localId)) return; // 上传期间已取消：占位已摘，不发
      const clientMsgId = client.sendMedia(url, "voice", kept.to, kept.convId, {
        duration: kept.duration, fileSize: size, waveform: kept.waveform,
      });
      // 摘掉占位（连带回收本地 blobUrl）、换真实 cid + 服务器 URL 重新上屏；ack 走既有 applyAck，同图片/文件路径。
      removeMsgRow(kept.convId, localId);
      URL.revokeObjectURL(kept.blobUrl);
      appendMsg(kept.convId, {
        clientMsgId, convId: kept.convId, from: uid, content: url, contentType: "voice",
        duration: kept.duration, waveform: kept.waveform, fileSize: size,
        convSeq: 0, timestamp: Date.now(), status: "sending",
      });
    } catch (e) {
      if (cancelledVoiceRef.current.delete(localId)) return;
      // 占位原地转失败：content **保留本地 blobUrl 不清空**——resendPolicyFor 按"content 是 blob: 本地占位"
      // 判 retry-upload，且这条判断排在 note 判断之前，与是否挂 note 无关（note 只在"本地也没字节"时
      // 才代表"不可重发"，顺序见 resendPolicy.ts 的注释；这正是 iOS 2026-08-30 code-review 抓到过的
      // 一处，顺序写反了会让红❗照显却点不动）。
      const note = (e as Error).message || undefined;
      patchMsg(kept.convId, localId, { status: "failed", note });
      pendingVoiceRef.current.set(localId, kept);
      logger.warn(LOG_TAG.media, "voice_send_failed", {
        conv_id: kept.convId, client_msg_id: localId, bytes: kept.blob.size, error: (e as Error).message,
      });
      setToast(note || "语音发送失败");
    }
  }, [clientRef, uid, appendMsg, patchMsg, removeMsgRow, setToast]);

  /** 录音条松手：立即插入 Sending 占位（本地 blobUrl，不等上传），再后台上传+发送。 */
  const sendVoice = useCallback((blob: Blob, fileName: string, waveformBase64: string, durationMs: number, targetConvId?: string) => {
    const cid = targetConvId || convId;
    if (!cid) return;
    const to = toFor(cid, uid);
    const localId = `outbox-voice-${crypto.randomUUID()}`;
    const blobUrl = URL.createObjectURL(blob);
    appendMsg(cid, {
      clientMsgId: localId, convId: cid, from: uid, content: blobUrl, contentType: "voice",
      duration: durationMs, waveform: waveformBase64, fileSize: blob.size,
      convSeq: 0, timestamp: Date.now(), status: "sending",
    });
    void uploadAndSendVoice({ blob, blobUrl, fileName, waveform: waveformBase64, duration: durationMs, convId: cid, to }, localId);
  }, [convId, uid, appendMsg, uploadAndSendVoice]);

  /** 红❗重试（retry-upload 分支，见 useMediaSend#resendOne 的 voice 特判——语音不走那条通用
   *  pendingFilesRef 路径，单列，与 iOS 两条腿的取舍一致）：旧占位摘除并回收其 blobUrl，
   *  换新 localId + 新 blobUrl 重新插占位再传（服务端从没见过这条，换 ID 不会造重复）。 */
  const retryVoiceUpload = useCallback((m: ChatMessage) => {
    const key = m.clientMsgId ?? "";
    const kept = pendingVoiceRef.current.get(key);
    if (!kept) { setToast("原始录音已丢失，请重新录制"); return; }
    pendingVoiceRef.current.delete(key);
    removeMsgRow(m.convId, key);
    URL.revokeObjectURL(kept.blobUrl);
    const localId = `outbox-voice-${crypto.randomUUID()}`;
    const blobUrl = URL.createObjectURL(kept.blob);
    appendMsg(kept.convId, {
      clientMsgId: localId, convId: kept.convId, from: uid, content: blobUrl, contentType: "voice",
      duration: kept.duration, waveform: kept.waveform, fileSize: kept.blob.size,
      convSeq: 0, timestamp: Date.now(), status: "sending",
    });
    void uploadAndSendVoice({ ...kept, blobUrl }, localId);
  }, [uid, appendMsg, removeMsgRow, setToast, uploadAndSendVoice]);

  /** 取消发送（右键菜单）：占位仍在上传 → 标记取消（上传落地后不再发）；已失败 → 丢留存字节。两者都回收 blobUrl 并移除气泡。仅对 blob: 占位有意义——content 已是服务器 URL 说明 WS 帧已发出，撤不回（菜单层已隐藏）。 */
  const cancelVoiceSend = useCallback((m: ChatMessage) => {
    const key = m.clientMsgId ?? "";
    const kept = pendingVoiceRef.current.get(key);
    if (kept) { pendingVoiceRef.current.delete(key); URL.revokeObjectURL(kept.blobUrl); }
    else if (m.status === "sending") { cancelledVoiceRef.current.add(key); if (m.content.startsWith("blob:")) URL.revokeObjectURL(m.content); } // 上传在飞：立刻回收占位 blobUrl
    removeMsgRow(m.convId, key);
  }, [removeMsgRow]);

  return { sendVoice, retryVoiceUpload, cancelVoiceSend };
}
