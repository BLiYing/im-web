// 邀请入群后的 toast 决策（纯函数）。服务端响应 `{added, pending}`（PROTOCOL 邀请条）：
// 群开了「进群确认」时普通成员邀请的人转待审（pending），不算「已在群里」。
export interface InviteResult { added: string[]; pending: string[] }

/** 返回要弹的 toast 键与参数；null=全部直接加入，无需提示。 */
export function inviteFeedback(selectedCount: number, r: InviteResult): { key: string; args?: Record<string, number> } | null {
  if (r.pending.length > 0) return { key: "group.invite.pending_toast" };
  if (r.added.length === 0) return { key: "group.info.invite_all_in" };
  const skipped = selectedCount - r.added.length;
  if (skipped > 0) return { key: "group.info.invite_partial", args: { invited: r.added.length, skipped } };
  return null;
}
