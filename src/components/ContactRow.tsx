import type { MouseEvent } from "react";
import { Avatar } from "./Avatar";
import type { ContactCard } from "../contactCard";
import { useT } from "../i18n";

/**
 * 个人名片的「列表行」——**会话详情页「名片」页签**与**收藏页「名片」分类共用同一个组件**
 * （即"收藏页复用资料详情页"的落地方式，镜像 iOS 的 IMDetailContactCell）。
 * 规格见 IMServer docs/design/CONTACT_CARD_DESIGN.md §7.1：44 头像、主行显示名、副行 @句柄、
 * 「由 X 分享」独占第三行（accent），右上时间。
 *
 * 纯展示：显示名（备注优先）由调用方解析后注入，本组件不查任何 store。
 */
export function ContactRow({ card, displayName, sourceName, timeText, onClick, onContextMenu }: {
  card: ContactCard;
  /** 收方本地显示名（备注 > 快照昵称 > uid）。 */
  displayName?: string;
  /** 来源显示名，非空 → **独占第三行**「由 X 分享」（accent）。群聊详情页 / 收藏页用；单聊详情页不传。
   *  曾与 @句柄挤在同一副行，长备注名把句柄和来源一起截没（用户反馈）。 */
  sourceName?: string;
  timeText?: string;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const tr = useT();
  // 末级不落 userId（10 位随机数字内部 ID）；退到 @句柄，再退到占位。
  const shown = displayName || card.nickname || (card.username ? `@${card.username}` : tr("common.unnamed_user"));
  return (
    <div className="contact-row" onClick={onClick} onContextMenu={onContextMenu}>
      <Avatar url={card.avatarUrl} label={shown} seed={card.userId} cls="avatar contact-row-avatar" />
      <div className="contact-row-body">
        <div className="contact-row-name">{shown}</div>
        {/* 副标题 = @句柄。绝不显示 card.userId——那是内部 ID。 */}
        <div className="contact-row-sub">{card.username ? `@${card.username}` : ""}</div>
        {sourceName && <div className="contact-row-source">{tr("contact_card.row.shared_by", { source: sourceName })}</div>}
      </div>
      {timeText && <div className="contact-row-time">{timeText}</div>}
    </div>
  );
}
