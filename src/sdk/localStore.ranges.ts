// 「本地有哪几段」目录的门面（OFFLINE_BACKLOG_DESIGN §4.2）：转发给选中的本地库实现。
//
// 与 localStore.ts 分成两个文件，是因为调用点本来就分两处（imSdk 的区间登记单独 import）；
// 选择实现仍然只在 localStore.ts 的 `pickStore()` 一处。语义契约见 localStore.types.ts。

import type { RangesSnapshot } from "./localStore.types";
import type { SeqRange } from "./ranges";
import { activeLocalStore } from "./localStore";

export const loadRanges = (owner: string, convId: string): Promise<RangesSnapshot> =>
  activeLocalStore().loadRanges(owner, convId);

export const registerRange = (
  owner: string, convId: string, lo: number, hi: number, head?: number,
): Promise<SeqRange[]> =>
  activeLocalStore().registerRange(owner, convId, lo, hi, head);

export const updateRangesHead = (owner: string, convId: string, head: number): Promise<void> =>
  activeLocalStore().updateRangesHead(owner, convId, head);
