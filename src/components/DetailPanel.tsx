// DetailPanel：会话详情抽屉（对齐 iOS IMChatDetailViewController）——头部 + 操作排 + 公告/设置/备注卡 + 页签 + 群管理二级视图。
// 阶段 2 从 App.tsx 整块平移（含原 IIFE 顶部的派生：title/avatarUrl/pinned/muted/peerBlocked/detailPeerIsFriend/页签数据…），
// JSX 逐字一致（行为保持型，CODING_STYLE §7）。
// - 稳定服务走 Context：AppServicesContext（clientRef/setToast/comingSoon）+ ChatActionsContext（setViewer/onGateTap/onPassiveMediaError/openReadyFile）；
// - 其余动作多定义在 App 的 login 早退之后（plain fn，不能进 memo 化 context）→ 按组走 props（此前登记的「~35 props」路线，用户拍板整块抽）。
// 护栏：DetailPanel.test.tsx + DetailPanelParts.test.tsx（子件）。
import type { Dispatch, SetStateAction } from "react";
import {
  X, Camera, UserPlus, MessageCircle, Phone, Video, Search, MoreHorizontal, Trash2, Ban, LogOut,
  Megaphone, Info, ChevronRight, Pin, BellOff, Settings2, QrCode, Link2, SquarePen, Bookmark, AtSign,
} from "lucide-react";
import type { ChatMessage, Conversation, FriendEntry, GroupBan, GroupInfo, GroupMember } from "../sdk/protocol";
import type { DownloadState } from "../download";
import { firstURLInText } from "../messageContent";
import { useAppServices } from "../AppServicesContext";
import { useChatActions } from "../ChatActionsContext";
import { Avatar } from "./Avatar";
import { GroupManagePanel } from "./GroupManagePanel";
import { DetailTabs, type DetailTab } from "./DetailTabs";

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
  groupBans: GroupBan[] | null;
  // —— 解析/判定（App 内闭包）——
  groupRemark: (cid: string) => string;
  peerNick: (id: string) => string | undefined;
  peerAvatar: (id: string) => string | undefined;
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  mediaSrc: (m: ChatMessage) => string; // blob 缓存优先解析（语音 tab）
  canManageMember: (gp: GroupInfo, m: GroupMember) => boolean;
  // —— 抽屉自身 UI 态 ——
  onClose: () => void;
  setDetailTab: (k: DetailTab) => void;
  setDetailMore: Dispatch<SetStateAction<boolean>>;
  setManageOpen: (v: boolean) => void;
  setContactDraft: (v: { peer: string; remark: string }) => void;
  setInviteDraft: (v: { convId: string; selected: string[] }) => void;
  setMemberMenu: (v: { x: number; y: number; convId: string; m: GroupMember }) => void;
  setFileMenu: (v: { x: number; y: number; m: ChatMessage }) => void;
  // —— 动作 ——
  doFriendAction: (userId: string, fn: () => Promise<void>) => Promise<void>;
  openChat: (peer: string) => void;
  openInChatSearch: () => void;
  doClearHistory: (cid: string) => void;
  doToggleBlock: (peer: string, block: boolean) => void;
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
  const {
    detail, conversations, groupInfos, friends, uid, detailTab, detailMsgs, detailMore, manageOpen, groupBans,
    groupRemark, peerNick, peerAvatar, mediaGate, mediaSrc, canManageMember,
    onClose, setDetailTab, setDetailMore, setManageOpen, setContactDraft, setInviteDraft, setMemberMenu, setFileMenu,
    doFriendAction, openChat, openInChatSearch, doClearHistory, doToggleBlock, doLeaveGroup, doDissolveGroup,
    setConvPinned, setConvMuted, openGroupText, openGroupCard, doEditMyGroupNickname, doEditGroupRemark,
    pickGroupAvatar, openJoinRequests, openGroupBans, openPeerDetail,
  } = p;
  const { clientRef, setToast, comingSoon } = useAppServices();
  const { setViewer, onGateTap, onPassiveMediaError, openReadyFile, fetchLinkPreview } = useChatActions();
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
    const subtitle = d.isGroup ? `${gp?.members.length ?? conv?.member_count ?? 0} 位成员` : (d.peer ?? "");
    const pinned = (conv?.pinned_at ?? 0) > 0;
    const muted = !!conv?.muted;
    const peerBlocked = !d.isGroup && !!friends.find((f) => f.user_id === d.peer)?.blocked;
    // 好友准入（微信式，任务一 P0）：非好友不显示「消息/呼叫/视频」，改显「加好友」。
    // 拉黑的好友 status 仍 accepted（仍算好友，可发消息），故只看 status 不看 blocked。
    const detailPeerIsFriend = !d.isGroup && !!d.peer && friends.some((f) => f.user_id === d.peer && f.status === "accepted");
    // 系统通知会话（peer=system）：资料页精简版——不显加好友/消息/呼叫/视频/搜索/拉黑，
    // 只保留头像+说明+清空聊天。见 docs/SYSTEM_NOTICE_SESSION_DESIGN.md §5.3 / §7 权限矩阵。
    const isSystemPeer = !d.isGroup && d.peer === "system";
    // 非好友（单聊）只保留头像 + 操作排（加好友/更多），隐藏设置·备注名·页签——尚未建立关系时这些设置无意义。
    // 仅隐藏，数据加载逻辑不动（加为好友后重新渲染即恢复）。与 iOS sectionLayout 同语义。
    const showDetailBody = d.isGroup || detailPeerIsFriend;
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
    // 语音 tab 与 iOS 对齐：有语音消息才出现（其余 tab 维持恒显的既有 Web 行为）。
    const voiceTabs: Array<{ k: typeof detailTab; label: string }> = voices.length > 0 ? [{ k: "voice", label: "语音" }] : [];
    const tabs: Array<{ k: typeof detailTab; label: string }> = d.isGroup
      ? [{ k: "members", label: "成员" }, { k: "media", label: "媒体" }, { k: "files", label: "文件" }, ...voiceTabs, { k: "links", label: "链接" }]
      : [{ k: "media", label: "媒体" }, { k: "files", label: "文件" }, ...voiceTabs, { k: "links", label: "链接" }];
    const activeTab = tabs.some((t) => t.k === detailTab) ? detailTab : tabs[0].k;

    return (
      <div className="detail-mask" onClick={onClose}>
        <aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
          {!manageOpen && (
            // 标题栏随面板滚动固定在顶部（对齐 iOS 大标题折叠为常驻导航栏）：关闭按钮一并锁在标题栏内。
            <div className="detail-sticky-head">
              <button className="detail-close" title="关闭" onClick={onClose}><X size={20} /></button>
              <div className="detail-topbar">{d.isGroup ? "群组信息" : "用户信息"}</div>
            </div>
          )}

          {manageOpen && gp ? (
            <GroupManagePanel gp={gp} groupBans={groupBans}
              onBack={() => setManageOpen(false)} onPickAvatar={pickGroupAvatar}
              onOpenJoinRequests={openJoinRequests} onOpenBans={openGroupBans} />
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
                {!isSystemPeer && showDetailBody && <button className="detail-pill" onClick={() => { onClose(); openInChatSearch(); }}><Search size={20} /><span>搜索</span></button>}
                <div className="detail-pill-anchor">
                  <button className="detail-pill" onClick={() => setDetailMore((v) => !v)}><MoreHorizontal size={20} /><span>更多</span></button>
                  {detailMore && (
                    <div className="menu-card detail-more" onClick={(e) => e.stopPropagation()}>
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
                    </div>
                  )}
                </div>
              </div>
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
                {canManage && (
                  <button className="detail-row" onClick={() => setManageOpen(true)}>
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
                  <div className="detail-row"><span className="detail-row-ic"><AtSign size={18} /></span><span>用户名</span><span className="detail-row-val accent">{d.peer}</span></div>
                </div>
              )}

              {/* ---- 页签 ---- */}
              <DetailTabs
                tabs={tabs} activeTab={activeTab} onSelectTab={setDetailTab}
                gp={gp} uid={uid} media={media} files={files} voices={voices}
                voiceSenderLabel={(m) => {
                  // 单聊：peer 备注/昵称；群聊：群成员昵称（peerNick 已封装成员表 → 昵称回退 uid）。
                  const label = peerNick?.(m.from);
                  return label || m.fromNickname || m.from;
                }}
                links={links}
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
