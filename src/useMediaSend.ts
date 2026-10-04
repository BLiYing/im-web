// useMediaSend：媒体/文件**发送**侧的状态 + 逻辑外壳（阶段 5 从 App.tsx 抽出，CODING_STYLE §7「①自有状态+一组操作」）。
// 自有：附件面板开合 attachPanel / 粘贴攒批 pastedImages / 上传进度 uploadProgress / 留存 File 的 pendingFilesRef /
// 取消集合 cancelledSendsRef / 附件入口 ref 与悬停关闭计时。操作：相册批发 sendMediaBatch（选完秒上屏→逐张上传→
// 原地换 URL→socket 发送）/ 单件 uploadAndSend / 暂停·恢复 toggleUploadPause / 取消 cancelSendMessage /
// teardownOutboxUpload / 失败重试 retryUpload / 媒体气泡点按路由 onMediaBubbleTap / 粘贴 addPastedFiles·onComposerPaste /
// 附件入口 pickFile·onFilePicked·attachItems。函数体逐字平移，行为不变。
// 副作用依赖注入：clientRef / setToast / uid / peer / groupConvId / 消息表三方法（appendMsg·patchMsg·removeMsgRow，来自 useMessageStore）。
// ⚠️ 文本+附件合并发送的编排 send() 仍在 App（与 input/replyTo/editingMsg/mention 互咬，§7「胶水别硬抽」），它消费本 Hook。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, MutableRefObject } from "react";
import { Image as ImageIcon, FileText } from "lucide-react";
import type { IMClient } from "./sdk/imSdk";
import { convIdFor, type ChatMessage } from "./sdk/protocol";
import { chunkedTaskFor } from "./sdk/chunkedUpload";
import { mediaKindForFile, webCanRenderMedia, MEDIA_PICKER_ACCEPT } from "./fileTypes";
import { attachmentContentType, shouldSendAsMediaBatch, type AttachmentPickMode } from "./attachments";
import { planAlbumBatch, albumOverflowToast } from "./albumBatch";
import { makeTinyThumbFromImage, probeMediaMetadata } from "./media";
import { captureVideoPoster } from "./videoPoster";
import { LOG_TAG, logger } from "./logging/logger";
import { resendPolicyFor } from "./resendPolicy";
import { resendMessage as sdkResendMessage } from "./sdk/resend";

export interface MediaSendDeps {
  uid: string;
  peer: string;
  groupConvId: string;
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  appendMsg: (convId: string, m: ChatMessage) => void;
  patchMsg: (cid: string, clientMsgId: string, patch: Partial<ChatMessage>) => void;
  removeMsgRow: (cid: string, key: string) => void;
  /** 语音上传失败的重试（见 useVoiceSend）：语音不走本 Hook 的 pendingFilesRef/retryUpload
   *  （与 iOS `im_resendSingleMessage:` 按 contentType 分两条腿同一取舍），resendOne 据此分派。 */
  retryVoiceUpload: (m: ChatMessage) => void;
}

