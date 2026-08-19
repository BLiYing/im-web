import { useCallback } from "react";
import type { GroupInfo } from "./sdk/protocol";
import type { AppServices } from "./AppServicesContext";

// 群资料写操作簇（改名/简介/公告/禁言/治理开关/我的群昵称）。从 App.tsx 收口出来的第一批——
// 它们**只依赖稳定服务**（clientRef/askPrompt/setToast/refresh*），故整簇只注入一个 `services`，直接复用
// AppServicesContext。会碰 App UI 态（modal/detail 设置、setCropReq、groupRemark）的动作（开黑名单/审批弹窗、
// 解散/退群、群备注、群头像选图）暂留 App——它们不是「稳定服务」耦合，待子件拆分/更多状态上下文化后再迁。
//
// `doGroupAction(cid, fn)` 是这簇的公共骨架（跑操作 → 刷群资料 + 会话列表 → 失败吐司），一并导出供 App 里
// 仍留守的动作（如 pickGroupAvatar）复用。
export function useGroupActions(services: AppServices) {
  const { clientRef, setToast, askPrompt, refreshGroupInfo, refreshConversations } = services;

  const doGroupAction = useCallback(async (cid: string, fn: () => Promise<void>) => {
    try {
      await fn();
      void refreshGroupInfo(cid);
      void refreshConversations();
    } catch (e) {
      setToast(`操作失败：${(e as Error).message}`);
    }
  }, [refreshGroupInfo, refreshConversations, setToast]);

  // 改群名（群主/管理员）：轻量 prompt，回车确定。
  const doRenameGroup = useCallback(async (gp: GroupInfo) => {
    const name = await askPrompt("修改群名", gp.name, { placeholder: "群名（1~30 字）", okText: "保存", maxLength: 30 });
    if (name === null || !name.trim() || name.trim() === gp.name) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, name.trim(), gp.avatar_url, gp.intro ?? ""));
  }, [askPrompt, clientRef, doGroupAction]);

  // 群简介（G1，群主/管理员）：整体替换，随群资料写。
  const doEditIntro = useCallback(async (gp: GroupInfo) => {
    const intro = await askPrompt("群简介", gp.intro ?? "", { placeholder: "介绍这个群（≤200 字）", okText: "保存", maxLength: 200, multiline: true });
    if (intro === null || intro.trim() === (gp.intro ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, gp.name, gp.avatar_url, intro.trim()));
  }, [askPrompt, clientRef, doGroupAction]);

  // 群公告（G1，群主/管理员）：发布走独立接口并落系统消息；清空文本=撤下。
  const doEditAnnouncement = useCallback(async (gp: GroupInfo) => {
    const text = await askPrompt("群公告", gp.announcement ?? "", {
      placeholder: "发布后通知全体成员", okText: "发布", maxLength: 500, multiline: true,
      // 已有公告时提供「撤下」危险动作 = 发空串（决策 18，与「发布」区分）。
      extraAction: (gp.announcement ?? "").trim() ? { label: "撤下公告", value: "", danger: true } : undefined,
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
    const nick = await askPrompt("我在本群的昵称", gp.my_nickname ?? "", { placeholder: "群内可见（≤20 字，留空恢复默认）", okText: "保存", maxLength: 20 });
    if (nick === null || nick.trim() === (gp.my_nickname ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupMyNickname(gp.conv_id, nick.trim()));
  }, [askPrompt, clientRef, doGroupAction]);

  return { doGroupAction, doRenameGroup, doEditIntro, doEditAnnouncement, doToggleGroupMute, doToggleGroupSetting, doEditMyGroupNickname };
}
