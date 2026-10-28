// 会话被「清除到位点」（删除会话 §6.7.1，三个触发点共用：本机删 / 别的设备的 conv_update(delete) / 列表 cleared_at 对齐）后，
// UI 各处内存态的同步。App.tsx 贴体量红线，故独立成纯工厂（依赖全注入，便于单测）。
// 存储层已由 IMClient.clearToFloor 清完；这里只管界面：聊天消息、资料页签数据源（含服务端页）、置顶横幅、查看器 / 阅读器、正开着的聊天页。
import type { ChatMessage } from "./sdk/protocol";

type Upd<T> = (f: (prev: T) => T) => void;
export interface ConvClearedDeps<V extends { m: ChatMessage } = { m: ChatMessage }> {
  clearThrough: (cid: string, floor: number) => void;
  setDetailMsgs: Upd<ChatMessage[]>;
  dropArchive: (cid: string, floor: number) => void;
  pinnedDrop: (cid: string, floor: number) => void;
  pinnedRefresh: (cid: string) => void;
  setViewer: Upd<V | null>;
  setTextReader: Upd<ChatMessage | null>;
  currentConv: () => string;
  closeChat: () => void;
}

const gone = (m: ChatMessage, cid: string, floor: number): boolean => m.convId === cid && m.convSeq > 0 && m.convSeq <= floor;

/** `advanced=false`（本标签位点没抬高：本机删除的回声帧、或同进程列表对齐已先清过）不重复清 UI；
 *  聊天页只在本机删除动作时关（别端删除不关，对齐 iOS）。 */
export interface ClearCtx { source: "local" | "frame" | "align"; retained: boolean }

export function makeConvClearedHandler<V extends { m: ChatMessage }>(d: ConvClearedDeps<V>): (cid: string, floor: number, advanced: boolean, ctx: ClearCtx) => void {
  return (cid, floor, advanced, ctx) => {
    if (advanced) {
      d.clearThrough(cid, floor);
      d.setDetailMsgs((prev) => prev.filter((m) => !gone(m, cid, floor)));
      d.dropArchive(cid, floor);
      d.pinnedDrop(cid, floor);   // 位点以内的置顶当场摘（纯本地），再与服务端对齐
      d.pinnedRefresh(cid);
      d.setViewer((v) => (v && gone(v.m, cid, floor) ? null : v));
      d.setTextReader((r) => (r && gone(r, cid, floor) ? null : r));
    }
    // 只有本机删除动作退出聊天页；别端删除帧 / 列表对齐只清 <=位点、页面留着（与 iOS 一致，之后发消息会话自然复现）
    if (ctx.source === "local" && advanced && d.currentConv() === cid) d.closeChat();
  };
}
