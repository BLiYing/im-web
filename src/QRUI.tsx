// 二维码体系（QRCODE P0）+ 群组 G3 入群的 Web UI 组件（展示型，语义判定全在服务端）。
// 与 App.tsx 解耦：组件只收数据 + 回调，扫码只吐 raw 字符串，由 App 走 SDK resolve。
import { useEffect, useRef, useState, useCallback } from "react";
import * as QRCode from "qrcode";
import {
  QrCode, X, Camera, Image as ImageIcon, RefreshCw, Download, Copy, Check,
  UserPlus, LogIn, Users, ExternalLink, ScanLine, Clock,
} from "lucide-react";
import type { QRCard, QRResolved, QRUserCard, QRGroupCard, JoinRequest, QRLoginState, QRLoginTicket } from "./sdk/protocol";
import { decodeImageData, decodeAllImageFile, describeRaw, drawToImageData, userCardAction, groupCardAction, classifyUnknown, errorCode, type GroupAction, type RawKind } from "./qr";
import { loginNew, loginPoll } from "./sdk/qrLogin";
import { t, useT } from "./i18n";

/** 生成二维码图片 dataURL（容错级 M，中留白，端本地生成）。失败返回空串。 */
async function toQRDataURL(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 2, width: 240 });
  } catch {
    return "";
  }
}

function Avatar({ url, name, size = 44 }: { url?: string; name: string; size?: number }) {
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  const style = { width: size, height: size, fontSize: size * 0.42 } as const;
  return url
    ? <img className="qr-avatar" src={url} alt="" style={style} />
    : <span className="qr-avatar qr-avatar-fallback" style={style}>{initial}</span>;
}

// ---- 名片码 / 群码 展示模态（复用：我的名片码 + 群二维码）----

