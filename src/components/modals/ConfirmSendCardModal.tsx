import type { ContactCard } from "../../contactCard";
import { Modal } from "../Modal";
import { Avatar } from "../Avatar";
import { IdCard } from "lucide-react";

/**
 * 发送名片前的二次确认（CONTACT_CARD_DESIGN §4.2 / §8.2）。
 * 卡片式而不是一句「确定发送？」——因为要**把即将发出的那张卡先给用户看**，预览就是收方会看到的样式。
 *
 * 与选人弹窗是**顺序**两个弹窗，不是嵌套（Web 侧一直避免弹窗套弹窗）。
 */
export function ConfirmSendCardModal({ cards, targetName, displayName, onSend, onCancel }: {
  cards: ContactCard[];
  /** 目标会话显示名（"发送名片给「产品群」"）。 */
  targetName: string;
  /** 预览卡主标题显示名（备注 > 快照昵称 > uid）；调用方解析后注入。 */
  displayName?: (userId: string, fallback?: string) => string;
  onSend: () => void;
  onCancel: () => void;
}) {
  if (cards.length === 0) return null;
  const first = cards[0];
  const firstName = displayName?.(first.userId, first.nickname) ?? first.nickname ?? first.userId;
  // ≥2 张时首卡出全卡，其余折叠成一行显示名（≤3 个，再多显「等 N 人」）——9 张卡会把弹窗撑爆。
  const rest = cards.slice(1);
  const restNames = rest.slice(0, 3).map((c) => displayName?.(c.userId, c.nickname) ?? c.nickname ?? c.userId);
  const restText = rest.length === 0 ? ""
    : rest.length > restNames.length ? `${restNames.join(" · ")} 等 ${rest.length} 人`
    : restNames.join(" · ");

  return (
    <Modal onClose={onCancel}>
      <h3>{cards.length === 1 ? `发送名片给「${targetName}」` : `发送 ${cards.length} 张名片给「${targetName}」`}</h3>
      <div className="card-confirm-preview">
        <div className="contact-card">
          <div className="contact-card-head">
            <Avatar url={first.avatarUrl} label={firstName} seed={first.userId} cls="avatar" />
            <div className="contact-card-body">
              <div className="contact-card-name">{firstName}</div>
              <div className="contact-card-id">ID {first.userId}</div>
            </div>
          </div>
          <div className="contact-card-foot"><IdCard size={12} aria-hidden="true" />个人名片</div>
        </div>
        {restText && <div className="card-confirm-rest">{restText}</div>}
      </div>
      <div className="modal-actions">
        <button className="link" onClick={onCancel}>取消</button>
        <button className="mini-btn" onClick={onSend}>发送</button>
      </div>
    </Modal>
  );
}
