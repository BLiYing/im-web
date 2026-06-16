import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IMClient, registerAccount, type ConnState } from "./sdk/imSdk";
import { convIdFor, type ChatMessage, type Conversation, type FriendEntry, type UserCard } from "./sdk/protocol";

type Phase = "login" | "app"; // 登录页 / 双栏主界面（左列表 + 右聊天，Telegram 桌面式）
type Tab = "chats" | "contacts"; // 左栏顶部：会话列表 / 通讯录

export default function App() {
  const [phase, setPhase] = useState<Phase>("login");
  const [uid, setUid] = useState("1001");
  const [password, setPassword] = useState(""); // 登录密码（空=走开发期免密）
  const [authBusy, setAuthBusy] = useState(false); // 登录/注册请求进行中
  const [authErr, setAuthErr] = useState(""); // 登录/注册错误文案
  const [state, setState] = useState<ConnState>("disconnected");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [msgsByConv, setMsgsByConv] = useState<Record<string, ChatMessage[]>>({});
  const [peer, setPeer] = useState("");
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState<Record<string, string>>({}); // user -> online/offline
  const [peerReadSeq, setPeerReadSeq] = useState<Record<string, number>>({}); // convId -> 对端已读位点
  const [typingConv, setTypingConv] = useState<string | null>(null);
  const [entryUnread, setEntryUnread] = useState(0); // 进会话时的未读数（红点/↓N 计数，服务端 cap 999）
  const [entryReadSeq, setEntryReadSeq] = useState(0); // 进会话时的已读位点（精确定位未读分割线，CHAT_UX §4）
  const [showJump, setShowJump] = useState(false); // 右下角"跳到底部"按钮是否显示
  const [jumpCount, setJumpCount] = useState(0); // 按钮上的未读条数
  const [menu, setMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 长按/右键菜单
  const [tab, setTab] = useState<Tab>("chats"); // 左栏当前 Tab：会话 / 通讯录
  const [friends, setFriends] = useState<FriendEntry[]>([]); // 全量好友/申请关系（含 pending/requested/accepted）
  const [searchQ, setSearchQ] = useState(""); // 找人搜索框
  const [searchResults, setSearchResults] = useState<UserCard[] | null>(null); // null=未搜索；[]=搜过无结果
  const [busyUser, setBusyUser] = useState<string | null>(null); // 正在执行好友动作的对端 uid（防重复点击）
  const [profileDraft, setProfileDraft] = useState<{ nickname: string; avatar_url: string; phone: string; tags: string } | null>(null); // 编辑资料弹窗（null=关闭）
  const [profileBusy, setProfileBusy] = useState(false);
  const [friendMenu, setFriendMenu] = useState<{ x: number; y: number; userId: string } | null>(null); // 好友行 ⋯ 菜单

  const clientRef = useRef<IMClient | null>(null);
  const seenByConv = useRef<Record<string, Set<number>>>({});
  const currentConvRef = useRef<string>(""); // 当前打开的会话（供消息回调判断是否标记已读）
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef<number>(0);
  const msgsRef = useRef<HTMLDivElement>(null); // 消息滚动容器
  const dividerRef = useRef<HTMLDivElement>(null); // 未读分割线（进会话定位用）
  const histAnchorRef = useRef<{ h: number; t: number } | null>(null); // 上滚加载历史前的滚动锚点（保位）
  const pendingScrollRef = useRef(false); // 刚进会话，待定位到未读/底部
  const wasNearBottomRef = useRef(true); // 追加消息前用户是否贴近底部
  const prevMaxSeqRef = useRef(0); // 上次渲染的最大 conv_seq（判断底部是否来了更新的消息）
  const entryUnreadRef = useRef(0); // 进会话时的未读数（按钮初始计数）
  const prevMinSeqRef = useRef(0); // 上次渲染的最小 conv_seq（判断顶部是否插了更早历史）
  const loadingOlderRef = useRef(false); // 是否正在上滚加载更早历史
  const loadingNewerRef = useRef(false); // 是否正在下滚加载更新历史
  const latestSeqRef = useRef(0); // 该会话服务端最新 conv_seq（判断下方是否还有未加载）
  const forceBottomRef = useRef(false); // jumpToBottom 触发的"强制定位到底"（忽略未读分割线）
  const maxReadReportedRef = useRef(0); // 已上报的最大已读 conv_seq（可见即读，单调不回退）
  const pendingReadRef = useRef(0); // 已滚入视口的最大 conv_seq（节流后上报）
  const readTimerRef = useRef<number | null>(null); // 可见即读上报的节流定时器

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

  const refreshFriends = useCallback(async () => {
    try {
      const list = await clientRef.current?.listFriends();
      if (list) setFriends(list);
    } catch {
      /* 忽略：通讯录加载失败不阻断主流程 */
    }
  }, []);

  const doSearch = useCallback(async () => {
    const q = searchQ.trim();
    if (!q) { setSearchResults(null); return; }
    try {
      const users = await clientRef.current?.searchUsers(q);
      setSearchResults(users ?? []);
    } catch (e) {
      alert(`搜索失败：${(e as Error).message}`);
    }
  }, [searchQ]);

  // 好友动作（申请/同意/拒绝/删除）统一走这里：执行 → 刷新关系 → 解锁按钮。
  const doFriendAction = useCallback(async (userId: string, fn: () => Promise<void>) => {
    setBusyUser(userId);
    try {
      await fn();
      await refreshFriends();
    } catch (e) {
      alert(`操作失败：${(e as Error).message}`);
    } finally {
      setBusyUser(null);
    }
  }, [refreshFriends]);

  // 打开"编辑资料"弹窗：拉本人资料填入草稿（tags 以空格连接成可编辑串）。
  const openProfile = useCallback(async () => {
    try {
      const p = await clientRef.current?.fetchMyProfile();
      // phone 后端是 omitempty：空时 JSON 无该键 → undefined，须兜底为 ""，否则 input 由非受控变受控告警。
      if (p) setProfileDraft({ nickname: p.nickname ?? "", avatar_url: p.avatar_url ?? "", phone: p.phone ?? "", tags: (p.tags ?? []).join(" ") });
    } catch (e) {
      alert(`加载资料失败：${(e as Error).message}`);
    }
  }, []);

  // 保存资料：tags 按空格/逗号切分去空，PUT 整体替换。
  const saveProfile = useCallback(async () => {
    if (!profileDraft) return;
    setProfileBusy(true);
    try {
      await clientRef.current?.updateMyProfile({
        nickname: profileDraft.nickname.trim(),
        avatar_url: profileDraft.avatar_url.trim(),
        phone: profileDraft.phone.trim(),
        tags: profileDraft.tags.split(/[\s,]+/).filter(Boolean),
      });
      setProfileDraft(null);
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileDraft]);

  const enterApp = useCallback(async (pwd: string) => {
    if (!uid) {
      setAuthErr("请填写用户名");
      return;
    }
    setAuthBusy(true);
    setAuthErr("");
    const client = new IMClient({
      onState: setState,
      onMessage: (m) => {
        const seen = (seenByConv.current[m.convId] ??= new Set());
        if (m.convSeq > 0) {
          if (seen.has(m.convSeq)) return;
          seen.add(m.convSeq);
        }
        appendMsg(m.convId, m);
        // 可见即读：不在收到时立即标已读；新消息若落在视口内（贴底）会由滚动/布局后的 markVisibleRead 读到，
        // 在上方看历史时则不读，留到滚下去再读。
        // 任何对端来信都刷新会话列表（双栏下列表常驻：更新最后一条/排序/红点）。
        if (m.from !== uid) void refreshConversations();
      },
      onAck: (clientMsgId, ok, convSeq) => {
        setMsgsByConv((prev) => {
          const out: Record<string, ChatMessage[]> = {};
          for (const [cid, list] of Object.entries(prev)) {
            out[cid] = list.map((m) => {
              if (m.clientMsgId !== clientMsgId) return m;
              // 防 sync_resp/carbon 重复回显自己发的：把 ack 拿到的 conv_seq 登记进去重集
              // （new_msg/sync 无 client_msg_id，只能按 conv_seq 去重；与 iOS handleSendResult 一致）。
              if (ok && convSeq > 0) (seenByConv.current[cid] ??= new Set()).add(convSeq);
              return { ...m, status: ok ? "sent" : "failed", convSeq };
            });
          }
          return out;
        });
        // 自己发送成功 → 刷新列表：新发起的会话首条消息后即出现在左侧、更新最后一条。
        if (ok) void refreshConversations();
      },
      onReceipt: (convId, from, status, upToSeq) => {
        if (status === "read" && from !== uid) {
          setPeerReadSeq((prev) => ({ ...prev, [convId]: Math.max(prev[convId] ?? 0, upToSeq) }));
          // 对端已读 → 刷新左侧列表，让"我发的最后一条"在列表里也即时变绿✓✓（否则要切会话才更新）。
          void refreshConversations();
        }
      },
      onPresence: (user, status) => setPresence((prev) => ({ ...prev, [user]: status })),
      onTyping: (convId, from) => {
        if (from === uid) return;
        setTypingConv(convId);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setTypingConv(null), 3000);
      },
      // 好友关系实时变更：刷新通讯录（"新的朋友"红点/列表即时更新，无需切 Tab）。
      onFriend: () => { void refreshFriends(); },
    });
    clientRef.current = client;
    try {
      await client.connect(uid, pwd); // 首次登录失败（密码错误等）会抛错
    } catch (e) {
      clientRef.current = null;
      setAuthBusy(false);
      setAuthErr((e as Error).message || "登录失败");
      return;
    }
    await refreshConversations();
    void refreshFriends(); // 拉好友关系：让"通讯录"Tab 的新申请红点即时显示
    setAuthBusy(false);
    setPhase("app");
  }, [uid, appendMsg, refreshConversations, refreshFriends]);

  // 注册账号（用户名+密码，密码≥6位）→ 成功后直接登录。
  const doRegister = useCallback(async () => {
    if (!uid || password.length < 6) {
      setAuthErr("用户名必填，密码至少 6 位");
      return;
    }
    setAuthBusy(true);
    setAuthErr("");
    try {
      await registerAccount(uid, password);
    } catch (e) {
      setAuthBusy(false);
      setAuthErr((e as Error).message || "注册失败");
      return;
    }
    await enterApp(password); // 注册成功 → 直接用同一密码登录
  }, [uid, password, enterApp]);

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
    // 进会话即用服务端已知的对端已读位点给聊天详情播种（否则只靠实时回执：对方早前已读、本标签页没在场时，
    // 列表显✓✓而详情仍显✓）。取较大值，避免覆盖刚到的更新回执。
    setPeerReadSeq((prev) => ({ ...prev, [cid]: Math.max(prev[cid] ?? 0, conv?.peer_read_seq ?? 0) }));
    setEntryUnread(conv?.unread ?? 0);
    entryUnreadRef.current = conv?.unread ?? 0;
    setEntryReadSeq(readSeq);
    latestSeqRef.current = latestSeq;
    pendingScrollRef.current = true;
    forceBottomRef.current = false;
    setShowJump(false);
    setJumpCount(0);
    // 可见即读：已读起点=进入前位点；只有滚入视口超过它的消息才上报（见 markVisibleRead）。
    maxReadReportedRef.current = readSeq;
    pendingReadRef.current = readSeq;
    clientRef.current?.openConversation(cid, readSeq, latestSeq); // 加载锚点窗口，余下双向分页
    void refreshConversations(); // 选会话后刷新列表（更新其他会话 / 排序）
  }, [uid, conversations, refreshConversations]);

  const logout = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    seenByConv.current = {};
    currentConvRef.current = "";
    setConversations([]);
    setMsgsByConv({});
    setPresence({});
    setPeerReadSeq({});
    setFriends([]);
    setSearchResults(null);
    setSearchQ("");
    setTab("chats");
    setPassword("");
    setAuthErr("");
    setPhase("login");
  }, []);

  const deselect = useCallback(() => {
    currentConvRef.current = "";
    setPeer("");
    setTypingConv(null);
    void refreshConversations();
  }, [refreshConversations]);

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

  // 本地删除一条消息（仅本端：从内存列表 + 去重集移除，不影响对端）。
  const deleteMessage = useCallback((m: ChatMessage) => {
    setMsgsByConv((prev) => {
      const list = (prev[m.convId] ?? []).filter((x) =>
        m.clientMsgId ? x.clientMsgId !== m.clientMsgId : x.convSeq !== m.convSeq
      );
      return { ...prev, [m.convId]: list };
    });
    if (m.convSeq > 0) seenByConv.current[m.convId]?.delete(m.convSeq);
    setMenu(null);
  }, []);

  const copyMessage = useCallback((m: ChatMessage) => {
    void navigator.clipboard?.writeText(m.content);
    setMenu(null);
  }, []);

  // 菜单打开时：点空白/滚动/Esc 关闭。
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // 好友 ⋯ 菜单：点空白 / Esc 关闭。
  useEffect(() => {
    if (!friendMenu) return;
    const close = () => setFriendMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFriendMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [friendMenu]);

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

  // 进会话定位 / 新消息贴底 / 顶部插历史保位 / 在上看历史累加跳转计数（纯 DOM 滚动）。
  useLayoutEffect(() => {
    if (phase !== "app" || !convId) return;
    const box = msgsRef.current;
    if (!box) return;
    const curMin = minSeqOf(messages);
    const curMax = maxSeqOf(messages);

    if (pendingScrollRef.current) {
      if (messages.length === 0) return; // 等锚点窗口到达再定位
      if (firstUnreadIdx >= 0 && !forceBottomRef.current && dividerRef.current) {
        dividerRef.current.scrollIntoView({ block: "start" }); // 停在首条未读（分割线在其上方）
        // 定位后实测是否已贴底：未读不多、整屏放得下时分割线滚到顶仍贴底 → 不显示 ↓N（CHAT_UX §7）。
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        wasNearBottomRef.current = nearBottom;
        setShowJump(!nearBottom && entryUnreadRef.current > 0);
        setJumpCount(nearBottom ? 0 : entryUnreadRef.current);
      } else {
        box.scrollTop = box.scrollHeight; // 无未读 / 强制到底
        wasNearBottomRef.current = true;
        setShowJump(false);
      }
      pendingScrollRef.current = false;
      forceBottomRef.current = false;
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    const wasLoadingNewer = loadingNewerRef.current;
    if (curMin < prevMinSeqRef.current) loadingOlderRef.current = false;
    if (curMax > prevMaxSeqRef.current) loadingNewerRef.current = false;

    // 顶部插入更早历史 → 用插入前后的 scrollHeight 差补偿，保持视觉位置不跳。
    if (curMin < prevMinSeqRef.current && curMax <= prevMaxSeqRef.current) {
      if (histAnchorRef.current) {
        box.scrollTop = box.scrollHeight - histAnchorRef.current.h + histAnchorRef.current.t;
        histAnchorRef.current = null;
      }
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 下滚分页加载的更新历史（≤ latest）：插在下方，位置不动。
    if (curMax > prevMaxSeqRef.current && curMax <= latestSeqRef.current && wasLoadingNewer) {
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 真·新消息（live）或自己发送。
    const newPeer = messages.filter((m) => m.from !== uid && m.convSeq > prevMaxSeqRef.current).length;
    const lastMine = messages[messages.length - 1]?.from === uid;
    prevMinSeqRef.current = curMin;
    prevMaxSeqRef.current = curMax;
    if (curMax > latestSeqRef.current) latestSeqRef.current = curMax;

    if (lastMine) {
      box.scrollTop = box.scrollHeight;
      wasNearBottomRef.current = true;
      setShowJump(false);
      setJumpCount(0);
    } else if (newPeer > 0) {
      if (wasNearBottomRef.current) {
        box.scrollTop = box.scrollHeight;
        setShowJump(false);
        setJumpCount(0);
      } else {
        setJumpCount((n) => n + newPeer);
        setShowJump(true);
      }
    }
  }, [phase, convId, messages.length, uid, firstUnreadIdx]);

  // 可见即读（CHAT_UX §6 完整语义）：扫描在视口内的消息，取最大 conv_seq；超过已滚入位点则节流上报。
  // 同时把"↓N"更新为视口下方仍未读的对端消息数（随滚动递减，滚到底为 0）。
  const markVisibleRead = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    const boxBottom = box.getBoundingClientRect().bottom;
    const items = box.querySelectorAll<HTMLElement>(".msg-item[data-seq]");
    let maxSeq = 0;
    items.forEach((el) => {
      const seq = Number(el.dataset.seq);
      // 元素顶部已进入容器可见底边 → 视为已滚入（被看到过）；其中最大 seq = 当前看到的最深位置。
      if (seq > 0 && el.getBoundingClientRect().top < boxBottom) maxSeq = Math.max(maxSeq, seq);
    });
    if (maxSeq > pendingReadRef.current) {
      pendingReadRef.current = maxSeq;
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
      readTimerRef.current = window.setTimeout(() => {
        if (pendingReadRef.current > maxReadReportedRef.current) {
          maxReadReportedRef.current = pendingReadRef.current;
          clientRef.current?.markRead(currentConvRef.current, maxReadReportedRef.current);
          void refreshConversations(); // 已读推进后刷新左侧列表，红点未读数随滚动递减
        }
      }, 300);
    }
    // ↓N = 视口下方仍未读的对端消息数（conv_seq 超过已滚入位点、且是对端消息）。
    let below = 0;
    items.forEach((el) => {
      if (Number(el.dataset.seq) > pendingReadRef.current && el.querySelector(".row.them")) below++;
    });
    setJumpCount(below);
  }, [refreshConversations]);

  // 进会话/新消息渲染后扫一遍可见消息（覆盖"整屏放得下、不触发滚动"的短会话；滚动另由 onMsgsScroll 处理）。
  useEffect(() => {
    if (phase === "app" && convId) markVisibleRead();
  }, [phase, convId, messages.length, markVisibleRead]);

  const onMsgsScroll = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    markVisibleRead(); // 可见即读：滚到哪、读到哪
    const cid = currentConvRef.current;
    const list = msgsByConv[cid] ?? [];
    const nearBottomPx = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const newest = maxSeqOf(list);
    const oldest = minSeqOf(list);
    const moreBelow = newest < latestSeqRef.current; // 下方还有未加载的更新历史
    const atTrueBottom = nearBottomPx && !moreBelow;
    wasNearBottomRef.current = atTrueBottom;
    setShowJump(!atTrueBottom);
    if (atTrueBottom) setJumpCount(0);

    const busy = loadingOlderRef.current || loadingNewerRef.current;
    if (nearBottomPx && moreBelow && !busy) {
      loadingNewerRef.current = true; // 下滚到底 → 加载更新一页
      clientRef.current?.loadNewer(cid, newest);
    } else if (box.scrollTop < 120 && oldest > 1 && !busy) {
      loadingOlderRef.current = true; // 上滚到顶 → 加载更早一页（保位）
      histAnchorRef.current = { h: box.scrollHeight, t: box.scrollTop };
      clientRef.current?.loadOlder(cid, oldest);
    }
  }, [msgsByConv]);

  const jumpToBottom = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    const cid = currentConvRef.current;
    const newest = maxSeqOf(msgsByConv[cid] ?? []);
    if (newest < latestSeqRef.current) {
      // 下方还有大段未加载 → 重载最近一页再贴底。
      setEntryUnread(0);
      forceBottomRef.current = true;
      pendingScrollRef.current = true;
      clientRef.current?.openConversation(cid, latestSeqRef.current, latestSeqRef.current);
    } else {
      box.scrollTop = box.scrollHeight;
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
        <label>用户名<input value={uid} autoFocus onChange={(e) => setUid(e.target.value.trim())} /></label>
        <label>密码<input type="password" value={password} placeholder="≥ 6 位"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void enterApp(password); }} /></label>
        {authErr && <p className="auth-err">{authErr}</p>}
        <button disabled={authBusy} onClick={() => void enterApp(password)}>登录</button>
        <button className="secondary" disabled={authBusy} onClick={() => void doRegister()}>注册并登录</button>
        <p className="hint">
          真账号密码登录。先启动后端 <code>go run ./cmd/imserver</code>。<br />
          仅调试：<button className="link-inline" disabled={authBusy} onClick={() => void enterApp("")}>免密登录</button>（需后端开启 dev-login）。
        </p>
      </div>
    );
  }

  // ---- 双栏主界面（左会话列表常驻 + 右聊天详情） ----
  const readSeq = peerReadSeq[convId] ?? 0;
  const peerOnline = presence[peer] === "online";

  // 通讯录派生：我对每个对端的关系状态、收到的申请、已是好友、新申请红点数。
  const friendStatus = new Map(friends.map((f) => [f.user_id, f.status]));
  const incoming = friends.filter((f) => f.status === "pending"); // 别人申请我，待我同意/拒绝
  const accepted = friends.filter((f) => f.status === "accepted").sort((a, b) => b.updated_at - a.updated_at);
  const incomingCount = incoming.length;
  const labelOf = (id: string, nick: string) => (nick && nick.trim()) || id; // 有昵称显昵称，否则显 uid
  const openFriendChat = (id: string) => { setTab("chats"); openChat(id); };

  return (
    <div className={`app ${peer ? "has-sel" : "no-sel"}`}>
      <aside className="sidebar">
        <header>
          <span>{uid} · {stateText}</span>
          <span className="header-actions">
            <button className="link" onClick={() => void openProfile()}>资料</button>
            <button className="link" onClick={logout}>退出</button>
          </span>
        </header>
        <div className="tabs">
          <button className={`tab ${tab === "chats" ? "active" : ""}`} onClick={() => setTab("chats")}>会话</button>
          <button className={`tab ${tab === "contacts" ? "active" : ""}`}
            onClick={() => { setTab("contacts"); void refreshFriends(); }}>
            通讯录{incomingCount > 0 && <span className="tab-badge">{incomingCount > 99 ? "99+" : incomingCount}</span>}
          </button>
        </div>
        {tab === "chats" ? (
        <div className="convlist">
          {conversations.length === 0 && <div className="empty">还没有会话，去「通讯录」找人发起一个吧</div>}
          {conversations.map((c) => (
            <div key={c.conv_id} className={`convitem ${c.peer === peer ? "active" : ""}`} onClick={() => openChat(c.peer)}>
              <div className="avatar">
                {c.peer.slice(-2)}
                {presence[c.peer] === "online" && <span className="presence-dot" />}
              </div>
              <div className="convbody">
                <div className="convtop">
                  <span className="convpeer">{c.peer}</span>
                  <span className="convtime">
                    {c.last_message?.from === uid && (
                      <span className={c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "convck read" : "convck"}>
                        {c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "✓✓ " : "✓ "}
                      </span>
                    )}
                    {c.last_message ? fmtTime(c.last_message.timestamp) : ""}
                  </span>
                </div>
                <div className="convlast">{c.last_message?.content ?? "（无消息）"}</div>
              </div>
              {c.unread > 0 && <span className="badge">{c.unread > 99 ? "99+" : c.unread}</span>}
            </div>
          ))}
        </div>
        ) : (
        <div className="contacts">
          <div className="newchat">
            <input value={searchQ} placeholder="对方完整 uid 或手机号"
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }} />
            <button onClick={() => void doSearch()}>搜索</button>
          </div>
          <div className="convlist">
            {searchResults !== null && (
              <>
                <div className="section-label">搜索结果</div>
                {searchResults.length === 0 && <div className="empty">没有找到匹配的用户</div>}
                {searchResults.map((u) => {
                  const st = friendStatus.get(u.user_id);
                  return (
                    <div key={`s-${u.user_id}`} className="convitem static">
                      <div className="avatar">{labelOf(u.user_id, u.nickname).slice(-2)}</div>
                      <div className="convbody">
                        <div className="convpeer">{labelOf(u.user_id, u.nickname)}</div>
                        <div className="convlast">{u.user_id}{u.tags.length > 0 ? ` · ${u.tags.join(" ")}` : ""}</div>
                      </div>
                      <div className="row-actions">
                        {st === "accepted" ? (
                          <button className="mini-btn" onClick={() => openFriendChat(u.user_id)}>发消息</button>
                        ) : st === "requested" ? (
                          <button className="mini-btn ghost" disabled>已申请</button>
                        ) : st === "pending" ? (
                          <button className="mini-btn" disabled={busyUser === u.user_id}
                            onClick={() => void doFriendAction(u.user_id, () => clientRef.current!.friendAction("accept", u.user_id))}>同意</button>
                        ) : st === "blocked" ? (
                          <button className="mini-btn ghost" disabled>已拉黑</button>
                        ) : (
                          <button className="mini-btn" disabled={busyUser === u.user_id}
                            onClick={() => void doFriendAction(u.user_id, () => clientRef.current!.friendAction("request", u.user_id))}>加好友</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {incoming.length > 0 && (
              <>
                <div className="section-label">新的朋友（{incoming.length}）</div>
                {incoming.map((f) => (
                  <div key={`p-${f.user_id}`} className="convitem static">
                    <div className="avatar">{labelOf(f.user_id, f.nickname).slice(-2)}</div>
                    <div className="convbody">
                      <div className="convpeer">{labelOf(f.user_id, f.nickname)}</div>
                      <div className="convlast">请求加你为好友</div>
                    </div>
                    <div className="row-actions">
                      <button className="mini-btn" disabled={busyUser === f.user_id}
                        onClick={() => void doFriendAction(f.user_id, () => clientRef.current!.friendAction("accept", f.user_id))}>同意</button>
                      <button className="mini-btn ghost" disabled={busyUser === f.user_id}
                        onClick={() => void doFriendAction(f.user_id, () => clientRef.current!.friendAction("reject", f.user_id))}>拒绝</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="section-label">好友（{accepted.length}）</div>
            {accepted.length === 0 && <div className="empty">还没有好友，上面搜索用户添加吧</div>}
            {accepted.map((f) => (
              <div key={`f-${f.user_id}`} className="convitem" onClick={() => openFriendChat(f.user_id)}>
                <div className="avatar">
                  {labelOf(f.user_id, f.nickname).slice(-2)}
                  {presence[f.user_id] === "online" && <span className="presence-dot" />}
                </div>
                <div className="convbody">
                  <div className="convpeer">{labelOf(f.user_id, f.nickname)}</div>
                  <div className="convlast">{f.user_id}</div>
                </div>
                <div className="row-actions">
                  <button className="mini-btn ghost" title="更多"
                    onClick={(e) => { e.stopPropagation(); setFriendMenu({ x: e.clientX, y: e.clientY, userId: f.user_id }); }}>⋯</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
      </aside>

      {/* chat 面板始终挂载（即使未选会话），让 VList 在 app 加载时就测到稳定高度；
          未选会话时用 .main-empty 覆盖层遮住。否则条件挂载会让 virtua 在布局未定时测到 0。 */}
      <main className="main">
        <div className="chat">
          <header>
            {peer && <button className="link back-btn" onClick={deselect}>‹ 会话</button>}
            {peer ? (
              <span>
                <span className={`dot ${peerOnline ? "on" : ""}`} /> {peer}
                {peerOnline ? "（在线）" : ""}
              </span>
            ) : (
              <span className="muted">未选择会话</span>
            )}
            <span className="muted">{stateText}</span>
          </header>
          <div className="msgs" ref={msgsRef} onScroll={onMsgsScroll}>
            {messages.map((m, i) => {
              const mine = m.from === uid;
              const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
              const showDate = m.timestamp > 0 && (i === 0 || !isSameDay(m.timestamp, messages[i - 1].timestamp));
              return (
                <div className="msg-item" data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                  {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                  {i === firstUnreadIdx && (
                    <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                  )}
                  <div className={`row ${mine ? "me" : "them"}`}>
                    <div className="bubble"
                      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }}>
                      <span className="btext">{m.content}</span>
                      <span className="bmeta">
                        {mine ? (
                          m.status === "sending" ? "发送中…"
                            : m.status === "failed" ? <span className="failed">发送失败 ✗</span>
                              : <>{fmtTime(m.timestamp)}<span className={readByPeer ? "ck read" : "ck"}>{readByPeer ? " ✓✓" : " ✓"}</span></>
                        ) : (
                          fmtTime(m.timestamp)
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {showJump && peer && (
            <button className="jump-btn" onClick={jumpToBottom} title="跳到最新消息">
              ↓{jumpCount > 0 && <span className="jump-badge">{jumpCount > 99 ? "99+" : jumpCount}</span>}
            </button>
          )}
          {peer && typingConv === convId && <div className="typing">对方正在输入…</div>}
          <footer>
            <input value={input} placeholder={peer ? "输入消息，回车发送…" : "先选择左侧的会话…"} disabled={!peer}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
            <button onClick={send} disabled={!peer}>发送</button>
          </footer>
        </div>
        {!peer && <div className="main-empty">选择左侧的会话开始聊天</div>}
      </main>

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => copyMessage(menu.m)}>复制</button>
          <button className="danger" onClick={() => deleteMessage(menu.m)}>删除</button>
        </div>
      )}

      {friendMenu && (
        <div className="ctx-menu" style={{ left: friendMenu.x, top: friendMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.removeFriend(id)); }}>删除好友</button>
          <button className="danger" onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.friendAction("block", id)); }}>拉黑</button>
        </div>
      )}

      {profileDraft && (
        <div className="modal-mask" onClick={() => setProfileDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>编辑我的资料</h3>
            <label>昵称<input value={profileDraft.nickname} maxLength={32}
              onChange={(e) => setProfileDraft({ ...profileDraft, nickname: e.target.value })} /></label>
            <label>头像 URL<input value={profileDraft.avatar_url}
              onChange={(e) => setProfileDraft({ ...profileDraft, avatar_url: e.target.value })} /></label>
            <label>手机号<input value={profileDraft.phone}
              onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} /></label>
            <label>标签（空格或逗号分隔）<input value={profileDraft.tags}
              onChange={(e) => setProfileDraft({ ...profileDraft, tags: e.target.value })} /></label>
            <div className="modal-actions">
              <button className="link" onClick={() => setProfileDraft(null)}>取消</button>
              <button className="mini-btn" disabled={profileBusy} onClick={() => void saveProfile()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 两个毫秒时间戳是否同一自然日（聊天页按日期分组用）。
function isSameDay(a: number, b: number): boolean {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

// 毫秒时间戳 → 日期分隔文案：今天/昨天/M月d日（今年）/yyyy年M月d日（往年）。
function dayHeader(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(ts, now.getTime())) return "今天";
  if (isSameDay(ts, yesterday.getTime())) return "昨天";
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
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
