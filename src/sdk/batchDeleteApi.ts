// 多选批量删除的 HTTP 调用（PROTOCOL §6.7.1 / §6.7.2）。无状态：只发请求并把 results 对回 seqs，
// 本地移除由 IMClient（imSdk.rest.ts 基类转调）负责。拆出来是因为 imSdk.ts 已超体量预算（CODING_STYLE §7）。

import { callJson } from "./http";
import { summarizeBatch } from "../selectDelete";

export type BatchOutcome = { okSeqs: number[]; failed: number };

async function post(token: string, path: string, body: Record<string, unknown>, seqs: number[]): Promise<BatchOutcome> {
  const data = await callJson(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return summarizeBatch(seqs, (data as { results?: unknown } | undefined)?.results);
}

/** 仅为我删除（批量）。整单失败（断网/非成员）抛错。 */
export const hideBatch = (token: string, convId: string, seqs: number[]) =>
  post(token, "/api/v1/messages/hide", { conv_id: convId, conv_seqs: seqs }, seqs);

/** 为所有人删除（批量）。走 REST，WS 断着也能删；client_msg_id 是整批的幂等键。 */
export const deleteBatch = (token: string, convId: string, seqs: number[]) =>
  post(token, "/api/v1/messages/delete", { conv_id: convId, conv_seqs: seqs, client_msg_id: crypto.randomUUID() }, seqs);
