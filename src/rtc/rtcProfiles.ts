// 通话界面显示名：备注（仅本机）> 昵称 > @句柄；都没有返回 undefined。
// 与 App 的 displayNameOf 同序，但**不落到「未命名用户」**：没解析到时让 Kit 先显示 uid，
// 名片拉回来后再重画（同时触发 useUserProfiles 去拉）。
export function rtcNameOf(
  remarks: ReadonlyMap<string, string>, uid: string, nickname?: string, username?: string,
): string | undefined {
  const remark = remarks.get(uid)?.trim();
  if (remark) return remark;
  const nick = nickname?.trim();
  if (nick) return nick;
  const handle = username?.trim();
  return handle ? `@${handle}` : undefined;
}
