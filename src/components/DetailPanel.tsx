// DetailPanel：会话详情抽屉（对齐 iOS IMChatDetailViewController）——头部 + 操作排 + 公告/设置/备注卡 + 页签 + 群管理二级视图。
// 阶段 2 从 App.tsx 整块平移（含原 IIFE 顶部的派生：title/avatarUrl/pinned/muted/peerBlocked/detailPeerIsFriend/页签数据…），
// JSX 逐字一致（行为保持型，CODING_STYLE §7）。
// - 稳定服务走 Context：AppServicesContext（clientRef/setToast/comingSoon）+ ChatActionsContext（setViewer/onGateTap/onPassiveMediaError/openReadyFile）；
// - 其余动作多定义在 App 的 login 早退之后（plain fn，不能进 memo 化 context）→ 按组走 props（此前登记的「~35 props」路线，用户拍板整块抽）。
// 护栏：DetailPanel.test.tsx + DetailPanelParts.test.tsx（子件）。
import { useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  X, Camera, UserPlus, UserMinus, MessageCircle, Phone, Video, Search, MoreHorizontal, Trash2, Ban, LogOut,
  Megaphone, Info, ChevronRight, Pin, BellOff, Settings2, QrCode, Link2, SquarePen, Bookmark, AtSign,
  IdCard,
} from "lucide-react";
import type { ChatMessage, Conversation, FriendEntry, GroupBan, GroupInfo, GroupMember } from "../sdk/protocol";
import type { DownloadState } from "../download";
import { firstURLInText } from "../messageContent";
import { CONTACT_CONTENT_TYPE, parseContactCard } from "../contactCard";
import { useAppServices } from "../AppServicesContext";
import { useChatActions } from "../ChatActionsContext";
import { Avatar } from "./Avatar";
import { GroupManagePanel } from "./GroupManagePanel";
import { AdminListPanel } from "./AdminListPanel";
import { DetailTabs, type DetailTab } from "./DetailTabs";
import { useMemberSearch } from "../useMemberSearch";
import { SYSTEM_UID } from "../sdk/protocol";

export type DetailTarget = { convId: string; isGroup: boolean; peer?: string; fromOwnChat?: boolean };

