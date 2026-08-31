// useMentions：@提及簇（阶段 7b，CODING_STYLE §7「①自有状态+一组操作」）——面板开合/过滤词/高亮项 3 state + 候选表/全员待决/
// 面板与高亮行 ref + 候选行 mentionRows + 选中回填 pickMention + 键盘导航 onMentionNavKey + 4 个 effect（关面板清过滤、
// 过滤变回首项、高亮滚入视野、切会话清空、Esc/点外关闭）。函数体逐字平移。onInputChange（含 typing 信号）与
// mentionEntriesFor（依赖早退后的 memberNick）留 App。依赖注入：convId/groupConvId/peer/uid/groupInfos/input/setInput/composerRef。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { FriendEntry, GroupInfo } from "./sdk/protocol";
import type { MentionRow } from "./components/Composer";
import { applyMentionToken, filterMentionMembers, canMentionAll, MENTION_ALL_LABEL, type MentionCandidates } from "./mention";
import { remarkMap } from "./remarks";

export interface MentionsDeps {
  convId: string;
  groupConvId: string;
  peer: string;
  uid: string;
  groupInfos: Record<string, GroupInfo>;
  friends: FriendEntry[]; // 仅用于取"我给某人起的备注"参与匹配（备注不进消息，见下）
  input: string;
  setInput: (v: string) => void;
  composerRef: RefObject<HTMLTextAreaElement>;
  /**
   * 超级群的成员搜索（依赖注入，便于单测）。
   *
   * 超级群的 `GET /groups/{id}` 只回我自己，`info.members` 里没有别人——不接这条，
   * 大群里 @人会**一个候选都搜不到**。普通群不传/不调用（成员表已全量在手，走服务端只会更慢）。
   */
  searchGroupMembers?: (convId: string, q: string) => Promise<Array<{ user_id: string; nickname?: string; role?: string; avatar_url?: string }>>;
}

