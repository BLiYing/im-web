import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { VList, type VListHandle } from "virtua";
import { IMClient, type ConnState } from "./sdk/imSdk";
import { convIdFor, type ChatMessage, type Conversation } from "./sdk/protocol";

type Phase = "login" | "list" | "chat";

export default function App() {
  const [phase, setPhase] = useState<Phase>("login");
  const [uid, setUid] = useState("1001");
  const [state, setState] = useState<ConnState>("disconnected");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [msgsByConv, setMsgsByConv] = useState<Record<string, ChatMessage[]>>({});
  const [peer, setPeer] = useState("");
  const [newPeer, setNewPeer] = useState("");
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState<Record<string, string>>({}); // user -> online/offline
  const [peerReadSeq, setPeerReadSeq] = useState<Record<string, number>>({}); // convId -> 对端已读位点
  const [typingConv, setTypingConv] = useState<string | null>(null);
  const [entryUnread, setEntryUnread] = useState(0); // 进会话时的未读数（红点/↓N 计数，服务端 cap 999）
  const [entryReadSeq, setEntryReadSeq] = useState(0); // 进会话时的已读位点（精确定位未读分割线，CHAT_UX §4）
  const [showJump, setShowJump] = useState(false); // 右下角"跳到底部"按钮是否显示
  const [jumpCount, setJumpCount] = useState(0); // 按钮上的未读条数

  const clientRef = useRef<IMClient | null>(null);
  const seenByConv = useRef<Record<string, Set<number>>>({});
  const currentConvRef = useRef<string>(""); // 当前打开的会话（供消息回调判断是否标记已读）
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef<number>(0);
  const vlistRef = useRef<VListHandle>(null); // 虚拟列表句柄（滚动/定位）
  const pendingScrollRef = useRef(false); // 刚进会话，待定位到未读/底部
  const wasNearBottomRef = useRef(true); // 追加消息前用户是否贴近底部
  const prevMaxSeqRef = useRef(0); // 上次渲染的最大 conv_seq（判断底部是否来了更新的消息）
  const entryUnreadRef = useRef(0); // 进会话时的未读数（按钮初始计数）
  const prevMinSeqRef = useRef(0); // 上次渲染的最小 conv_seq（判断顶部是否插了更早历史）
  const loadingOlderRef = useRef(false); // 是否正在上滚加载更早历史
  const loadingNewerRef = useRef(false); // 是否正在下滚加载更新历史
  const latestSeqRef = useRef(0); // 该会话服务端最新 conv_seq（判断下方是否还有未加载）
  const forceBottomRef = useRef(false); // jumpToBottom 触发的"强制定位到底"（忽略未读分割线）

  const appendMsg = useCallback((convId: string, m: ChatMessage) => {
    setMsgsByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] ?? []), m] }));
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const convs = await clientRef.current?.fetchConversations();
      if (convs) setConversations(convs);
    } catch {
      /* 忽略 */
    }
  }, []);

  const enterApp = useCallback(async () => {
    if (!uid) {
      alert("请填写 uid");
      return;
    }
    const client = new IMClient({
      onState: setState,
      onMessage: (m) => {
        const seen = (seenByConv.current[m.convId] ??= new Set());
        if (m.convSeq > 0) {
          if (seen.has(m.convSeq)) return;
          seen.add(m.convSeq);
        }
        appendMsg(m.convId, m);
        if (m.convId === currentConvRef.current && m.from !== uid && m.convSeq > 0) {
          // 正在看这个会话 + 对端发来 → 标记已读（对端看到已读双勾）。
          clientRef.current?.markRead(m.convId, m.convSeq);
        } else if (m.from !== uid) {
          // 不在该会话 → 刷新会话列表，更新未读红点与最后一条。
          void refreshConversations();
        }
      },
      onAck: (clientMsgId, ok, convSeq) => {
        setMsgsByConv((prev) => {
          const out: Record<string, ChatMessage[]> = {};
          for (const [cid, list] of Object.entries(prev)) {
            out[cid] = list.map((m) =>
              m.clientMsgId === clientMsgId ? { ...m, status: ok ? "sent" : "failed", convSeq } : m
            );
          }
          return out;
        });
      },
      onReceipt: (convId, from, status, upToSeq) => {
        if (status === "read" && from !== uid) {
          setPeerReadSeq((prev) => ({ ...prev, [convId]: Math.max(prev[convId] ?? 0, upToSeq) }));
        }
      },
      onPresence: (user, status) => setPresence((prev) => ({ ...prev, [user]: status })),
      onTyping: (convId, from) => {
        if (from === uid) return;
        setTypingConv(convId);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setTypingConv(null), 3000);
      },
    });
    clientRef.current = client;
    await client.connect(uid);
    await refreshConversations();
    setPhase("list");
  }, [uid, appendMsg, refreshConversations]);

  const openChat = useCallback((p: string) => {
    if (!p || p === uid) {
      alert("请输入有效的对方 uid");
      return;
    }
    const cid = convIdFor(uid, p);
    setPeer(p);
    currentConvRef.current = cid;
    // 进会话定位（CHAT_UX §3）：以 read_seq 为锚点——有未读则停在首条未读，否则到最新。
    const conv = conversations.find((c) => c.conv_id === cid);
    const readSeq = conv?.read_seq ?? 0;
    const latestSeq = conv?.latest_conv_seq ?? 0;
    setEntryUnread(conv?.unread ?? 0);
    entryUnreadRef.current = conv?.unread ?? 0;
    setEntryReadSeq(readSeq);
    latestSeqRef.current = latestSeq;
    pendingScrollRef.current = true;
    forceBottomRef.current = false;
    setShowJump(false);
    setJumpCount(0);
    clientRef.current?.openConversation(cid, readSeq, latestSeq); // 加载锚点窗口，余下双向分页
    // 打开即全部已读（CHAT_UX §6 简化）：上报到 latest，会话列表红点随即清零；
    // 分割线仍用进入前的 readSeq 快照定位，不受影响。
    if (latestSeq > 0) clientRef.current?.markRead(cid, latestSeq);
    setPhase("chat");
  }, [uid, msgsByConv, conversations]);

  const backToList = useCallback(() => {
    currentConvRef.current = "";
    setPeer("");
    setNewPeer("");
    setTypingConv(null);
    void refreshConversations();
    setPhase("list");
  }, [refreshConversations]);

  const logout = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    seenByConv.current = {};
    currentConvRef.current = "";
    setConversations([]);
    setMsgsByConv({});
    setPresence({});
    setPeerReadSeq({});
    setPhase("login");
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    const client = clientRef.current;
    if (!text || !client || !peer) return;
    const convId = convIdFor(uid, peer);
    const clientMsgId = client.sendText(text, peer, convId);
    appendMsg(convId, {
      clientMsgId, convId, from: uid, content: text, contentType: "text",
      convSeq: 0, timestamp: Date.now(), status: "sending",
    });
    setInput("");
  }, [input, peer, uid, appendMsg]);

  const onInputChange = useCallback((val: string) => {
    setInput(val);
    const now = Date.now();
    if (val && peer && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      clientRef.current?.sendTyping(convIdFor(uid, peer));
    }
  }, [peer, uid]);

  const stateText = { connected: "已连接", connecting: "连接中…", disconnected: "未连接" }[state];

  const convId = peer ? convIdFor(uid, peer) : "";
  // 按 conv_seq 排序（回填的历史可能晚于实时消息到达）；发送中(convSeq=0)排末尾。
  const messages = (msgsByConv[convId] ?? [])
    .slice()
    .sort((a, b) => (a.convSeq || Number.MAX_SAFE_INTEGER) - (b.convSeq || Number.MAX_SAFE_INTEGER));
  // 首条未读下标：conv_seq > read_seq 的第一条对端消息（精确，CHAT_UX §4）。
  const firstUnreadIdx =
    entryUnread > 0 ? messages.findIndex((m) => m.from !== uid && m.convSeq > entryReadSeq) : -1;

  // shift：本次渲染是否在"顶部插入了更早历史"（与上次渲染比 min/max seq）。
  // 传给 VList 后由 virtua 自动从底部维持滚动位置，反向分页不跳。
  const renderMin = minSeqOf(messages);
  const renderMax = maxSeqOf(messages);
  const shift =
    !pendingScrollRef.current &&
    prevMinSeqRef.current > 0 &&
    renderMin < prevMinSeqRef.current &&
    renderMax <= prevMaxSeqRef.current;

  // 进会话定位 / 新消息贴底 / 顶部插历史复位锁 / 在上看历史时累加跳转计数。
  useLayoutEffect(() => {
    if (phase !== "chat") return;
    const h = vlistRef.current;
    if (!h) return;
    const curMin = minSeqOf(messages);
    const curMax = maxSeqOf(messages);

    if (pendingScrollRef.current) {
      if (messages.length === 0) return; // 等锚点窗口到达再定位
      if (firstUnreadIdx >= 0 && !forceBottomRef.current) {
        h.scrollToIndex(firstUnreadIdx, { align: "start" }); // 停在首条未读（分割线在其上方）
        wasNearBottomRef.current = false;
        setJumpCount(entryUnreadRef.current);
        setShowJump(entryUnreadRef.current > 0);
      } else {
        h.scrollToIndex(messages.length - 1, { align: "end" }); // 无未读 / 强制到底
        wasNearBottomRef.current = true;
        setShowJump(false);
      }
      pendingScrollRef.current = false;
      forceBottomRef.current = false;
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 复位分页锁：顶部插了更老（min 变小）/底部接了更新（max 变大）。
    const wasLoadingNewer = loadingNewerRef.current;
    if (curMin < prevMinSeqRef.current) loadingOlderRef.current = false;
    if (curMax > prevMaxSeqRef.current) loadingNewerRef.current = false;

    // 顶部插入更早历史：位置由 VList 的 shift 维持，不动滚动/计数。
    if (curMin < prevMinSeqRef.current && curMax <= prevMaxSeqRef.current) {
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 下滚分页加载的更新历史（≤ latest）：插在底部下方，位置不动（virtua 自然保持）。
    if (curMax > prevMaxSeqRef.current && curMax <= latestSeqRef.current && wasLoadingNewer) {
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 真·新消息（live，conv_seq 超过进会话时的 latest）或自己发送。
    const newPeer = messages.filter((m) => m.from !== uid && m.convSeq > prevMaxSeqRef.current).length;
    const lastMine = messages[messages.length - 1]?.from === uid;
    prevMinSeqRef.current = curMin;
    prevMaxSeqRef.current = curMax;
    if (curMax > latestSeqRef.current) latestSeqRef.current = curMax; // live 推进 latest

    if (lastMine) {
      h.scrollToIndex(messages.length - 1, { align: "end" }); // 自己发 → 贴底
      wasNearBottomRef.current = true;
      setShowJump(false);
      setJumpCount(0);
    } else if (newPeer > 0) {
      if (wasNearBottomRef.current) {
        h.scrollToIndex(messages.length - 1, { align: "end" }); // 已在底部 → 贴底
        setShowJump(false);
        setJumpCount(0);
      } else {
        setJumpCount((n) => n + newPeer); // 在上面看历史 → 累加并显示按钮
        setShowJump(true);
      }
    }
  }, [phase, convId, messages.length, uid, firstUnreadIdx]);

  // virtua 的滚动回调：offset = 当前 scrollTop。判断贴底/到顶 + 双向分页。
  const onVScroll = useCallback(
    (offset: number) => {
      const h = vlistRef.current;
      if (!h) return;
      const cid = currentConvRef.current;
      const list = msgsByConv[cid] ?? [];
      const nearBottomPx = offset >= h.scrollSize - h.viewportSize - 80;
      const newest = maxSeqOf(list);
      const oldest = minSeqOf(list);
      const moreBelow = newest < latestSeqRef.current; // 下方还有未加载的更新历史
      const atTrueBottom = nearBottomPx && !moreBelow;
      wasNearBottomRef.current = atTrueBottom;
      setShowJump(!atTrueBottom);
      if (atTrueBottom) setJumpCount(0);

      const busy = loadingOlderRef.current || loadingNewerRef.current;
      // 下滚到底 → 加载更新一页（位置不动）。
      if (nearBottomPx && moreBelow && !busy) {
        loadingNewerRef.current = true;
        clientRef.current?.loadNewer(cid, newest);
      } else if (offset < 200 && oldest > 1 && !busy) {
        // 上滚到顶 → 加载更早一页（位置由 shift 维持）。
        loadingOlderRef.current = true;
        clientRef.current?.loadOlder(cid, oldest);
      }
    },
    [msgsByConv]
  );

  const jumpToBottom = useCallback(() => {
    const h = vlistRef.current;
    if (!h) return;
    const cid = currentConvRef.current;
    const newest = maxSeqOf(msgsByConv[cid] ?? []);
    if (newest < latestSeqRef.current) {
      // 下方还有大段未加载（如从很老的未读处直接跳底）→ 重载最近一页再贴底。
      setEntryUnread(0);
      forceBottomRef.current = true;
      pendingScrollRef.current = true;
      clientRef.current?.openConversation(cid, latestSeqRef.current, latestSeqRef.current);
    } else {
      h.scrollTo(h.scrollSize); // 已加载到底 → 直接滚到最底
    }
    wasNearBottomRef.current = true;
    setShowJump(false);
    setJumpCount(0);
  }, [msgsByConv]);

  // ---- 登录 ----
  if (phase === "login") {
    return (
      <div className="login">
        <h1>IM Web 登录</h1>
        <label>我的 uid<input value={uid} onChange={(e) => setUid(e.target.value.trim())} /></label>
        <button onClick={enterApp}>登录</button>
        <p className="hint">开发期免密登录：填 uid 即可。先启动后端 <code>go run ./cmd/imserver</code>。</p>
      </div>
    );
  }

  // ---- 会话列表 ----
  if (phase === "list") {
    return (
      <div className="screen">
        <header>
          <span>会话（{uid} · {stateText}）</span>
          <button className="link" onClick={logout}>退出</button>
        </header>
        <div className="newchat">
          <input value={newPeer} placeholder="输入对方 uid 发起会话…"
            onChange={(e) => setNewPeer(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === "Enter") openChat(newPeer); }} />
          <button onClick={() => openChat(newPeer)}>发起</button>
        </div>
        <div className="convlist">
          {conversations.length === 0 && <div className="empty">还没有会话，输入对方 uid 发起一个吧</div>}
          {conversations.map((c) => (
            <div key={c.conv_id} className="convitem" onClick={() => openChat(c.peer)}>
              <div className="avatar">
                {c.peer.slice(-2)}
                {presence[c.peer] === "online" && <span className="presence-dot" />}
              </div>
              <div className="convbody">
                <div className="convtop">
                  <span className="convpeer">{c.peer}</span>
                  <span className="convtime">{c.last_message ? fmtTime(c.last_message.timestamp) : ""}</span>
                </div>
                <div className="convlast">{c.last_message?.content ?? "（无消息）"}</div>
              </div>
              {c.unread > 0 && <span className="badge">{c.unread > 99 ? "99+" : c.unread}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- 聊天 ----
  const readSeq = peerReadSeq[convId] ?? 0;
  const peerOnline = presence[peer] === "online";
  return (
    <div className="screen">
      <header>
        <button className="link" onClick={backToList}>‹ 会话</button>
        <span>
          <span className={`dot ${peerOnline ? "on" : ""}`} /> 与 {peer} 聊天
          {peerOnline ? "（在线）" : ""}
        </span>
        <span className="muted">{stateText}</span>
      </header>
      <VList ref={vlistRef} className="msgs" shift={shift} onScroll={onVScroll}>
        {messages.map((m, i) => {
          const mine = m.from === uid;
          const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
          return (
            <div className="msg-item" key={m.clientMsgId ?? m.serverMsgId ?? i}>
              {i === firstUnreadIdx && (
                <div className="unread-divider"><span>未读消息</span></div>
              )}
              <div className={`row ${mine ? "me" : "them"}`}>
                <div className="bubble">{m.content}</div>
                <div className="meta">
                  {mine
                    ? m.status === "sending" ? "发送中…"
                      : m.status === "failed" ? "发送失败 ✗"
                        : readByPeer ? "已读" : `已送达 ✓ · seq#${m.convSeq}`
                    : `来自 ${m.from} · seq#${m.convSeq}`}
                </div>
              </div>
            </div>
          );
        })}
      </VList>
      {showJump && (
        <button className="jump-btn" onClick={jumpToBottom} title="跳到最新消息">
          ↓{jumpCount > 0 && <span className="jump-badge">{jumpCount > 99 ? "99+" : jumpCount}</span>}
        </button>
      )}
      {typingConv === convId && <div className="typing">对方正在输入…</div>}
      <footer>
        <input value={input} placeholder="输入消息，回车发送…"
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button onClick={send}>发送</button>
      </footer>
    </div>
  );
}

// 消息列表里的最大 conv_seq（发送中的 0 不计）。
function maxSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > m) m = x.convSeq;
  return m;
}

// 消息列表里的最小 conv_seq（发送中的 0 不计；空列表返回 0）。
function minSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > 0 && (m === 0 || x.convSeq < m)) m = x.convSeq;
  return m;
}

function fmtTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
