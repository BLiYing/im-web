import type { ReactNode } from "react";
import { X, Copy } from "lucide-react";
import type { ChatMessage } from "../sdk/protocol";
import { charCountLabel } from "../longtext";
import { Modal } from "./Modal";

/** 超长文本全屏阅读器：可滚动 / 选中复制 / 字号调节。点蒙层或 ✕ 关闭。
 *  纯展示：字号档由 App 持有；正文渲染（含 @提及高亮）经 renderBody 注入。 */
export function TextReader({ message, fontStep, renderBody, onFontStep, onCopy, onClose }: {
  message: ChatMessage;
  fontStep: number; // -1 ~ 3
  renderBody: (m: ChatMessage, text: string) => ReactNode;
  onFontStep: (next: number) => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <Modal className="text-reader" onClose={onClose}>
        <div className="tr-bar">
          <button className="tr-btn" title="关闭" onClick={onClose}><X size={18} /></button>
          <span className="tr-title">全文 · {charCountLabel(message.content)}</span>
          <span className="tr-actions">
            <button className="tr-btn" title="缩小字号" disabled={fontStep <= -1}
                    onClick={() => onFontStep(Math.max(-1, fontStep - 1))}>A−</button>
            <button className="tr-btn" title="放大字号" disabled={fontStep >= 3}
                    onClick={() => onFontStep(Math.min(3, fontStep + 1))}>A+</button>
            <button className="tr-btn" title="复制全文" onClick={onCopy}><Copy size={16} /></button>
          </span>
        </div>
        {/* 基准跟随用户设置的聊天正文字号 --msg-font（14~22px），再叠加档位偏移——否则读长文的界面反而无视字号偏好。 */}
        <div className="tr-body" style={{ fontSize: `calc(var(--msg-font) + ${fontStep}px)` }}>{renderBody(message, message.content)}</div>
    </Modal>
  );
}
