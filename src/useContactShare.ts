// useContactShare：个人名片发送簇（CONTACT_CARD_DESIGN §8.1）——三个入口共用一套状态与发送路径。
//
//   ① 聊天页附件面板「个人名片」 → 选**好友**（复用 FriendPickerModal）→ 二次确认 → 发进当前会话
//   ② 会话详情面板「推荐给朋友」 → 选**会话**（复用 ForwardPicker）→ 发出
//   ③ 侧栏「我」「分享我的名片」 → 同 ②，卡片是自己
//
// 入口 ① 与 ②③ 的差别只在"先选谁"：① 已在会话里、选的是要推荐的人；②③ 已知推荐谁、选的是发去哪。
// 二次确认只有 ① 有——②③ 的转发选择页本身就是确认步骤（与转发一致）。
//
// 依赖注入（与 useFavorites / useForward 同款）：clientRef/setToast/uid/friends/conversations/
// appendMsg/setAttachPanel/setForwardMode/setForwarding/sendForwardToTarget。
import { useCallback, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage, Conversation, FriendEntry } from "./sdk/protocol";
import { CONTACT_CONTENT_TYPE, buildContactCard, type ContactCard } from "./contactCard";

/** 一次最多发几张名片（与转发选择页多选上限一致）。没有上限的话"一次发 200 张"就是刷屏。 */
export const CONTACT_MAX_SELECTION = 9;

export interface ContactShareDeps {
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  uid: string;
  friends: FriendEntry[];
  conversations: Conversation[];
  /** 当前会话（入口 ① 的发送目标）；无会话时入口 ① 不可用。 */
  currentConvRef: MutableRefObject<string>;
  appendMsg: (convId: string, m: ChatMessage) => void;
  setAttachPanel: (v: boolean) => void;
  // 入口 ②③ 复用转发选择页（ForwardPicker）：与「转发一条消息」走完全相同的选会话 + 发送路径。
  setForwardMode: (m: "each" | "merged") => void;
  setForwarding: (m: ChatMessage[] | null) => void;
}

export function useContactShare(d: ContactShareDeps) {
  const { clientRef, setToast, uid, friends, conversations, currentConvRef,
          appendMsg, setAttachPanel, setForwardMode, setForwarding } = d;

  /** 入口 ① 的选人弹窗：null=关闭；selected 存 uid（与搜索过滤无关，见 FriendPickerModal）。 */
  const [cardPicker, setCardPicker] = useState<{ selected: string[] } | null>(null);
  /** 二次确认弹窗：即将发出的名片快照（顺序 = 用户勾选顺序）。 */
  const [cardConfirm, setCardConfirm] = useState<ContactCard[] | null>(null);

  const openContactPicker = useCallback(() => {
    setAttachPanel(false);
    setCardPicker({ selected: [] });
  }, [setAttachPanel]);

  const toggleContactPick = useCallback((userId: string) => {
    setCardPicker((prev) => {
      if (!prev) return prev;
      if (prev.selected.includes(userId)) return { selected: prev.selected.filter((x) => x !== userId) };
      if (prev.selected.length >= CONTACT_MAX_SELECTION) return prev; // 满选：静默忽略（行已置灰）
      return { selected: [...prev.selected, userId] };
    });
  }, []);

  /**
   * 由选中的 uid 组装名片快照，进二次确认。
   * ⚠️ 昵称取 `f.nickname`（服务端下发的真实昵称），**绝不能取备注**——
   * 备注是查看者私有的，发出去就是泄露"我给你起的外号"（设计文档 §2.4）。
   */
  const confirmContactPick = useCallback(() => {
    const sel = cardPicker?.selected ?? [];
    if (sel.length === 0) return;
    const byId = new Map(friends.map((f) => [f.user_id, f]));
    const cards: ContactCard[] = sel.map((id) => {
      const f = byId.get(id);
      return { userId: id, nickname: f?.nickname, avatarUrl: f?.avatar_url };
    });
    setCardPicker(null);
    setCardConfirm(cards);
  }, [cardPicker, friends]);

  /**
   * 入口 ①：逐条发进当前会话（每张名片是独立消息：失败那条独立显红、其余不受影响）。
   * **不出 toast**——气泡本身就是反馈，与发图/发文件一致，别重复报喜。
   */
  const sendContactCards = useCallback((cards: ContactCard[]) => {
    const conv = conversations.find((c) => c.conv_id === currentConvRef.current);
    const client = clientRef.current;
    setCardConfirm(null);
    if (!conv || !client || cards.length === 0) return;
    const to = conv.is_group ? "" : (conv.peer ?? "");
    for (const card of cards) {
      const content = buildContactCard(card.userId, card.nickname, card.avatarUrl);
      if (!content) continue; // 无 uid（理论到不了）：服务端也会拒，不如本地就别发
      const clientMsgId = client.sendMedia(content, CONTACT_CONTENT_TYPE, to, conv.conv_id);
      appendMsg(conv.conv_id, {
        clientMsgId, convId: conv.conv_id, from: uid, content, contentType: CONTACT_CONTENT_TYPE,
        convSeq: 0, timestamp: Date.now(), status: "sending",
      });
    }
  }, [conversations, currentConvRef, clientRef, appendMsg, uid]);

  /**
   * 入口 ②③：把某个人做成一条 contact 消息，交给**已有的**转发选择页选会话后发出。
   * 合成一条本地 ChatMessage 喂进 forwarding —— 与「转发一条名片消息」是同一件事，
   * 故转发路径的保留原类型 / 逐条发送 / 吐司汇总全部白拿，无需新写发送代码。
   */
  const shareContactCard = useCallback((card: ContactCard) => {
    const content = buildContactCard(card.userId, card.nickname, card.avatarUrl);
    if (!content) { setToast("该用户资料不完整，无法分享名片"); return; }
    setForwardMode("each");
    setForwarding([{
      clientMsgId: `card-${card.userId}`, convId: "",
      // ⚠️ `from` 必须留空：转发路径取 `origin = m.forwardFrom || m.fromNickname || m.from`，
      // 填 uid 会让收方在卡片上方看到「转发自 4820571639」（既是错的语义——分享名片不是转发，
      // 又把 10 位内部 ID 露到界面上）。留空使整条回退链落到 ""，`forwardFrom` 随之不下发。
      // 合并模式的 nameOf(m) 用不到它：合并开关只在 count > 1 时出现，这里恒为 1 条。
      from: "",
      content, contentType: CONTACT_CONTENT_TYPE,
      convSeq: 1,          // >0：转发路径按"已确认消息"处理（0 会被当成未发出的占位过滤掉）
      timestamp: Date.now(), status: "sent",
    }]);
  }, [setForwardMode, setForwarding, setToast]);

  /** 入口 ① 的候选：全部好友（名片不排除任何人——推荐当前会话对端本身也是合理操作）。 */
  const contactCandidates = useMemo(
    () => friends.filter((f) => f.status === "accepted"), [friends]);

  return {
    cardPicker, cardConfirm, contactCandidates,
    openContactPicker, toggleContactPick, confirmContactPick, sendContactCards, shareContactCard,
    closeContactPicker: () => setCardPicker(null),
    closeContactConfirm: () => setCardConfirm(null),
  };
}
