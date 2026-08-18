import type { ReactNode } from "react";

/** 弹窗通用外壳：半透明遮罩 + 居中面板。点遮罩关闭；点面板内部不冒泡到遮罩。
 *  className 为面板容器类（多数是 "modal xxx"，媒体库等自定义容器直接整串传入）。 */
export function Modal({ className = "modal", onClose, children }: {
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
