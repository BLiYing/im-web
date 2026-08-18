/** 从视频文件抓取首帧封面（JPEG File），供上传作视频消息封面（M4+）。
 *  浏览器解不了码（如 HEVC）或抓帧失败 → 返回 null（消息则无封面，收端回退 <video>）。
 *
 *  Safari 兼容（BUG-video-poster-safari 修复）：Safari 比 Chrome 严格——`preload="metadata"` 只缓冲元数据不解码帧，
 *  且仅靠 seek/`seeked` 事件**不保证该帧已解码进可绘制缓冲**，drawImage 会得到空帧 → 旧实现在 Safari 上封面与
 *  （由封面派生的）thumb 双双为空（收端只能退灰底占位）。现改为：`preload="auto"` 缓冲可绘制数据 + 静音自动播放
 *  （muted+playsInline 允许无手势播放）强制解码 + `requestVideoFrameCallback` 在帧**真正呈现后**才抓，drawImage 必得真实像素；
 *  并保留 seek / timeupdate / 超时多重兜底，Chrome 行为不变。 */
export function captureVideoPoster(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (result: File | null) => {
      if (done) return; done = true;
      try { video.pause(); } catch { /* 忽略 */ }
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.preload = "auto";       // Safari：metadata 不解码帧，auto 才缓冲可绘制数据
    video.muted = true;
    video.defaultMuted = true;    // 部分 Safari 版本据此判定“静音自动播放可放行”
    video.playsInline = true;
    video.onerror = () => finish(null); // 解不了码（HEVC 等）

    // 帧就绪后抽一帧：videoWidth/Height=0 或 canvas 被 taint（drawImage 抛）→ 尽力兜底为 null。
    const draw = () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { finish(null); return; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { finish(null); return; }
      try { ctx.drawImage(video, 0, 0, w, h); } catch { finish(null); return; }
      canvas.toBlob((blob) => finish(blob ? new File([blob], "poster.jpg", { type: "image/jpeg" }) : null), "image/jpeg", 0.8);
    };
    // rVFC：新帧被送到合成器后回调，是“帧已解码可绘制”的可靠信号（Safari 15.4+/Chrome 均支持）。
    const rvfc = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
    }).requestVideoFrameCallback?.bind(video);

    video.onloadeddata = () => {
      // 跳到极早一帧避开纯黑首帧（不超过片长中点）；seek 失败也无妨，播放兜底会推进。
      try { video.currentTime = Math.min(0.1, (video.duration || 0.2) / 2); } catch { /* 播放兜底 */ }
      // 关键：muted 自动播放强制 Safari 真正解码出帧；拿到帧即抓并在 finish() 里 pause。
      video.play().then(() => {
        if (rvfc) rvfc(() => draw());
        else video.ontimeupdate = () => draw(); // 老浏览器无 rVFC：进度前进即已有可绘制帧
      }).catch(() => {
        // 自动播放被拒（极少数）→ 退回 seek 方案：seek 完成事件里抓（旧行为，Chrome 本就可用）。
        video.onseeked = () => draw();
      });
    };

    window.setTimeout(() => finish(null), 8000); // 兜底超时，避免卡住发送
    video.src = url;
  });
}
