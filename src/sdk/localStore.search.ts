// 本地消息搜索的门面（SEARCH_DESIGN §7.2）：转发给选中的本地库实现。
//
// **命中判据是跨端契约**（后端 G4 / iOS / 各本地实现必须一致），定义与「为什么不上 FTS5」
// 见 localStore.types.ts 的 `searchMessages`。选择实现只在 localStore.ts 的 `pickStore()` 一处。

import type { MsgRecord, SearchOptions } from "./localStore.types";
import { activeLocalStore } from "./localStore";

export const searchMessages = (owner: string, opts: SearchOptions): Promise<MsgRecord[]> =>
  activeLocalStore().searchMessages(owner, opts);
