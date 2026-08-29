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
        <button className="qr-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <h3 className="modal-title">{title}</h3>
        <div className="qr-card-head">
          <Avatar url={avatarUrl} name={name} />
          <div className="qr-card-name">{name}</div>
        </div>
        <div className="qr-img-wrap">
          {img ? <img className="qr-img" src={img} alt="二维码" /> : <div className="qr-img qr-img-loading" />}
        </div>
        <div className="qr-card-sub">{subtitle}</div>
        <div className="modal-actions qr-card-actions">
          <button className="mini-btn ghost" onClick={downloadPNG}><Download size={15} /> 下载 PNG</button>
          <button className="mini-btn ghost" onClick={copyLink}>
            {copied ? <><Check size={15} /> 已复制</> : <><Copy size={15} /> 复制链接</>}
          </button>
        </div>
        {canReset && !confirmReset && (
          <button className="qr-reset-link" onClick={() => setConfirmReset(true)}>
            <RefreshCw size={14} /> 重置二维码
          </button>
        )}
        {canReset && confirmReset && (
          <div className="qr-reset-confirm">
            <div className="qr-reset-warn">重置后旧二维码<b>立即失效</b>，已发出的码将无法再用于加入。</div>
            <div className="modal-actions">
              <button className="mini-btn ghost" disabled={resetting} onClick={() => setConfirmReset(false)}>取消</button>
              <button className="mini-btn danger" disabled={resetting} onClick={async () => {
                setResetting(true);
                try { await onReset(); setConfirmReset(false); } finally { setResetting(false); }
              }}>{resetting ? "重置中…" : "确认重置"}</button>
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
      setHint("这个文件读不出图片，请换一张图片试试");
      return;
    }
    if (raws.length === 0) { setHint("这张图片里没有识别到二维码，换一张试试"); return; }
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
        <button className="qr-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <h3 className="modal-title"><ScanLine size={18} /> 扫一扫</h3>

        {candidates.length > 1 ? (
          <div className="qr-multi">
            <div className="qr-multi-title">这张图里有 {candidates.length} 个二维码，请选择要打开的一个：</div>
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
            <button className="mini-btn ghost wide" onClick={() => { setCandidates([]); setHint(""); }}>取消，换一张图</button>
          </div>
        ) : (
          <>
            {camState === "on" && (
              <div className="qr-scan-stage">
                <video ref={videoRef} className="qr-scan-video" playsInline muted />
                <div className="qr-scan-frame" />
                <div className="qr-scan-tip">将二维码放入框内，自动识别</div>
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
                <div className="qr-drop-title">把带二维码的图片拖到这里</div>
                <div className="qr-drop-sub">
                  {camState === "denied" ? "相机权限被拒——你仍可上传或粘贴图片识别"
                    : camState === "unavailable" ? "当前环境无摄像头（或非 HTTPS）——请上传或粘贴图片"
                    : "也支持 ⌘/Ctrl+V 直接粘贴截图"}
                </div>
              </div>
            )}

            {hint && <div className="qr-scan-hint">{hint}</div>}
          </>
        )}

        <div className="modal-actions qr-scan-actions">
          <label className="mini-btn ghost">
            <ImageIcon size={15} /> 选择图片
            <input type="file" accept="image/*" hidden onChange={(e) => void handleFile(e.target.files?.[0])} />
          </label>
          <button className="mini-btn ghost" onClick={onMyCard}><QrCode size={15} /> 我的二维码</button>
        </div>
        {camState === "denied" && (
          <div className="qr-scan-hint qr-scan-permhint"><Camera size={13} /> 想用摄像头扫码，请在浏览器地址栏为本站开启相机权限后重试。</div>
        )}
      </div>
    </div>
  );
}

// ---- 扫码结果分支（user / group / unknown / expired）----

export type QRResultActions = {
  onAddFriend: (uid: string) => Promise<void>;
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
  const { result, onClose, actions } = props;
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal qr-result-modal" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        {result.kind === "expired" && <ExpiredBranch onClose={onClose} />}
        {result.kind === "user" && <UserBranch card={result.data as QRUserCard} actions={actions} onClose={onClose} />}
        {result.kind === "group" && <GroupBranch card={result.data as QRGroupCard} actions={actions} onClose={onClose} />}
        {result.kind === "unknown" && <UnknownBranch text={(result.data as { text: string }).text} />}
      </div>
    </div>
  );
}

