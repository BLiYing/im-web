import type { GroupInfo, GroupMember } from "./sdk/protocol";
import { errorCode } from "./qr";

// 群管理面板「管理员 / 转让群组」的纯逻辑（计数口径 / 候选过滤 / 批量截断 / 结果文案）。
// 与 iOS IMGroupAdminLogic 一一对应——两端口径漂移就是"同一个群在两端管理员数不一样"这类灵异问题的来源。
// 设计见 IMServer/docs/design/GROUP_ADMIN_TRANSFER_DESIGN.md §4 / §5。

/** 一次最多添加几位管理员。后端 setGroupRole **每调一次发一条系统消息**且无批量接口，
 *  一次选 12 个人 = 群里瞬间刷 12 条系统消息。
 *  ⚠️ 这**不是**管理员总数上限——后端对总数无约束，客户端假上限只是自欺（设计 §7.1）。 */
export const MAX_ADMIN_BATCH = 5;

/** 群主（没有则 undefined）。 */
export function ownerOf(gp: GroupInfo | undefined): GroupMember | undefined {
  return gp?.members.find((m) => m.role === "owner");
}

/** 管理员，按 joined_at 升序（与成员列表同口径；后端没存"何时被设为管理员"）。 */
export function adminsOf(gp: GroupInfo | undefined): GroupMember[] {
  return (gp?.members ?? [])
    .filter((m) => m.role === "admin")
    .sort((a, b) => (a.joined_at - b.joined_at) || a.user_id.localeCompare(b.user_id));
}

/** 群管理面板「管理员」行的右值：0 → 「未设置」，>0 → 「N 人」。 */
export function adminCountText(gp: GroupInfo | undefined): string {
  const n = adminsOf(gp).length;
  return n === 0 ? "未设置" : `${n} 人`;
}

/** 「添加管理员」候选：排除群主 + 现有管理员 + 我自己（剩下就是普通成员）。 */
export function adminCandidates(gp: GroupInfo | undefined, uid: string): GroupMember[] {
  return (gp?.members ?? []).filter((m) => m.role === "member" && m.user_id !== uid);
}

/** 「转让群组」候选：全体成员 − 我（管理员也可以被选，后端不限）。 */
export function transferCandidates(gp: GroupInfo | undefined, uid: string): GroupMember[] {
  return (gp?.members ?? []).filter((m) => m.user_id !== uid);
}

/** 选中集截断到 MAX_ADMIN_BATCH（弹窗已拦，这里是兜底）。 */
export function clampBatch(selected: string[]): string[] {
  return selected.slice(0, MAX_ADMIN_BATCH);
}

/** 批量结果文案：全成功→「已添加 N 位管理员」；部分失败→「N 位已添加，M 位失败：…」；全失败→首条错误。 */
export function batchToast(succeeded: number, failed: number, firstError?: string): string {
  if (failed === 0) return `已添加 ${succeeded} 位管理员`;
  if (succeeded === 0) return firstError || "添加失败";
  return `${succeeded} 位已添加，${failed} 位失败：${firstError || "操作失败"}`;
}

/** 成员行副标题：**恒为 `@username`**（没有句柄就留空）。**绝不显示 user_id**——那是 10 位随机内部 ID
 *  （见 docs/design/ACCOUNT_IDENTITY_REDESIGN.md §5.2）。
 *
 *  设计稿 §5.2 原本写的是「群昵称 / 否则 @username」，落地时改成恒显句柄：主名（`groupMemberLabel`）
 *  本来就是"备注 > 群昵称 > 昵称"，群昵称优先的话，设了群昵称的成员主名与副行会**逐字重复**
 *  （「运维 / 运维」）。iOS `IMDetailMemberCell` 也是恒显 `@username`，两端就此对齐。 */
export function memberSubtitle(m: Pick<GroupMember, "username">): string {
  return m.username ? `@${m.username}` : "";
}

/** 业务错误 → 中文（设计 §4.4）。后端这几处的默认 message 是英文，两端都得自己本地化。
 *  **不 parse 英文串**：100001 一个码在 SetRole/Transfer 里复用了三种语义（不能改自己 / 对方不在群 / 已经是群主），
 *  靠文案分支太脆，统一给一句可操作的中文；真正值得单说的「TA 已不在群里」在发请求前用候选表本地判定。 */
export function adminErrorToast(e: unknown): string {
  switch (errorCode(e)) {
    case 300201: return "该群已被解散";
    case 300203: return "你已不在该群";
    case 300204: return "只有群主可以进行此操作";
    case 100001: return "操作失败，请刷新后重试";
    default: return `操作失败：${(e as Error)?.message ?? ""}`;
  }
}
