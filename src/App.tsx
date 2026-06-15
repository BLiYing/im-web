import { useCallback, useRef, useState } from "react";
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

  const clientRef = useRef<IMClient | null>(null);
  const seenByConv = useRef<Record<string, Set<number>>>({});
  const currentConvRef = useRef<string>(""); // 当前打开的会话（供消息回调判断是否标记已读）
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef<number>(0);

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
    clientRef.current?.trackConversation(cid); // 触发增量同步拉历史
    // 已读：把已知最新消息位点上报（新同步进来的由 onMessage 续报）。
    const known = msgsByConv[cid] ?? [];
    const maxSeq = known.reduce((a, m) => Math.max(a, m.convSeq), 0);
    if (maxSeq > 0) clientRef.current?.markRead(cid, maxSeq);
    setPhase("chat");
  }, [uid, msgsByConv]);

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
  const convId = convIdFor(uid, peer);
  const messages = msgsByConv[convId] ?? [];
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
      <div className="msgs">
        {messages.map((m, i) => {
          const mine = m.from === uid;
          const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
          return (
            <div key={m.clientMsgId ?? m.serverMsgId ?? i} className={`row ${mine ? "me" : "them"}`}>
              <div className="bubble">{m.content}</div>
              <div className="meta">
                {mine
                  ? m.status === "sending" ? "发送中…"
                    : m.status === "failed" ? "发送失败 ✗"
                      : readByPeer ? "已读" : `已送达 ✓ · seq#${m.convSeq}`
                  : `来自 ${m.from} · seq#${m.convSeq}`}
              </div>
            </div>
          );
        })}
      </div>
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

function fmtTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
