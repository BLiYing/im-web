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
  const [entryUnread, setEntryUnread] = useState(0); // 进会话时的未读条数（用于定位分割线，从尾部倒数）
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
  const loadingOlderRef = useRef(false); // 是否正在加载更早历史（防重复触发）

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
    // 进会话定位：记录"进入前"的已读位点，据此渲染未读分割线并滚动到它。
    const conv = conversations.find((c) => c.conv_id === cid);
    setEntryUnread(conv?.unread ?? 0);
    entryUnreadRef.current = conv?.unread ?? 0;
    pendingScrollRef.current = true;
    setShowJump(false);
    setJumpCount(0);
    clientRef.current?.trackConversation(cid, conv?.latest_conv_seq ?? 0); // 只同步最近一页，余下上滚加载
    // 已读：把已知最新消息位点上报（新同步进来的由 onMessage 续报）。
    const known = msgsByConv[cid] ?? [];
    const maxSeq = known.reduce((a, m) => Math.max(a, m.convSeq), 0);
    if (maxSeq > 0) clientRef.current?.markRead(cid, maxSeq);
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
  // 首条未读下标：从尾部倒数第 entryUnread 条"对端消息"（只依赖未读计数，不依赖 read_seq）。
  const firstUnreadIdx = firstUnreadIndex(messages, uid, entryUnread);

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
      if (messages.length === 0) return; // 等最近一页到达再定位
      if (firstUnreadIdx >= 0) {
        h.scrollToIndex(firstUnreadIdx, { align: "start" }); // 定位到首条未读
        wasNearBottomRef.current = false;
        setJumpCount(entryUnreadRef.current);
        setShowJump(entryUnreadRef.current > 0);
      } else {
        h.scrollToIndex(messages.length - 1, { align: "end" }); // 否则直接到最新
        wasNearBottomRef.current = true;
        setShowJump(false);
      }
      pendingScrollRef.current = false;
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 顶部插入了更早历史：位置已由 VList 的 shift 维持，这里只复位加载锁。
    if (curMin < prevMinSeqRef.current && curMax <= prevMaxSeqRef.current) {
      loadingOlderRef.current = false;
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 底部来了更大的 conv_seq 才算新消息。
    const newPeer = messages.filter((m) => m.from !== uid && m.convSeq > prevMaxSeqRef.current).length;
    const lastMine = messages[messages.length - 1]?.from === uid;
    prevMinSeqRef.current = curMin;
    prevMaxSeqRef.current = curMax;

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

  // virtua 的滚动回调：offset = 当前 scrollTop。判断贴底/到顶。
  const onVScroll = useCallback(
    (offset: number) => {
      const h = vlistRef.current;
      if (!h) return;
      const nearBottom = offset >= h.scrollSize - h.viewportSize - 80;
      wasNearBottomRef.current = nearBottom;
      if (nearBottom) {
        setShowJump(false);
        setJumpCount(0);
      } else {
        setShowJump(true);
      }
      // 上滚到顶 → 加载更早一页历史（位置由 shift 维持）。
      if (offset < 200 && !loadingOlderRef.current) {
        const cid = currentConvRef.current;
        const oldest = minSeqOf(msgsByConv[cid] ?? []);
        if (oldest > 1) {
          loadingOlderRef.current = true;
          clientRef.current?.loadOlder(cid, oldest);
        }
      }
    },
    [msgsByConv]
  );

  const jumpToBottom = useCallback(() => {
    const h = vlistRef.current;
    if (!h) return;
    h.scrollTo(h.scrollSize); // 滚到最底
    wasNearBottomRef.current = true;
    setShowJump(false);
    setJumpCount(0);
  }, []);

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

// 首条未读下标：从尾部倒数第 n 条"对端消息"。仅依赖未读计数，不依赖 read_seq。
function firstUnreadIndex(messages: ChatMessage[], uid: string, n: number): number {
  if (n <= 0) return -1;
  let c = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from !== uid) {
      c++;
      if (c === n) return i;
    }
  }
  return -1; // 本地消息不足 n 条对端消息（历史还没拉全），不画分割线
}

function fmtTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
