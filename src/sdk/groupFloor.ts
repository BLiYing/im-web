// 哪些 group 帧**不会**改变「我」在该群的可见下界（入群位点 × history_visible 开关）。
//
// 为什么要看：可见下界 = 我的入群位点 × 群设置；退群再邀请 / 群主翻「仅可见入群后」都会变。
// `floorSeq` 只往小里收（nextHistoryFloor 取 min），只在重连才清会让该群在本次连接内翻不上去，
// 所以 IMClient 在该群来 group 帧时就丢它的缓存，下次开窗以服务端为准（调用点：imSdk.ts `case T.GROUP`）。
//
// 对端（判定同口径，分类表一致）：Android `GroupEventData.changesMyHistoryFloor`；
// iOS `IMSocketManager.m` 在 group 帧分发处（`handleGroupEvent:` 之前）按同一张表调 `clearHistoryFloorForConv:`。
//
// 只列确定不影响的；未知事件一律按「会影响」处理（宁可多丢缓存、多问一次服务端）。
const NEVER_AFFECTS = new Set(["profile", "announcement", "role", "transfer", "member_mute"]);
const ABOUT_ONE_MEMBER = new Set(["invite", "leave", "remove"]);

/** `true` = 这一帧不影响我的可见下界，缓存的下界可以留着。 */
export function groupEventKeepsFloor(event: string | undefined, target: string | undefined, myUid: string | null | undefined): boolean {
  const ev = event ?? "";
  if (NEVER_AFFECTS.has(ev)) return true;
  if (ABOUT_ONE_MEMBER.has(ev)) return !!target && target !== (myUid ?? "");
  return false;
}
