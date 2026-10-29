import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { SubPanel } from "./SubPanel";

/** 危险操作二级页的共用版式：警示头（红圆图标 + 标题）+ 后果卡 + 蓝色提示条 + 红按钮。
 *  「注销账号」「清除所有对话」两处共用（CLEAR_ALL_CONVERSATIONS_DESIGN §2 复用组件），样式沿用 `.delacct-*`，不复制分叉。
 *  `children` 插在提示条与错误行之间（注销页的群主阻断卡 / 密码框）；错误行的 className 由调用方选（注销页 `pwd-error`，清除页 `auth-err`）。 */
export function DangerConfirmPage({ className, title, headline, bullets, tip, error, errorClass, buttonLabel, busy, disabled, onSubmit, onBack, children }: {
  className: string;
  title: string;
  headline: string;
  bullets: string[];
  tip: string;
  error?: string;
  errorClass: string;
  buttonLabel: string;
  busy: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onBack: () => void;
  children?: ReactNode;
}) {
  return (
    <SubPanel className={className} title={title} onBack={onBack}>
      <div className="delacct-warn" aria-hidden="true"><TriangleAlert size={30} /></div>
      <div className="delacct-head">{headline}</div>
      <div className="settings-group">
        {bullets.map((b, i) => (
          <div className="delacct-li" key={i}><span aria-hidden="true">•</span><span>{b}</span></div>
        ))}
      </div>
      <div className="delacct-tip">{tip}</div>
      {children}
      {error && <div className={errorClass}>{error}</div>}
      <button className="delacct-btn" disabled={disabled} onClick={onSubmit}>
        {busy ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null}{buttonLabel}
      </button>
    </SubPanel>
  );
}
