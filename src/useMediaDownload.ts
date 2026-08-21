// useMediaDownload：媒体/文件下载门控与缓存的状态 + 逻辑外壳（阶段 4 从 App.tsx 抽出，CODING_STYLE §7
// 「①有自己状态+一组操作 → 自定义 Hook」）。自有：策略 dlSettings / 文件下载态 dlStates / 应用内 blob dlBlobs /
// 图片·视频解门控 mediaOptedIn / 持久失效 expiredSet / 运行期不可渲染 unsupportedSet（+ 对应 ref）。
// 操作：mediaGate 判定 / mediaSrc / 文件点击路由 openReadyFile / 另存 saveMessageToDisk / 带进度 startDownload /
// 失效复验 markExpiredIfGone / 被动失败入口 onPassiveMediaError / 门控卡点击 onGateTap / 策略拉取·保存 /
// 清缓存 clearMediaCache；以及原散在 App enterApp/logout/查看器 effect 里的三段收口：restoreDownloadState（登录回灌）/
// resetDownloadState（退登清空）/ optInMedia（打开查看器=解门控）。
// 副作用依赖全部注入（clientRef/setToast/setViewer/uid/groupConvId），Hook 不摸全局。函数体逐字平移，行为不变。
import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage } from "./sdk/protocol";
import { parseDownloadSettings, shouldAutoDownload, type DownloadSettings, type DownloadState } from "./download";
import { cachePutBlob, cacheMatchBlob, cacheClear, loadStrSet, saveStrSet, expiredKey, downloadedFilesKey } from "./mediaCache";
import { loadOptedIn, saveOptedIn, optedInKey } from "./optedIn";
import { fileNameFromContent, isPreviewableFile } from "./messageContent";
import { LOG_TAG, logger } from "./logging/logger";

export interface MediaDownloadDeps {
  uid: string;
  groupConvId: string;
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  setViewer: (v: { m: ChatMessage; fromGallery?: boolean } | null) => void;
}