export function QRCardModal(props: {
  title: string;
  subtitle: string;          // 「扫描二维码，加我为朋友」/「扫描二维码，加入群聊」
  name: string;
  avatarUrl?: string;
  card: QRCard;
  canReset: boolean;         // 我的码恒 true；群码仅群主/管理员
  onReset: () => Promise<void>;
  onClose: () => void;
}) {
  const tr = useT();
  const { title, subtitle, name, avatarUrl, card, canReset, onReset, onClose } = props;
  const [img, setImg] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => { void toQRDataURL(card.url).then(setImg); }, [card.url]);

  const copyLink = useCallback(() => {
    void navigator.clipboard?.writeText(card.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [card.url]);

  const downloadPNG = useCallback(() => {
    if (!img) return;
    const a = document.createElement("a");
    a.href = img;
    a.download = `${title}.png`;
    a.click();
  }, [img, title]);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose} aria-label={tr("common.close")}><X size={18} /></button>
        <h3 className="modal-title">{title}</h3>
        <div className="qr-card-head">
          <Avatar url={avatarUrl} name={name} />
          <div className="qr-card-name">{name}</div>
        </div>
        <div className="qr-img-wrap">
          {img ? <img className="qr-img" src={img} alt={tr("qr.image_alt")} /> : <div className="qr-img qr-img-loading" />}
        </div>
        <div className="qr-card-sub">{subtitle}</div>
        <div className="modal-actions qr-card-actions">
          <button className="mini-btn ghost" onClick={downloadPNG}><Download size={15} /> {tr("qr.download_png")}</button>
          <button className="mini-btn ghost" onClick={copyLink}>
            {copied ? <><Check size={15} /> {tr("common.copied")}</> : <><Copy size={15} /> {tr("qr.copy_link")}</>}
          </button>
        </div>
        {canReset && !confirmReset && (
          <button className="qr-reset-link" onClick={() => setConfirmReset(true)}>
            <RefreshCw size={14} /> {tr("qr.reset")}
          </button>
        )}
        {canReset && confirmReset && (
          <div className="qr-reset-confirm">
            <div className="qr-reset-warn">{tr("qr.reset_warn.prefix")}<b>{tr("qr.reset_warn.strong")}</b>{tr("qr.reset_warn.suffix")}</div>
            <div className="modal-actions">
              <button className="mini-btn ghost" disabled={resetting} onClick={() => setConfirmReset(false)}>{tr("common.cancel")}</button>
              <button className="mini-btn danger" disabled={resetting} onClick={async () => {
                setResetting(true);
                try { await onReset(); setConfirmReset(false); } finally { setResetting(false); }
              }}>{resetting ? tr("qr.resetting") : tr("qr.confirm_reset")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- 扫一扫（摄像头 + 上传/拖拽/粘贴图片）----

/** 多码候选列表按类型选图标。 */
function candidateIcon(kind: RawKind) {
  switch (kind) {
    case "user": return <UserPlus size={16} />;
    case "group": return <Users size={16} />;
    case "login": return <LogIn size={16} />;
    case "url": return <ExternalLink size={16} />;
    default: return <QrCode size={16} />;
  }
}

export function QRScannerModal(props: { onRaw: (raw: string) => void; onClose: () => void; onMyCard: () => void }) {
  const tr = useT();
  const { onRaw, onClose, onMyCard } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const firedRef = useRef(false);
  const [camState, setCamState] = useState<"idle" | "on" | "denied" | "unavailable">("idle");
  const [hint, setHint] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]); // 一图多码时的候选，>1 才弹选择列表

  const fire = useCallback((raw: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    onRaw(raw);
  }, [onRaw]);

  // 摄像头生命周期：进页申请流（退页务必关掉，隐私 + 释放设备）。
  // 注意只取流、不碰 <video>——此刻 camState 仍非 "on"，video 尚未挂载，videoRef 还是 null。
  useEffect(() => {
    let cancelled = false;
    const secure = window.isSecureContext || location.hostname === "localhost";
    if (!secure || !navigator.mediaDevices?.getUserMedia) {
      setCamState("unavailable");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setCamState("on"); // 触发重渲染挂载 <video>，绑定交给下面 camState 依赖的 effect
      })
      .catch(() => { if (!cancelled) setCamState("denied"); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // camState 变 "on" 后 <video> 已挂载，此时 videoRef 才有效——绑流 + 起识别循环。
  useEffect(() => {
    if (camState !== "on") return;
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    void v.play();
    loop();
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camState]);

  const loop = useCallback(() => {
    const v = videoRef.current;
    if (v && v.readyState >= 2) {
      const img = drawToImageData(v, 640);
      const raw = img && decodeImageData(img);
      if (raw) { fire(raw); return; }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [fire]);

  // 拖拽/粘贴进来的不一定是图片（PDF、压缩包…），decodeAllImageFile 会 reject；
  // 不接住的话就是一条未处理的 rejection + 界面毫无反应（file input 的 accept 拦不住这两条路）。
  const handleFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    setHint(""); setCandidates([]);
    let raws: string[];
    try {
      raws = await decodeAllImageFile(file);
    } catch {
      setHint(tr("qr.scan.unreadable_image"));
      return;
    }
    if (raws.length === 0) { setHint(tr("qr.scan.no_code")); return; }
    if (raws.length === 1) { fire(raws[0]); return; }
    // 一图多码：停掉摄像头识别循环（否则它会抢先 fire 一枚），列出候选让用户选。
    cancelAnimationFrame(rafRef.current);
    setCandidates(raws);
  }, [fire]);

  // 桌面常见：直接 Cmd/Ctrl+V 粘贴截图。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) void handleFile(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal qr-scan-modal" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose} aria-label={tr("common.close")}><X size={18} /></button>
        <h3 className="modal-title"><ScanLine size={18} /> {tr("conv.menu.scan")}</h3>

        {candidates.length > 1 ? (
          <div className="qr-multi">
            <div className="qr-multi-title">{tr("qr.scan.multi_title", { count: candidates.length })}</div>
            <div className="qr-multi-list">
              {candidates.map((raw, i) => {
                const d = describeRaw(raw);
                return (
                  <button className="qr-multi-item" key={`${raw}-${i}`} onClick={() => fire(raw)}>
                    <span className={`qr-multi-ic ${d.kind}`}>{candidateIcon(d.kind)}</span>
                    <span className="qr-multi-label">{d.label}</span>
                  </button>
                );
              })}
            </div>
            <button className="mini-btn ghost wide" onClick={() => { setCandidates([]); setHint(""); }}>{tr("qr.scan.cancel_pick")}</button>
          </div>
        ) : (
          <>
            {camState === "on" && (
              <div className="qr-scan-stage">
                <video ref={videoRef} className="qr-scan-video" playsInline muted />
                <div className="qr-scan-frame" />
                <div className="qr-scan-tip">{tr("qr.scan.tip")}</div>
              </div>
            )}
            {camState !== "on" && (
              <div
                className={`qr-drop${dragOver ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFile(e.dataTransfer.files?.[0]); }}
              >
                <ImageIcon size={30} />
                <div className="qr-drop-title">{tr("qr.scan.drop_title")}</div>
                <div className="qr-drop-sub">
                  {camState === "denied" ? tr("qr.scan.cam_denied")
                    : camState === "unavailable" ? tr("qr.scan.cam_unavailable")
                    : tr("qr.scan.paste_hint")}
                </div>
              </div>
            )}

            {hint && <div className="qr-scan-hint">{hint}</div>}
          </>
        )}

        <div className="modal-actions qr-scan-actions">
          <label className="mini-btn ghost">
            <ImageIcon size={15} /> {tr("qr.scan.choose_image")}
            <input type="file" accept="image/*" hidden onChange={(e) => void handleFile(e.target.files?.[0])} />
          </label>
          <button className="mini-btn ghost" onClick={onMyCard}><QrCode size={15} /> {tr("qr.scan.my_code")}</button>
        </div>
        {camState === "denied" && (
          <div className="qr-scan-hint qr-scan-permhint"><Camera size={13} /> {tr("qr.scan.perm_hint")}</div>
        )}
      </div>
    </div>
  );
}

// ---- 扫码结果分支（user / group / unknown / expired）----

export type QRResultActions = {
  /** 加好友：**只负责打开申请弹窗**（填验证消息后由 App 发出），不在这里直接发请求——
   *  全站五个加好友入口都走同一个弹窗，少走一次就少一次理由。 */
  onAddFriend: (uid: string, name: string) => void;
  onMessage: (uid: string) => void;
  onViewProfile: (uid: string) => void;
  onJoinGroup: (hello: string) => Promise<void>; // 需审批的群带申请附言
  onEnterGroup: (convId: string) => void;
};

export function QRResultModal(props: {
  result: QRResolved | { kind: "expired" };
  onClose: () => void;
  actions: QRResultActions;
}) {
  const tr = useT();
  const { result, onClose, actions } = props;
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal qr-result-modal" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose} aria-label={tr("common.close")}><X size={18} /></button>
        {result.kind === "expired" && <ExpiredBranch onClose={onClose} />}
        {result.kind === "user" && <UserBranch card={result.data as QRUserCard} actions={actions} onClose={onClose} />}
        {result.kind === "group" && <GroupBranch card={result.data as QRGroupCard} actions={actions} onClose={onClose} />}
        {result.kind === "unknown" && <UnknownBranch text={(result.data as { text: string }).text} />}
      </div>
    </div>
  );
}

function ExpiredBranch({ onClose }: { onClose: () => void }) {
  const tr = useT();
  return (
    <div className="qr-branch qr-branch-center">
      <div className="qr-branch-icon"><Clock size={30} /></div>
      <h3 className="modal-title">{tr("qr.invalid.title")}</h3>
      <div className="qr-branch-note">{tr("qr.invalid.note")}</div>
      <button className="mini-btn wide" onClick={onClose}>{tr("common.got_it")}</button>
    </div>
  );
}

function UserBranch({ card, actions, onClose }: { card: QRUserCard; actions: QRResultActions; onClose: () => void }) {
  const tr = useT();
  const a = userCardAction(card);
  // 三条分支现在都是**同步**的（加好友只是开申请弹窗），没有在途请求可等，故不再有 busy 态。
  const primary = () => {
    if (a.kind === "add") { actions.onAddFriend(card.user_id, card.nickname || (card.username ? `@${card.username}` : tr("common.unnamed_user"))); onClose(); }
    else if (a.kind === "message") { actions.onMessage(card.user_id); onClose(); }
    else { actions.onViewProfile(card.user_id); onClose(); }
  };
  return (
    <div className="qr-branch">
      <div className="qr-branch-head">
        <Avatar url={card.avatar_url} name={card.nickname} size={52} />
        <div>
          <div className="qr-branch-title">{card.nickname || tr("common.unnamed_user")}</div>
          {/* 句柄而非内部 ID（10 位随机数字）；没有句柄就只说来源。 */}
          <div className="qr-branch-meta">{card.username ? `@${card.username} · ` : ""}{tr("qr.branch.via_scan")}</div>
        </div>
      </div>
      <div className="modal-actions qr-branch-actions">
        <button className="mini-btn wide" onClick={primary}>{a.label}</button>
        {a.kind !== "self" && <button className="mini-btn ghost wide" onClick={() => { actions.onViewProfile(card.user_id); onClose(); }}>{tr("qr.branch.view_profile")}</button>}
      </div>
    </div>
  );
}

function GroupBranch({ card, actions, onClose }: { card: QRGroupCard; actions: QRResultActions; onClose: () => void }) {
  const tr = useT();
  const a: GroupAction = groupCardAction(card);
  const [busy, setBusy] = useState(false);
  const [hello, setHello] = useState("");
  const primary = async () => {
    if (a.kind === "enter") { actions.onEnterGroup(card.group_id); onClose(); return; }
    if (a.kind === "disabled") return;
    setBusy(true);
    try { await actions.onJoinGroup(hello.trim()); onClose(); } finally { setBusy(false); }
  };
  return (
    <div className="qr-branch">
      <div className="qr-branch-head">
        <Avatar url={card.avatar_url} name={card.name} size={52} />
        <div>
          <div className="qr-branch-title"><Users size={15} /> {card.name}</div>
          <div className="qr-branch-meta">{card.inviter_nickname ? tr("qr.branch.group_meta_invited", { count: card.member_count, name: card.inviter_nickname }) : tr("qr.branch.group_meta", { count: card.member_count })}</div>
        </div>
      </div>
      {card.intro && card.intro.trim() && <div className="qr-branch-intro">{card.intro}</div>}
      {a.note && <div className="qr-branch-note">{a.note}</div>}
      {a.kind === "apply" && (
        <input className="qr-hello-input" maxLength={50} value={hello}
          placeholder={tr("qr.branch.hello_placeholder")} onChange={(e) => setHello(e.target.value)} />
      )}
      <div className="modal-actions qr-branch-actions">
        <button className="mini-btn wide" disabled={busy || a.kind === "disabled"}
          onClick={primary}>
          {busy ? tr("common.processing") : (a.kind === "join" || a.kind === "apply" ? <><LogIn size={15} /> {a.label}</> : a.label)}
        </button>
      </div>
    </div>
  );
}

function UnknownBranch({ text }: { text: string }) {
  const tr = useT();
  const { isUrl, domain } = classifyUnknown(text);
  const copy = () => void navigator.clipboard?.writeText(text);
  return (
    <div className="qr-branch">
      <h3 className="modal-title">{tr("qr.result.title")}</h3>
      <div className="qr-branch-note">{tr("qr.result.not_ours")}</div>
      <div className="qr-unknown-text">{text || tr("qr.result.empty")}</div>
      {isUrl
        ? <>
            <div className="qr-branch-warn">{tr("qr.result.phishing_prefix")} <b>{domain}</b> {tr("qr.result.phishing_suffix")}</div>
            <div className="modal-actions">
              <a className="mini-btn ghost" href={text} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink size={15} /> {tr("qr.result.open_in_browser")}</a>
              <button className="mini-btn ghost" onClick={copy}><Copy size={15} /> {tr("qr.result.copy_content")}</button>
            </div>
          </>
        : <div className="modal-actions"><button className="mini-btn ghost" onClick={copy}><Copy size={15} /> {tr("qr.result.copy_content")}</button></div>}
    </div>
  );
}

// ---- Web 扫码登录（QR P1）：四态一屏，二维码常驻、状态用覆盖层表达 ----

// UI 相位：loading=正在申请票据；error=申请失败；其余直接映射票据状态机。
type LoginPhase = "loading" | "error" | QRLoginState;

export function QRLoginTab(props: { onLogin: (uid: string, token: string, refreshToken: string) => void }) {
  const tr = useT();
  const { onLogin } = props;
  const [phase, setPhase] = useState<LoginPhase>("loading");
  const [img, setImg] = useState("");
  const [nickname, setNickname] = useState("");
  const [errMsg, setErrMsg] = useState("");
  // 每次「刷新」自增，作 effect 的钥匙：旧轮询以 cancelled 收尾，新轮询重开。
  const [round, setRound] = useState(0);
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;

  useEffect(() => {
    let cancelled = false;
    setImg(""); setNickname(""); setErrMsg(""); setPhase("loading");

    (async () => {
      let ticket: QRLoginTicket;
      try {
        ticket = await loginNew();
      } catch (e) {
        if (cancelled) return;
        setErrMsg((e as Error).message || t("qr.login.request_failed")); setPhase("error");
        return;
      }
      if (cancelled) return;
      void toQRDataURL(ticket.url).then((u) => { if (!cancelled) setImg(u); });
      setPhase("new");

      // 长轮询：state 相对已知态一变即返回；确认后一次性领 token → 登录。
      let known: QRLoginState = "new";
      while (!cancelled) {
        let res;
        try {
          res = await loginPoll(ticket.ticket, ticket.poll_key, known);
        } catch (e) {
          if (cancelled) return;
          // poll_key 错(100103)=票据不属于我，按失效处理；其余(网络/限流)稍候重试。
          if (errorCode(e) === 100103) { setPhase("expired"); return; }
          await sleep(1500);
          continue;
        }
        if (cancelled) return;
        known = res.state;
        if (res.state === "scanned") {
          setNickname(res.nickname || res.uid || ""); setPhase("scanned"); continue;
        }
        if (res.state === "confirmed" && res.token && res.uid) {
          setPhase("confirmed");
          onLoginRef.current(res.uid, res.token, res.refresh_token ?? ""); // 父组件会切到 app 相位并卸载本组件
          return;
        }
        if (res.state === "expired" || res.state === "rejected" || res.state === "consumed") {
          setPhase(res.state === "consumed" ? "expired" : res.state); return;
        }
        // new / 其它：无变化的超时返回，继续轮询。
      }
    })();

    return () => { cancelled = true; };
  }, [round]);

  const refresh = () => setRound((n) => n + 1);
  const dim = phase === "expired" || phase === "rejected";

  return (
    <div className="qr-login">
      <div className="qr-login-tip-top"><ScanLine size={15} /> {tr("login.tab_qr")}</div>
      <div className="qr-login-box">
        {img
          ? <img className={`qr-login-img${dim ? " dim" : ""}`} src={img} alt={tr("qr.login.image_alt")} />
          : <div className="qr-login-img qr-img-loading" />}

        {phase === "loading" && (
          <div className="qr-login-cover"><div className="qr-login-spin" /><div className="qr-login-cover-t">{tr("qr.login.generating")}</div></div>
        )}
        {phase === "error" && (
          <div className="qr-login-cover">
            <div className="qr-login-cover-t">{tr("qr.login.request_failed")}</div>
            <div className="qr-login-cover-s">{errMsg}</div>
            <button className="qr-login-refresh" onClick={refresh}><RefreshCw size={14} /> {tr("common.retry")}</button>
          </div>
        )}
        {phase === "scanned" && (
          <div className="qr-login-cover">
            <div className="qr-login-badge ok"><Check size={22} /></div>
            <div className="qr-login-cover-t">{tr("qr.login.scanned")}</div>
            <div className="qr-login-cover-s">{tr("qr.login.confirm_on_phone")}</div>
          </div>
        )}
        {phase === "confirmed" && (
          <div className="qr-login-cover">
            <div className="qr-login-badge ok"><Check size={22} /></div>
            <div className="qr-login-cover-t">{tr("qr.login.success")}</div>
            <div className="qr-login-cover-s">{tr("qr.login.entering")}</div>
          </div>
        )}
        {phase === "expired" && (
          <button className="qr-login-cover as-btn" onClick={refresh}>
            <div className="qr-login-badge gray"><RefreshCw size={20} /></div>
            <div className="qr-login-cover-t">{tr("qr.login.expired")}</div>
            <div className="qr-login-cover-s">{tr("qr.login.tap_refresh")}</div>
          </button>
        )}
        {phase === "rejected" && (
          <button className="qr-login-cover as-btn" onClick={refresh}>
            <div className="qr-login-badge bad"><X size={20} /></div>
            <div className="qr-login-cover-t">{tr("qr.login.rejected")}</div>
            <div className="qr-login-cover-s">{tr("qr.login.tap_new")}</div>
          </button>
        )}
      </div>

      <div className="qr-login-tip">
        {phase === "scanned"
          ? <>{tr("qr.login.recognized_prefix")} <b>{nickname || "…"}</b>{tr("qr.login.recognized_suffix")}</>
          : <>{tr("qr.login.hint_prefix")} <b>{tr("qr.login.hint_strong")}</b>{tr("qr.login.hint_suffix")}</>}
      </div>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- G3 待审入群申请列表（群主/管理员）----

export function JoinRequestsModal(props: {
  requests: JoinRequest[];
  loading: boolean;
  onDecide: (uid: string, accept: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const tr = useT();
  const { requests, loading, onDecide, onClose } = props;
  const [busyUid, setBusyUid] = useState("");
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const pending = requests.filter((r) => r.status === "pending");
  const done = requests.filter((r) => r.status !== "pending");
  const shown = tab === "pending" ? pending : done;
  const decide = async (uid: string, accept: boolean) => {
    setBusyUid(uid);
    try { await onDecide(uid, accept); } finally { setBusyUid(""); }
  };
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal join-req-modal" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose} aria-label={tr("common.close")}><X size={18} /></button>
        <h3 className="modal-title"><UserPlus size={18} /> {tr("qr.join_req.title")}</h3>
        <div className="join-req-seg">
          <button className={`join-req-seg-btn${tab === "pending" ? " on" : ""}`} onClick={() => setTab("pending")}>{pending.length ? tr("qr.join_req.tab_pending_count", { count: pending.length }) : tr("qr.join_req.tab_pending")}</button>
          <button className={`join-req-seg-btn${tab === "done" ? " on" : ""}`} onClick={() => setTab("done")}>{tr("qr.join_req.tab_done")}</button>
        </div>
        {loading && <div className="join-req-empty">{tr("common.loading")}</div>}
        {!loading && shown.length === 0 && (
          <div className="join-req-empty">{tab === "pending" ? tr("qr.join_req.empty_pending") : tr("qr.join_req.empty_done")}</div>
        )}
        <div className="join-req-list">
          {shown.map((r) => (
            <div className="join-req-row" key={r.user_id}>
              <Avatar url={r.avatar_url} name={r.nickname} size={40} />
              <div className="join-req-info">
                <div className="join-req-name">{r.nickname || tr("common.unnamed_user")}</div>
                {r.hello && <div className="join-req-hello">{r.hello}</div>}
              </div>
              {tab === "pending" ? (
                <div className="join-req-btns">
                  <button className="mini-btn" disabled={busyUid === r.user_id} onClick={() => decide(r.user_id, true)}>{tr("common.agree")}</button>
                  <button className="mini-btn ghost" disabled={busyUid === r.user_id} onClick={() => decide(r.user_id, false)}>{tr("common.reject")}</button>
                </div>
              ) : (
                <div className={`join-req-status ${r.status}`}>{r.status === "approved" ? tr("qr.join_req.approved") : tr("qr.join_req.rejected")}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
