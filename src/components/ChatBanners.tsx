// ChatBanners：聊天头下方的三条横幅（入群审批 G3 蓝 / 群公告 G1 黄 / 置顶消息 G0）。
// 从 App.tsx 平移的**纯展示组件**（状态/动作仍在 App，经 props 注入；控制 App 体量，CODING_STYLE §7）。
// 优先级：审批 > 公告 > 置顶（自上而下）。纯函数 pinnedPreview/pinnedSenderLabel 直接复用 ../pinned（已带单测）。
import { UserPlus, Megaphone, Pin, X, List } from "lucide-react";
import type { GroupInfo, PinnedMessage } from "../sdk/protocol";
import { pinnedPreview, pinnedSenderLabel } from "../pinned";
import { useT } from "../i18n";

export function ChatBanners(p: {
  isGroupChat: boolean;
  groupInfo?: GroupInfo;                       // 当前群资料（单聊为 undefined）
  dismissedBanners: Record<string, boolean>;
  annDismissKey: string;
  pinDismissKey: string;
  dismiss: (key: string) => void;              // 收起某横幅（写 dismissedBanners[key]=true）
  pinnedShown?: PinnedMessage;                 // 当前轮转显示的置顶（无则不显置顶条）
  pinnedShownIdx: number;
  activePinned: PinnedMessage[];
  onOpenJoinRequests: () => void;
  onOpenAnnouncement: () => void;
  onJumpPinned: () => void;                    // 点条=跳到该置顶并轮转到下一条
  onOpenPinnedList: () => void;
}) {
  const tr = useT();
  const gi = p.groupInfo;
  const showApprove = p.isGroupChat && (gi?.my_role === "owner" || gi?.my_role === "admin") && (gi?.pending_count ?? 0) > 0;
  const showAnnounce = p.isGroupChat && !!gi?.announcement && !p.dismissedBanners[p.annDismissKey];
  const showPinned = !!p.pinnedShown && !p.dismissedBanners[p.pinDismissKey];
  return (
    <>
      {/* 入群审批横幅（G3，蓝条）：仅群主/管理员且有待审申请时显示。排在最上（需处置）。 */}
      {showApprove && (
        <div className="pin-banner approve" onClick={p.onOpenJoinRequests} role="button">
          <span className="pin-banner-main" style={{ cursor: "pointer" }}>
            <span className="pin-banner-bar" />
            <span className="pin-banner-copy">
              <span className="pin-banner-kicker"><UserPlus size={12} /> {tr("chat.banner.join_request")}</span>
              <span className="pin-banner-text">{tr("chat.banner.join_pending", { count: gi!.pending_count ?? 0 })}</span>
            </span>
          </span>
        </div>
      )}
      {/* 群公告横幅（G1，黄条）：排在置顶之上（优先级 公告 > 置顶）。点条开公告全文视图（决策 16）。 */}
      {showAnnounce && (
        <div className="pin-banner announce">
          <button className="pin-banner-main" onClick={p.onOpenAnnouncement}>
            <span className="pin-banner-bar" />
            <span className="pin-banner-copy">
              <span className="pin-banner-kicker"><Megaphone size={12} /> {tr("group.text.announcement")}</span>
              <span className="pin-banner-text">{gi!.announcement}</span>
            </span>
          </button>
          <button className="icon-btn pin-banner-close" title={tr("chat.banner.collapse_announcement")} onClick={() => p.dismiss(p.annDismissKey)}><X size={16} /></button>
        </div>
      )}
      {/* 置顶消息横幅（G0）：点条=跳到那条并轮转到下一条；右侧 ☰=展开全部置顶。 */}
      {showPinned && (
        <div className="pin-banner">
          <button className="pin-banner-main" title={tr("chat.banner.jump_to_message")} onClick={p.onJumpPinned}>
            <span className={`pin-banner-bar${p.activePinned.length > 1 ? " multi" : ""}`} />
            <span className="pin-banner-copy">
              <span className="pin-banner-kicker">
                <Pin size={12} /> {tr("chat.banner.pinned")}
                {p.activePinned.length > 1 && <span className="pin-banner-count">{p.pinnedShownIdx + 1}/{p.activePinned.length}</span>}
                {pinnedSenderLabel(p.pinnedShown!, p.isGroupChat) && (
                  <span className="pin-banner-from">· {pinnedSenderLabel(p.pinnedShown!, p.isGroupChat)}</span>
                )}
              </span>
              <span className="pin-banner-text">{pinnedPreview(p.pinnedShown!, tr)}</span>
            </span>
          </button>
          {p.activePinned.length > 1 && (
            <button className="icon-btn pin-banner-list" title={tr("chat.banner.all_pinned")} onClick={p.onOpenPinnedList}><List size={18} /></button>
          )}
          <button className="icon-btn pin-banner-close" title={tr("chat.banner.collapse_pinned")} onClick={() => p.dismiss(p.pinDismissKey)}><X size={16} /></button>
        </div>
      )}
    </>
  );
}
