// 桌面端集成要用到的两个回调的**实现**：会话标题、点通知打开哪个会话。
//
// 单独成文件而不是写在 App 里，有两个理由：① `App.tsx` 有行数硬预算（`check-file-size.sh`，
// D4-2 就是在这里被拦下的）；② 这两件是纯映射（会话 id → 名字 / → 打开动作），
// 抽出来就能单测，留在 App 里只能靠肉眼。
import type { Conversation } from "./sdk/protocol";

export interface DesktopCallbacks {
  titleOf: (convId: string) => string;
  onOpenConversation: (convId: string) => void;
}

/**
 * 系统通知的标题 = 会话的**本机显示名**（含备注）。
 *
 * 备注可以出现在这里：通知只渲染在本机，不会被写进要发出去的字节，
 * 故不受 `UI.md` 那条「对外可见名必须用公开名」的隐私红线约束。
 *
 * **「点通知打开会话」不在这里实现**：App 里已有 `openConvById`，而且比另写一份更稳
 * （会话不在列表时还能从 `conv_id` 还原出 peer）。直接把它传进 `bindCallbacks` 即可。
 */
export function makeDesktopTitleOf(
  conversations: readonly Conversation[],
  convDisplayLabel: (c: Conversation) => string,
): (convId: string) => string {
  return (cid) => {
    const c = conversations.find((x) => x.conv_id === cid);
    return c ? convDisplayLabel(c) : "新消息";
  };
}