function ExpiredBranch({ onClose }: { onClose: () => void }) {
  return (
    <div className="qr-branch qr-branch-center">
      <div className="qr-branch-icon"><Clock size={30} /></div>
      <h3 className="modal-title">二维码已失效</h3>
      <div className="qr-branch-note">该二维码已过期或被重置，请向对方索取新的二维码。</div>
      <button className="mini-btn wide" onClick={onClose}>我知道了</button>
    </div>
  );
}

function UserBranch({ card, actions, onClose }: { card: QRUserCard; actions: QRResultActions; onClose: () => void }) {
  const a = userCardAction(card);
  const [busy, setBusy] = useState(false);
  const primary = async () => {
    if (a.kind === "add") { setBusy(true); try { await actions.onAddFriend(card.user_id); onClose(); } finally { setBusy(false); } }
    else if (a.kind === "message") { actions.onMessage(card.user_id); onClose(); }
    else { actions.onViewProfile(card.user_id); onClose(); }
  };
  return (
    <div className="qr-branch">
      <div className="qr-branch-head">
        <Avatar url={card.avatar_url} name={card.nickname} size={52} />
        <div>
          <div className="qr-branch-title">{card.nickname || "未命名用户"}</div>
          <div className="qr-branch-meta">ID {card.user_id} · 通过扫一扫</div>
        </div>
      </div>
      <div className="modal-actions qr-branch-actions">
        <button className="mini-btn wide" disabled={busy} onClick={primary}>{busy ? "处理中…" : a.label}</button>
        {a.kind !== "self" && <button className="mini-btn ghost wide" onClick={() => { actions.onViewProfile(card.user_id); onClose(); }}>查看资料</button>}
      </div>
    </div>
  );
}

function GroupBranch({ card, actions, onClose }: { card: QRGroupCard; actions: QRResultActions; onClose: () => void }) {
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
          <div className="qr-branch-meta">{card.member_count} 名成员{card.inviter_nickname ? ` · ${card.inviter_nickname} 邀请你加入` : ""}</div>
        </div>
      </div>
      {card.intro && card.intro.trim() && <div className="qr-branch-intro">{card.intro}</div>}
      {a.note && <div className="qr-branch-note">{a.note}</div>}
      {a.kind === "apply" && (
        <input className="qr-hello-input" maxLength={50} value={hello}
          placeholder="附言（选填，让管理员认识你）" onChange={(e) => setHello(e.target.value)} />
      )}
      <div className="modal-actions qr-branch-actions">
        <button className="mini-btn wide" disabled={busy || a.kind === "disabled"}
          onClick={primary}>
          {busy ? "处理中…" : (a.kind === "join" || a.kind === "apply" ? <><LogIn size={15} /> {a.label}</> : a.label)}
        </button>
      </div>
    </div>
  );
}

function UnknownBranch({ text }: { text: string }) {
  const { isUrl, domain } = classifyUnknown(text);
  const copy = () => void navigator.clipboard?.writeText(text);
  return (
    <div className="qr-branch">
      <h3 className="modal-title">扫描结果</h3>
      <div className="qr-branch-note">这不是本应用的二维码，内容如下：</div>
      <div className="qr-unknown-text">{text || "（空）"}</div>
      {isUrl
        ? <>
            <div className="qr-branch-warn">链接来自二维码，可能是钓鱼站点。确认域名 <b>{domain}</b> 无误再打开。</div>
            <div className="modal-actions">
              <a className="mini-btn ghost" href={text} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink size={15} /> 在浏览器中打开</a>
              <button className="mini-btn ghost" onClick={copy}><Copy size={15} /> 复制内容</button>
            </div>
          </>
        : <div className="modal-actions"><button className="mini-btn ghost" onClick={copy}><Copy size={15} /> 复制内容</button></div>}
    </div>
  );
}

// ---- Web 扫码登录（QR P1）：四态一屏，二维码常驻、状态用覆盖层表达 ----

// UI 相位：loading=正在申请票据；error=申请失败；其余直接映射票据状态机。
type LoginPhase = "loading" | "error" | QRLoginState;

