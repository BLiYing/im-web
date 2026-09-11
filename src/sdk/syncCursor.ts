// 连续同步游标的两条判据（纯函数）。2026-09-11 从 imSdk.ts 逐字移出——那个文件顶在行数预算上，
// 而这两条本就与连接状态无关，单测也只测它们本身。

/** 离线空洞自愈判定（纯函数，导出供单测）：实时消息跳过“已连续位置+1”即补拉。
 *  初始位置为 0 但首条直接是较大序号同样是空洞，不能当作已同步。 */
export function shouldHealGap(prevSynced: number, incomingConvSeq: number, tracked: boolean): boolean {
  return tracked && prevSynced >= 0 && incomingConvSeq > prevSynced + 1;
}

/** sync 游标推进规则（纯函数，导出供单测）：服务端 covered_conv_seq 权威覆盖 (since, covered]——
 *  区间内每个序号要么已下发、要么对本人不可见（history_visible 抬入群下界 / 「仅为我删除」隐藏项）。
 *  据此把游标推过永远拿不到的可见性空洞，破解死循环；covered 未超过当前游标则不动（空页/已追平）。 */
export function nextSyncCursor(before: number, covered: number): number {
  return covered > before ? covered : before;
}