export interface DetailPanelProps {
  detail: DetailTarget;
  // —— 数据（reactive）——
  conversations: Conversation[];
  groupInfos: Record<string, GroupInfo>;
  friends: FriendEntry[];
  uid: string;
  detailTab: DetailTab;
  detailMsgs: ChatMessage[];
  detailMore: boolean;
  manageOpen: boolean;
  /** 群管理 →「管理员」二级面板是否展开（与 manageOpen 同级的抽屉内层级）。 */
  adminPanelOpen: boolean;
  groupBans: GroupBan[] | null;
  // —— 解析/判定（App 内闭包）——
  groupRemark: (cid: string) => string;
  peerNick: (id: string) => string | undefined;
  /** 对端的**公开句柄**（GET /users/{id} 的 username），UI 显示为 @xxx。
   *  「用户名」行显示它——绝不能显示 d.peer，那是 10 位随机数字内部 ID（见 docs/UI.md「用户标识」）。 */
  peerUsername: (id: string) => string | undefined;
  /**
   * 超级群的成员分页（普通群不传，走 gp.members 全量）。
   * 超级群的 `GET /groups/{id}` 只回我自己，成员表必须由 App 走 groupMembersPage 分页取，
   * 再从这里透传下来——DetailPanel/DetailTabs 都是纯展示组件，不自己发请求。
   */
  superMembers?: GroupMember[];
  superHasMore?: boolean;
  onLoadMoreMembers?: () => void;
  /** 部署级能力/配额（GET /server-config）。用于判定「满员 → 可升级为大群」告知是否显示。
   *  拿不到（还没回/请求失败）时不显示——宁可少提示，也不能按硬编码上限误报"已满"。 */
  serverConfig?: { max_group_members: number; supergroup_enabled: boolean; max_supergroup_members: number } | null;
  /** 群成员在**本机**列表里的显示名：备注 > 群昵称 > 昵称 > uid（透传给 DetailTabs）。 */
  memberLabel: (m: GroupMember) => string;
  peerAvatar: (id: string) => string | undefined;
  /** 入口 ②「推荐给朋友」：把当前单聊对端做成名片，交给转发选择页选会话（见 useContactShare）。 */
  onShareContact: (card: { userId: string; username?: string; nickname?: string; avatarUrl?: string }) => void;
  /** 名片行显示名（**备注优先**）。由 App 注入——只有那里能拿到 remarks；
   *  曾在此就地用 peerNick 拼，那个函数只查昵称不查备注，同一张名片在气泡显「老王」、
   *  在本页名片签却显「王建国」（/code-review 2026-08-29）。 */
  contactDisplayName: (userId: string, fallback?: string) => string;
  /** 单聊头部副标题 = 对端**在线态**文案（App 用 presenceText(presence[peer]) 算好传入，取不到为空串）。
   *  刻意**不显示 @句柄**：下方「用户名」行已经显示它，头部再来一次是纯重复（与 iOS displaySubtitle 同口径）。 */
  peerPresenceText?: string;
  /** 该 uid 经 GET /users/{id} 确认已注销（200001）→ 面板显空态（CONTACT_CARD_DESIGN §6 第四分支）。
   *  名片卡是唯一能打开任意陌生/已注销 uid 的入口，没有这一支就会显示一个看似正常的空资料页。 */
  peerDeleted?: boolean;
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  mediaSrc: (m: ChatMessage) => string; // blob 缓存优先解析（语音 tab）
  canManageMember: (gp: GroupInfo, m: GroupMember) => boolean;
  // —— 抽屉自身 UI 态 ——
  onClose: () => void;
  setDetailTab: (k: DetailTab) => void;
  setDetailMore: Dispatch<SetStateAction<boolean>>;
  setManageOpen: (v: boolean) => void;
  setAdminPanelOpen: (v: boolean) => void;
  /** 打开「添加管理员」弹窗（仅群主；候选在 App 里按 groupAdmin.adminCandidates 过滤）。 */
  openAdminPicker: (cid: string) => void;
  /** 打开「选择新群主」弹窗（仅群主）。 */
  openTransferPicker: (cid: string) => void;
  /** 撤销某人的管理员身份（含二次确认）。 */
  revokeAdmin: (cid: string, m: GroupMember) => void;
  setContactDraft: (v: { peer: string; remark: string }) => void;
  setInviteDraft: (v: { convId: string; selected: string[] }) => void;
  setMemberMenu: (v: { x: number; y: number; convId: string; m: GroupMember }) => void;
  setFileMenu: (v: { x: number; y: number; m: ChatMessage }) => void;
  // —— 动作 ——
  doFriendAction: (userId: string, fn: () => Promise<void>) => Promise<void>;
  openChat: (peer: string) => void;
  /** 在**该资料卡对应的会话**里开搜索（不是当前打开的那个会话）。
   *  从群成员头像进来的单聊资料卡，convId 是与该成员的单聊——此前这里不传参，
   *  App 侧就把搜索开在了当时还开着的那个群上（静默搜错会话，2026-08-31 修）。 */
  openInChatSearch: (targetConvId: string, peer: string, isGroup: boolean) => void;
  doClearHistory: (cid: string) => void;
  doToggleBlock: (peer: string, block: boolean) => void;
  /** 删除好友（含二次确认）。删完保持面板打开——好友态刷新后本页自动切成非好友视图。 */
  doRemoveFriend: (peer: string) => void;
  doLeaveGroup: (cid: string) => Promise<void>;
  doDissolveGroup: (cid: string) => void;
  setConvPinned: (c: Conversation, pinned: boolean) => void;
  setConvMuted: (c: Conversation, muted: boolean) => void;
  openGroupText: (kind: "announcement" | "intro", cid: string) => void;
  openGroupCard: (cid: string, asLink?: boolean) => Promise<void>;
  doEditMyGroupNickname: (gp: GroupInfo) => Promise<void>;
  doEditGroupRemark: (gp: GroupInfo) => Promise<void>;
  pickGroupAvatar: (gp: GroupInfo) => void;
  openJoinRequests: (cid: string) => Promise<void>;
  openGroupBans: (cid: string) => Promise<void>;
  openPeerDetail: (peer: string) => void;
}

