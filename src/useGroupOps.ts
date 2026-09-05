// useGroupOps：群的**写操作 + 它们各自的弹窗状态**（建群/退群/解散/邀请/黑名单/入群审批/群备注/群头像）。
//
// 从 App.tsx 抽出（2026-09-05，CODING_STYLE §7 ①「自有状态 + 一组操作 → 独立协作对象」）。
// 判据不是"App 太长"而是**这七个 state 只有这一族操作会读写**：`groupsModal` / `createDraft` /
// `createBusy` / `inviteDraft` / `joinReqModal` / `groupBansModal` / `groupBans`——它们此前混在
// App 的四十多个 state 里，看不出谁和谁是一伙的，改一处要顺着整份文件确认还有谁在动它。
//
// 与既有 `useGroupActions` 的分工：那个是「群资料字段的通用写包装」（改名/简介/禁言/开关，
// 只吃 services），本文件是「带自己 UI 状态的那几个动作」——弹窗开合、忙标志、列表缓存都在这。
//
// ## 注入而不是 context 的两个依赖值得说明
// · `doGroupAction` 来自 useGroupActions（群头像走它，才能复用同一套刷新/报错）。
// · `deselect` / `currentConvRef`：退群/解散后若当前正开着这个会话，要把右栏收掉——
//   否则聊天页停在一个已经不存在的会话上，发消息才报错。
import { useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { Conversation, GroupBan, GroupInfo, GroupSummary, JoinRequest } from "./sdk/protocol";
import { errorCode } from "./qr";
import { LOG_TAG, logger } from "./logging/logger";
import type { useDialogs } from "./useDialogs";
import type { CreateGroupDraft } from "./components/modals/CreateGroupModal";

type DialogsApi = ReturnType<typeof useDialogs>;

export interface GroupOpsDeps {
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  askConfirm: DialogsApi["askConfirm"];
  askPrompt: DialogsApi["askPrompt"];
  refreshConversations: () => Promise<Conversation[]>;
  refreshGroupInfo: (cid: string) => Promise<GroupInfo | null>;
  /** 群资料字段写操作的通用包装（useGroupActions）：群头像复用它的刷新与报错。 */
  doGroupAction: (cid: string, fn: () => Promise<void>) => Promise<void>;
  openGroupChat: (cid: string) => void;
  /** 收起右栏（退群/解散后当前会话已不存在时用）。 */
  deselect: () => void;
  currentConvRef: MutableRefObject<string>;
  /** 超级群成员列表是另一份 state，邀请后要单独补拉（见 doInvite 注释）。 */
  loadSuperMembers: (convId: string, cursor: string) => Promise<void> | void;
  setCropReq: (r: { file: File; onDone: (blob: Blob) => Promise<void> | void } | null) => void;
  setTab: (t: "chats" | "contacts") => void;
  setDetail: (d: null) => void;
  setGroupInfos: React.Dispatch<React.SetStateAction<Record<string, GroupInfo>>>;
  /** 只读来源：群备注取自会话行的 remark；邀请后判是不是超级群。 */
  conversations: Conversation[];
  groupInfos: Record<string, GroupInfo>;
}

export function useGroupOps(d: GroupOpsDeps) {
  const {
    clientRef, setToast, askConfirm, askPrompt, refreshConversations, refreshGroupInfo, doGroupAction,
    openGroupChat, deselect, currentConvRef, loadSuperMembers, setCropReq, setTab, setDetail, setGroupInfos,
    conversations, groupInfos,
  } = d;

  const [groupsModal, setGroupsModal] = useState<GroupSummary[] | null>(null); // 通讯录「群聊」列表弹窗
  const [createDraft, setCreateDraft] = useState<CreateGroupDraft | null>(null); // 建群弹窗（群名 + 选中好友 + 头像，两步）
  const [createBusy, setCreateBusy] = useState(false);
  const [createAvatarBusy, setCreateAvatarBusy] = useState(false); // 建群第二步：头像上传在途（按钮禁用防重复选图）
  const [inviteDraft, setInviteDraft] = useState<{ convId: string; selected: string[] } | null>(null); // 邀请成员弹窗
  const [joinReqModal, setJoinReqModal] = useState<{ convId: string; requests: JoinRequest[]; loading: boolean } | null>(null); // 待审入群申请（G3）
  const [groupBans, setGroupBans] = useState<GroupBan[] | null>(null);   // 当前群黑名单（管理面板显示计数）
  const [groupBansModal, setGroupBansModal] = useState<{ convId: string; bans: GroupBan[] } | null>(null); // 黑名单弹窗

  // 群动作统一包装：执行 → 刷新群资料 + 会话列表；失败 alert。
  // 打开「群聊」列表弹窗（通讯录入口）。
  const openGroupsModal = async () => {
    try {
      const list = await clientRef.current?.listGroups();
      setGroupsModal(list ?? []);
    } catch (e) {
      setToast(`加载群列表失败：${(e as Error).message}`);
    }
  };

  // 解散群（仅群主，二次确认）。
  const doDissolveGroup = (cid: string) => {
    void (async () => {
      if (!(await askConfirm("删除并解散该群？所有成员将被移出，且不可恢复。", { okText: "解散", danger: true }))) return;
      try {
        await clientRef.current!.dissolveGroup(cid);
        setDetail(null);
        setGroupInfos((prev) => { const { [cid]: _drop, ...rest } = prev; return rest; });
        if (currentConvRef.current === cid) deselect();
        void refreshConversations();
      } catch (e) { setToast(`解散失败：${(e as Error).message}`); }
    })();
  };

  // 建群：校验 → POST → 进入新群会话。
  const doCreateGroup = async () => {
    if (!createDraft) return;
    const name = createDraft.name.trim();
    if (!name) { setToast("请输入群名"); return; }
    if (createDraft.selected.length === 0) { setToast("请至少选择一位好友"); return; }
    setCreateBusy(true);
    try {
      // 头像随建群一起发：`POST /groups` 的 body 本来就有 avatar_url 位，此前一直传空串。
      const info = await clientRef.current!.createGroup(name, createDraft.selected, createDraft.avatarUrl ?? "");
      setGroupInfos((prev) => ({ ...prev, [info.conv_id]: info }));
      setCreateDraft(null);
      setGroupsModal(null);
      setTab("chats");
      await refreshConversations();
      openGroupChat(info.conv_id);
    } catch (e) {
      setToast(`建群失败：${(e as Error).message}`);
    } finally {
      setCreateBusy(false);
    }
  };

  // 退出群聊（群主会被服务端拦：需先转让）。
  const doLeaveGroup = async (cid: string) => {
    if (!(await askConfirm("确定退出该群聊？", { okText: "退出", danger: true }))) return;
    try {
      await clientRef.current!.leaveGroup(cid);
      setDetail(null);
      setGroupInfos((prev) => { const { [cid]: _drop, ...rest } = prev; return rest; });
      if (currentConvRef.current === cid) deselect();
      void refreshConversations();
    } catch (e) {
      setToast(`退出失败：${(e as Error).message}`);
    }
  };

  // 打开黑名单弹窗（G2）：拉一次列表。
  const openGroupBans = async (cid: string) => {
    try {
      const bans = await clientRef.current!.fetchGroupBans(cid);
      setGroupBansModal({ convId: cid, bans });
      setGroupBans(bans);
    } catch (e) { setToast(`加载黑名单失败：${(e as Error).message}`); }
  };
  const doUnban = async (cid: string, userId: string) => {
    try {
      await clientRef.current!.unbanGroupMember(cid, userId);
      const bans = await clientRef.current!.fetchGroupBans(cid);
      setGroupBansModal({ convId: cid, bans });
      setGroupBans(bans);
      setToast("已解除");
    } catch (e) { setToast(`解除失败：${(e as Error).message}`); }
  };

  const openJoinRequests = async (cid: string) => {
    setJoinReqModal({ convId: cid, requests: [], loading: true });
    try {
      const requests = await clientRef.current!.fetchJoinRequests(cid, ""); // ""=全部（待处理 + 已处理分段）
      setJoinReqModal({ convId: cid, requests, loading: false });
    } catch (e) {
      setJoinReqModal(null);
      setToast(`加载入群申请失败：${(e as Error).message}`);
    }
  };
  const reloadJoinRequests = async (cid: string) => {
    try {
      const requests = await clientRef.current!.fetchJoinRequests(cid, "");
      setJoinReqModal((m) => (m && m.convId === cid ? { ...m, requests, loading: false } : m));
    } catch { /* 列表已关或无权限，忽略 */ }
  };
  const decideJoin = async (cid: string, userId: string, accept: boolean) => {
    try {
      await clientRef.current!.decideJoinRequest(cid, userId, accept);
      await reloadJoinRequests(cid);
      void refreshGroupInfo(cid); // 更新 pending_count 角标
      setToast(accept ? "已同意入群" : "已拒绝");
    } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
  };

  // 群备注（G1，仅本人可见）：改我看到的群名，**服务端多端同步**（PUT …/remark）。
  // 成功后重拉会话列表；conv_update 也会把变更同步到本人其它端与本机列表/标题。
  const doEditGroupRemark = async (gp: GroupInfo) => {
    const cur = (conversations.find((c) => c.conv_id === gp.conv_id)?.remark || "").trim();
    const v = await askPrompt("群备注", cur, { placeholder: `${gp.name}（仅自己可见）`, okText: "保存", maxLength: 30 });
    if (v === null || v.trim() === cur) return;
    try {
      await clientRef.current?.setConvRemark(gp.conv_id, v.trim());
      logger.info(LOG_TAG.app, "group_remark_updated", { conv: gp.conv_id, len: v.trim().length });
      await refreshConversations(); // 列表状态更新 → chatTitle/列表项/详情行随 remark 重渲染
    } catch (e) {
      setToast(`保存备注失败：${(e as Error).message}`);
    }
  };

  // 设置群头像（仅群主/管理员，方案 C）：选图 → 圆形裁切 → 头像专用上传 → updateGroup 带新 URL。
  const pickGroupAvatar = (gp: GroupInfo) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setCropReq({
        file,
        onDone: async (blob) => {
          try {
            setToast("上传中…");
            const { url } = await clientRef.current!.uploadAvatar(blob);
            await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, gp.name, url, gp.intro ?? ""));
            setToast("群头像已更新");
          } catch (e) { setToast(`设置群头像失败：${(e as Error).message}`); }
        },
      });
    };
    input.click();
  };

  // 建群第二步的群头像：选图 → 圆形裁切 → 头像专用上传 → 写回草稿（**此刻群还不存在**，
  // 所以不像 pickGroupAvatar 那样调 updateGroup，只把 URL 存着，等点「创建」时随 POST 一起发）。
  // 上传失败不阻塞建群——头像是可选项，建完还能在群管理里补。
  const pickCreateGroupAvatar = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setCropReq({
        file,
        onDone: async (blob) => {
          setCreateAvatarBusy(true);
          try {
            const { url } = await clientRef.current!.uploadAvatar(blob);
            setCreateDraft((prev) => (prev ? { ...prev, avatarUrl: url } : prev));
          } catch (e) {
            setToast(`头像上传失败：${(e as Error).message}`);
          } finally {
            setCreateAvatarBusy(false);
          }
        },
      });
    };
    input.click();
  };

  // 邀请成员：提交选中的好友。
  const doInvite = async () => {
    if (!inviteDraft || inviteDraft.selected.length === 0) { setToast("请选择要邀请的好友"); return; }
    const { convId: cid, selected } = inviteDraft;
    try {
      const added = await clientRef.current!.inviteToGroup(cid, selected);
      setInviteDraft(null);
      void refreshGroupInfo(cid);
      void refreshConversations();
      // **超级群的成员列表是另一份 state**（superMembers），它只在切群时才重拉。
      // 不在这里补一发，界面会自相矛盾：副标题刷成「2001 位成员」，列表还是原来那 2000 行。
      if (groupInfos[cid]?.is_super) void loadSuperMembers(cid, "");
      // 按**实际加入数**给反馈，而不是按勾选数：已在群里的人会被服务端跳过（幂等，不是错误）。
      // 超级群下这是常态——端上算不出完整的"已在群里"集合（gp.members 只有我自己）。
      const skipped = selected.length - added.length;
      if (added.length === 0) setToast("所选的人都已在群里");
      else if (skipped > 0) setToast(`已邀请 ${added.length} 人，其余 ${skipped} 人已在群里`);
    } catch (e) {
      // 按业务码分支（勿直接透传服务端 message，i18n）：300207 = 被邀请者已被移出/冷却期，
      // 用邀请场景的第三人称文案，区别于自加群映射表里的第二人称「你已被移出」。
      if (errorCode(e) === 300207) setToast("该成员已被移出本群，暂时无法再次邀请");
      // 300204 = 无邀请权（竞态：打开选择器后群主刚开启「仅管理员可邀请」）。后端此码下发英文默认文案，
      // 且 300204 多场景复用不宜在 FRIENDLY_MESSAGES 一刀切映射，故在此邀请场景就地给中文（对齐 iOS）。
      else if (errorCode(e) === 300204) setToast("群主已开启「仅管理员可邀请」，你无法邀请成员");
      else setToast(`邀请失败：${(e as Error).message}`);
    }
  };

  return {
    groupsModal, setGroupsModal, createDraft, setCreateDraft, createBusy, createAvatarBusy,
    inviteDraft, setInviteDraft, joinReqModal, setJoinReqModal,
    groupBans, groupBansModal, setGroupBansModal,
    openGroupsModal, doDissolveGroup, doCreateGroup, doLeaveGroup,
    openGroupBans, doUnban, openJoinRequests, reloadJoinRequests, decideJoin,
    doEditGroupRemark, pickGroupAvatar, pickCreateGroupAvatar, doInvite,
  };
}
