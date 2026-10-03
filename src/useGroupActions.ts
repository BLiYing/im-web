import { useCallback } from "react";
import type { GroupInfo } from "./sdk/protocol";
import type { AppServices } from "./AppServicesContext";
import { adminErrorToast, batchToast, clampBatch } from "./groupAdmin";
import { t } from "./i18n";

// 群资料写操作簇（改名/简介/公告/禁言/治理开关/我的群昵称）。从 App.tsx 收口出来的第一批——
// 它们**只依赖稳定服务**（clientRef/askPrompt/setToast/refresh*），故整簇只注入一个 `services`，直接复用
// AppServicesContext。会碰 App UI 态（modal/detail 设置、setCropReq、groupRemark）的动作（开黑名单/审批弹窗、
// 解散/退群、群备注、群头像选图）暂留 App——它们不是「稳定服务」耦合，待子件拆分/更多状态上下文化后再迁。
//
// `doGroupAction(cid, fn)` 是这簇的公共骨架（跑操作 → 刷群资料 + 会话列表 → 失败吐司），一并导出供 App 里
// 仍留守的动作（如 pickGroupAvatar）复用。
export function useGroupActions(services: AppServices) {
  const { clientRef, setToast, askPrompt, askConfirm, refreshGroupInfo, refreshConversations } = services;

  const doGroupAction = useCallback(async (cid: string, fn: () => Promise<void>) => {
    try {
      await fn();
      void refreshGroupInfo(cid);
      void refreshConversations();
    } catch (e) {
      setToast(t("common.error.action_failed", { detail: (e as Error).message }));
    }
  }, [refreshGroupInfo, refreshConversations, setToast]);

  // 改群名（群主/管理员）：轻量 prompt，回车确定。
  const doRenameGroup = useCallback(async (gp: GroupInfo) => {
    const name = await askPrompt(t("group.info.rename_title"), gp.name, { placeholder: t("group.ops.name_placeholder"), okText: t("common.save"), maxLength: 30 });
    if (name === null || !name.trim() || name.trim() === gp.name) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, name.trim(), gp.avatar_url, gp.intro ?? ""));
  }, [askPrompt, clientRef, doGroupAction]);

  // 群简介（G1，群主/管理员）：整体替换，随群资料写。
  const doEditIntro = useCallback(async (gp: GroupInfo) => {
    const intro = await askPrompt(t("group.text.intro"), gp.intro ?? "", { placeholder: t("group.ops.intro_placeholder"), okText: t("common.save"), maxLength: 200, multiline: true });
    if (intro === null || intro.trim() === (gp.intro ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, gp.name, gp.avatar_url, intro.trim()));
  }, [askPrompt, clientRef, doGroupAction]);

  // 群公告（G1，群主/管理员）：发布走独立接口并落系统消息；清空文本=撤下。
  const doEditAnnouncement = useCallback(async (gp: GroupInfo) => {
    const text = await askPrompt(t("group.text.announcement"), gp.announcement ?? "", {
      placeholder: t("group.ops.announcement_placeholder"), okText: t("common.publish"), maxLength: 500, multiline: true,
      // 已有公告时提供「撤下」危险动作 = 发空串（决策 18，与「发布」区分）。
      extraAction: (gp.announcement ?? "").trim() ? { label: t("group.ops.announcement_retract"), value: "", danger: true } : undefined,
    });
    if (text === null || text.trim() === (gp.announcement ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupAnnouncement(gp.conv_id, text.trim()));
  }, [askPrompt, clientRef, doGroupAction]);

  // 全员禁言开关（G1，群主/管理员）：开=永久（-1），关=解除（0）。
  const doToggleGroupMute = useCallback(async (gp: GroupInfo, turnOn: boolean) => {
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupMute(gp.conv_id, turnOn ? -1 : 0));
  }, [clientRef, doGroupAction]);

  // 群治理开关组（G2，群主/管理员）：翻转某个布尔位，整组回带当前值上报（后端整体替换）。
  const doToggleGroupSetting = useCallback(async (gp: GroupInfo, key: "join_approval" | "perm_invite" | "perm_edit_info" | "perm_pin" | "history_visible") => {
    const s = {
      join_approval: !!gp.join_approval, perm_invite: !!gp.perm_invite,
      perm_edit_info: !!gp.perm_edit_info, perm_pin: !!gp.perm_pin, history_visible: !!gp.history_visible,
    };
    s[key] = !s[key];
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupSettings(gp.conv_id, s));
  }, [clientRef, doGroupAction]);

  // 我在本群的昵称（G1，任意成员）：群内可见，留空恢复默认。
  const doEditMyGroupNickname = useCallback(async (gp: GroupInfo) => {
    const nick = await askPrompt(t("chat.detail.my_group_nickname"), gp.my_nickname ?? "", { hint: t("group.info.my_nickname_hint"), okText: t("common.save"), maxLength: 20 });
    if (nick === null || nick.trim() === (gp.my_nickname ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupMyNickname(gp.conv_id, nick.trim()));
  }, [askPrompt, clientRef, doGroupAction]);

  // 批量设管理员（仅群主）：后端没有批量接口，**串行**逐个 PUT（并发会让系统消息乱序）。
  // 逐条汇总成败——部分失败也要刷新，成功的那几位已经生效了，不刷就是骗用户。
  // 刻意**不做乐观更新**：角色即权限，先改 UI 再等服务器，一旦失败就是"看着是管理员、点什么都被拒"。
  const doSetAdmins = useCallback(async (cid: string, uids: string[]): Promise<{ ok: number; bad: number }> => {
    const ids = clampBatch(uids);
    if (ids.length === 0) return { ok: 0, bad: 0 };
    let ok = 0, bad = 0, firstError: string | undefined;
    for (const id of ids) {
      try {
        await clientRef.current!.setGroupRole(cid, id, "admin");
        ok++;
      } catch (e) {
        bad++;
        firstError = firstError ?? adminErrorToast(e);
      }
    }
    setToast(batchToast(ok, bad, firstError));
    void refreshGroupInfo(cid);
    void refreshConversations();
    return { ok, bad }; // 全失败时调用方把弹窗留着，用户能换个人重试（与 iOS「停在选人页」对齐）
  }, [clientRef, setToast, refreshGroupInfo, refreshConversations]);

  // 撤销管理员（仅群主）：SetRole 幂等，重复撤同一人不会报错。
  const doRevokeAdmin = useCallback(async (cid: string, userId: string, label: string) => {
    const ok = await askConfirm(t("group.ops.revoke_admin_confirm", { name: label }), { okText: t("group.admin_list.revoke_btn"), danger: true });
    if (!ok) return;
    try {
      await clientRef.current!.setGroupRole(cid, userId, "member");
      setToast(t("group.ops.revoke_admin_done"));
    } catch (e) {
      setToast(adminErrorToast(e)); // 通用 doGroupAction 只会透传英文原文，这里按码本地化
    }
    void refreshGroupInfo(cid);
    void refreshConversations();
  }, [askConfirm, clientRef, setToast, refreshGroupInfo, refreshConversations]);

  // 转让群组（仅群主，不可逆）：二次确认 → 转让。**原群主降为普通成员**（member，不是管理员），
  // 这是后端 store.TransferGroupOwner 的既定行为，客户端不做任何补偿。
  // 成功返回 true，调用方据此关掉群管理/管理员面板——那一刻我已是 member，整页对我不再可见。
  const doTransferOwner = useCallback(async (cid: string, userId: string, label: string): Promise<boolean> => {
    const ok = await askConfirm(t("group.ops.transfer_confirm_message", { name: label }),
      { okText: t("group.transfer_owner.confirm"), danger: true });
    if (!ok) return false;
    try {
      await clientRef.current!.transferGroup(cid, userId);
    } catch (e) {
      setToast(adminErrorToast(e));
      return false;
    }
    setToast(t("group.transfer_owner.done", { name: label }));
    void refreshGroupInfo(cid);
    void refreshConversations();
    return true;
  }, [askConfirm, clientRef, setToast, refreshGroupInfo, refreshConversations]);

  return { doGroupAction, doRenameGroup, doEditIntro, doEditAnnouncement, doToggleGroupMute, doToggleGroupSetting, doEditMyGroupNickname,
           doSetAdmins, doRevokeAdmin, doTransferOwner };
}
