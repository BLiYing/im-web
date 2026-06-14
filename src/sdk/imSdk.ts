// IMClient —— Web 端协议 SDK（对应 iOS 的 IMSocketManager）。
// 职责：登录换 token、WebSocket 连接、收发、心跳、重连、增量同步、回执；不含任何 UI。
// 默认走同源相对路径（开发期由 Vite 代理到后端，见 vite.config.ts）。

import { T, type Envelope, type ChatMessage } from "./protocol";

const PING_INTERVAL_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type ConnState = "disconnected" | "connecting" | "connected";

export interface IMClientHandlers {
  onState?: (state: ConnState) => void;
  onMessage?: (msg: ChatMessage) => void;
  /** 发送结果：成功时带 server 分配的 convSeq。 */
  onAck?: (clientMsgId: string, ok: boolean, convSeq: number) => void;
}

export class IMClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private uid = "";
  private state: ConnState = "disconnected";
  private pingTimer: number | null = null;
  private reconnectAttempts = 0;
  private manualClose = false;
  private syncedSeq = new Map<string, number>(); // convId -> 已同步到的最大 conv_seq
  private tracked = new Set<string>(); // 重连后需增量同步的会话
  private handlers: IMClientHandlers;

  constructor(handlers: IMClientHandlers = {}) {
    this.handlers = handlers;
  }

  get currentState(): ConnState {
    return this.state;
  }
  get userId(): string {
    return this.uid;
  }

  /** 连接：先登录换 token，再用 ?token= 连 ws。 */
  async connect(uid: string): Promise<void> {
    this.uid = uid;
    this.manualClose = false;
    await this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    this.stopPing();
    this.ws?.close(1000);
    this.ws = null;
    this.setState("disconnected");
  }

  /** 登记会话：每次（重）连成功后自动从已同步位点发 sync_req 补回缺失/离线消息。 */
  trackConversation(convId: string): void {
    if (!convId) return;
    this.tracked.add(convId);
    if (this.state === "connected") this.sendSyncReq([convId]);
  }

  /** 发送文本，返回 client_msg_id。 */
  sendText(content: string, to: string, convId: string): string {
    const clientMsgId = crypto.randomUUID();
    const env: Envelope = {
      type: T.SEND_MSG,
      seq: ++this.seq,
      data: { client_msg_id: clientMsgId, conv_id: convId, to, content_type: "text", content },
    };
    this.send(env);
    return clientMsgId;
  }

  // ---- 内部 ----

  private async openSocket(): Promise<void> {
    this.setState("connecting");
    let token: string;
    try {
      const resp = await fetch("/api/v1/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: this.uid }),
      });
      const body = await resp.json();
      if (body.code !== 0 || !body.data?.token) {
        throw new Error(body.message || "login failed");
      }
      token = body.data.token;
    } catch (e) {
      if (!this.manualClose) this.scheduleReconnect();
      return;
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.startPing();
      this.sendSyncReq([...this.tracked]); // 重连补偿
    };
    ws.onmessage = (ev) => this.onFrame(ev.data);
    ws.onclose = () => {
      this.stopPing();
      this.setState("disconnected");
      if (!this.manualClose) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private onFrame(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    const d = env.data || {};
    switch (env.type) {
      case T.ACK:
        this.updateSynced(d.conv_id, d.conv_seq);
        this.handlers.onAck?.(d.client_msg_id, true, d.conv_seq);
        break;
      case T.NEW_MSG:
        this.processIncoming(d);
        break;
      case T.SYNC_RESP:
        for (const conv of d.conversations || []) {
          for (const m of conv.messages || []) this.processIncoming(m);
          if (conv.has_more && conv.conv_id) this.sendSyncReq([conv.conv_id]);
        }
        break;
      case T.PONG:
        break;
      case T.ERROR:
        // 业务错误：code/message（见 errcode）。此处简单忽略，UI 可订阅扩展。
        break;
    }
  }

  private processIncoming(d: any): void {
    const msg: ChatMessage = {
      serverMsgId: d.server_msg_id,
      convId: d.conv_id,
      from: d.from,
      content: typeof d.content === "string" ? d.content : "",
      contentType: d.content_type || "text",
      convSeq: d.conv_seq || 0,
      timestamp: d.timestamp || 0,
      status: "received",
    };
    this.updateSynced(msg.convId, msg.convSeq);
    this.sendReceipt(msg.convId, msg.convSeq);
    this.handlers.onMessage?.(msg);
  }

  private sendReceipt(convId: string, upTo: number): void {
    if (!convId) return;
    this.send({ type: T.RECEIPT, data: { conv_id: convId, status: "delivered", up_to_conv_seq: upTo } });
  }

  private sendSyncReq(convIds: string[]): void {
    const cursors = convIds.map((c) => ({ conv_id: c, since_conv_seq: this.syncedSeq.get(c) ?? 0 }));
    if (cursors.length === 0) return;
    this.send({ type: T.SYNC_REQ, seq: ++this.seq, data: { cursors } });
  }

  private updateSynced(convId: string, seq: number): void {
    if (!convId || !seq) return;
    if (seq > (this.syncedSeq.get(convId) ?? 0)) this.syncedSeq.set(convId, seq);
  }

  private send(env: Envelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(env));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.send({ type: T.PING, seq: ++this.seq }), PING_INTERVAL_MS);
  }
  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    window.setTimeout(() => {
      if (!this.manualClose) void this.openSocket();
    }, delay);
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    this.handlers.onState?.(s);
  }
}
