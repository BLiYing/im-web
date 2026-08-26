// 语音相关的 REST 调用（voice 域）。从 imSdk.ts 拆出——见 scripts/check-file-size.sh 对
// imSdk.ts 的建议「如拆按域分（auth/messages/groups/qr）」；与 qrLogin.ts 同一套做法。
//
// 这两个接口都只依赖「token + 一次 HTTP」，不碰 IMClient 的连接状态/本地库，
// 所以适合做纯函数模块：IMClient 上的同名方法只是带上自己的 token 转调。
import { tracedFetch } from "./http";
import { friendlyMessage } from "./imSdk";

/**
 * 上传语音（voice P1）：/api/v1/upload?as=voice——服务端切用 voice 白名单
 * (.m4a/.aac/.caf/.opus/.ogg/.webm/.mp4) + 16MB 上限。返回 `/uploads/<id>.m4a` 相对 URL。
 * 一次性 multipart（分片对 voice 显式拒绝，5min AAC ≈ 0.9MB 用不着）。
 */
export async function uploadVoice(token: string, blob: Blob, fileName: string): Promise<{ url: string; size: number }> {
  const fd = new FormData();
  fd.append("file", blob, fileName);
  const resp = await tracedFetch("/api/v1/upload?as=voice", {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  const body = await resp.json().catch(() => ({ code: -1, data: {} }));
  if (body.code !== 0 || !body.data) throw new Error(friendlyMessage(body.code, body.message || "语音上传失败"));
  return { url: body.data.url as string, size: Number(body.data.size) || blob.size };
}

/**
 * 语音转文字：POST /api/v1/voice/transcripts。**只传消息坐标不传音频路径**
 * （服务端自己反查 content 并过路径白名单——content 是客户端此前自己写进消息表的，不可信）。
 *
 * 返回 status：`done` 带 text；`pending` 表示已入队，结果随后经 WS voice_transcript 帧到达。
 * 失败时业务码挂在 Error.code（500101 未启用 / 500102 识别失败 / 500103 队列满 / 100002 限流）。
 * 见 IMServer docs/VOICE_TRANSCRIBE_DESIGN.md §3。
 */
export async function transcribeVoice(
  api: (path: string, init?: RequestInit) => Promise<any>,
  convId: string, convSeq: number,
): Promise<{ status: string; text: string }> {
  const d = await api("/api/v1/voice/transcripts", {
    method: "POST",
    body: JSON.stringify({ conv_id: convId, conv_seq: convSeq }),
  });
  return { status: String(d?.status ?? ""), text: String(d?.text ?? "") };
}