export function QRLoginTab(props: { onLogin: (uid: string, token: string) => void }) {
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
        setErrMsg((e as Error).message || "二维码申请失败"); setPhase("error");
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
          onLoginRef.current(res.uid, res.token); // 父组件会切到 app 相位并卸载本组件
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
      <div className="qr-login-tip-top"><ScanLine size={15} /> 扫码登录</div>
      <div className="qr-login-box">
        {img
          ? <img className={`qr-login-img${dim ? " dim" : ""}`} src={img} alt="登录二维码" />
          : <div className="qr-login-img qr-img-loading" />}

        {phase === "loading" && (
          <div className="qr-login-cover"><div className="qr-login-spin" /><div className="qr-login-cover-t">生成二维码…</div></div>
        )}
        {phase === "error" && (
          <div className="qr-login-cover">
            <div className="qr-login-cover-t">二维码申请失败</div>
            <div className="qr-login-cover-s">{errMsg}</div>
            <button className="qr-login-refresh" onClick={refresh}><RefreshCw size={14} /> 重试</button>
          </div>
        )}
        {phase === "scanned" && (
          <div className="qr-login-cover">
            <div className="qr-login-badge ok"><Check size={22} /></div>
            <div className="qr-login-cover-t">扫描成功</div>
            <div className="qr-login-cover-s">请在手机上确认登录</div>
          </div>
        )}
        {phase === "confirmed" && (
          <div className="qr-login-cover">
            <div className="qr-login-badge ok"><Check size={22} /></div>
            <div className="qr-login-cover-t">登录成功</div>
            <div className="qr-login-cover-s">正在进入…</div>
          </div>
        )}
        {phase === "expired" && (
          <button className="qr-login-cover as-btn" onClick={refresh}>
            <div className="qr-login-badge gray"><RefreshCw size={20} /></div>
            <div className="qr-login-cover-t">二维码已过期</div>
            <div className="qr-login-cover-s">点击刷新</div>
          </button>
        )}
        {phase === "rejected" && (
          <button className="qr-login-cover as-btn" onClick={refresh}>
            <div className="qr-login-badge bad"><X size={20} /></div>
            <div className="qr-login-cover-t">已在手机上拒绝登录</div>
            <div className="qr-login-cover-s">点击换一个二维码</div>
          </button>
        )}
      </div>

      <div className="qr-login-tip">
        {phase === "scanned"
          ? <>已识别账号 <b>{nickname || "…"}</b>，在手机上点「确认登录」</>
          : <>打开手机 App，点 <b>＋ → 扫一扫</b>，扫描上方二维码登录</>}
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
        <button className="qr-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <h3 className="modal-title"><UserPlus size={18} /> 入群申请</h3>
        <div className="join-req-seg">
          <button className={`join-req-seg-btn${tab === "pending" ? " on" : ""}`} onClick={() => setTab("pending")}>待处理{pending.length ? ` (${pending.length})` : ""}</button>
          <button className={`join-req-seg-btn${tab === "done" ? " on" : ""}`} onClick={() => setTab("done")}>已处理</button>
        </div>
        {loading && <div className="join-req-empty">加载中…</div>}
        {!loading && shown.length === 0 && (
          <div className="join-req-empty">{tab === "pending" ? "暂无待审批的入群申请" : "暂无已处理的申请"}</div>
        )}
        <div className="join-req-list">
          {shown.map((r) => (
            <div className="join-req-row" key={r.user_id}>
              <Avatar url={r.avatar_url} name={r.nickname} size={40} />
              <div className="join-req-info">
                <div className="join-req-name">{r.nickname || "未命名用户"}</div>
                {r.hello && <div className="join-req-hello">{r.hello}</div>}
              </div>
              {tab === "pending" ? (
                <div className="join-req-btns">
                  <button className="mini-btn" disabled={busyUid === r.user_id} onClick={() => decide(r.user_id, true)}>同意</button>
                  <button className="mini-btn ghost" disabled={busyUid === r.user_id} onClick={() => decide(r.user_id, false)}>拒绝</button>
                </div>
              ) : (
                <div className={`join-req-status ${r.status}`}>{r.status === "approved" ? "已同意" : "已拒绝"}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