export function useMediaSend(d: MediaSendDeps) {
  const { uid, peer, groupConvId, clientRef, setToast, appendMsg, patchMsg, removeMsgRow, retryVoiceUpload } = d;
  const [attachPanel, setAttachPanel] = useState(false); // 附件面板（图片或视频/文件，M4-6）

  const pendingFilesRef = useRef<Map<string, { file: File; mode: AttachmentPickMode; convId: string; groupId?: string; caption?: string; mentions?: string[]; mentionAll?: boolean }>>(new Map());
  // 已被用户取消的出箱件：发送流水线（sendMediaBatch/uploadAndSend）在每个边界检查它，
  // 跳过后续上传与 sendMedia——因为 cancel() 只能中断在飞的**分片**任务，小文件 XHR、排队中的
  // 相册成员、以及"上传完成→poster→sendMedia"窗口都没有可 abort 的任务，必须靠这个集合拦住。
  const cancelledSendsRef = useRef<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<Record<string, { sent: number; total: number }>>({});
  const clearUploadProgress = useCallback((key: string) => {
    setUploadProgress((prev) => { if (!(key in prev)) return prev; const nx = { ...prev }; delete nx[key]; return nx; });
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
  const [pastedImages, setPastedImages] = useState<{ file: File; url: string; kind: "image" | "video" | "file" }[]>([]);
  // 粘贴限单件的替换判定用镜像 ref（addPastedFiles 是空 deps 回调，直接读 state 会拿到陈旧闭包）。
  const pastedImagesRef = useRef(pastedImages);
  pastedImagesRef.current = pastedImages;
  // source：文件是粘贴进来的还是拖进来的（useFileDrop 走同一条路），只影响提示文案。
  const addPastedFiles = useCallback((files: File[], source: "paste" | "drop" = "paste") => {
    // 走与文件选择器同一个类型闸：可发送的图片/视频进"媒体批量"通道（image/video），
    // 其余（含 svg——MIME 是 image/svg+xml，旧代码会误判成 image 送进批量→服务端拒传坏气泡）走文件通道。
    // 网页端解不了码的媒体（HEIC 等）直接丢弃：发出去自己看不了。（非媒体文件仍按文件发，行为不变。）
    // 视频保留 video 种类而非并入 image：否则预览条会拿视频 blob 塞进 <img> → 破图（见预览渲染）。
    const keep: { file: File; url: string; kind: "image" | "video" | "file" }[] = [];
    let dropped = 0;
    for (const f of files) {
      const k = mediaKindForFile(f);
      if (k !== null && !webCanRenderMedia(k, f.name)) { dropped++; continue; }
      keep.push({ file: f, url: URL.createObjectURL(f), kind: k ?? "file" });
    }
    if (dropped) setToast("为保证各端可见，已忽略 HEIC 等格式");
    if (!keep.length) return;
    // 粘贴限单件（2026-08-19 拍板）：一次只保留一个附件（图/视频/文件三选一），后粘的替换先前的——
    // 图说 caption 只对单件消息定义，多件会退回「各发各的」旧路径。多选/相册仍走附件选择器，不受此限。
    // 保留**最后一个**（=最新，与 toast 文案及 iOS 的逐张替换语义一致；code-review 修正：原取 first 与文案相反）。
    const kept = keep[keep.length - 1];
    const replaced = [...pastedImagesRef.current, ...keep.slice(0, -1)];
    // 被替换项延迟 revoke：预览条 <img>/<video> 可能仍挂着旧 blob URL，同步回收会闪断图 + 控制台报错
    //（与 send() 的 60s 延迟回收同策略）。
    replaced.forEach((p) => window.setTimeout(() => URL.revokeObjectURL(p.url), 60_000));
    if (replaced.length) setToast(`一次只能${source === "drop" ? "拖入" : "粘贴"}一个文件，已保留最新的`);
    setPastedImages([kept]);
  }, []);
  const removePastedImage = useCallback((idx: number) => {
    setPastedImages((prev) => { const nx = prev.slice(); const [rm] = nx.splice(idx, 1); if (rm) URL.revokeObjectURL(rm.url); return nx; });
  }, []);
  const onComposerPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); addPastedFiles(files); }
  }, [addPastedFiles]);

  // 相册批量发送（M4+）：**选完秒上屏**——每张先用本地 blob URL 占位（≥2 张共享 group_id → 宫格聚簇），
  // 逐张上传后原地替换为服务器 URL 并走 socket 发送（带 group_id）；单张失败标该格不阻塞后续。
  // **本函数是发送侧 group_id 与 9 件上限的唯一收口**：附件选择器（onFilePicked）与粘贴攒批（App#send）
  // 都汇到这里，判据本身在纯模块 albumBatch.ts（见那里的注释：别在调用侧再拼一份）。
  const sendMediaBatch = useCallback(async (files: File[], opts?: { convId?: string; groupId?: string; caption?: string; mentions?: string[]; mentionAll?: boolean }) => {
    const client = clientRef.current;
    // opts 用于重试：按原会话/原相册重发（不耦合当前打开的会话）。
    const cid = opts?.convId ?? (peer ? convIdFor(uid, peer) : groupConvId);
    if (!client || !cid || files.length === 0) return;
    // 截到 9 件（三端同值）并定这一批的 group_id。超出的**必须告知**——多发的那几条会真的进对端库，
    // 却因宫格只有 9 格而两端都不显示，静默丢弃比发不出去更难查（详见 albumBatch.ts#ALBUM_MAX）。
    const plan = planAlbumBatch(files, { groupId: opts?.groupId, newId: () => crypto.randomUUID() });
    const overflow = albumOverflowToast(plan.dropped);
    if (overflow) setToast(overflow);
    const batch = plan.batch;
    const groupId = plan.groupId;
    // caption（图文/视频文，Telegram 图说模型）：仅单件时随附（相册不带 caption，见 send()）；挂到唯一那条消息。
    // 配文 @提及同随单件带上（群聊被@强提醒）。
    const caption = batch.length === 1 ? opts?.caption : undefined;
    const capMentions = batch.length === 1 ? opts?.mentions : undefined;
    const capMentionAll = batch.length === 1 ? opts?.mentionAll : undefined;
    // 图/视频归类走统一入口 mediaKindForFile（含扩展名回退）：MIME 缺失的 .mov 等也能判成 video，
    // 否则乐观气泡会当成 image（<img> 放视频→坏图）且跳过封面/时长探测。null（异常漏进来的）退回 MIME。
    const locals = batch.map((f) => {
      const mk = mediaKindForFile(f);
      const isVideo = mk === "video" || (mk === null && f.type.startsWith("video/"));
      return { f, isVideo, localId: `outbox-${crypto.randomUUID()}`, blobUrl: URL.createObjectURL(f), posterFile: null as File | null, posterBlobUrl: undefined as string | undefined, meta: { width: 0, height: 0, durationMs: 0 } };
    });
    for (const l of locals) {
      appendMsg(cid, {
        clientMsgId: l.localId, convId: cid, from: uid, content: l.blobUrl,
        contentType: l.isVideo ? "video" : "image",
        convSeq: 0, timestamp: Date.now(), status: "sending", groupId, caption,
        mentions: capMentions, mentionAll: capMentionAll,
      });
      setUploadProgress((prev) => ({ ...prev, [l.localId]: { sent: 0, total: l.f.size } })); // 排队中：先显“等待中”
    }
    // 视频：先在本地抓首帧 → 立刻用 blob 封面显示（发送端不必等上传就见封面）；抓到的 File 复用做上传。
    // 同时量出像素尺寸与时长 → 本地气泡立刻按原比例排版，并随消息上行给收端。
    await Promise.all(locals.map(async (l) => {
      l.meta = await probeMediaMetadata(l.f);
      if (l.meta.width > 0) { patchMsg(cid, l.localId, { mediaW: l.meta.width, mediaH: l.meta.height, duration: l.meta.durationMs, fileSize: l.f.size }); }
      if (!l.isVideo) return;
      const pf = await captureVideoPoster(l.f); // 发送端封面恒派生：收端靠它；「视频预加载」只管收端预览 <video>（POWER_SAVING §4.3）
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
        // 极小模糊预览（M4-7）：图片本体 / 视频封面首帧的缩略，随消息带 thumb；收端未下载时显模糊占位。失败不阻塞。
        let thumb: string | undefined;
        if (contentType === "image") thumb = await makeTinyThumbFromImage(l.f);
        else if (contentType === "video" && l.posterFile) thumb = await makeTinyThumbFromImage(l.posterFile);
        if (takeCancelled()) continue;
        const clientMsgId = client.sendMedia(url, contentType, peer, cid, {
          groupId, poster, thumb, mediaW: l.meta.width, mediaH: l.meta.height, duration: l.meta.durationMs, fileSize: l.f.size, caption,
          mentions: capMentions, mentionAll: capMentionAll,
        });
        // thumb 也写回本地行：否则转发「自己发的」图片/视频时源消息无 thumb，收端只剩空占位（详见 forward 修复）。
        patchMsg(cid, l.localId, { clientMsgId, content: url, contentType, posterUrl: poster || l.posterBlobUrl, thumb });
        clearUploadProgress(l.localId); // 传完：左上角进度胶囊消失，切回时长角标
        mainOrphaned = true;      // 主体已切服务器 URL → 本地 blob 可回收
        posterOrphaned = !!poster; // 仅当封面也上到服务器才回收本地封面 blob（回退时还在显）
      } catch (e) {
        clearUploadProgress(l.localId);
        if ((e as Error).name === "UploadCancelledError") { takeCancelled(); revokeNow(); continue; } // 分片任务被 cancel()
        patchMsg(cid, l.localId, { status: "failed" });
        pendingFilesRef.current.set(l.localId, { file: l.f, mode: "media", convId: cid, groupId, caption, mentions: capMentions, mentionAll: capMentionAll }); // 留住 File+分组+caption+@：点失败气泡按原相册重试、不丢字不丢@
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

  // 注意：uploadAndSend 须先于 retryUpload / onFilePicked 声明——它们的 useCallback deps 在 Hook 体内即时求值，
  // 后置声明会踩 const TDZ（ReferenceError）。
  const uploadAndSend = useCallback(async (file: File, pickMode: AttachmentPickMode = "media", convIdOverride?: string, caption?: string, mentions?: string[], mentionAll?: boolean) => {
    const client = clientRef.current;
    // convIdOverride 用于重试：按原会话重发（不耦合当前打开的会话）。
    const cid = convIdOverride ?? (peer ? convIdFor(uid, peer) : groupConvId);
    if (!client || !cid) return;
    // 先上屏一条占位消息再上传：大文件传几十秒，原先"传完才出现"期间界面毫无反馈，用户以为卡死。
    const localId = `outbox-${crypto.randomUUID()}`;
    appendMsg(cid, {
      clientMsgId: localId, convId: cid, from: uid, content: "", contentType: attachmentContentType(pickMode, "file"),
      fileName: file.name, fileSize: file.size, caption, mentions, mentionAll, convSeq: 0, timestamp: Date.now(), status: "sending",
    });
    setUploadProgress((prev) => ({ ...prev, [localId]: { sent: 0, total: file.size } }));
    pendingFilesRef.current.set(localId, { file, mode: pickMode, convId: cid, caption, mentions, mentionAll }); // 失败时据此重试（含 caption/@，不丢字不丢@）
    const takeCancelled = () => cancelledSendsRef.current.delete(localId); // 取消：文件无 blobURL，无需 revoke
    try {
      const { url, contentType: uploadedContentType, size } = await client.uploadFile(file, (sent, total) => {
        const ratio = total > 0 ? Math.min(sent / total, 1) : 0;
        setUploadProgress((prev) => ({ ...prev, [localId]: { sent: Math.round(ratio * file.size), total: file.size } }));
      }, localId);
      if (takeCancelled()) return; // 小文件 XHR 无法 abort：传完了但用户已取消 → 不发消息
      const contentType = attachmentContentType(pickMode, uploadedContentType);
      let poster: string | undefined;
      let thumb: string | undefined; // 极小模糊预览（M4-7）：收端未下载时显模糊占位
      if (pickMode === "media" && contentType === "video") {
        const pf = await captureVideoPoster(file);
        if (pf) {
          thumb = await makeTinyThumbFromImage(pf); // 视频封面首帧的缩略
          try { poster = (await client.uploadFile(pf)).url; } catch { /* 封面上传失败：不阻塞 */ }
        }
      } else if (pickMode === "media" && contentType === "image") {
        thumb = await makeTinyThumbFromImage(file);
      }
      if (takeCancelled()) return; // poster 窗口内被取消 → 不发消息
      const options = contentType === "file"
        ? { fileName: file.name, fileSize: size, caption, mentions, mentionAll }
        : ((poster || thumb || caption || mentions?.length || mentionAll) ? { poster, thumb, caption, mentions, mentionAll } : undefined);
      const clientMsgId = client.sendMedia(url, contentType, peer, cid, options);
      // thumb 也写回本地行：否则转发「自己发的」图片/视频时源消息无 thumb，收端只剩空占位（详见 forward 修复）。
      patchMsg(cid, localId, { clientMsgId, content: url, contentType, posterUrl: poster, thumb });
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


  /// 重试失败的媒体/文件消息（图片/视频/文件通吃）：移除旧占位，用留存的 File 按**原会话/原相册**
  /// 重发（新的 localId）。媒体走批量通道（保留 groupId → 宫格成员回原格）；文件走单发通道。
  const retryUpload = useCallback((m: ChatMessage) => {
    const key = m.clientMsgId ?? "";
    const kept = pendingFilesRef.current.get(key);
    if (!kept) { setToast("原文件已失效，请重新选择"); return; }
    pendingFilesRef.current.delete(key);
    removeMsgRow(m.convId, key);
    if (kept.mode === "media") void sendMediaBatch([kept.file], { convId: kept.convId, groupId: kept.groupId, caption: kept.caption, mentions: kept.mentions, mentionAll: kept.mentionAll });
    else void uploadAndSend(kept.file, kept.mode, kept.convId, kept.caption, kept.mentions, kept.mentionAll);
  }, [removeMsgRow, sendMediaBatch, uploadAndSend]);

  /// 单条重发（红❗入口的实现，见下）。
  const resendOne = useCallback((one: ChatMessage) => {
    switch (resendPolicyFor(one, one.from === uid)) {
      case "none": return;             // 红❗此时本就不可点，走到这里只可能是并发改了状态
      case "retry-upload":
        // 语音上传不走本 Hook 的常驻 pendingFilesRef（单列一条路，见 useVoiceSend 顶部注释），
        // 与 iOS `im_resendSingleMessage:` 按 contentType 分派同一取舍。
        if (one.contentType === "voice") { retryVoiceUpload(one); return; }
        retryUpload(one); return;
      case "same-id": {
        const client = clientRef.current;
        // to：单聊=对端 uid，群聊=""（服务端按 conv_id 写扩散）。与首发同一个取值来源。
        if (!client || !sdkResendMessage(client, one, peer)) { setToast("这条消息内容已丢失，无法重发"); return; }
        // 立刻转"发送中"：红❗消失，给出点击反馈（否则 ack 超时窗内像点了没反应）。
        // note/noteCode 一并清掉，否则上一轮失败的系统行会挂在这一轮重试上。
        patchMsg(one.convId, one.clientMsgId!, { status: "sending", note: undefined, noteCode: undefined });
        return;
      }
    }
  }, [uid, peer, clientRef, patchMsg, setToast, retryUpload, retryVoiceUpload]);

  /// 红❗点击的唯一入口（与 iOS `im_resendMessage:` 同一套）：按 `resendPolicyFor` 分派——
  /// 上传失败 → 用留存的 File 重传（换新 localId）；send_msg 失败 → 按**原 clientMsgId** 重发
  /// （服务端 (conv_id, client_msg_id) 幂等去重，换新 ID 会让对端收到两条）。
  /// 相册宫格外侧只有一个红❗ → 传该组任一成员 + 同会话消息表，点一次重发整组失败成员。
  const resendMessage = useCallback((m: ChatMessage, all?: ChatMessage[]) => {
    if (m.groupId && all) {
      // 先拍快照再遍历：重传会就地改消息表（旧行删了重建），边遍历边改要出错。
      for (const mm of all.filter((x) => x.groupId === m.groupId)) resendOne(mm);
      return;
    }
    resendOne(m);
  }, [resendOne]);

  /// 媒体气泡点按路由（与 iOS 中心按钮状态机一致）：失败 ↻ 重试；上传中 ⏸↔↑ 暂停恢复
  /// （仅 ≥8MB 分片任务；小文件几秒传完不可暂停，点击忽略）；已发出 → 打开查看器。
  const onMediaBubbleTap = useCallback((m: ChatMessage, openViewer: () => void) => {
    const mine = m.from === uid;
    if (mine && resendPolicyFor(m, mine) === "retry-upload") {
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
    { id: "media", label: "图片或视频", accept: MEDIA_PICKER_ACCEPT, icon: ImageIcon }, // 显式扩展名白名单：系统选择器从源头灰掉 HEIC 等（详见 fileTypes.MEDIA_PICKER_ACCEPT）
    { id: "file", label: "文件", accept: "*/*", icon: FileText },
  ], []);
  const pickFile = useCallback((mode: AttachmentPickMode, accept: string) => {
    cancelAttachClose();
    setAttachPanel(false);
    attachmentPickModeRef.current = mode;
    const inp = fileInputRef.current;
    if (inp) { inp.accept = accept; inp.multiple = accept !== "*/*"; inp.value = ""; inp.click(); } // 图片/视频可多选（相册）
  }, [cancelAttachClose]);
  const onFilePicked = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const mode = attachmentPickModeRef.current;
    if (shouldSendAsMediaBatch(mode)) {
      // 「图片或视频」入口两道闸：① 只收图片/视频（与 iOS 对齐，非媒体请走「文件」入口——accept 只是 UI 提示可被绕过）；
      // ② 挡跨端兼容差的格式：HEIC/MKV 等在多数网页端（Chrome/Firefox）看不了——即便本机是 Safari 能看，
      //    发出去也坑其它网页端收件人 → 拒发，请转成 JPG/PNG/MP4 再发。
      const valid: File[] = [];
      let notMedia = 0, notRenderable = 0;
      for (const f of files) {
        const k = mediaKindForFile(f);
        if (k === null) { notMedia++; continue; }
        if (!webCanRenderMedia(k, f.name)) { notRenderable++; continue; }
        valid.push(f);
      }
      if (notRenderable > 0) setToast("为保证各端可见，已忽略 HEIC 等格式；请转成 JPG/PNG 再发");
      else if (notMedia > 0) setToast(notMedia === files.length ? "只能发送图片或视频" : `已忽略 ${notMedia} 个非图片/视频文件`);
      if (valid.length) void sendMediaBatch(valid);
    } else { for (const f of files) void uploadAndSend(f, "file"); }
  }, [uploadAndSend, sendMediaBatch]);

  return {
    attachPanel, setAttachPanel,
    pendingFilesRef, uploadProgress, teardownOutboxUpload, hasActiveSend, toggleUploadPause, cancelSendMessage,
    pastedImages, setPastedImages, addPastedFiles, removePastedImage, onComposerPaste,
    sendMediaBatch, uploadAndSend, retryUpload, resendMessage, onMediaBubbleTap,
    fileInputRef, attachAnchorRef, cancelAttachClose, scheduleAttachClose, attachItems, pickFile, onFilePicked,
  };
}
