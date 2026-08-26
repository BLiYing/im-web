// voiceRecorder.ts —— Web 语音录制（P1，Telegram 布局：输入栏原地 morph 成录制条）。
//
// 设计参见 IMServer docs/VOICE_MESSAGE_DESIGN.md §4/§9：
//   - AAC 兼容探测：MediaRecorder.isTypeSupported('audio/mp4') → 支持才允许录制；
//     不支持 → mic 按钮置灰 + tooltip"当前浏览器不支持录制语音，可在 App 内发送"。
//     绝不产出 webm/opus——iOS AVFoundation 解不了。
//   - 采样：AnalyserNode 每 100ms 取 RMS → 0~100 百分比 → base64 waveform（≤120 字节）。
//   - 时长上限 5min（超上限自动停并进入待发送态）；<0.6s 提示"说话时间太短"并丢弃。

/** 单条语音硬闸（sketch §12）：到点自动 stopAndSend；导出供 UI 显倒数/文案。 */
export const VOICE_MAX_MS = 5 * 60 * 1000;
const VOICE_MIN_MS = 600;
/** 4:50 起 UI 应显倒数 10s 提示上限逼近（sketch §12）。 */
export const VOICE_COUNTDOWN_START_MS = VOICE_MAX_MS - 10 * 1000;
const VOICE_MAX_WAVEFORM_BYTES = 120;
const VOICE_SAMPLE_INTERVAL_MS = 100;

export interface VoiceRecordingResult {
  blob: Blob;
  mimeType: string; // audio/mp4 or fallback
  fileExtension: string; // ".m4a" typically
  durationMs: number;
  waveformBase64: string;
}

/** 探测浏览器是否支持产出 iOS 可播的音频（audio/mp4 优先，audio/aac 次之）。 */
export function voiceRecordingSupported(): { supported: boolean; mime: string; ext: string } {
  if (typeof MediaRecorder === "undefined") return { supported: false, mime: "", ext: "" };
  // Safari MediaRecorder 通常支持 audio/mp4。Chrome/Firefox 需装 aac codec；标准配置里都不支持。
  const cands: [string, string][] = [
    ["audio/mp4", ".m4a"],
    ["audio/aac", ".aac"],
    ["audio/mp4;codecs=mp4a.40.2", ".m4a"],
  ];
  for (const [m, e] of cands) {
    if (MediaRecorder.isTypeSupported(m)) return { supported: true, mime: m, ext: e };
  }
  return { supported: false, mime: "", ext: "" };
}

export interface RecorderCallbacks {
  onTick?(amplitude: number, elapsedMs: number): void;
  onDone?(result: VoiceRecordingResult): void;
  onCancel?(reason: "user" | "tooShort" | "error"): void;
  /** 达 5min 上限硬闸（sketch §12）：Web 桌面无"按住/锁定"区分，直接 stopAndSend 送出即可。 */
  onMaxReached?(): void;
}