export function useMediaDownload(deps: MediaDownloadDeps) {
  const { uid, groupConvId, clientRef, setToast, setViewer } = deps;

  const [dlSettings, setDlSettings] = useState<DownloadSettings | null>(null);
  const [dlStates, setDlStates] = useState<Record<string, DownloadState>>({}); // content → 下载态（**仅文件**用状态机）
  const [dlBlobs, setDlBlobs] = useState<Record<string, string>>({});          // content → objectURL（**仅文件**的应用内缓存）
  const dlBlobsRef = useRef<Record<string, string>>({});
  dlBlobsRef.current = dlBlobs;
  const dlAbortRef = useRef<Record<string, AbortController>>({}); // content → 在飞请求的中止句柄（✕ 取消要真中止）
  // 图片/视频门控（方案 B）：不下到内存 blob，只记「已解门控」的 content——解门控后直接 <img/video src=远端>，
  // 浏览器 HTTP 缓存兜底持久（刷新仍在）。门控判定本身保留：大图/视频先显模糊占位、点了才拉，省流量。
  const [mediaOptedIn, setMediaOptedIn] = useState<Set<string>>(new Set());
  // 持久失效标记（草图 §06 404 止损）：命中 404/410 的 content 落 localStorage（按 uid）。mediaGate 据此直接
  // 画失效占位、不再回源 → 掐 404 风暴、刷新仍显失效。ref 供 render 中的 onError 回调同步去重、避免重复复验。
  const [expiredSet, setExpiredSet] = useState<Set<string>>(new Set());
  const expiredRef = useRef<Set<string>>(expiredSet);
  expiredRef.current = expiredSet;
  // 「网页端无法渲染」运行期标记（编解码级失败，扩展名看不出，如 mp4 里的 HEVC）：<img>/<video> onError 且非 404 时落此集。
  // 容器级已知不支持（heic/mkv 等）由 webCanRenderMedia 直接判定、无需入集。仅内存：刷新后一次加载尝试即可复得，无需持久化。
  const [unsupportedSet, setUnsupportedSet] = useState<Set<string>>(new Set());
  const unsupportedRef = useRef<Set<string>>(unsupportedSet);
  unsupportedRef.current = unsupportedSet;
  const markUnsupported = useCallback((content: string) => {
    if (!content) return;
    setUnsupportedSet((s) => (s.has(content) ? s : new Set(s).add(content)));
  }, []);
  /** 把某 content 标记为永久失效（幂等）：更新内存态 + 持久化。 */
  const markExpired = useCallback((content: string) => {
    if (!content) return;
    setExpiredSet((s) => {
      if (s.has(content)) return s;
      const n = new Set(s); n.add(content); saveStrSet(expiredKey(uid), n); return n;
    });
  }, [uid]);

  /** 打开查看器 = 用户主动看原图 → 标记「已解门控」（对齐 iOS 档 B）；幂等、落 localStorage。 */
  const optInMedia = useCallback((content: string) => {
    setMediaOptedIn((s) => { if (s.has(content)) return s; const n = new Set(s); n.add(content); saveOptedIn(uid, n); return n; });
  }, [uid]);

  const refreshDownloadSettings = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const res = await c.downloadSettings();
      const next = parseDownloadSettings(res?.settings);
      setDlSettings(next);
      // 策略是所有门控判定的输入；version 与服务端 download_settings_saved 对账即可确认多端同步到没到本端。
      logger.info(LOG_TAG.media, "download_settings_applied", {
        version: Number(res?.version) || 0,
        wifi_enabled: next.wifi.enabled,
        wifi_video_max_bytes: next.wifi.video.max_bytes,
        wifi_file_max_bytes: next.wifi.file.max_bytes,
      });
    } catch (e) {
      // 拉不到 → 静默沿用默认策略，门控行为会与用户设置不一致，必须留痕。
      logger.warn(LOG_TAG.media, "download_settings_unavailable", { error: (e as Error).message, fallback: "defaults" });
    }
  }, []);

  /** 保存策略（乐观应用 + PUT；失败回滚重拉，与 iOS 同口径）。 */
  const saveDownloadSettings = useCallback(async (next: DownloadSettings) => {
    const c = clientRef.current;
    setDlSettings(next);
    if (!c) return;
    try {
      const res = await c.saveDownloadSettings(next);
      setDlSettings(parseDownloadSettings(res?.settings)); // 以服务端规整后的为准
    } catch (e) {
      logger.warn(LOG_TAG.media, "download_settings_save_failed", { error: (e as Error).message, rollback: true });
      setToast(`保存失败：${(e as Error).message}`);
      void refreshDownloadSettings();
    }
  }, [refreshDownloadSettings]);

  /**
   * 这条收到的媒体/文件当前的门控态：**undefined = 就绪**（可直接显图/播放/打开）。
   * 非 undefined 时卡片显 ↓ / 进度 / ↻，点击走 `startDownload`。
   * 自己发的、上传中的、撤回的一律不门控（本地就有原件或还没有远端地址）。
   */
  const mediaGate = useCallback((m: ChatMessage): DownloadState | undefined => {
    if (!m.content || m.recalledAt) return undefined;
    const kind = m.contentType;
    if (kind !== "image" && kind !== "video" && kind !== "file") return undefined;
    // 网页端无法渲染的媒体 → 显"无法预览·点击下载"降级卡（避免破图/黑屏）。**判定靠本浏览器实测**（<img>/<video>
    // onError 落 unsupportedSet），不写死黑名单——HEIC/TIFF 等能否渲染是**浏览器相关**的（Safari 支持 HEIC、Chrome 不支持），
    // 写死会把 Safari 上本可显示的图也误降级。放在 from===uid 之前：自己从 iOS 发的 HEIC 在不支持的浏览器同样看不了。
    if ((kind === "image" || kind === "video") && unsupportedSet.has(m.content)) {
      return { phase: "unsupported", received: 0, total: m.fileSize ?? 0 };
    }
    if (m.from === uid) return undefined; // 自己发的（本浏览器可渲染）不门控
    // 持久失效标记优先（草图 §06）：已知服务端已清理 → 直接失效态、不回源（掐 404 风暴）。三类消息统一。
    if (expiredSet.has(m.content)) return { phase: "expired", received: 0, total: m.fileSize ?? 0 };
    // 群/单聊分档：渲染中的消息恒属当前打开的会话，故用 groupConvId 判定（isGroupChat 在此之后才定义）。
    const passesPolicy = shouldAutoDownload(dlSettings, kind, m.fileSize ?? 0, !!groupConvId);
    if (kind === "image" || kind === "video") {
      // 方案 B：图片/视频不落 blob，只判「要不要拉原件」。已解门控 / 策略放行 → 直显远端；否则显模糊占位 + ↓。
      if (mediaOptedIn.has(m.content) || passesPolicy) return undefined;
      return { phase: "notStarted", received: 0, total: m.fileSize ?? 0 };
    }
    // 文件：保留应用内下载状态机（进度环 / 取消 / 失效 / 就绪走 blob）。
    if (dlBlobs[m.content]) return undefined;                       // 已下到应用内缓存
    const st = dlStates[m.content];
    if (st) return st.phase === "done" ? undefined : st;            // 进行中 / 失败 / 已失效
    if (passesPolicy) return undefined;                             // 策略放行=浏览器直取
    return { phase: "notStarted", received: 0, total: m.fileSize ?? 0 };
  }, [uid, dlBlobs, dlStates, dlSettings, groupConvId, mediaOptedIn, expiredSet, unsupportedSet]);

  /** 该消息应当渲染的地址：已手动下载过用应用内 blob，否则用远端 URL。 */
  const mediaSrc = useCallback((m: ChatMessage) => dlBlobs[m.content] || m.content, [dlBlobs]);

  /**
   * 就绪文件点击路由（对齐 iOS QuickLook 的 Web 诚实映射）：可预览类型（pdf/图片/音视频/文本）在**新标签预览**，
   * 其余（zip/dmg/office…）触发**另存**——绝不静默走浏览器下载。已手动下过的走应用内 blob，否则远端 URL。
   */
  const openReadyFile = useCallback(async (m: ChatMessage) => {
    const name = m.fileName || fileNameFromContent(m.content);
    const url = dlBlobsRef.current[m.content] || m.content;
    if (isPreviewableFile(name)) {
      window.open(url, "_blank", "noopener,noreferrer"); // 预览：不 await（保用户手势，避免弹窗拦截），失效则新标签自显 404
      return;
    }
    // 另存：用远端 URL 时先验失效——避免"能看却下不了"只丢一个浏览器下载失败（见铁律 A 讨论）。
    if (url === m.content && await markExpiredIfGoneRef.current(m)) {
      setToast(m.contentType === "image" ? "图片已失效" : m.contentType === "video" ? "视频已失效" : "文件已失效");
      return;
    }
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  }, []);

  /**
   * 右键菜单「下载」：把这条图片/视频/文件**保存到本地**（浏览器下载目录，如 ~/Downloads）。复用应用内已下的 blob
   * （dlBlobs），否则拉远端 URL（同源，`download` 属性生效）——与 openReadyFile 的另存分支同一套落盘逻辑。
   */
  const saveMessageToDisk = useCallback(async (m: ChatMessage) => {
    if (!m.content) return;
    const name = m.fileName || fileNameFromContent(m.content);
    const url = dlBlobsRef.current[m.content] || m.content;
    // 用远端 URL 时先验失效：Chrome 可能靠 HTTP 缓存还显示着图，但源已删——下载会 404。先探一次，
    // 命中则 toast「已失效」+ 标记（下次渲染各面统一显失效），不再丢一个懵的浏览器下载失败（铁律 A 讨论）。
    if (url === m.content && await markExpiredIfGoneRef.current(m)) {
      setToast(m.contentType === "image" ? "图片已失效" : m.contentType === "video" ? "视频已失效" : "文件已失效");
      return;
    }
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  }, []);

  /**
   * 手动下载到应用内缓存（带真进度）。失败分因：404/410=服务端已清理 → "文件已失效"、不给重试。
   * 刷新会丢（blob URL 活在本页生命周期内），与上传的同类限制一致。
   */
  const startDownload = useCallback(async (m: ChatMessage) => {
    const key = m.content;
    if (!key || dlBlobsRef.current[key]) return;
    // 只在真正发起时记（mediaGate 每次 render 都会走，绝不能在那里打日志）。
    const startedAt = Date.now();
    logger.info(LOG_TAG.media, "download_start", {
      conv_id: m.convId, conv_seq: m.convSeq, kind: m.contentType, size_bytes: m.fileSize ?? 0,
      file_name: m.fileName,
    });
    setDlStates((p) => ({ ...p, [key]: { phase: "downloading", received: 0, total: m.fileSize ?? 0 } }));
    const ac = new AbortController();
    dlAbortRef.current[key] = ac;
    try {
      const resp = await fetch(key, { signal: ac.signal });
      if (!resp.ok) {
        const gone = resp.status === 404 || resp.status === 410;
        // status 是「文件已失效」与「可重试」分因的依据（与 iOS download_http_error 同语义）。
        logger.warn(LOG_TAG.media, "download_http_error", {
          conv_id: m.convId, conv_seq: m.convSeq, status: resp.status, expired: gone,
        });
        setDlStates((p) => ({ ...p, [key]: { phase: gone ? "expired" : "failed", received: 0, total: m.fileSize ?? 0 } }));
        if (gone) markExpired(key); // 持久失效：刷新后仍显失效、不再回源
        return;
      }
      const total = Number(resp.headers.get("Content-Length")) || m.fileSize || 0;
      let blob: Blob;
      if (resp.body) {
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        // 进度节流：App 很大，若每个数据块都 setState 会整树重渲染上千次。只在整数百分比变化
        // （总大小未知时按 256KB 步进）时才更新；最终 done 会补齐 100%。
        let lastPct = -1, lastAt = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const pct = total > 0 ? Math.floor((received / total) * 100) : -1;
          if (pct !== lastPct || received - lastAt >= 262144) {
            lastPct = pct; lastAt = received;
            setDlStates((p) => ({ ...p, [key]: { phase: "downloading", received, total } }));
          }
        }
        blob = new Blob(chunks as BlobPart[], { type: resp.headers.get("Content-Type") || "application/octet-stream" });
      } else {
        blob = await resp.blob(); // 老浏览器无流式 body：只能等整段（无中间进度）
      }
      const url = URL.createObjectURL(blob);
      setDlBlobs((p) => ({ ...p, [key]: url }));
      // C1：字节写入 Cache Storage + 记入"已下载文件"键集合 → 刷新/离线仍在、秒开（对齐 iOS 落盘）。
      void cachePutBlob(uid, key, blob);
      const dlf = loadStrSet(downloadedFilesKey(uid)); dlf.add(key); saveStrSet(downloadedFilesKey(uid), dlf);
      // 完成即止：只置"就绪"，**不**自动打开/播放（铁律②）。
      setDlStates((p) => ({ ...p, [key]: { phase: "done", received: total, total } }));
      logger.info(LOG_TAG.media, "download_completed", {
        conv_id: m.convId, conv_seq: m.convSeq, bytes: blob.size, duration_ms: Date.now() - startedAt,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // 用户按 ✕ 取消：状态已回落"未下载"，别覆盖成失败
      logger.warn(LOG_TAG.media, "download_failed", {
        conv_id: m.convId, conv_seq: m.convSeq, duration_ms: Date.now() - startedAt, error: (e as Error).message,
      });
      setDlStates((p) => ({ ...p, [key]: { phase: "failed", received: 0, total: m.fileSize ?? 0 } }));
    } finally {
      if (dlAbortRef.current[key] === ac) delete dlAbortRef.current[key];
    }
  }, [uid, markExpired]);

  /**
   * 被动展示路径（气泡/查看器的原件 <img>/<video>）加载失败时的失效复验：
   * <img onError> 分不清「404 已清理」与「解码失败/瞬时抖动」——只对前者才标失效。用一次轻量 ranged GET
   * （服务端 /uploads 支持 Range）读状态码：404/410 → 落持久失效标记（掐 404 风暴）；其余（网络错/解码）不标，
   * 保留可重试/可重载。已知失效则直接跳过，避免 onError 反复触发复验。
   */
  /** 复验 URL 是否已被服务端清理（404/410）：命中即标记并返回 true。已知失效直接 true；网络错/瞬时返回 false（不误标）。 */
  const markExpiredIfGone = useCallback(async (m: ChatMessage): Promise<boolean> => {
    const key = m.content;
    if (!key) return false;
    if (expiredRef.current.has(key)) return true; // 已知失效
    try {
      const resp = await fetch(key, { headers: { Range: "bytes=0-0" } });
      if (resp.status === 404 || resp.status === 410) {
        logger.warn(LOG_TAG.media, "media_verified_expired", {
          conv_id: m.convId, conv_seq: m.convSeq, kind: m.contentType, status: resp.status,
        });
        markExpired(key);
        return true;
      }
      return false;
    } catch {
      return false; /* 网络错/断网：不标失效（可能只是暂时坏了），保留下次重载 */
    }
  }, [markExpired]);
  // 供 openReadyFile / saveMessageToDisk（定义在前）在点击时调用，规避声明顺序；ref 恒稳、不入依赖数组。
  const markExpiredIfGoneRef = useRef(markExpiredIfGone);
  markExpiredIfGoneRef.current = markExpiredIfGone;

  /** 被动展示（气泡/宫格/资料卡的原件 <img>/<video>）加载失败统一入口：先复验 404→失效；否则=编解码失败→标"网页端无法渲染"降级卡（不再破图）。 */
  const onPassiveMediaError = useCallback(async (m: ChatMessage) => {
    const gone = await markExpiredIfGone(m);
    if (!gone) markUnsupported(m.content);
  }, [markExpiredIfGone, markUnsupported]);

  /** 门控卡片点击路由：下载中 → 取消（Web 无断点续传，只能重来）；已失效 → 不响应；其余 → 下载/重试。 */
  const onGateTap = useCallback((m: ChatMessage) => {
    // 本浏览器实测无法渲染的媒体（HEIC 于 Chrome、HEVC 视频等）：无从"解门控预览"，
    // 点击=打开查看器里的降级卡（统一"先开卡再下载"，与媒体库一致）。
    if ((m.contentType === "image" || m.contentType === "video") && unsupportedRef.current.has(m.content)) {
      setViewer({ m });
      return;
    }
    // 图片/视频（方案 B）：只「解门控」——不下 blob、不走状态机，直接用远端 URL 渲染，浏览器 HTTP 缓存兜底。
    if (m.contentType === "image" || m.contentType === "video") {
      setMediaOptedIn((s) => { const n = new Set(s); n.add(m.content); saveOptedIn(uid, n); return n; });
      return;
    }
    // 文件：应用内下载状态机（进度环 / 取消 / 重试）。
    const st = dlStates[m.content];
    if (st?.phase === "expired") return;
    if (st?.phase === "downloading") {
      logger.warn(LOG_TAG.media, "download_cancelled_by_user", {
        conv_id: m.convId, conv_seq: m.convSeq, received: st.received, total: st.total,
      });
      dlAbortRef.current[m.content]?.abort();                                     // 真中止在飞请求，别让它稍后又"完成"
      setDlStates((p) => { const n = { ...p }; delete n[m.content]; return n; }); // 回到"未下载"
      return;
    }
    void startDownload(m);
  }, [uid, dlStates, startDownload]);

  /** 清空应用内媒体缓存（设置 ▸ 数据与存储）：只删本机，云端保留可重下 → 卡片回退"未下载"。 */
  const clearMediaCache = useCallback(() => {
    logger.info(LOG_TAG.media, "media_cache_cleared", { count: Object.keys(dlBlobsRef.current).length });
    Object.values(dlBlobsRef.current).forEach((u) => URL.revokeObjectURL(u));
    setDlBlobs({});
    setDlStates({});
    setMediaOptedIn(new Set()); // 图片/视频回退模糊占位（浏览器 HTTP 缓存里的字节由浏览器自管，无法在此清除）
    void cacheClear(uid);       // C1：清空该账号 Cache Storage 里的持久文件字节
    try {
      localStorage.removeItem(optedInKey(uid));      // 持久 opt-in 一并清，刷新后也真回退
      localStorage.removeItem(downloadedFilesKey(uid)); // 已下载文件键集合
      // 失效标记**不清**：那是"服务端已删"的客观事实，清了只会刷新后再撞一次 404。
    } catch { /* ignore */ }
  }, [uid]);

  /** 登录后回灌（原 enterApp 内联）：解门控记录 / 失效标记 / Cache Storage 里的已下载文件 → objectURL。 */
  const restoreDownloadState = useCallback(async (forUid: string) => {
    setMediaOptedIn(loadOptedIn(forUid)); // 恢复图片/视频「已解门控」记录（方案 B）：刷新后已看过的媒体仍直显，不回退门控
    setExpiredSet(loadStrSet(expiredKey(forUid))); // 恢复失效标记：已知 404 的媒体刷新后仍显失效、不再回源
    // rehydrate 已下载文件（C1）：从 Cache Storage 取回持久字节 → 重建 objectURL → dlBlobs，对齐 iOS 读盘即"就绪"。
    const keys = [...loadStrSet(downloadedFilesKey(forUid))];
    const restored: Record<string, string> = {};
    for (const k of keys) {
      const blob = await cacheMatchBlob(forUid, k);
      if (blob) restored[k] = URL.createObjectURL(blob);
    }
    if (Object.keys(restored).length) {
      setDlBlobs((p) => ({ ...restored, ...p })); // 已在飞/新下的优先，不覆盖
      logger.info(LOG_TAG.media, "media_cache_rehydrated", { count: Object.keys(restored).length });
    }
  }, []);

  /** 退登清空（原 logout 内联）：revoke 应用内 blob、清下载态，避免 objectURL 泄漏与跨账号残留。 */
  const resetDownloadState = useCallback(() => {
    Object.values(dlBlobsRef.current).forEach((u) => URL.revokeObjectURL(u));
    dlAbortRef.current = {};
    setDlBlobs({});
    setDlStates({});
    setMediaOptedIn(new Set()); // 图片/视频解门控记录：换账号重新门控
    setExpiredSet(new Set());   // 失效标记内存态清空（每 uid 各自持久化，登录时按账号重载）
  }, []);

  return {
    dlSettings, setDlSettings, dlStates, dlBlobs, mediaOptedIn, expiredSet,
    refreshDownloadSettings, saveDownloadSettings, mediaGate, mediaSrc, openReadyFile, saveMessageToDisk,
    markExpired, markExpiredIfGone, onPassiveMediaError, onGateTap, clearMediaCache,
    optInMedia, restoreDownloadState, resetDownloadState,
  };
}
