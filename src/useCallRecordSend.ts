// useCallRecordSend：SDK 的 callSummary → 主叫发一条 content_type=call 的 IM 消息（CALL_RECORD_DESIGN §2）。
//
//  · 只由主叫发（planCallRecord 里判 role）；client_msg_id = "call-"+call_id，走现有幂等，不做自动补发。
//  · **失败不影响通话、也不打扰用户**：被对方拉黑（200102）等一切被拒 / 超时都只写日志 tag rtc，并把本地那条「发送失败」行抹掉
//    （不留红❗，不弹 toast）——通话记录是附带事实，不是用户「说的话」。
import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import { convIdFor, type ChatMessage } from "./sdk/protocol";
import { logger, LOG_TAG } from "./logging/logger";
import { CALL_CONTENT_TYPE, planCallRecord, type CallSummaryEvent } from "./callRecord";

/** 在途的通话记录：client_msg_id → conv_id。ack / 被拒回来时据此认出「这是通话记录」。 */
const pending = new Map<string, string>();

/** ack 成功：不再关心这条。 */
export function callRecordAcked(clientMsgId: string): void {
  pending.delete(clientMsgId);
}

/**
 * ack 失败 / 被拒收：若这是在途的通话记录，写日志并返回它所在的 conv_id（调用方据此抹掉本地行）；否则返回 undefined。
 * 同一条可能先后走 onAck(false) 与 onMsgRejected 两条路，第二次返回 undefined，无副作用。
 */
export function takeFailedCallRecord(clientMsgId: string, why: string): string | undefined {
  const cid = pending.get(clientMsgId);
  if (cid === undefined) return undefined;
  pending.delete(clientMsgId);
  logger.warn(LOG_TAG.rtc, "call_record_send_failed", { client_msg_id: clientMsgId, conv_id: cid, why });
  return cid;
}

export interface CallRecordSendDeps {
  clientRef: MutableRefObject<IMClient | null>;
  uid: string;
  appendMsg: (convId: string, m: ChatMessage) => void;
}

export function useCallRecordSend({ clientRef, uid, appendMsg }: CallRecordSendDeps) {
  const sendCallRecord = useCallback((s: CallSummaryEvent) => {
    const plan = planCallRecord(s, uid, convIdFor);
    if (!plan) return;
    const client = clientRef.current;
    if (!client) {
      logger.warn(LOG_TAG.rtc, "call_record_skip_no_im", { call_id: s.callId });
      return;
    }
    pending.set(plan.clientMsgId, plan.convId);
    client.sendMedia(plan.content, CALL_CONTENT_TYPE, plan.to, plan.convId, { clientMsgId: plan.clientMsgId });
    appendMsg(plan.convId, {
      clientMsgId: plan.clientMsgId, convId: plan.convId, from: uid, content: plan.content, contentType: CALL_CONTENT_TYPE,
      convSeq: 0, timestamp: Date.now(), status: "sending",
    });
    logger.info(LOG_TAG.rtc, "call_record_send", { call_id: s.callId, conv_id: plan.convId, reason: s.reason, duration_sec: s.durationSec });
  }, [clientRef, uid, appendMsg]);
  return { sendCallRecord };
}