/** 单例句柄：一次只允许一个录制会话。 */
export class VoiceRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private tickTimer: number | null = null;
  private stopReason: "user" | "tooShort" | "error" | "reachedMax" | "cancelled" | null = null;
  private cbs: RecorderCallbacks = {};
  private amplitudes: number[] = [];
  private mime = "audio/mp4";
  private ext = ".m4a";
  private paused = false;
  private pausedAt = 0; // 暂停时刻：resume 时把暂停区间补回 startedAt，暂停中 elapsed 以它为基准

  /** 请求麦克风权限并开始录制。resolve 表示已开始（recorder 处于 recording 态）。 */
  async start(cbs: RecorderCallbacks): Promise<void> {
    const probe = voiceRecordingSupported();
    if (!probe.supported) throw new Error("当前浏览器不支持录制语音");
    this.mime = probe.mime; this.ext = probe.ext;
    this.cbs = cbs;
    this.chunks = [];
    this.amplitudes = [];
    this.stopReason = null;
    this.paused = false;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
    // AnalyserNode 只做振幅采样，不影响录音本身。
    this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mime, audioBitsPerSecond: 24000 });
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.handleStop();
    this.recorder.start(500); // 每 500ms 拉一次片段（保证异常时数据不全丢）
    this.startedAt = performance.now();
    this.tickTimer = window.setInterval(() => this.tick(), VOICE_SAMPLE_INTERVAL_MS);
  }

  /** 用户主动停并送出。<0.6s 会走 tooShort 分支自动丢弃。 */
  stopAndSend(): void {
    if (!this.recorder || this.recorder.state === "inactive") return;
    const dur = this.elapsedMs();
    if (dur < VOICE_MIN_MS) { this.stopReason = "tooShort"; }
    else { this.stopReason = "user"; }
    this.recorder.stop();
  }

  /** 用户左滑取消（Esc / 关闭按钮）：丢弃音频与波形。 */
  cancel(): void {
    if (!this.recorder || this.recorder.state === "inactive") { this.cleanup(); return; }
    // stopReason=cancelled 显式（曾用 "user" + chunks=[]：MediaRecorder.stop() 会 flush 最后一次
    // ondataavailable，chunks 变非空 → handleStop 走 send 分支即"取消也发出去"，2026-08-27 修）。
    this.stopReason = "cancelled";
    this.chunks = [];
    // **立刻停 tickTimer**——否则 4:59.9x 点取消后 100ms 内 tick 到点抢跑，把 stopReason 从 'cancelled'
    // 覆盖回 'user' → 又走 send 分支，"取消也发送"回归（code-review 2026-08-27 CONFIRMED）。
    if (this.tickTimer !== null) { window.clearInterval(this.tickTimer); this.tickTimer = null; }
    this.recorder.stop();
  }

  pause(): void {
    if (this.recorder && this.recorder.state === "recording") {
      this.recorder.pause();
      this.paused = true;
      this.pausedAt = performance.now();
      if (this.tickTimer !== null) { window.clearInterval(this.tickTimer); this.tickTimer = null; }
    }
  }

  resume(): void {
    if (this.recorder && this.recorder.state === "paused") {
      this.recorder.resume();
      this.paused = false;
      // 把暂停区间补回 startedAt——否则 durationMs / 0.6s tooShort 门 / 5min 自动停全都把
      // 暂停挂钟时间算进去（暂停 1 分钟再发送，气泡与服务端 duration 凭空多 1 分钟；2026-08-26 修，
      // iOS 同款 bug 同批已修）。
      this.startedAt += performance.now() - this.pausedAt;
      this.tickTimer = window.setInterval(() => this.tick(), VOICE_SAMPLE_INTERVAL_MS);
    }
  }

  /** 已录音时长 ms（不含暂停区间：暂停中以 pausedAt 为基准冻结）。 */
  private elapsedMs(): number {
    return (this.paused ? this.pausedAt : performance.now()) - this.startedAt;
  }

  isRecording(): boolean { return this.recorder?.state === "recording"; }
  isPaused(): boolean { return this.paused; }

  private tick(): void {
    if (!this.analyser) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    // RMS → 0..1
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    const amp = Math.max(0, Math.min(1, rms * 2)); // ×2 提升低音量可见性
    if (this.amplitudes.length < 4096) this.amplitudes.push(Math.round(amp * 100));
    const elapsed = this.elapsedMs();
    this.cbs.onTick?.(amp, elapsed);
    if (elapsed >= VOICE_MAX_MS) {
      // §12 UI 硬闸：Web 端桌面天然锁定，直接自动送出（等价 sketch §12 "锁定态到点=stopAndSend"）。
      // 通知 UI 关录制条 + toast 提示。stopReason=reachedMax 让 handleStop 走 send 分支。
      // 防抖：stopReason 已设过就早退（下一 tick 若在 recorder.stop 完成前跑，避免二发 onMaxReached / toast）。
      if (this.stopReason) { return; }
      this.stopReason = "reachedMax";
      if (this.tickTimer !== null) { window.clearInterval(this.tickTimer); this.tickTimer = null; }
      this.cbs.onMaxReached?.();
      this.recorder?.stop();
    }
  }

  private handleStop(): void {
    if (this.tickTimer !== null) { window.clearInterval(this.tickTimer); this.tickTimer = null; }
    const dur = this.elapsedMs();
    const reason = this.stopReason ?? "user";
    if (reason === "tooShort") {
      this.cleanup();
      this.cbs.onCancel?.("tooShort");
      return;
    }
    if (reason === "cancelled") {
      this.cleanup();
      this.cbs.onCancel?.("user");
      return;
    }
    // reachedMax 与 user 都走 send 分支；类型显式区分让上层日志/遥测能分辨"用户主动停"vs"到点自动停"。
    // 下采到 60 帧再 base64（服务端上限 120 字节，留一半余量）。
    const N = Math.min(60, this.amplitudes.length);
    const bucketSize = this.amplitudes.length / N;
    const out = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const lo = Math.floor(i * bucketSize);
      const hi = Math.min(this.amplitudes.length, Math.floor((i + 1) * bucketSize));
      let m = 0;
      for (let j = lo; j < hi; j++) if (this.amplitudes[j] > m) m = this.amplitudes[j];
      out[i] = Math.min(100, m);
    }
    // base64 encode (原始字节 ≤120 保证)
    let bin = "";
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    const wave = btoa(bin);
    // 兜底防超长（正常 60 字节 → base64 80 字符；理论 120 字节 → base64 160 字符）
    const clampedWave = wave.length > VOICE_MAX_WAVEFORM_BYTES * 4 ? wave.slice(0, VOICE_MAX_WAVEFORM_BYTES * 4) : wave;

    const blob = new Blob(this.chunks, { type: this.mime });
    const result: VoiceRecordingResult = {
      blob, mimeType: this.mime, fileExtension: this.ext, durationMs: Math.round(dur), waveformBase64: clampedWave,
    };
    this.cleanup();
    this.cbs.onDone?.(result);
  }

  private cleanup(): void {
    if (this.tickTimer !== null) { window.clearInterval(this.tickTimer); this.tickTimer = null; }
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* stream 已停 */ }
    try { void this.ctx?.close(); } catch { /* ctx 已关 */ }
    this.stream = null;
    this.ctx = null;
    this.recorder = null;
    this.analyser = null;
  }
}
