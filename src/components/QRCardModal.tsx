// 名片码 / 群二维码 / 群邀请链接 展示模态（从 QRUI.tsx 拆出以守体量红线）。
import { useEffect, useState, useCallback } from "react";
import { X, RefreshCw, Download, Copy, Check, QrCode, Share2 } from "lucide-react";
import type { QRCard } from "../sdk/protocol";
import { useT } from "../i18n";
import { Avatar, toQRDataURL } from "../QRUI";

export function QRCardModal(props: {
  title: string;
  subtitle: string;          // 「扫描二维码，加我为朋友」/「扫描二维码，加入群聊」（码下方提示）
  meta?: string;             // 名字下的公开信息：名片码＝@句柄，群＝「N 人」（对齐 Android，不落内部 ID）
  mode?: "code" | "link";    // link＝群邀请链接页：不画码，链接本身是主角
  onViewCode?: () => void;   // 链接页底部「查看二维码」
  name: string;
  avatarUrl?: string;
  card: QRCard;
  canReset: boolean;         // 我的码恒 true；群码仅群主/管理员
  onReset: () => Promise<void>;
  onClose: () => void;
}) {
  const tr = useT();
  const { title, subtitle, meta, mode = "code", onViewCode, name, avatarUrl, card, canReset, onReset, onClose } = props;
  const linkMode = mode === "link";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const [img, setImg] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (linkMode) return;
    let stale = false;
    void toQRDataURL(card.url).then((d) => { if (!stale) setImg(d); });
    return () => { stale = true; };
  }, [card.url, linkMode]);

  const shareLink = useCallback(() => {
    void navigator.share?.({ title, url: card.url }).catch(() => { /* 用户取消分享：无需处理 */ });
  }, [card.url, title]);

  const copyLink = useCallback(() => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    // 非安全上下文（纯 HTTP）或权限被拒时 clipboard API 不可用/会 reject：退回 execCommand，仍失败就静默（不留未处理 rejection）。
    const legacy = () => {
      const ta = document.createElement("textarea");
      ta.value = card.url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand("copy")) done(); } catch { /* 无可用复制通道 */ }
      ta.remove();
    };
    if (!navigator.clipboard?.writeText) { legacy(); return; }
    void navigator.clipboard.writeText(card.url).then(done, legacy);
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
          <Avatar url={avatarUrl} name={name} size={56} />
          <div className="qr-card-name">{name}</div>
          {meta && <div className="qr-card-meta">{meta}</div>}
        </div>
        {linkMode ? (
          <div className="qr-link-box" data-testid="qr-link-box">{card.url}</div>
        ) : (
          <div className="qr-img-wrap">
            {img ? <img className="qr-img" src={img} alt={tr("qr.image_alt")} /> : <div className="qr-img qr-img-loading" />}
          </div>
        )}
        <div className="qr-card-sub">{subtitle}</div>
        <div className="modal-actions qr-card-actions">
          {linkMode ? (
            <>
              <button className="mini-btn" onClick={copyLink}>
                {copied ? <><Check size={15} /> {tr("common.copied")}</> : <><Copy size={15} /> {tr("qr.copy_link")}</>}
              </button>
              {canShare && <button className="mini-btn ghost" onClick={shareLink}><Share2 size={15} /> {tr("qr.card.share_link")}</button>}
            </>
          ) : (
            <>
              <button className="mini-btn ghost" onClick={downloadPNG}><Download size={15} /> {tr("qr.download_png")}</button>
              <button className="mini-btn ghost" onClick={copyLink}>
                {copied ? <><Check size={15} /> {tr("common.copied")}</> : <><Copy size={15} /> {tr("qr.copy_link")}</>}
              </button>
            </>
          )}
        </div>
        {linkMode && onViewCode && (
          <button className="qr-reset-link qr-view-code" onClick={onViewCode}><QrCode size={14} /> {tr("qr.card.view_code")}</button>
        )}
        {canReset && !linkMode && !confirmReset && (
          <button className="qr-reset-link" onClick={() => setConfirmReset(true)}>
            <RefreshCw size={14} /> {tr("qr.reset")}
          </button>
        )}
        {canReset && !linkMode && confirmReset && (
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