export function useMentions(d: MentionsDeps) {
  const { convId, groupConvId, peer, uid, groupInfos, friends, input, setInput, composerRef, searchGroupMembers } = d;
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null=面板关闭
  const [mentionFilter, setMentionFilter] = useState(""); // 面板顶部搜索框的**独立**搜索词（从空开始，不随消息框 @后文字回填；空时列表跟随 mentionQuery）
  const mentionCandidates = useRef<MentionCandidates>({});
  const mentionAllPending = useRef(false);
  const mentionPanelRef = useRef<HTMLDivElement>(null); // 面板 DOM：判定"点击是否落在面板外"
  const mentionActiveRef = useRef<HTMLButtonElement>(null); // 当前高亮行：键盘移动时滚入视野
  // 超级群：候选来自**服务端搜索**（本地只有我自己）。存搜到的那一页，随过滤词变化重取。
  const [remoteMembers, setRemoteMembers] = useState<Array<{ user_id: string; nickname?: string; role?: string; avatar_url?: string }>>([]);

  const mentionRows = useMemo(() => {
    if (mentionQuery === null || !groupConvId || peer) return [];
    const info = groupInfos[groupConvId];
    if (!info) return [];
    // displayName 恒为群内**公开名**（选中后插进消息的就是它）；remark 只挂在候选项上参与匹配，
    // 绝不进 label——备注仅本人可见，写进消息文本等于把私房名发给全群。
    const remarkOf = remarkMap(friends);
    // 超级群的候选来自服务端搜索（本地 info.members 只有我自己）；普通群仍用本地全量成员表。
    const source = info.is_super
      ? remoteMembers.map((m) => ({ user_id: m.user_id, nickname: m.nickname, role: m.role, avatar_url: m.avatar_url }))
      : info.members;
    const others = source
      .filter((m) => m.user_id !== uid)
      .map((m) => ({ userId: m.user_id, displayName: m.nickname || m.user_id, remark: remarkOf.get(m.user_id),
                     role: m.role, avatarUrl: m.avatar_url }));
    // 生效过滤词：用户在面板搜索框主动打字时以搜索框为准（独立搜索）；否则跟随消息框 @后的字符（mentionQuery）。
    // 二者互不写入对方，故搜索框不会被 @文字自动回填；清空搜索框即回落到消息框驱动。
    const effQuery = mentionFilter.trim() !== "" ? mentionFilter : mentionQuery;
    const hits = filterMentionMembers(others, effQuery);
    // note 显示备注：搜「老王」蹦出一行叫「王小二」的人，没有这行副标记就像是匹配错了。
    const rows: MentionRow[] =
      hits.map((m) => ({ label: m.displayName, userId: m.userId, role: m.role, avatarUrl: m.avatarUrl,
                         ...(m.remark ? { note: `备注: ${m.remark}` } : {}) }));
    if (canMentionAll(info.my_role) && effQuery.trim() === "") {
      // 「通知全部 N 人」的 N 用群真实人数：超级群的候选是搜出来的一页，用 others.length 会显示成个位数。
      const total = info.member_count ?? others.length;
      rows.unshift({ label: MENTION_ALL_LABEL, userId: null, note: `通知全部 ${total} 人` });
    }
    return rows;
  }, [mentionQuery, mentionFilter, groupConvId, peer, groupInfos, friends, uid, remoteMembers]);

  // 超级群：面板打开或过滤词变化时向服务端搜成员。
  // 300ms 去抖——每敲一个字打一次请求，在 2 万人的群里既浪费也会让候选闪烁。
  useEffect(() => {
    const info = groupConvId ? groupInfos[groupConvId] : undefined;
    if (mentionQuery === null || !info?.is_super || !searchGroupMembers) { setRemoteMembers([]); return; }
    const q = (mentionFilter.trim() !== "" ? mentionFilter : mentionQuery).trim();
    let alive = true;
    const timer = window.setTimeout(() => {
      void searchGroupMembers(groupConvId, q)
        .then((ms) => { if (alive) setRemoteMembers(Array.isArray(ms) ? ms : []); })
        .catch(() => { if (alive) setRemoteMembers([]); }); // 搜不到就空列表，不打断输入
    }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [mentionQuery, mentionFilter, groupConvId, groupInfos, searchGroupMembers]);

  // 面板关闭时清空搜索框：下次打开是干净的空框（搜索词不跨会话/跨次残留）。
  useEffect(() => { if (mentionQuery === null) setMentionFilter(""); }, [mentionQuery]);
  // 键盘导航的高亮项；过滤词一变就回到首项（否则旧下标会指向另一个人）。
  const [mentionActive, setMentionActive] = useState(0);
  useEffect(() => { setMentionActive(0); }, [mentionQuery, mentionFilter]);
  // 高亮项滚入视野：成员多时用 ↓ 走到列表下缘，高亮不能停在可视区外。
  useEffect(() => { mentionActiveRef.current?.scrollIntoView({ block: "nearest" }); }, [mentionActive]);

  /** 选中某成员 / @所有人：回填 token、记入候选表、关面板并把焦点与光标交还输入框。 */
  const pickMention = useCallback((displayName: string, userId: string | null) => {
    const el = composerRef.current;
    const caret = el?.selectionStart ?? input.length;
    const next = applyMentionToken(input, caret, displayName);
    setInput(next.text);
    if (userId) mentionCandidates.current[userId] = displayName; // 键必须是 uid：同名成员不能互相覆盖
    else mentionAllPending.current = true;
    setMentionQuery(null);
    window.setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    }, 0);
  }, [input]);

  /** @面板导航键（消息框与面板搜索框共用）：↑/↓ 移动、Enter/Tab 选中、Esc 关闭。返回 true=已消费。 */
  const onMentionNavKey = (e: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (mentionQuery === null || e.nativeEvent.isComposing) return false;
    if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return true; }
    if (mentionRows.length === 0) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setMentionActive((i) => (i + 1) % mentionRows.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setMentionActive((i) => (i - 1 + mentionRows.length) % mentionRows.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") {
      const r = mentionRows[Math.min(mentionActive, mentionRows.length - 1)];
      if (r) { e.preventDefault(); pickMention(r.label, r.userId); return true; }
    }
    return false;
  };

  // 手打同名成员时会命中**上一个群**的 uid —— 服务端按新群成员集过滤后把它丢掉，
  // 结果本群那位同名成员一条提醒都收不到，发送方却毫无察觉。面板同理必须收起。
  useEffect(() => {
    mentionCandidates.current = {};
    mentionAllPending.current = false;
    setMentionQuery(null);
    setMentionFilter("");
  }, [convId]);
  // @面板的关闭路径（M4-8）：Esc 或点击面板外。没有这条路径时面板会一直悬在输入框上方，
  // 只能靠"打一个空格"才消失——用户想手打昵称或去点别处时无从关闭。
  useEffect(() => {
    if (mentionQuery === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMentionQuery(null); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (mentionPanelRef.current?.contains(t) || composerRef.current?.contains(t))) return;
      setMentionQuery(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [mentionQuery]);

  return {
    mentionQuery, setMentionQuery, mentionFilter, setMentionFilter, mentionActive, setMentionActive,
    mentionCandidates, mentionAllPending, mentionPanelRef, mentionActiveRef,
    mentionRows, pickMention, onMentionNavKey,
  };
}
