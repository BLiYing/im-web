import { useCallback, useRef, useState } from "react";
import { IMClient, type ConnState } from "./sdk/imSdk";
import { convIdFor, type ChatMessage } from "./sdk/protocol";

export default function App() {
  const [phase, setPhase] = useState<"login" | "chat">("login");
  const [uid, setUid] = useState("1001");
  const [peer, setPeer] = useState("1002");
  const [state, setState] = useState<ConnState>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  const clientRef = useRef<IMClient | null>(null);
  const seenSeq = useRef<Set<number>>(new Set());
  const convId = convIdFor(uid, peer);

  const enterChat = useCallback(() => {
    if (!uid || !peer || uid === peer) {
      alert("请填写不同的「我的 uid」与「对方 uid」");
      return;
    }
    const client = new IMClient({
      onState: setState,
      onMessage: (m) => {
        // 同一条可能既被 new_msg 推送、又被 sync_resp 拉到，按 conv_seq 去重。
        if (m.convSeq > 0) {
          if (seenSeq.current.has(m.convSeq)) return;
          seenSeq.current.add(m.convSeq);
        }
        setMessages((prev) => [...prev, m]);
      },
      onAck: (clientMsgId, ok, convSeq) => {
        if (convSeq > 0) seenSeq.current.add(convSeq);
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMsgId === clientMsgId ? { ...m, status: ok ? "sent" : "failed", convSeq } : m
          )
        );
      },
    });
    clientRef.current = client;
    void client.connect(uid);
    client.trackConversation(convId);
    setPhase("chat");
  }, [uid, peer, convId]);

  const leave = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    seenSeq.current.clear();
    setMessages([]);
    setPhase("login");
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    const client = clientRef.current;
    if (!text || !client) return;
    const clientMsgId = client.sendText(text, peer, convId);
    setMessages((prev) => [
      ...prev,
      { clientMsgId, convId, from: uid, content: text, contentType: "text", convSeq: 0, timestamp: Date.now(), status: "sending" },
    ]);
    setInput("");
  }, [input, peer, convId, uid]);

  if (phase === "login") {
    return (
      <div className="login">
        <h1>IM Web 登录</h1>
        <label>我的 uid<input value={uid} onChange={(e) => setUid(e.target.value.trim())} /></label>
        <label>对方 uid<input value={peer} onChange={(e) => setPeer(e.target.value.trim())} /></label>
        <button onClick={enterChat}>连接并进入聊天</button>
        <p className="hint">开发期：先启动后端 <code>go run ./cmd/imserver</code>，再 <code>npm run dev</code>。</p>
      </div>
    );
  }

  const stateText = { connected: "已连接", connecting: "连接中…", disconnected: "未连接" }[state];
  return (
    <div className="chat">
      <header>
        <button className="back" onClick={leave}>‹ 返回</button>
        <span>与 {peer} 聊天（{stateText}）</span>
      </header>
      <div className="msgs">
        {messages.map((m, i) => {
          const mine = m.from === uid;
          return (
            <div key={m.clientMsgId ?? m.serverMsgId ?? i} className={`row ${mine ? "me" : "them"}`}>
              <div className="bubble">{m.content}</div>
              <div className="meta">
                {mine
                  ? m.status === "sending" ? "发送中…" : m.status === "sent" ? `已送达 ✓ · seq#${m.convSeq}` : m.status === "failed" ? "发送失败 ✗" : ""
                  : `来自 ${m.from} · seq#${m.convSeq}`}
              </div>
            </div>
          );
        })}
      </div>
      <footer>
        <input
          value={input}
          placeholder="输入消息，回车发送…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button onClick={send}>发送</button>
      </footer>
    </div>
  );
}
