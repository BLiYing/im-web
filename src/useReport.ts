// useReport：举报簇（AG-3）——举报某条消息 / 举报某个人 / 多选批量举报同一发送者的多条。
// 抽出来的原因：新功能默认进新文件，别再往 App.tsx（已 3800+ 行）堆（CODING_STYLE §九[防膨胀]/§7）；
// 与 useForward / useFavorites 的多选动作簇同构。纯判定 `reportableSenderOf` 在 messageContent.ts（带单测）。
//
// 三个入口的分工（2026-09-06 合并长按菜单后定型）：
//   · 长按菜单「举报」        → reportMsg(m)：target_type=message，举报这一条
//   · 资料页「更多 → 举报」    → reportPeer(uid, nickname)：target_type=user，举报这个人本身
//   · 多选栏「举报」          → reportSelected()：target_type=message + target_seqs，一次一张工单
import { useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage } from "./sdk/protocol";
import { displayNameOf } from "./remarks";
import { reportableSenderOf } from "./messageContent";

export interface ReportDeps {
  clientRef: MutableRefObject<IMClient | null>;
  uid: string;
  remarks: Map<string, string>;
  askPrompt: (title: string, def?: string, opts?: { placeholder?: string; okText?: string }) => Promise<string | null>;
  setToast: (msg: string | null) => void;
  setMenu: (v: null) => void;
  // 多选批量举报用：当前会话 id + 该会话消息 + 已选 conv_seq 集 + 退出多选。
  convId: string;
  msgsByConv: Record<string, ChatMessage[]>;
  selected: Set<number>;
  selectMode: boolean;
  exitSelectMode: () => void;
}

export function useReport(d: ReportDeps) {
  const { clientRef, uid, remarks, askPrompt, setToast, setMenu, convId, msgsByConv, selected, selectMode, exitSelectMode } = d;

  /** 提交一次举报并出吐司。返回是否成功（批量成功后要退出多选）。 */
  const submit = useCallback(async (
    title: string,
    send: (reason: string) => Promise<void>,
  ): Promise<boolean> => {
    const reason = await askPrompt(title, "", { placeholder: "请填写举报理由", okText: "提交举报" });
    if (reason === null) return false; // 取消
    try {
      await send(reason);
      setToast("举报已提交，感谢反馈。");
      return true;
    } catch (e) {
      setToast(`举报失败：${(e as Error).message}`);
      return false;
    }
  }, [askPrompt, setToast]);

  /** 长按菜单「举报」：举报这一条消息。用 (conv_id, conv_seq) 定位——客户端不持有 server_msg_id。 */
  const reportMsg = useCallback((m: ChatMessage) => {
    setMenu(null);
    void submit("举报这条消息", (reason) => clientRef.current!.report("message", String(m.convSeq), reason, m.convId));
  }, [submit, setMenu, clientRef]);

  /** 资料页「更多 → 举报」：举报这个人本身。长按菜单合并后，人本身的举报只剩这一个入口。
   *  标题里的名字用**本机显示名**（备注优先）：这句话只给我自己看、不随请求发出。
   *  nickname 必须由调用方传进来——只给 uid 的话弹窗会显示一串内部随机数字，用户根本不知道在举报谁。 */
  const reportPeer = useCallback((peerId: string, nickname?: string | null) => {
    const who = displayNameOf(peerId, remarks, nickname);
    void submit(`举报用户 ${who}`, (reason) => clientRef.current!.report("user", peerId, reason));
  }, [submit, remarks, clientRef]);

  /** 多选栏「举报」：所选须**全部来自同一个对方**（否则按钮已置灰），填一次理由 → 一次 POST
   *  合成**一张**工单（勾 N 条不给管理员刷出 N 张讲同一件事的单）。 */
  const reportSelected = useCallback(() => {
    const list = (msgsByConv[convId] ?? []).filter((m) => m.convSeq > 0 && selected.has(m.convSeq) && !m.recalledAt);
    const sender = reportableSenderOf(list, uid);
    if (!sender) return; // 按钮禁用兜底
    const seqs = list.map((m) => m.convSeq);
    const who = displayNameOf(sender, remarks, list[0]?.fromNickname);
    const title = seqs.length === 1 ? "举报这条消息" : `举报 ${who} 的 ${seqs.length} 条消息`;
    void submit(title, (reason) => clientRef.current!.report("message", String(seqs[0]), reason, convId, seqs))
      // 成功才退出多选；失败留在原地让用户重试，不用重新勾一遍。
      .then((ok) => { if (ok) exitSelectMode(); });
  }, [submit, convId, msgsByConv, selected, uid, remarks, clientRef, exitSelectMode]);

  // 多选栏举报钮的可点性与灰态原因。**置灰不隐藏**——隐藏会让栏内按钮数随勾选变化、按钮左右跳。
  const [reportableSender, reportHasMine] = useMemo(() => {
    if (!selectMode || selected.size === 0) return [null, false] as const;
    const list = (msgsByConv[convId] ?? []).filter((m) => m.convSeq > 0 && selected.has(m.convSeq) && !m.recalledAt);
    return [reportableSenderOf(list, uid), list.some((m) => m.from === uid)] as const;
  }, [selectMode, selected, msgsByConv, convId, uid]);

  return { reportMsg, reportPeer, reportSelected, reportableSender, reportHasMine };
}
