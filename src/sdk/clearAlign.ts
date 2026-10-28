// 会话列表快照 → 把本机对齐到服务端的删除位点 `cleared_at`（OFFLINE_BACKLOG_DESIGN §6.7.1 触发点③）。
// 离线期间别的设备删过的会话、旧版本遗留的残留消息、重装后，都在这里补上。纯编排：判据在 clearFloor.ts，清除例程由调用方注入。
import { convsNeedingAlign } from "./clearFloor";
import { logger, LOG_TAG } from "../logging/logger";

export async function alignClearedFromList(
  convs: { conv_id: string; cleared_at?: number }[],
  memFloorOf: (convId: string) => number,
  storeFloorOf: (convId: string) => Promise<number>,
  clearToFloor: (convId: string, clearedAt: number) => Promise<unknown>,
): Promise<void> {
  for (const c of convsNeedingAlign(convs, memFloorOf)) {
    const at = Number(c.cleared_at);
    try {
      if ((await storeFloorOf(c.conv_id)) >= at) continue;   // 内存镜像还没载入，但存储里已对齐
      await clearToFloor(c.conv_id, at);
    } catch (error) {
      logger.warn(LOG_TAG.store, "conv_clear_align_failed", { conv_id: c.conv_id, error });   // 下次列表刷新再试
    }
  }
}