export function DetailPanel(p: DetailPanelProps) {
  // 抽屉本身就是滚动容器（.detail-panel 有 overflow-y:auto）。成员列表虚拟化复用它，
  // 不自造内层滚动区——那会变成"抽屉里再套一个滚动条"，与现在的交互不一样。
  const panelRef = useRef<HTMLElement>(null);
  const {
    detail, conversations, groupInfos, friends, uid, detailTab, detailMsgs, detailMore, manageOpen, adminPanelOpen, groupBans,
    groupRemark, peerNick, peerUsername, peerAvatar, memberLabel, mediaGate, mediaSrc, canManageMember, onShareContact, contactDisplayName, peerDeleted, peerPresenceText,
    onClose, setDetailTab, setDetailMore, setManageOpen, setAdminPanelOpen, openAdminPicker, openTransferPicker, revokeAdmin,
    setContactDraft, setInviteDraft, setMemberMenu, setFileMenu,
    doFriendAction, openChat, openInChatSearch, doClearHistory, doToggleBlock, doRemoveFriend, doLeaveGroup, doDissolveGroup,
    setConvPinned, setConvMuted, openGroupText, openGroupCard, doEditMyGroupNickname, doEditGroupRemark,
    pickGroupAvatar, openJoinRequests, openGroupBans, openPeerDetail, serverConfig,
  } = p;
  const { clientRef, setToast, comingSoon } = useAppServices();
  const { setViewer, onGateTap, onPassiveMediaError, openReadyFile, fetchLinkPreview } = useChatActions();
  // 成员搜索：只对群会话有意义（单聊没有成员表）。恒走服务端 ?q=，理由见 useMemberSearch 头注释。
  // token 每次渲染现取，**不在组件里存副本**——登录路径三条，副本必然漂移。
  const memberSearch = useMemberSearch(
    p.detail.isGroup ? p.detail.convId : undefined,
    clientRef.current?.authToken ?? "",
  );
    const d = detail;
    const conv = conversations.find((c) => c.conv_id === d.convId);
    const gp = d.isGroup ? groupInfos[d.convId] : undefined;
    const canManage = !!gp && gp.my_role !== "member";
    const isOwner = !!gp && gp.my_role === "owner";
    // 「仅管理员可邀请」开启且我非管理员 → 隐藏所有邀请类入口（群二维码/群邀请链接/添加成员），对齐 iOS。
    const canInviteHere = !gp?.perm_invite || canManage;
    const title = d.isGroup ? (groupRemark(d.convId) || gp?.name || conv?.name || "群聊")
      : (conv?.peer_remark || conv?.peer_nickname || (d.peer ? peerNick(d.peer) : "") || d.peer || "");
    // 单聊资料卡：无会话行时（从群成员点进的未聊过对端）从群成员表/好友/搜索兜底取头像，
    // 否则只回退首字母圈（bug：群里头像正常、点进资料卡却回退）。
    const avatarUrl = d.isGroup ? (gp?.avatar_url ?? conv?.avatar_url)
      : (conv?.peer_avatar_url || (d.peer ? peerAvatar(d.peer) : undefined));
    // 名片快照用的**真实昵称/头像**（推荐给朋友，入口 ②）：刻意**不含备注**（title 含），见 §2.4。
    const detailPeerNickname = d.isGroup ? undefined
      : (conv?.peer_nickname || (d.peer ? peerNick(d.peer) : undefined));
    const detailPeerAvatar = d.isGroup ? undefined
      : (conv?.peer_avatar_url || (d.peer ? peerAvatar(d.peer) : undefined));
    // 单聊副标题 = **在线态**（对齐 iOS：标题是名字、副标题是「在线 / 最近在线」）。
    // 曾经显示 @句柄——但下方「用户名」行已经显示了它，头部再来一次是纯重复、没有新信息。
    // 取不到在线态时为空串，副标题自然隐藏（不显示占位；绝不回退到 d.peer 那串内部 ID）。
    // 人数优先取 member_count：超级群的 members 只含我自己（服务端不再下发全量），
    // 用 members.length 会显示成「1 位成员」。member_count 恒是真实人数。
    const memberTotal = gp?.member_count ?? gp?.members.length ?? conv?.member_count ?? 0;
    // 「大群」标注：让用户明白为什么这里看不到已读/正在输入/在线态（否则会当成 bug 报上来）。
    const superTag = (gp?.is_super ?? conv?.is_super) ? " · 大群" : "";
    // 满员告知：**普通群人满 + 本部署开了超级群**才给。三个条件缺一不可——
    //   · 已是大群 → 没有可升的了；
    //   · 部署没开超级群 → 入口是死的，联系管理员他也办不了（后端直接拒 upgrade-super）；
    //   · 拿不到 serverConfig → 不显示。宁可少提示，也不能按硬编码上限误报"已满"
    //     （端上硬编码上限这个坑本仓刚踩过：端 500、后端 2000）。
    const isSuperHere = !!(gp?.is_super ?? conv?.is_super);
    const upgradeHint = (!isSuperHere && gp && serverConfig?.supergroup_enabled
      && memberTotal >= serverConfig.max_group_members)
      ? {
          maxMembers: serverConfig.max_group_members,
          maxSuperMembers: serverConfig.max_supergroup_members,
          onCopyGroupID: () => {
            void navigator.clipboard?.writeText(gp.conv_id);
            setToast("已复制群 ID");
          },
        }
      : undefined;
    const subtitle = d.isGroup ? `${memberTotal} 位成员${superTag}` : (peerPresenceText ?? "");
    const pinned = (conv?.pinned_at ?? 0) > 0;
    const muted = !!conv?.muted;
    const peerBlocked = !d.isGroup && !!friends.find((f) => f.user_id === d.peer)?.blocked;
    // 好友准入（微信式，任务一 P0）：非好友不显示「消息/呼叫/视频」，改显「加好友」。
    // 拉黑的好友 status 仍 accepted（仍算好友，可发消息），故只看 status 不看 blocked。
    const detailPeerIsFriend = !d.isGroup && !!d.peer && friends.some((f) => f.user_id === d.peer && f.status === "accepted");
    // 系统通知会话（peer=system）：资料页精简版——不显加好友/消息/呼叫/视频/搜索/拉黑，
    // 只保留头像+说明+清空聊天。见 docs/design/SYSTEM_NOTICE_SESSION_DESIGN.md §5.3 / §7 权限矩阵。
    const isSystemPeer = !d.isGroup && d.peer === SYSTEM_UID;
    // 非好友（单聊）只保留头像 + 操作排（加好友/更多），隐藏设置·备注名·页签——尚未建立关系时这些设置无意义。
    // 仅隐藏，数据加载逻辑不动（加为好友后重新渲染即恢复）。与 iOS sectionLayout 同语义。
    const showDetailBody = (d.isGroup || detailPeerIsFriend) && !peerDeleted;
    // 页签数据（本地历史）—— 与 iOS IMChatDetailTabs.matchesKind: 对齐（2026-08-25）：
    // ① 撤回墓碑 recalledAt>0 排除；② status==="failed" 未确认态排除；③ convSeq>0 挡未发出的占位；
    // ④ 链接 tab 前置 contentType 校验（`text`/`link`），否则图片/视频/文件的 content 恰为 URL 时会漏进链接 tab
    //   （曾造成"链接 tab 同一 URL 显示两遍"—— 一次是真链接消息，一次是同 URL 的图片消息误匹配）。
    const isPresentable = (m: typeof detailMsgs[number]) =>
      m.convSeq > 0 && !m.recalledAt && m.status !== "failed";
    const media = detailMsgs.filter((m) => isPresentable(m) && (m.contentType === "image" || m.contentType === "video"))
      .sort((a, b) => b.convSeq - a.convSeq);
    const files = detailMsgs.filter((m) => isPresentable(m) && m.contentType === "file").sort((a, b) => b.convSeq - a.convSeq);
    const voices = detailMsgs.filter((m) => isPresentable(m) && (m.contentType === "voice" || m.contentType === "audio"))
      .sort((a, b) => b.convSeq - a.convSeq); // 语音 tab（2026-08-26，与 iOS IMDetailTabKindVoice 同口径）
    const links = detailMsgs.filter((m) =>
      // 与 iOS IMChatDetailTabs.matchesKind: 同款口径：text 只要**含 URL** 就进链接 tab（草图 §D），
      // 老的 isUrlText 只认整段 = URL，会漏掉"看看 https://xxx"这类混排消息。
      isPresentable(m) && (m.contentType === "text" || m.contentType === "link") && firstURLInText(m.content) !== null
    ).sort((a, b) => b.convSeq - a.convSeq);
    // 名片 tab（2026-08-29）：与 iOS IMDetailTabKindContacts 同口径——**解析不出的脏名片不收录**
    //（列表里不该出现点不动的空行；气泡侧另有灰字降级，那是历史记录该保留）。
    const contacts = detailMsgs.filter((m) =>
      isPresentable(m) && m.contentType === CONTACT_CONTENT_TYPE && parseContactCard(m.content) !== null
    ).sort((a, b) => b.convSeq - a.convSeq);
    // 语音 / 名片 tab 与 iOS 对齐：有该类消息才出现（其余 tab 维持恒显的既有 Web 行为）。名片**置末**。
    const voiceTabs: Array<{ k: typeof detailTab; label: string }> = voices.length > 0 ? [{ k: "voice", label: "语音" }] : [];
    const contactTabs: Array<{ k: typeof detailTab; label: string }> = contacts.length > 0 ? [{ k: "contacts", label: "名片" }] : [];
    const tabs: Array<{ k: typeof detailTab; label: string }> = d.isGroup
      ? [{ k: "members", label: "成员" }, { k: "media", label: "媒体" }, { k: "files", label: "文件" }, ...voiceTabs, { k: "links", label: "链接" }, ...contactTabs]
      : [{ k: "media", label: "媒体" }, { k: "files", label: "文件" }, ...voiceTabs, { k: "links", label: "链接" }, ...contactTabs];
    const activeTab = tabs.some((t) => t.k === detailTab) ? detailTab : tabs[0].k;

    return (
      <div className="detail-mask" onClick={onClose}>
        <aside ref={panelRef} className="detail-panel" onClick={(e) => e.stopPropagation()}>
          {!manageOpen && (
            // 标题栏随面板滚动固定在顶部（对齐 iOS 大标题折叠为常驻导航栏）：关闭按钮一并锁在标题栏内。
            <div className="detail-sticky-head">
              <button className="detail-close" title="关闭" onClick={onClose}><X size={20} /></button>
              <div className="detail-topbar">{d.isGroup ? "群组信息" : "用户信息"}</div>
            </div>
          )}

          {manageOpen && gp && adminPanelOpen ? (
            <AdminListPanel gp={gp} uid={uid} memberLabel={memberLabel}
              onBack={() => setAdminPanelOpen(false)}
              onAdd={() => openAdminPicker(gp.conv_id)}
              onRevoke={(m) => revokeAdmin(gp.conv_id, m)}
              onOpenMember={openPeerDetail} />
          ) : manageOpen && gp ? (
            <GroupManagePanel gp={gp} groupBans={groupBans}
              onBack={() => { setManageOpen(false); setAdminPanelOpen(false); }} onPickAvatar={pickGroupAvatar}
              onOpenJoinRequests={openJoinRequests} onOpenBans={openGroupBans}
              onOpenAdmins={() => setAdminPanelOpen(true)}
              onOpenTransfer={openTransferPicker} />
          ) : (
            <>
              {/* ---- 头部：头像 + 名 + 副标题 ---- */}
              <div className="detail-header">
                <div className="detail-avatar-wrap">
                  <Avatar url={avatarUrl} label={title} seed={d.isGroup ? d.convId : (d.peer ?? "")} cls="detail-avatar" />
                  {canManage && (
                    <button className="detail-cam" title="设置群头像" onClick={() => pickGroupAvatar(gp!)}><Camera size={15} /></button>
                  )}
                </div>
                <div className="detail-name">{title}</div>
                <div className="detail-sub">{subtitle}</div>
              </div>

              {/* ---- 操作排 pills ---- */}
              <div className="detail-pills">
                {!isSystemPeer && !d.isGroup && !detailPeerIsFriend && (
                  <button className="detail-pill" onClick={() => void doFriendAction(d.peer!, async () => {
                    // 已直接成为好友（我曾单向删除对方而对方仍视我为好友）→ 不吐司，doFriendAction 的
                    // refreshFriends 会让操作排/卡片立即恢复；说「已发送申请」反而误导要等对方通过。
                    const becameFriend = await clientRef.current!.requestFriend(d.peer!);
                    if (!becameFriend) { setToast("已发送好友申请"); }
                  })}><UserPlus size={20} /><span>加好友</span></button>
                )}
                {!isSystemPeer && !d.isGroup && detailPeerIsFriend && !d.fromOwnChat && (
                  <button className="detail-pill" onClick={() => { onClose(); openChat(d.peer!); }}><MessageCircle size={20} /><span>消息</span></button>
                )}
                {!isSystemPeer && !d.isGroup && detailPeerIsFriend && <button className="detail-pill" onClick={() => comingSoon("语音通话")}><Phone size={20} /><span>呼叫</span></button>}
                {!isSystemPeer && !d.isGroup && detailPeerIsFriend && <button className="detail-pill" onClick={() => comingSoon("视频通话")}><Video size={20} /><span>视频</span></button>}
                {!isSystemPeer && showDetailBody && <button className="detail-pill" onClick={() => { onClose(); openInChatSearch(d.convId, d.peer ?? "", d.isGroup); }}><Search size={20} /><span>搜索</span></button>}
                {/* 「更多」：单聊**非好友**不显示——菜单里全是"已经是好友"才有意义的项（推荐/拉黑/清空/删除好友），
                    此时页面只应给一个主入口「加好友」（与 iOS actionPillSpecs 同口径）。系统通知会话例外：它只有这一个入口。 */}
                {(d.isGroup || isSystemPeer || detailPeerIsFriend) && (
                <div className="detail-pill-anchor">
                  <button className="detail-pill" onClick={() => setDetailMore((v) => !v)}><MoreHorizontal size={20} /><span>更多</span></button>
                  {detailMore && (
                    <div className="menu-card detail-more" onClick={(e) => e.stopPropagation()}>
                      {/* 入口 ②「推荐给朋友」（CONTACT_CARD_DESIGN §8.1）：把正在看的这个人推给别的会话。
                          选会话复用**已有的** ForwardPicker，零新组件。系统通知会话不给（推它没有意义）。 */}
                      {!isSystemPeer && !d.isGroup && d.peer && !peerDeleted && (
                        <button className="menu-item" onClick={() => {
                          setDetailMore(false);
                          // 昵称取 peerNickname（服务端下发的真实昵称），**不是**页面标题——后者备注优先，
                          // 发出去就泄露"我给你起的外号"（§2.4）。
                          onShareContact({ userId: d.peer!, username: peerUsername(d.peer!), nickname: detailPeerNickname, avatarUrl: detailPeerAvatar });
                        }}><IdCard size={16} className="menu-icon" />推荐给朋友</button>
                      )}
                      <button className="menu-item" onClick={() => { setDetailMore(false); doClearHistory(d.convId); }}><Trash2 size={16} className="menu-icon" />清空聊天记录</button>
                      {!isSystemPeer && !d.isGroup && (
                        <button className={`menu-item ${peerBlocked ? "" : "danger"}`} onClick={() => { setDetailMore(false); doToggleBlock(d.peer!, !peerBlocked); }}><Ban size={16} className="menu-icon" />{peerBlocked ? "取消拉黑" : "拉黑"}</button>
                      )}
                      {d.isGroup && (
                        <button className="menu-item danger" onClick={() => { setDetailMore(false); void doLeaveGroup(d.convId); }}><LogOut size={16} className="menu-icon" />退出群组</button>
                      )}
                      {isOwner && (
                        <button className="menu-item danger" onClick={() => { setDetailMore(false); doDissolveGroup(d.convId); }}><Trash2 size={16} className="menu-icon" />删除群组</button>
                      )}
                      {/* 删除好友：破坏性最重，按本仓 destructive-last 约定放末位（与消息/会话菜单一致）。
                          删完不关面板——好友列表刷新后本页自动切成非好友视图（只剩「加好友」）。 */}
                      {!isSystemPeer && !d.isGroup && detailPeerIsFriend && d.peer && (
                        <button className="menu-item danger" onClick={() => { setDetailMore(false); doRemoveFriend(d.peer!); }}><UserMinus size={16} className="menu-icon" />删除好友</button>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
              {/* 已注销用户：一段空态替代全部资料/页签（§6 第四分支）。头部头像+名字仍显快照，
                  与「卡片本身仍显示快照、历史记录不该凭空变空」同口径。 */}
              {peerDeleted && !d.isGroup && (
                <div className="detail-card detail-empty" style={{ marginTop: 8 }}>该用户不存在或已注销</div>
              )}
              {/* 系统通知会话：一段说明卡替代普通用户资料页的备注/设置/页签。 */}
              {isSystemPeer && (
                <div className="detail-card" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: "var(--muted, #666)" }}>
                  这是官方通知会话，用于发送<b style={{ color: "var(--fg, #222)" }}>登录提醒、账号安全</b>等系统事件。你不能回复此会话。
                </div>
              )}

              {showDetailBody && (<>
              {/* ---- 群公告 / 群简介卡（决策 17，Pills 下第一卡，全员只读；一行预览 + 点开全文视图） ---- */}
              {d.isGroup && gp && (gp.announcement || gp.intro) && (
                <div className="detail-card">
                  {gp.announcement && (
                    <button className="detail-row" onClick={() => openGroupText("announcement", d.convId)}>
                      <span className="detail-row-ic"><Megaphone size={18} /></span><span>群公告</span>
                      <span className="detail-row-val">{gp.announcement}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                  )}
                  {gp.intro && (
                    <button className="detail-row" onClick={() => openGroupText("intro", d.convId)}>
                      <span className="detail-row-ic"><Info size={18} /></span><span>群简介</span>
                      <span className="detail-row-val">{gp.intro}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                  )}
                </div>
              )}
              {/* ---- 设置：置顶 / 免打扰 (+群管理) ---- */}
              <div className="detail-card">
                <div className="detail-row"><span className="detail-row-ic"><Pin size={18} /></span><span>置顶聊天</span>
                  <button className={`switch ${pinned ? "on" : ""}`} disabled={!conv} onClick={() => conv && setConvPinned(conv, !pinned)} /></div>
                <div className="detail-row"><span className="detail-row-ic"><BellOff size={18} /></span><span>消息免打扰</span>
                  <button className={`switch ${muted ? "on" : ""}`} disabled={!conv} onClick={() => conv && setConvMuted(conv, !muted)} /></div>
                {/* 进「群管理」时显式复位管理员二级面板：不复位的话，上次从管理员页直接退出抽屉后，
                    下次点「群管理」会一步跨进管理员列表（层级状态是两个独立布尔，不会自己归位）。 */}
                {canManage && (
                  <button className="detail-row" onClick={() => { setAdminPanelOpen(false); setManageOpen(true); }}>
                    <span className="detail-row-ic"><Settings2 size={18} /></span><span>群管理</span>
                    {(gp?.pending_count ?? 0) > 0
                      ? <span className="detail-badge">{gp!.pending_count}</span>
                      : <span className="detail-row-val muted">仅群主/管理员</span>}
                    <ChevronRight size={16} className="detail-row-chev" />
                  </button>
                )}
                {d.isGroup && canInviteHere && (
                  <button className="detail-row" onClick={() => void openGroupCard(d.convId)}>
                    <span className="detail-row-ic"><QrCode size={18} /></span><span>群二维码</span>
                    <ChevronRight size={16} className="detail-row-chev end" />
                  </button>
                )}
                {d.isGroup && canInviteHere && (
                  <button className="detail-row" onClick={() => void openGroupCard(d.convId, true)}>
                    <span className="detail-row-ic"><Link2 size={18} /></span><span>群邀请链接</span>
                    <ChevronRight size={16} className="detail-row-chev end" />
                  </button>
                )}
              </div>

              {/* ---- 群：我在本群的昵称 / 群备注（任意成员，G1） ---- */}
              {d.isGroup && gp && (
                <div className="detail-card">
                  <button className="detail-row" onClick={() => void doEditMyGroupNickname(gp)}>
                    <span className="detail-row-ic"><SquarePen size={18} /></span><span>我在本群的昵称</span>
                    <span className="detail-row-val">{gp.my_nickname || "未设置"}</span><ChevronRight size={16} className="detail-row-chev" />
                  </button>
                  <button className="detail-row" onClick={() => void doEditGroupRemark(gp)}>
                    <span className="detail-row-ic"><Bookmark size={18} /></span><span>群备注</span>
                    <span className="detail-row-val">{groupRemark(gp.conv_id) || "未设置"}</span><ChevronRight size={16} className="detail-row-chev" />
                  </button>
                </div>
              )}

              {/* ---- 单聊：备注名 / 用户名 ---- */}
              {!d.isGroup && (
                <div className="detail-card">
                  <button className="detail-row" onClick={() => setContactDraft({ peer: d.peer!, remark: conv?.peer_remark ?? "" })}>
                    <span className="detail-row-ic"><SquarePen size={18} /></span><span>备注名</span>
                    <span className="detail-row-val">{conv?.peer_remark || "点击设置"}</span><ChevronRight size={16} className="detail-row-chev" />
                  </button>
                  {/* 显示公开句柄，不是 d.peer（内部 ID）。拿不到时整行不渲染——
                      标签写着"用户名"却显示一串随机数字，是最刺眼的一处错配。 */}
                  {d.peer && peerUsername(d.peer) && (
                    // 点整行即复制句柄（不带 @）：用户名是要拿去搜人/发给别人的，看得见却复制不走等于没有。
                    // Web 上「长按」没有原生语义，点击就是它的等价物（iOS 那端是长按菜单「复制」）。
                    <button className="detail-row" title="点击复制用户名" onClick={() => {
                      const handle = peerUsername(d.peer!) ?? "";
                      if (!handle) return;
                      void navigator.clipboard?.writeText(handle).then(() => setToast("已复制用户名"), () => setToast("复制失败"));
                    }}><span className="detail-row-ic"><AtSign size={18} /></span><span>用户名</span><span className="detail-row-val accent">@{peerUsername(d.peer)}</span></button>
                  )}
                </div>
              )}

              {/* ---- 页签 ---- */}
              <DetailTabs
                tabs={tabs} activeTab={activeTab} onSelectTab={setDetailTab}
                gp={gp} uid={uid} memberLabel={memberLabel} media={media} files={files} voices={voices}
                voiceSenderLabel={(m) => {
                  // 单聊：peer 备注/昵称；群聊：群成员昵称（peerNick 已封装成员表 → 昵称回退 uid）。
                  const label = peerNick?.(m.from);
                  return label || m.fromNickname || m.from;
                }}
                links={links}
                contacts={contacts}
                contactDisplayName={contactDisplayName}
                contactSourceLabel={(m) => {
                  // 「由 X 分享」只在群聊显——单聊详情页里发送者只可能是我或对方，写出来纯冗余（与 iOS 一致）。
                  if (!d.isGroup) return undefined;
                  if (m.from === uid) return "你自己";
                  return contactDisplayName(m.from, m.fromNickname);
                }}
                onOpenContact={openPeerDetail}
                members={p.superMembers} hasMoreMembers={p.superHasMore} onLoadMoreMembers={p.onLoadMoreMembers}
                scrollElRef={panelRef} search={memberSearch} upgradeHint={upgradeHint}
                canInvite={canInviteHere}
                onAddMember={(cid) => setInviteDraft({ convId: cid, selected: [] })}
                onOpenMember={openPeerDetail} canManageMember={canManageMember}
                onMemberMenu={(e, cid, m) => setMemberMenu({ x: e.clientX, y: e.clientY, convId: cid, m })}
                mediaGate={mediaGate} mediaSrc={mediaSrc} onGateTap={onGateTap}
                onOpenViewer={(m) => setViewer({ m, fromGallery: true })}
                onFileMenu={(e, m) => setFileMenu({ x: e.clientX, y: e.clientY, m })}
                onMediaError={(m) => void onPassiveMediaError(m)} onOpenFile={openReadyFile}
                fetchLinkPreview={fetchLinkPreview}
              />
              </>)}
            </>
          )}
        </aside>
      </div>
    );
}
