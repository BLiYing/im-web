import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IMClient, registerAccount, type ConnState } from "./sdk/imSdk";
import { convIdFor, type ChatMessage, type Conversation, type FriendEntry, type UserCard, type GroupInfo, type GroupMember, type GroupSummary, type Favorite } from "./sdk/protocol";
import { buildMessageActions, buildConversationActions, type MenuAction } from "./menus";
import { formatTime } from "./time";
import type { LucideIcon } from "lucide-react";
import {
  Settings, Bookmark, Settings2, Gauge, Bell, Database, Lock, Folder,
  MonitorSmartphone, Languages, Smile, Phone, AtSign, Users, Megaphone,
  Headphones, ChevronLeft, ChevronRight, SquarePen, Check,
  MoreVertical, Video, Ban, Trash2, CheckSquare, BellOff,
  Image as ImageIcon, UserPlus, LogOut, Info,
} from "lucide-react";

type Phase = "login" | "app"; // 登录页 / 双栏主界面（左列表 + 右聊天，Telegram 桌面式）
type Tab = "chats" | "contacts"; // 左栏顶部：会话列表 / 通讯录

// 可复用头像：有 avatar_url（http 或 data: 内联图）→ 渲染 <img>；否则回退首字母圈（现 Web 用统一主色底）。
// cls 决定尺寸（avatar / settings-avatar / edit-avatar）；children 作为叠加层（如在线点、相机角标）。
function Avatar({ url, label, cls = "avatar", children }: {
  url?: string; label: string; cls?: string; children?: React.ReactNode;
}) {
  return (
    <div className={cls}>
      {url ? <img className="avatar-img" src={url} alt="" /> : (label || "").slice(-2)}
      {children}
    </div>
  );
}

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
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null); // 正在引用回复的目标消息（撤回后清）
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null); // 正在编辑的消息（M4-5，编辑态）
  const [translations, setTranslations] = useState<Record<number, string>>({}); // convSeq -> 译文（挂气泡下，M4-5）
  const [forwarding, setForwarding] = useState<ChatMessage[] | null>(null); // 待转发的消息（打开会话选择器；null=关闭）
  const [favorites, setFavorites] = useState<Favorite[] | null>(null); // 收藏列表弹窗（null=关闭，M4-4）
  const [selectMode, setSelectMode] = useState(false); // 多选态
  const [selected, setSelected] = useState<Set<number>>(new Set()); // 已选消息的 convSeq 集合
  const [tab, setTab] = useState<Tab>("chats"); // 左栏当前 Tab：会话 / 通讯录
  const [friends, setFriends] = useState<FriendEntry[]>([]); // 全量好友/申请关系（含 pending/requested/accepted）
  const [searchQ, setSearchQ] = useState(""); // 找人搜索框
  const [searchResults, setSearchResults] = useState<UserCard[] | null>(null); // null=未搜索；[]=搜过无结果
  const [busyUser, setBusyUser] = useState<string | null>(null); // 正在执行好友动作的对端 uid（防重复点击）
  const [profileDraft, setProfileDraft] = useState<{ nickname: string; avatar_url: string; phone: string; tags: string } | null>(null); // 编辑资料弹窗（null=关闭）
  const [profileBusy, setProfileBusy] = useState(false);
  const [friendMenu, setFriendMenu] = useState<{ x: number; y: number; userId: string } | null>(null); // 好友行 ⋯ 菜单
  const [blockedList, setBlockedList] = useState<FriendEntry[] | null>(null); // 黑名单弹窗（null=关闭）
  const [convMenu, setConvMenu] = useState<{ x: number; y: number; c: Conversation } | null>(null); // 会话行右键菜单
  const [chatMenu, setChatMenu] = useState(false); // 聊天页右上 ⋮ 下拉菜单
  const [contactDraft, setContactDraft] = useState<{ peer: string; remark: string } | null>(null); // 编辑联系人（备注名）弹窗
  const [toast, setToast] = useState<string | null>(null); // 轻量浮层提示（如"xx（开发中）"）
  const [accountCard, setAccountCard] = useState(false); // 左上角头像气泡卡片
  const [showSettings, setShowSettings] = useState(false); // 设置面板（占据侧栏列，右侧聊天保留）
  const [myInfo, setMyInfo] = useState<{ nickname: string; phone: string; avatar_url: string } | null>(null); // 设置页顶部资料展示
  const [generalOpen, setGeneralOpen] = useState(false); // 通用设置子面板
  // 通用设置项：theme（主题）/ timeFormat（时间格式）/ fontSize（字体）/ sendKey（发送键）均已接通真功能（壁纸仍占位）。
  // ---- 群聊（M3-4）----
  const [groupConvId, setGroupConvId] = useState(""); // 当前打开的群会话 conv_id（"" = 单聊模式，peer 生效）
  const [groupInfos, setGroupInfos] = useState<Record<string, GroupInfo>>({}); // conv_id -> 群资料缓存（标题/气泡昵称回退/资料面板共用）
  const [groupPanel, setGroupPanel] = useState<string | null>(null); // 群资料弹窗（conv_id；null=关闭）
  const [groupsModal, setGroupsModal] = useState<GroupSummary[] | null>(null); // 通讯录「群聊」列表弹窗
  const [createDraft, setCreateDraft] = useState<{ name: string; selected: string[] } | null>(null); // 建群弹窗（群名 + 选中好友）
  const [createBusy, setCreateBusy] = useState(false);
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; convId: string; m: GroupMember } | null>(null); // 成员行 ⋯ 菜单
  const [inviteDraft, setInviteDraft] = useState<{ convId: string; selected: string[] } | null>(null); // 邀请成员弹窗
  const [typingFrom, setTypingFrom] = useState(""); // 正在输入的对端 uid（群聊显示"谁"在输入）
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => (localStorage.getItem("im.theme") as "light" | "dark" | "system") || "system");
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem("im.fontSize")) || 15);
  const [timeFormat, setTimeFormat] = useState<"12" | "24">(() => (localStorage.getItem("im.timeFormat") as "12" | "24") || "24");
  const [sendKey, setSendKey] = useState<"enter" | "cmd">(() => (localStorage.getItem("im.sendKey") as "enter" | "cmd") || "enter");

  const clientRef = useRef<IMClient | null>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null); // 隐藏的本机图片选择 input
  const composerRef = useRef<HTMLTextAreaElement>(null); // 聊天输入框（自适应高度 + 发送键策略）
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
  const prevLenRef = useRef(0); // 上次渲染的消息条数（区分"新增消息"与"原条状态变更"如被拒收）
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

  const refreshConversations = useCallback(async (): Promise<Conversation[]> => {
    try {
      const convs = await clientRef.current?.fetchConversations();
      if (convs) {
        setConversations(convs);
        clientRef.current?.cacheConversations(convs); // 缓存：刷新/离线先秒显
        return convs;
      }
    } catch {
      /* 忽略 */
    }
    return [];
  }, []);

  // 登录后从本地库（IndexedDB）预载各会话历史 → 打开会话即秒显，刷新不丢已下载的历史；
  // 同时把增量同步基线设为本地最大 conv_seq（无本地则用服务端 latest），实现"同步位点持久化"。
  const preloadLocal = useCallback(async (convs: Conversation[]) => {
    const client = clientRef.current;
    if (!client) return;
    const loaded: Record<string, ChatMessage[]> = {};
    for (const c of convs) {
      const local = await client.loadLocal(c.conv_id);
      const localMax = local.length ? local[local.length - 1].convSeq : 0;
      // 同步位点：有本地消息→从本地最大续传（重连不重拉历史）；无本地→从 latest（旧历史按需 openChat 再拉）。
      client.trackConversation(c.conv_id, localMax > 0 ? localMax : (c.latest_conv_seq ?? 0));
      if (local.length === 0) continue;
      loaded[c.conv_id] = local;
      const seen = (seenByConv.current[c.conv_id] ??= new Set());
      local.forEach((m) => m.convSeq > 0 && seen.add(m.convSeq)); // 防服务端同步重复回显
    }
    if (Object.keys(loaded).length) setMsgsByConv((prev) => ({ ...loaded, ...prev }));
  }, []);

  const refreshFriends = useCallback(async () => {
    try {
      const list = await clientRef.current?.listFriends();
      if (list) setFriends(list);
    } catch {
      /* 忽略：通讯录加载失败不阻断主流程 */
    }
  }, []);

  // 拉群资料进缓存（best-effort）：失败（被移出/群没了）则清缓存。返回最新资料或 null。
  const refreshGroupInfo = useCallback(async (cid: string): Promise<GroupInfo | null> => {
    try {
      const info = await clientRef.current?.fetchGroup(cid);
      if (info) setGroupInfos((prev) => ({ ...prev, [cid]: info }));
      return info ?? null;
    } catch {
      setGroupInfos((prev) => {
        const { [cid]: _drop, ...rest } = prev;
        return rest;
      });
      return null;
    }
  }, []);

  // 打开群会话：与 openChat 同一套进会话定位逻辑，只是标识从 peer 换成 conv_id。
  const openGroupChat = useCallback((cid: string) => {
    if (!cid) return;
    setPeer("");
    setGroupConvId(cid);
    currentConvRef.current = cid;
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
    maxReadReportedRef.current = readSeq;
    pendingReadRef.current = readSeq;
    clientRef.current?.openConversation(cid, readSeq, latestSeq);
    void refreshGroupInfo(cid); // 群资料：标题成员数 / 气泡昵称回退 / 资料面板
    void refreshConversations();
  }, [conversations, refreshConversations, refreshGroupInfo]);

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

  // 加载本人资料到 myInfo（左上角头像 / 设置页头部共用同一份数据）。失败静默回退首字母圈。
  const loadMyInfo = useCallback(async () => {
    try {
      const p = await clientRef.current?.fetchMyProfile();
      if (p) setMyInfo({ nickname: p.nickname ?? "", phone: p.phone ?? "", avatar_url: p.avatar_url ?? "" });
    } catch { /* 忽略：头像回退首字母圈 */ }
  }, []);

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

  // 打开黑名单弹窗：拉 status=blocked 的关系。
  const openBlacklist = useCallback(async () => {
    try {
      const list = await clientRef.current?.listFriends("blocked");
      setBlockedList(list ?? []);
    } catch (e) {
      alert(`加载黑名单失败：${(e as Error).message}`);
    }
  }, []);

  // 解除拉黑：unblock 后从弹窗列表移除。
  const unblock = useCallback(async (userId: string) => {
    setBusyUser(userId);
    try {
      await clientRef.current?.friendAction("unblock", userId);
      setBlockedList((prev) => (prev ?? []).filter((f) => f.user_id !== userId));
      void refreshFriends(); // 同步主好友态：聊天页"已拉黑"横幅随之消失、输入恢复

    } catch (e) {
      alert(`解除失败：${(e as Error).message}`);
    } finally {
      setBusyUser(null);
    }
  }, [refreshFriends]);

  // 保存资料：tags 按空格/逗号切分去空，PUT 整体替换。
  const saveProfile = useCallback(async () => {
    if (!profileDraft) return;
    setProfileBusy(true);
    try {
      const updated = await clientRef.current?.updateMyProfile({
        nickname: profileDraft.nickname.trim(),
        avatar_url: profileDraft.avatar_url.trim(),
        phone: profileDraft.phone.trim(),
        tags: profileDraft.tags.split(/[\s,]+/).filter(Boolean),
      });
      // 保存后刷新设置页顶部名片（否则头像/昵称仍显旧值）。
      if (updated) setMyInfo({ nickname: updated.nickname ?? "", phone: updated.phone ?? "", avatar_url: updated.avatar_url ?? "" });
      setProfileDraft(null);
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileDraft]);

  // 选本机图片做头像：<input type=file> 浏览器自动用当前系统(Mac/Windows/Linux)的原生文件框，无需检测系统。
  // 读图 → canvas 缩放到 ≤192px → JPEG data URL（超 240KB 再降质，保证 < 后端 256KB 上限）→ 存 avatar_url。
  const onPickAvatar = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setToast("读取图片失败，请重试");
    reader.onload = () => {
      const img = new Image();
      // 浏览器无法解码该格式（如 HEIC/HEIF）时 onload 不触发 → 提示换 JPG/PNG。
      img.onerror = () => setToast("无法识别该图片格式，请改用 JPG / PNG");
      img.onload = () => {
        const max = 192;
        let w = img.width, h = img.height;
        if (w >= h && w > max) { h = Math.round((h * max) / w); w = max; }
        else if (h > max) { w = Math.round((w * max) / h); h = max; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.82;
        let dataUrl = canvas.toDataURL("image/jpeg", q);
        while (dataUrl.length > 240 * 1024 && q > 0.4) { q -= 0.15; dataUrl = canvas.toDataURL("image/jpeg", q); }
        setProfileDraft((d) => (d ? { ...d, avatar_url: dataUrl } : d));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

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
      onAck: (clientMsgId, ok, convSeq, serverTs) => {
        setMsgsByConv((prev) => {
          const out: Record<string, ChatMessage[]> = {};
          for (const [cid, list] of Object.entries(prev)) {
            out[cid] = list.map((m) => {
              if (m.clientMsgId !== clientMsgId) return m;
              // 防 sync_resp/carbon 重复回显自己发的：把 ack 拿到的 conv_seq 登记进去重集
              // （new_msg/sync 无 client_msg_id，只能按 conv_seq 去重；与 iOS handleSendResult 一致）。
              if (ok && convSeq > 0) (seenByConv.current[cid] ??= new Set()).add(convSeq);
              // 成功后把时间戳换成服务器时间（消除"乐观发送用客户端钟"在排序上的时钟偏差）。
              return { ...m, status: ok ? "sent" : "failed", convSeq, timestamp: ok && serverTs ? serverTs : m.timestamp };
            });
          }
          return out;
        });
        // 自己发送成功 → 刷新列表：新发起的会话首条消息后即出现在左侧、更新最后一条。
        if (ok) void refreshConversations();
      },
      onReceipt: (convId, from, status, upToSeq) => {
        if (status !== "read") return;
        if (from === uid) {
          // 多端已读同步（M1）：我在另一端已读 → 本端列表未读清零（服务端已记位点，刷新即得）。
          void refreshConversations();
        } else {
          setPeerReadSeq((prev) => ({ ...prev, [convId]: Math.max(prev[convId] ?? 0, upToSeq) }));
          // 对端已读 → 刷新左侧列表，让"我发的最后一条"在列表里也即时变绿✓✓（否则要切会话才更新）。
          void refreshConversations();
        }
      },
      onPresence: (user, status) => setPresence((prev) => ({ ...prev, [user]: status })),
      onTyping: (convId, from) => {
        if (from === uid) return;
        setTypingConv(convId);
        setTypingFrom(from); // 群聊显示"谁"在输入
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setTypingConv(null), 3000);
      },
      // 好友关系实时变更：刷新通讯录（"新的朋友"红点/列表即时更新，无需切 Tab）。
      onFriend: () => { void refreshFriends(); },
      // 群成员/资料实时变更：刷新会话列表 + 该群资料缓存；自己被移出 → 提示并退出该会话。
      onGroup: (event, cid, _from, target) => {
        void refreshConversations();
        if (event !== "dissolve") void refreshGroupInfo(cid); // 被移出时 fetch 报 300203 → 自动清缓存；解散后群已不存在，无需再拉
        // 被移出（remove 且 target=自己）或群被解散（dissolve，管理端处置，对全体生效）→ 提示并退出该会话。
        if ((event === "remove" && target === uid) || event === "dissolve") {
          setToast(event === "dissolve" ? "该群已被解散" : "你已被移出群聊");
          setGroupPanel((p) => (p === cid ? null : p));
          if (currentConvRef.current === cid) {
            currentConvRef.current = "";
            setGroupConvId("");
          }
        }
      },
      // 某条消息被拒收（被拉黑）→ 标记该条发送失败 + 把原因挂到该条 note（微信式：红❗+下方居中系统行，不弹窗）。
      onMsgRejected: (clientMsgId, msg) => {
        setMsgsByConv((prev) => {
          const out: Record<string, ChatMessage[]> = {};
          for (const [cid, list] of Object.entries(prev)) {
            out[cid] = list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, status: "failed", note: msg } : m));
          }
          return out;
        });
      },
      // 消息操作（撤回/编辑/置顶）应用到某条消息（按 conv_seq 定位）→ 就地打补丁（撤回→墓碑，编辑→改文本）。
      onMsgOp: (cid, targetSeq, patch) => {
        setMsgsByConv((prev) => {
          const list = prev[cid];
          if (!list) return prev;
          return { ...prev, [cid]: list.map((m) => (m.convSeq === targetSeq ? { ...m, ...patch } : m)) };
        });
        void refreshConversations(); // 撤回后会话列表预览也要更新（"撤回了一条消息"）
      },
      // 我发起的操作被拒（如撤回超时 300008）→ toast 提示（不改消息本身）。
      onMsgOpFailed: (_op, _cid, _seq, msg) => setToast(msg),
      // 鉴权失效（账号没了/密码错/token 失效）→ 弹框让用户选，不强制踢走：
      // 确定→重新登录；取消→留在当前界面继续看本地聊天记录（socket 已停重连，不刷屏）。
      onAuthError: (msg) => {
        if (window.confirm(`${msg}。点"确定"重新登录；"取消"可继续查看本地聊天记录。`)) {
          logout();
          setAuthErr(msg); // logout 会清 authErr，故放其后
        }
      },
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
    // 先用缓存的会话列表 + 本地消息秒显（刷新/弱网即时可见）。
    const cached = client.cachedConversations();
    if (cached.length) {
      setConversations(cached);
      await preloadLocal(cached);
    }
    // 再拉服务端最新会话列表，预载本地消息并按本地位点增量同步补新消息。
    const convs = await refreshConversations();
    if (convs.length) await preloadLocal(convs);
    client.syncTracked(); // 从各会话本地/latest 基线补离线期间的新消息（持久化位点续传）
    void refreshFriends(); // 拉好友关系：让"通讯录"Tab 的新申请红点即时显示
    void loadMyInfo();     // 拉本人资料：左上角头像 / 设置页头部立即可用
    setAuthBusy(false);
    setPhase("app");
  }, [uid, appendMsg, refreshConversations, preloadLocal, refreshFriends, loadMyInfo, refreshGroupInfo]);

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
    setGroupConvId(""); // 切回单聊模式
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
    setGroupConvId("");
    setGroupInfos({});
    setGroupPanel(null);
    setGroupsModal(null);
    setPhase("login");
  }, []);

  const deselect = useCallback(() => {
    currentConvRef.current = "";
    setPeer("");
    setGroupConvId("");
    setTypingConv(null);
    void refreshConversations();
  }, [refreshConversations]);

  const send = useCallback(() => {
    const text = input.trim();
    const client = clientRef.current;
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    if (!text || !client || !cid) return;
    // 编辑态（M4-5）：发 msg_op edit 而非新消息；内容由服务端广播回 onMsgOp 更新。
    if (editingMsg && editingMsg.convSeq > 0) {
      client.editMessage(cid, editingMsg.convSeq, text);
      setEditingMsg(null); setInput("");
      return;
    }
    // 引用回复（M4-2）：带上目标 conv_seq + 本端即时快照（服务端会冻结权威快照给收件方）。
    const rt = replyTo && replyTo.convSeq > 0
      ? { convSeq: replyTo.convSeq, preview: (replyTo.content || "").slice(0, 60) }
      : undefined;
    const clientMsgId = client.sendText(text, peer, cid, rt ? { replyTo: rt } : undefined); // 群聊 to 为空：服务端按 conv_id 查成员写扩散
    appendMsg(cid, {
      clientMsgId, convId: cid, from: uid, content: text, contentType: "text",
      convSeq: 0, timestamp: Date.now(), status: "sending",
      replyToConvSeq: rt?.convSeq, replySnapshot: rt?.preview,
    });
    setInput("");
    setReplyTo(null);
  }, [input, peer, groupConvId, uid, appendMsg, replyTo, editingMsg]);

  // 引用某条消息（M4-2）：进入引用态（输入框上方显示引用条，发送时带上）。
  const replyMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    setReplyTo(m);
  }, []);

  // 收藏（M4-4）：内容快照到服务端（原消息撤回/删除后仍在），toast 反馈。
  const favoriteMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    void (async () => {
      try {
        await clientRef.current?.addFavorite({
          content_type: m.contentType, content: m.content,
          source_conv_id: m.convId, source_conv_seq: m.convSeq, source_from: m.from,
        });
        setToast("已收藏");
      } catch (e) { setToast(`收藏失败：${(e as Error).message}`); }
    })();
  }, []);
  // 打开收藏列表弹窗。
  const openFavorites = useCallback(() => {
    void (async () => {
      try { setFavorites(await clientRef.current?.listFavorites() ?? []); }
      catch (e) { setToast(`加载收藏失败：${(e as Error).message}`); }
    })();
  }, []);
  const removeFavorite = useCallback((id: number) => {
    void (async () => {
      try {
        await clientRef.current?.deleteFavorite(id);
        setFavorites((prev) => (prev ? prev.filter((f) => f.id !== id) : prev));
      } catch (e) { setToast(`删除失败：${(e as Error).message}`); }
    })();
  }, []);

  // 转发（M4-3）：打开会话选择器，选目标后逐条转发（带 forward_from 溯源）。
  const forwardMessage = useCallback((m: ChatMessage) => { setMenu(null); setForwarding([m]); }, []);
  // 进入多选态（M4-3）：预选当前消息。
  const enterSelectMode = useCallback((m: ChatMessage) => {
    setMenu(null); setSelectMode(true);
    setSelected(new Set(m.convSeq > 0 ? [m.convSeq] : []));
  }, []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  const toggleSelected = useCallback((seq: number) => {
    setSelected((prev) => { const n = new Set(prev); n.has(seq) ? n.delete(seq) : n.add(seq); return n; });
  }, []);
  // 执行转发：把 forwarding 里的消息逐条发到 target 会话（forward_from 保留原始出处）。
  const doForwardTo = useCallback((target: Conversation) => {
    const client = clientRef.current;
    const msgs = forwarding;
    if (!client || !msgs) return;
    for (const m of msgs) {
      if (!m.content || m.recalledAt) continue;
      const origin = m.forwardFrom || m.fromNickname || m.from; // 转发链保留最初作者
      const clientMsgId = client.sendText(m.content, target.is_group ? "" : target.peer, target.conv_id, { forwardFrom: origin });
      // 乐观上屏到目标会话（转发到当前会话时立即可见；ack 后转 sent）。
      appendMsg(target.conv_id, {
        clientMsgId, convId: target.conv_id, from: uid, content: m.content, contentType: "text",
        convSeq: 0, timestamp: Date.now(), status: "sending", forwardFrom: origin,
      });
    }
    setForwarding(null);
    exitSelectMode();
    setToast(`已转发到 ${target.is_group ? (target.name || "群聊") : (target.peer_remark || target.peer_nickname || target.peer)}`);
  }, [forwarding, exitSelectMode, appendMsg, uid]);
  // 多选批量转发：收集选中的消息，打开选择器。
  const forwardSelected = useCallback(() => {
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    const list = (msgsByConv[cid] ?? []).filter((m) => m.convSeq > 0 && selected.has(m.convSeq) && !m.recalledAt);
    if (list.length > 0) setForwarding(list);
  }, [msgsByConv, peer, uid, groupConvId, selected]);
  // 多选批量删除（仅本端）。
  const deleteSelected = useCallback(() => {
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    setMsgsByConv((prev) => {
      const list = (prev[cid] ?? []).filter((m) => !(m.convSeq > 0 && selected.has(m.convSeq)));
      return { ...prev, [cid]: list };
    });
    selected.forEach((s) => seenByConv.current[cid]?.delete(s));
    exitSelectMode();
  }, [peer, uid, groupConvId, selected, exitSelectMode]);

  // 跳转到被引用的原消息（点击气泡引用条）：高亮该行并滚入视口。
  const jumpToSeq = useCallback((seq: number) => {
    const el = msgsRef.current?.querySelector(`[data-seq="${seq}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      window.setTimeout(() => el.classList.remove("flash"), 1200);
    } else {
      setToast("原消息不在当前视图");
    }
  }, []);

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

  // 撤回自己的消息（M4-1）：发 msg_op；成功由服务端广播回 msg_op 帧应用（onMsgOp），失败（超窗）toast。
  const recallMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    if (m.convSeq > 0) clientRef.current?.recallMessage(m.convId, m.convSeq);
  }, []);

  // 编辑自己的文本消息（M4-5）：进入编辑态（回填输入框，发送时走 msg_op edit）。
  const editMessage = useCallback((m: ChatMessage) => {
    setMenu(null); setReplyTo(null);
    setEditingMsg(m); setInput(m.content);
  }, []);

  // 翻译一条消息（M4-5）：调服务端翻译接口，译文挂气泡下方。
  const translateMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    if (m.convSeq <= 0) return;
    void (async () => {
      try {
        const t = await clientRef.current?.translate(m.content);
        if (t) setTranslations((prev) => ({ ...prev, [m.convSeq]: t }));
      } catch (e) { setToast(`翻译失败：${(e as Error).message}`); }
    })();
  }, []);

  // 举报（AG-3）：举报某条消息 / 举报发送者。仅对“对方的消息”可用。
  const reportMessage = useCallback(async (m: ChatMessage, kind: "message" | "user") => {
    setMenu(null);
    const what = kind === "message" ? "举报这条消息" : `举报用户 ${m.from}`;
    const reason = window.prompt(`${what}\n请填写举报理由：`, "");
    if (reason === null) return; // 取消
    try {
      if (kind === "message") {
        // 用 (conv_id, conv_seq) 定位消息：客户端无需持有 server_msg_id（本地库存的是复合键）。
        await clientRef.current?.report("message", String(m.convSeq), reason, m.convId);
      } else {
        await clientRef.current?.report("user", m.from, reason);
      }
      alert("举报已提交，感谢反馈。");
    } catch (e) {
      alert(`举报失败：${(e as Error).message}`);
    }
  }, []);

  // 轻量浮层提示：约 1.8s 自动消失。未接后端的功能统一用它提示"开发中"。
  const comingSoon = useCallback((label: string) => setToast(`${label}（开发中）`), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // 会话"设为已读"：把本会话已读位点推到最新，再刷新左侧列表（红点清零）。
  const markReadConv = useCallback((c: Conversation) => {
    clientRef.current?.markRead(c.conv_id, c.latest_conv_seq);
    setConvMenu(null);
    void refreshConversations();
  }, [refreshConversations]);

  // 消息菜单动作（数据驱动）：copy/delete/report* 接真实实现，其余 comingSoon。useMemo 避免每次渲染重建。
  const messageActions = useMemo<MenuAction<{ m: ChatMessage; uid: string }>[]>(
    () => buildMessageActions({
      copy: copyMessage,
      reply: replyMessage,
      forward: forwardMessage,
      favorite: favoriteMessage,
      edit: editMessage,
      translate: translateMessage,
      multiSelect: enterSelectMode,
      recall: recallMessage,
      delete: deleteMessage,
      reportMsg: (m) => void reportMessage(m, "message"),
      reportUser: (m) => void reportMessage(m, "user"),
      comingSoon,
    }),
    [copyMessage, replyMessage, forwardMessage, favoriteMessage, editMessage, translateMessage, enterSelectMode, recallMessage, deleteMessage, reportMessage, comingSoon],
  );

  // 会话菜单动作（数据驱动）：markRead/delete 接真实实现（删除暂走 comingSoon），其余 comingSoon。
  const conversationActions = useMemo<MenuAction<{ c: Conversation }>[]>(
    () => buildConversationActions({
      markRead: markReadConv,
      delete: (c) => comingSoon(`删除会话 ${c.peer}`),
      comingSoon,
    }),
    [markReadConv, comingSoon],
  );

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

  // 会话右键菜单：点空白/滚动/Esc 关闭（与消息菜单一致）。
  useEffect(() => {
    if (!convMenu) return;
    const close = () => setConvMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConvMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [convMenu]);

  // 群成员 ⋯ 菜单：点空白/滚动/Esc 关闭。
  useEffect(() => {
    if (!memberMenu) return;
    const close = () => setMemberMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMemberMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [memberMenu]);

  // 左上角头像卡片：点空白/Esc 关闭。
  useEffect(() => {
    if (!accountCard) return;
    const close = () => setAccountCard(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAccountCard(false); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountCard]);

  // 聊天页 ⋮ 下拉：点空白/Esc 关闭。
  useEffect(() => {
    if (!chatMenu) return;
    const close = () => setChatMenu(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setChatMenu(false); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [chatMenu]);

  // 打开设置时刷新本人资料（与左上角头像共用 loadMyInfo / myInfo）。
  useEffect(() => {
    if (!showSettings) return;
    void loadMyInfo();
  }, [showSettings]);

  // 主题：真功能——写 <html data-theme> 驱动 CSS 变量切换（浅/深/跟随系统）+ 持久化。
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("im.theme", theme);
  }, [theme]);
  // 消息字体大小：真功能——写 CSS 变量 --msg-font 驱动消息气泡文本字号 + 持久化。
  useEffect(() => {
    localStorage.setItem("im.fontSize", String(fontSize));
    document.documentElement.style.setProperty("--msg-font", `${fontSize}px`);
  }, [fontSize]);
  useEffect(() => { localStorage.setItem("im.timeFormat", timeFormat); }, [timeFormat]);
  useEffect(() => { localStorage.setItem("im.sendKey", sendKey); }, [sendKey]);

  // 输入框随内容自适应高度（换行时变高，最多 ~5 行；发送清空后回到单行）。
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const onInputChange = useCallback((val: string) => {
    setInput(val);
    const now = Date.now();
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    if (val && cid && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      clientRef.current?.sendTyping(cid);
    }
  }, [peer, groupConvId, uid]);

  const stateText = { connected: "已连接", connecting: "连接中…", disconnected: "未连接" }[state];

  const convId = peer ? convIdFor(uid, peer) : groupConvId;
  // 按时间戳排序（发送中/失败的 convSeq=0 但有发送时刻，故按时间能正确落位——
  // 否则它们会被挤到末尾，导致"解除拉黑后新发的消息排在更早的失败消息之前"）。
  // conv_seq 仅作同一毫秒内的次级排序，保证已送达消息间仍按服务端顺序。
  const messages = (msgsByConv[convId] ?? [])
    .slice()
    .sort((a, b) => (a.timestamp - b.timestamp) || ((a.convSeq || Number.MAX_SAFE_INTEGER) - (b.convSeq || Number.MAX_SAFE_INTEGER)));
  // 首条未读下标：conv_seq > read_seq 的第一条对端消息（精确，CHAT_UX §4）。
  const firstUnreadIdx =
    entryUnread > 0 ? messages.findIndex((m) => m.from !== uid && m.convSeq > entryReadSeq) : -1;
  // 末条"自己消息"的状态签名：被拒收/ack 会改其 status/note（条数不变），用它当滚动 effect 的依赖，
  // 否则仅 messages.length 不变 → effect 不重跑 → 系统行变高后不贴底（问题1）。
  const tail = messages[messages.length - 1];
  const tailSig = tail && tail.from === uid ? `${tail.status}|${tail.note ?? ""}` : "";

  // 进会话定位 / 新消息贴底 / 顶部插历史保位 / 在上看历史累加跳转计数（纯 DOM 滚动）。
  useLayoutEffect(() => {
    if (phase !== "app" || !convId) return;
    const box = msgsRef.current;
    if (!box) return;
    const curMin = minSeqOf(messages);
    const curMax = maxSeqOf(messages);
    // 条数是否增加：新增消息=true；仅原条状态变更（被拒收/ack 改 status/note）=false。
    const grew = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;

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
      // 新发消息始终贴底；末条状态变更（如被拒收挂系统行致变高）仅在原本贴底时贴底，
      // 不打断已上滚看历史的用户（CHAT_UX §9）。
      if (grew || wasNearBottomRef.current) {
        box.scrollTop = box.scrollHeight;
        wasNearBottomRef.current = true;
        setShowJump(false);
        setJumpCount(0);
      }
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
  }, [phase, convId, messages.length, uid, firstUnreadIdx, tailSig]);

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
  const peerBlocked = !!peer && friends.some((f) => f.user_id === peer && f.blocked); // 我拉黑了对方（blocked 标记，与 status 正交）

  // 通讯录派生：我对每个对端的关系状态、收到的申请、已是好友、新申请红点数。
  // 拉黑的好友 status 仍是 accepted，但搜索结果按"已拉黑"展示，故 blocked 覆盖 status。
  const friendStatus = new Map(friends.map((f) => [f.user_id, f.blocked ? "blocked" : f.status]));
  const blockedSet = new Set(friends.filter((f) => f.blocked).map((f) => f.user_id));
  const incoming = friends.filter((f) => f.status === "pending"); // 别人申请我，待我同意/拒绝
  const accepted = friends.filter((f) => f.status === "accepted").sort((a, b) => b.updated_at - a.updated_at);
  const incomingCount = incoming.length;
  const labelOf = (id: string, nick: string) => (nick && nick.trim()) || id; // 有昵称显昵称，否则显 uid
  // 好友显示名优先级：备注名 > 昵称 > uid（§头像/显示名规则）。
  const friendLabel = (f: FriendEntry) => (f.remark && f.remark.trim()) || (f.nickname && f.nickname.trim()) || f.user_id;
  // 会话对端显示名优先级：备注 > 昵称 > uid。
  const convLabel = (c: Conversation) => (c.peer_remark && c.peer_remark.trim()) || (c.peer_nickname && c.peer_nickname.trim()) || c.peer;
  // 当前聊天对端的会话项与显示名（聊天页标题/备注预填用）。
  const peerConv = conversations.find((c) => c.peer === peer);
  const peerLabel = peerConv ? convLabel(peerConv) : peer;

  // ---- 群聊派生 + 动作（早退 return 之后：全部普通函数，禁用 Hook）----
  const isGroupChat = !!groupConvId;
  const activeGroupInfo = groupConvId ? groupInfos[groupConvId] : undefined;
  const activeGroupConv = groupConvId ? conversations.find((c) => c.conv_id === groupConvId) : undefined;
  const chatTitle = isGroupChat ? (activeGroupInfo?.name || activeGroupConv?.name || "群聊") : peerLabel;
  const chatMemberCount = activeGroupInfo?.members.length ?? activeGroupConv?.member_count ?? 0;
  // 群成员昵称（气泡/正在输入回退用）：优先消息自带 from_nickname，其次成员表缓存，最后 uid。
  const memberNick = (cid: string, id: string): string => {
    const m = groupInfos[cid]?.members.find((x) => x.user_id === id);
    return (m?.nickname && m.nickname.trim()) || "";
  };
  const senderLabel = (m: ChatMessage): string => m.fromNickname || memberNick(m.convId, m.from) || m.from;
  // 会话列表项显示名/头像/预览（群聊 vs 单聊）。
  const convDisplayLabel = (c: Conversation) => (c.is_group ? (c.name || "群聊") : convLabel(c));
  const convAvatarUrl = (c: Conversation) => (c.is_group ? c.avatar_url : c.peer_avatar_url);
  const convPreview = (c: Conversation): string => {
    if (!c.last_message) return "（无消息）";
    // 撤回消息预览（后端已脱敏 content）：显示"撤回了一条消息"（微信式）。
    if (c.last_message.recalled_at) {
      const who = c.last_message.from === uid ? "你" : (c.is_group ? (c.last_message.from_nickname || c.last_message.from) : "对方");
      return `${who}撤回了一条消息`;
    }
    if (!c.is_group) return c.last_message.content;
    if (c.last_message.content_type === "system") return c.last_message.content; // 系统消息无发送者前缀
    const who = c.last_message.from === uid ? "我" : (c.last_message.from_nickname || c.last_message.from);
    return `${who}: ${c.last_message.content}`;
  };

  // 群动作统一包装：执行 → 刷新群资料 + 会话列表；失败 alert。
  const doGroupAction = async (cid: string, fn: () => Promise<void>) => {
    try {
      await fn();
      void refreshGroupInfo(cid);
      void refreshConversations();
    } catch (e) {
      alert(`操作失败：${(e as Error).message}`);
    }
  };

  // 打开「群聊」列表弹窗（通讯录入口）。
  const openGroupsModal = async () => {
    try {
      const list = await clientRef.current?.listGroups();
      setGroupsModal(list ?? []);
    } catch (e) {
      alert(`加载群列表失败：${(e as Error).message}`);
    }
  };

  // 打开群资料弹窗（拉最新资料）。
  const openGroupPanel = (cid: string) => {
    setGroupPanel(cid);
    void refreshGroupInfo(cid);
  };

  // 建群：校验 → POST → 进入新群会话。
  const doCreateGroup = async () => {
    if (!createDraft) return;
    const name = createDraft.name.trim();
    if (!name) { setToast("请输入群名"); return; }
    if (createDraft.selected.length === 0) { setToast("请至少选择一位好友"); return; }
    setCreateBusy(true);
    try {
      const info = await clientRef.current!.createGroup(name, createDraft.selected);
      setGroupInfos((prev) => ({ ...prev, [info.conv_id]: info }));
      setCreateDraft(null);
      setGroupsModal(null);
      setTab("chats");
      await refreshConversations();
      openGroupChat(info.conv_id);
    } catch (e) {
      alert(`建群失败：${(e as Error).message}`);
    } finally {
      setCreateBusy(false);
    }
  };

  // 退出群聊（群主会被服务端拦：需先转让）。
  const doLeaveGroup = async (cid: string) => {
    if (!window.confirm("确定退出该群聊？")) return;
    try {
      await clientRef.current!.leaveGroup(cid);
      setGroupPanel(null);
      setGroupInfos((prev) => { const { [cid]: _drop, ...rest } = prev; return rest; });
      if (currentConvRef.current === cid) deselect();
      void refreshConversations();
    } catch (e) {
      alert(`退出失败：${(e as Error).message}`);
    }
  };

  // 改群名（群主/管理员）：轻量 prompt，回车确定。
  const doRenameGroup = async (gp: GroupInfo) => {
    const name = window.prompt("群名（1~30 字）", gp.name);
    if (name === null || !name.trim() || name.trim() === gp.name) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, name.trim(), gp.avatar_url));
  };

  // 邀请成员：提交选中的好友。
  const doInvite = async () => {
    if (!inviteDraft || inviteDraft.selected.length === 0) { setToast("请选择要邀请的好友"); return; }
    const { convId: cid, selected } = inviteDraft;
    try {
      await clientRef.current!.inviteToGroup(cid, selected);
      setInviteDraft(null);
      void refreshGroupInfo(cid);
      void refreshConversations();
    } catch (e) {
      alert(`邀请失败：${(e as Error).message}`);
    }
  };

  // 成员行是否显示 ⋯ 管理菜单：不能管自己；owner 管所有人，admin 只管普通成员。
  const canManageMember = (gp: GroupInfo, m: GroupMember): boolean =>
    m.user_id !== uid && (gp.my_role === "owner" || (gp.my_role === "admin" && m.role === "member"));

  // 保存好友备注名：写后端 → 刷新会话列表/好友列表（两处显示名随之更新）→ 关弹窗。
  // 注意：本函数在 login early-return 之后，绝不能用 Hook（useCallback）——否则违反 Hooks 规则导致崩溃。
  const saveRemark = async () => {
    if (!contactDraft) return;
    try {
      await clientRef.current?.setRemark(contactDraft.peer, contactDraft.remark.trim());
      setContactDraft(null);
      void refreshConversations();
      void refreshFriends();
    } catch (e) {
      alert(`保存备注失败：${(e as Error).message}`);
    }
  };
  const openFriendChat = (id: string) => { setTab("chats"); openChat(id); };

  // 通用菜单行：图标可选、右侧值/箭头可选、danger 红色。account card / settings / contacts entries 共用。
  type Row = { id: string; label: string; icon?: LucideIcon; value?: string; danger?: boolean; chevron?: boolean; onClick: () => void };

  // 左上角头像卡片的行（≈ Telegram Web 汉堡菜单；数据驱动：加一项 = append 一条）。
  // 「我的资料」不再单列——资料在设置页顶部展示、经铅笔进入编辑；退出登录移到设置页底部。
  const accountRows: Row[] = [
    { id: "settings", label: "设置", icon: Settings, chevron: true, onClick: () => setShowSettings(true) },
    { id: "favorites", label: "收藏消息", icon: Bookmark, chevron: true, onClick: () => { setAccountCard(false); openFavorites(); } },
  ];

  // 设置列表（对齐 Telegram **Web** 版布局；数据驱动：加一行 = append 一条；接后端 = 换 onClick）。
  // Web 版条目与 iOS 版不同——各自镜像对应平台的 Telegram 客户端。
  const settingsGroups: Row[][] = [
    [
      { id: "general", label: "通用设置", icon: Settings2, chevron: true, onClick: () => setGeneralOpen(true) },
      { id: "animations", label: "动画与性能", icon: Gauge, chevron: true, onClick: () => comingSoon("动画与性能") },
      { id: "notifications", label: "通知", icon: Bell, chevron: true, onClick: () => comingSoon("通知") },
      { id: "data", label: "数据与存储", icon: Database, chevron: true, onClick: () => comingSoon("数据与存储") },
      { id: "privacy", label: "隐私与安全", icon: Lock, chevron: true, onClick: () => void openBlacklist() },
      { id: "folders", label: "聊天文件夹", icon: Folder, chevron: true, onClick: () => comingSoon("聊天文件夹") },
      { id: "devices", label: "已登录设备", icon: MonitorSmartphone, chevron: true, onClick: () => comingSoon("已登录设备") },
      { id: "language", label: "语言", icon: Languages, value: "简体中文", chevron: true, onClick: () => comingSoon("语言") },
      { id: "stickers", label: "贴纸与表情", icon: Smile, chevron: true, onClick: () => comingSoon("贴纸与表情") },
    ],
  ];

  // 设置页顶部名片下的资料卡（手机号/用户名）。
  const settingsInfoRows: Row[] = [
    { id: "phone", label: myInfo?.phone || "未设置", icon: Phone, value: "手机号", onClick: () => void openProfile() },
    { id: "username", label: `@${uid}`, icon: AtSign, value: "用户名", onClick: () => void openProfile() },
  ];

  // 通讯录顶部入口行（数据驱动）。
  const contactEntries: Row[] = [
    { id: "groups", label: "群聊", icon: Users, chevron: true, onClick: () => void openGroupsModal() },
    { id: "official", label: "公众号", icon: Megaphone, chevron: true, onClick: () => comingSoon("公众号") },
    { id: "service", label: "服务号", icon: Headphones, chevron: true, onClick: () => comingSoon("服务号") },
  ];

  // 通用行渲染（cls 区分容器样式）。
  const renderRow = (r: Row, cls: string) => (
    <button key={r.id} className={`${cls}${r.danger ? " danger" : ""}`} onClick={r.onClick}>
      {r.icon && <r.icon size={20} className="row-icon" />}
      <span className="row-label">{r.label}</span>
      {r.value && <span className="row-value">{r.value}</span>}
      {r.chevron && <ChevronRight size={18} className="row-chevron" />}
    </button>
  );

  return (
    <div className={`app ${peer || groupConvId ? "has-sel" : "no-sel"}`}>
      <aside className="sidebar">
        <header>
          <div className="account-anchor">
            <button className="account-avatar" title="账号"
              onClick={(e) => { e.stopPropagation(); setAccountCard((v) => !v); }}>
              <Avatar url={myInfo?.avatar_url} label={myInfo?.nickname || uid} cls="account-avatar-inner" />
            </button>
            {accountCard && (
              <div className="menu-card" onClick={(e) => e.stopPropagation()}>
                {accountRows.map((r) => renderRow(r, "menu-card-row"))}
              </div>
            )}
          </div>
          <span className="account-meta">{uid} · {stateText}</span>
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
            <div key={c.conv_id} className={`convitem ${c.conv_id === convId ? "active" : ""}`}
              onClick={() => (c.is_group ? openGroupChat(c.conv_id) : openChat(c.peer))}
              onContextMenu={(e) => { e.preventDefault(); setConvMenu({ x: e.clientX, y: e.clientY, c }); }}>
              <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)}>
                {!c.is_group && presence[c.peer] === "online" && <span className="presence-dot" />}
              </Avatar>
              <div className="convbody">
                <div className="convtop">
                  <span className="convpeer">{convDisplayLabel(c)}</span>
                  <span className="convtime">
                    {!c.is_group && c.last_message?.from === uid && (
                      <span className={c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "convck read" : "convck"}>
                        {c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "✓✓ " : "✓ "}
                      </span>
                    )}
                    {c.last_message ? formatTime(c.last_message.timestamp, timeFormat) : ""}
                  </span>
                </div>
                <div className="convlast">{convPreview(c)}</div>
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
          <div className="contact-entries">
            {contactEntries.map((r) => renderRow(r, "entry-row"))}
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
                      <Avatar url={u.avatar_url} label={labelOf(u.user_id, u.nickname)} />
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
                    <Avatar url={f.avatar_url} label={labelOf(f.user_id, f.nickname)} />
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
                <Avatar url={f.avatar_url} label={friendLabel(f)}>
                  {presence[f.user_id] === "online" && <span className="presence-dot" />}
                </Avatar>
                <div className="convbody">
                  <div className="convpeer">{friendLabel(f)}{f.blocked && <span className="tag-blocked">已拉黑</span>}</div>
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

        {/* 设置面板：占据侧栏列（绝对定位），右侧聊天 .main 保持不动、可继续聊（对齐 Telegram Web）。 */}
        {showSettings && (
          <div className="settings-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setShowSettings(false)}><ChevronLeft size={24} /></button>
              <span className="settings-title">设置</span>
              <button className="icon-btn" title="编辑资料" onClick={() => void openProfile()}><SquarePen size={20} /></button>
            </header>
            <div className="settings-body">
              <div className="settings-profile">
                <Avatar url={myInfo?.avatar_url} label={myInfo?.nickname || uid} cls="settings-avatar" />
                <div className="settings-name">{myInfo?.nickname || uid}</div>
                <div className="settings-status">{stateText}</div>
              </div>
              <div className="settings-group">
                {settingsInfoRows.map((r) => renderRow(r, "settings-row info"))}
              </div>
              {settingsGroups.map((group, gi) => (
                <div key={gi} className="settings-group">
                  {group.map((r) => renderRow(r, "settings-row"))}
                </div>
              ))}
              <button className="settings-logout" onClick={logout}>退出登录</button>
            </div>
          </div>
        )}

        {/* 编辑资料面板：经设置页铅笔进入，叠在设置面板之上（对齐 Telegram Web「Edit profile」）。 */}
        {profileDraft && (
          <div className="settings-panel edit-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setProfileDraft(null)}><ChevronLeft size={24} /></button>
              <span className="settings-title">编辑资料</span>
              <button className="icon-btn save" title="保存" disabled={profileBusy} onClick={() => void saveProfile()}><Check size={22} /></button>
            </header>
            <div className="settings-body">
              {/* 点头像 → 选本机图片（隐藏的 file input，浏览器自动用系统原生文件框，跨平台无需检测系统）。 */}
              <button className="edit-avatar" title="更换头像" onClick={() => avatarFileRef.current?.click()}>
                <Avatar url={profileDraft.avatar_url} label={profileDraft.nickname || uid} cls="edit-avatar-inner" />
                <span className="edit-cam"><SquarePen size={15} /></span>
              </button>
              <input ref={avatarFileRef} type="file" accept="image/*" hidden
                onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="settings-group edit-fields">
                <label className="edit-field"><span>昵称</span>
                  <input value={profileDraft.nickname} maxLength={32}
                    onChange={(e) => setProfileDraft({ ...profileDraft, nickname: e.target.value })} /></label>
                <label className="edit-field"><span>手机号</span>
                  <input value={profileDraft.phone}
                    onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} /></label>
                <label className="edit-field"><span>标签</span>
                  <input value={profileDraft.tags} placeholder="空格或逗号分隔"
                    onChange={(e) => setProfileDraft({ ...profileDraft, tags: e.target.value })} /></label>
              </div>
            </div>
          </div>
        )}

        {/* 通用设置子面板：设置 ▸ 通用设置进入，叠在设置之上。主题已接通真功能，其余先 UI。 */}
        {generalOpen && (
          <div className="settings-panel general-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setGeneralOpen(false)}><ChevronLeft size={24} /></button>
              <span className="settings-title">通用设置</span>
              <span className="icon-btn-spacer" />
            </header>
            <div className="settings-body">
              <div className="section-label">设置</div>
              <div className="settings-group">
                <div className="range-row">
                  <div className="range-top"><span className="row-label">消息字体大小</span><span className="row-value">{fontSize}</span></div>
                  <input type="range" min={12} max={24} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
                </div>
                <button className="settings-row" onClick={() => comingSoon("聊天壁纸")}>
                  <ImageIcon size={20} className="row-icon" /><span className="row-label">聊天壁纸</span><ChevronRight size={18} className="row-chevron" />
                </button>
              </div>

              <div className="section-label">主题</div>
              <div className="settings-group">
                {([{ v: "light", t: "浅色" }, { v: "dark", t: "深色" }, { v: "system", t: "跟随系统" }] as const).map((o) => (
                  <button key={o.v} className="radio-row" onClick={() => setTheme(o.v)}>
                    <span className={`radio-dot${theme === o.v ? " on" : ""}`} /><span className="row-label">{o.t}</span>
                  </button>
                ))}
              </div>

              <div className="section-label">时间格式</div>
              <div className="settings-group">
                {([{ v: "12", t: "12 小时制" }, { v: "24", t: "24 小时制" }] as const).map((o) => (
                  <button key={o.v} className="radio-row" onClick={() => setTimeFormat(o.v)}>
                    <span className={`radio-dot${timeFormat === o.v ? " on" : ""}`} /><span className="row-label">{o.t}</span>
                  </button>
                ))}
              </div>

              <div className="section-label">键盘</div>
              <div className="settings-group">
                {([{ v: "enter", t: "按 Enter 发送", s: "Shift + Enter 换行" }, { v: "cmd", t: "按 Cmd + Enter 发送", s: "Enter 换行" }] as const).map((o) => (
                  <button key={o.v} className="radio-row" onClick={() => setSendKey(o.v)}>
                    <span className={`radio-dot${sendKey === o.v ? " on" : ""}`} />
                    <span className="radio-text"><span className="row-label">{o.t}</span><span className="row-sub">{o.s}</span></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* chat 面板始终挂载（即使未选会话），让 VList 在 app 加载时就测到稳定高度；
          未选会话时用 .main-empty 覆盖层遮住。否则条件挂载会让 virtua 在布局未定时测到 0。 */}
      <main className="main">
        <div className="chat">
          <header>
            {(peer || isGroupChat) && <button className="link back-btn" onClick={deselect}>‹ 会话</button>}
            {isGroupChat ? (
              // 群聊标题：群名 + 成员数，点击打开群资料（对齐 Telegram 点标题看资料）。
              <button className="chat-title-btn" title="查看群资料" onClick={() => openGroupPanel(groupConvId)}>
                {chatTitle}{chatMemberCount > 0 ? `（${chatMemberCount}人）` : ""}
              </button>
            ) : peer ? (
              <span>
                <span className={`dot ${peerOnline ? "on" : ""}`} /> {peerLabel}
                {peerOnline ? "（在线）" : ""}
              </span>
            ) : (
              <span className="muted">未选择会话</span>
            )}
            <span className="chat-head-right">
              <span className="muted">{stateText}</span>
              {(peer || isGroupChat) && (
                <span className="chat-anchor">
                  <button className="icon-btn" title="更多" onClick={(e) => { e.stopPropagation(); setChatMenu((v) => !v); }}><MoreVertical size={20} /></button>
                  {chatMenu && (
                    <div className="menu-card chat-menu" onClick={(e) => e.stopPropagation()}>
                      {(isGroupChat ? [
                        { id: "info", label: "群资料", icon: Info, run: () => openGroupPanel(groupConvId) },
                        { id: "invite", label: "邀请成员", icon: UserPlus, run: () => setInviteDraft({ convId: groupConvId, selected: [] }) },
                        { id: "mute", label: "静音", icon: BellOff, run: () => comingSoon("静音") },
                        { id: "leave", label: "退出群聊", icon: LogOut, danger: true, run: () => void doLeaveGroup(groupConvId) },
                      ] : [
                        { id: "edit", label: "编辑联系人", icon: SquarePen, run: () => setContactDraft({ peer, remark: peerConv?.peer_remark ?? "" }) },
                        { id: "call", label: "视频通话", icon: Video, run: () => comingSoon("视频通话") },
                        { id: "mute", label: "静音", icon: BellOff, run: () => comingSoon("静音") },
                        { id: "select", label: "选择消息", icon: CheckSquare, run: () => comingSoon("选择消息") },
                        { id: "block", label: "屏蔽用户", icon: Ban, run: () => comingSoon("屏蔽用户") },
                        { id: "del", label: "删除会话", icon: Trash2, danger: true, run: () => comingSoon("删除会话") },
                      ]).map((r) => (
                        <button key={r.id} className={`menu-card-row${"danger" in r && r.danger ? " danger" : ""}`}
                          onClick={() => { setChatMenu(false); r.run(); }}>
                          <r.icon size={18} className="row-icon" /><span className="row-label">{r.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              )}
            </span>
          </header>
          <div className="msgs" ref={msgsRef} onScroll={onMsgsScroll}>
            {messages.map((m, i) => {
              const mine = m.from === uid;
              const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
              const showDate = m.timestamp > 0 && (i === 0 || !isSameDay(m.timestamp, messages[i - 1].timestamp));
              // 系统消息（群邀请/移除/转让/禁言等留痕）：居中灰字，无气泡/勾/菜单。
              if (m.contentType === "system") {
                return (
                  <div className="msg-item" data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                    {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                    {i === firstUnreadIdx && (
                      <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                    )}
                    <div className="sys-line"><span>{m.content}</span></div>
                  </div>
                );
              }
              // 撤回消息（M4-1）：居中系统行"撤回了一条消息"，隐藏原气泡；本人文本可"重新编辑"回填输入框。
              if (m.recalledAt) {
                const canReEdit = mine && m.contentType === "text" && !!m.content;
                return (
                  <div className="msg-item" data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                    {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                    {i === firstUnreadIdx && (
                      <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                    )}
                    <div className="sys-line">
                      <span>{mine ? "你撤回了一条消息" : `${isGroupChat ? senderLabel(m) : "对方"}撤回了一条消息`}</span>
                      {canReEdit && (
                        <button className="reedit-btn" onClick={() => setInput(m.content)}>重新编辑</button>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div className="msg-item" data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                  {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                  {i === firstUnreadIdx && (
                    <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                  )}
                  <div className={`row ${mine ? "me" : "them"}${selectMode ? " selecting" : ""}`}
                    onClick={selectMode && m.convSeq > 0 ? () => toggleSelected(m.convSeq) : undefined}>
                    {selectMode && (
                      <span className={`sel-check${selected.has(m.convSeq) ? " on" : ""}`}>{selected.has(m.convSeq) ? "✓" : ""}</span>
                    )}
                    <div className="bubble-line">
                      {mine && m.status === "failed" && (
                        <span className="fail-badge" title={m.note || "发送失败"}>!</span>
                      )}
                      <div className="bubble"
                        onContextMenu={(e) => { if (selectMode) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }}>
                        {isGroupChat && !mine && <span className="sender-name">{senderLabel(m)}</span>}
                        {m.forwardFrom ? <span className="forward-from">转发自 {m.forwardFrom}</span> : null}
                        {m.replyToConvSeq ? (
                          <div className="quote-bar" onClick={() => jumpToSeq(m.replyToConvSeq!)}>
                            <span className="quote-text">{m.replySnapshot || "原消息"}</span>
                          </div>
                        ) : null}
                        <span className="btext">{m.content}</span>
                        <span className="bmeta">
                          {m.editedAt ? <span className="edited-tag">已编辑 </span> : null}
                          {mine ? (
                            m.status === "sending" ? "发送中…"
                              : m.status === "failed" ? (m.note ? null : <span className="failed">发送失败 ✗</span>)
                                : <>{formatTime(m.timestamp, timeFormat)}<span className={readByPeer ? "ck read" : "ck"}>{readByPeer ? " ✓✓" : " ✓"}</span></>
                          ) : (
                            formatTime(m.timestamp, timeFormat)
                          )}
                        </span>
                      </div>
                    </div>
                    {m.convSeq > 0 && translations[m.convSeq] && (
                      <div className="translation"><span>{translations[m.convSeq]}</span></div>
                    )}
                  </div>
                  {mine && m.status === "failed" && m.note && (
                    <div className="sys-note"><span>{m.note}</span></div>
                  )}
                </div>
              );
            })}
          </div>
          {showJump && convId && (
            <button className="jump-btn" onClick={jumpToBottom} title="跳到最新消息">
              ↓{jumpCount > 0 && <span className="jump-badge">{jumpCount > 99 ? "99+" : jumpCount}</span>}
            </button>
          )}
          {convId && typingConv === convId && (
            <div className="typing">
              {isGroupChat ? `${memberNick(convId, typingFrom) || typingFrom} 正在输入…` : "对方正在输入…"}
            </div>
          )}
          {peerBlocked && peer && (
            // 微信式单向：拉黑者仍可发、对方能收到；这里只给一条非阻断提示 + 解除入口，不禁用输入。
            <div className="block-hint">已将对方加入黑名单（TA 发来的消息会被拒收）<button className="link-inline" onClick={() => void unblock(peer)}>解除拉黑</button></div>
          )}
          {editingMsg && (
            // 编辑态条（M4-5）：输入框上方显示"编辑消息" + 取消（恢复普通发送）。
            <div className="reply-compose">
              <div className="reply-compose-text">
                <span className="reply-who">编辑消息</span>
                <span className="reply-snippet">{(editingMsg.content || "").slice(0, 80)}</span>
              </div>
              <button className="reply-cancel" onClick={() => { setEditingMsg(null); setInput(""); }} title="取消编辑">✕</button>
            </div>
          )}
          {replyTo && (
            // 引用回复条（M4-2）：输入框上方显示被引用消息预览 + 取消。
            <div className="reply-compose">
              <div className="reply-compose-text">
                <span className="reply-who">回复 {replyTo.from === uid ? "自己" : (isGroupChat ? senderLabel(replyTo) : peerLabel)}</span>
                <span className="reply-snippet">{(replyTo.content || "").slice(0, 80)}</span>
              </div>
              <button className="reply-cancel" onClick={() => setReplyTo(null)} title="取消引用">✕</button>
            </div>
          )}
          {selectMode ? (
            // 多选态工具栏（M4-3）：批量 转发/删除，替换输入区。
            <footer className="select-bar">
              <button className="link-inline" onClick={exitSelectMode}>取消</button>
              <span className="select-count">已选 {selected.size}</span>
              <button disabled={selected.size === 0} onClick={forwardSelected}>转发</button>
              <button className="danger" disabled={selected.size === 0} onClick={deleteSelected}>删除</button>
            </footer>
          ) : (
            <footer>
              <textarea ref={composerRef} value={input} rows={1} disabled={!convId}
                placeholder={convId ? (sendKey === "cmd" ? "输入消息，Cmd+Enter 发送…" : "输入消息，回车发送…") : "先选择左侧的会话…"}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // 中文输入法组词中不触发
                  // enter 模式：Enter 发送、Shift+Enter 换行；cmd 模式：Cmd/Ctrl+Enter 发送、Enter 换行。
                  const shouldSend = sendKey === "cmd" ? (e.metaKey || e.ctrlKey) : !e.shiftKey;
                  if (shouldSend) { e.preventDefault(); send(); }
                }} />
              <button onClick={send} disabled={!convId}>发送</button>
            </footer>
          )}
        </div>
        {!convId && <div className="main-empty">选择左侧的会话开始聊天</div>}
      </main>

      {favorites && (
        // 收藏列表（M4-4）：内容快照 + 删除；原消息撤回/删除后仍在。
        <div className="modal-mask" onClick={() => setFavorites(null)}>
          <div className="modal fav-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">我的收藏（{favorites.length}）</div>
            <div className="fav-list">
              {favorites.length === 0 && <div className="fwd-empty">还没有收藏</div>}
              {favorites.map((f) => (
                <div key={f.id} className="fav-item">
                  <div className="fav-content">{f.content}</div>
                  <button className="fav-del" title="删除收藏" onClick={() => removeFavorite(f.id)}>✕</button>
                </div>
              ))}
            </div>
            <button className="modal-close" onClick={() => setFavorites(null)}>关闭</button>
          </div>
        </div>
      )}

      {forwarding && (
        // 转发会话选择器（M4-3）：从会话列表选目标，逐条转发。
        <div className="modal-mask" onClick={() => setForwarding(null)}>
          <div className="modal fwd-picker" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">转发到（{forwarding.length} 条）</div>
            <div className="fwd-list">
              {conversations.length === 0 && <div className="fwd-empty">暂无会话</div>}
              {conversations.map((c) => (
                <button key={c.conv_id} className="fwd-item" onClick={() => doForwardTo(c)}>
                  {convDisplayLabel(c)}
                </button>
              ))}
            </div>
            <button className="modal-close" onClick={() => setForwarding(null)}>取消</button>
          </div>
        </div>
      )}

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {messageActions
            .filter((a) => a.visible({ m: menu.m, uid }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => { a.run({ m: menu.m, uid }); setMenu(null); }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </div>
      )}

      {convMenu && (
        <div className="ctx-menu" style={{ left: convMenu.x, top: convMenu.y }} onClick={(e) => e.stopPropagation()}>
          {conversationActions
            .filter((a) => a.visible({ c: convMenu.c }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => { a.run({ c: convMenu.c }); setConvMenu(null); }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </div>
      )}

      {friendMenu && (
        <div className="ctx-menu" style={{ left: friendMenu.x, top: friendMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.removeFriend(id)); }}>删除好友</button>
          {blockedSet.has(friendMenu.userId) ? (
            <button onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void unblock(id); }}>解除拉黑</button>
          ) : (
            <button className="danger" onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.friendAction("block", id)); }}>拉黑</button>
          )}
        </div>
      )}

      {contactDraft && (
        <div className="modal-mask" onClick={() => setContactDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>编辑联系人</h3>
            <label>备注名（Notes）<input value={contactDraft.remark} maxLength={32} placeholder="设置备注名"
              onChange={(e) => setContactDraft({ ...contactDraft, remark: e.target.value })} /></label>
            <div className="modal-hint">备注名仅你可见，显示优先级高于对方昵称。</div>
            <div className="modal-actions">
              <button className="link" onClick={() => setContactDraft(null)}>取消</button>
              <button className="mini-btn" onClick={() => void saveRemark()}>保存</button>
            </div>
          </div>
        </div>
      )}

      {blockedList !== null && (
        <div className="modal-mask" onClick={() => setBlockedList(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>黑名单（{blockedList.length}）</h3>
            {blockedList.length === 0 && <div className="empty">没有拉黑的用户</div>}
            {blockedList.map((f) => (
              <div key={f.user_id} className="convitem static">
                <Avatar url={f.avatar_url} label={friendLabel(f)} />
                <div className="convbody">
                  <div className="convpeer">{friendLabel(f)}</div>
                  <div className="convlast">{f.user_id}</div>
                </div>
                <div className="row-actions">
                  <button className="mini-btn ghost" disabled={busyUser === f.user_id} onClick={() => void unblock(f.user_id)}>解除</button>
                </div>
              </div>
            ))}
            <div className="modal-actions">
              <button className="link" onClick={() => setBlockedList(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 「群聊」列表弹窗（通讯录入口）：我的群 + 创建群聊。 */}
      {groupsModal !== null && (
        <div className="modal-mask" onClick={() => setGroupsModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>群聊（{groupsModal.length}）</h3>
            <button className="mini-btn wide" onClick={() => setCreateDraft({ name: "", selected: [] })}>
              <UserPlus size={16} className="menu-icon" />创建群聊
            </button>
            {groupsModal.length === 0 && <div className="empty">还没有加入任何群聊</div>}
            <div className="modal-list">
              {groupsModal.map((g) => (
                <div key={g.conv_id} className="convitem"
                  onClick={() => { setGroupsModal(null); setTab("chats"); openGroupChat(g.conv_id); }}>
                  <Avatar url={g.avatar_url} label={g.name} />
                  <div className="convbody">
                    <div className="convpeer">{g.name}</div>
                    <div className="convlast">{g.owner === uid ? "我是群主" : `群主 ${g.owner}`}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="link" onClick={() => setGroupsModal(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 建群弹窗：群名 + 好友多选。 */}
      {createDraft && (
        <div className="modal-mask" onClick={() => setCreateDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>创建群聊</h3>
            <label>群名<input value={createDraft.name} maxLength={30} placeholder="1~30 字" autoFocus
              onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })} /></label>
            <div className="section-label">选择好友（已选 {createDraft.selected.length}）</div>
            {accepted.length === 0 && <div className="empty">还没有好友，先去通讯录添加吧</div>}
            <div className="modal-list">
              {accepted.map((f) => {
                const on = createDraft.selected.includes(f.user_id);
                return (
                  <button key={f.user_id} className="check-row"
                    onClick={() => setCreateDraft({
                      ...createDraft,
                      selected: on ? createDraft.selected.filter((x) => x !== f.user_id) : [...createDraft.selected, f.user_id],
                    })}>
                    <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>
                    <Avatar url={f.avatar_url} label={friendLabel(f)} />
                    <span className="row-label">{friendLabel(f)}</span>
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="link" onClick={() => setCreateDraft(null)}>取消</button>
              <button className="mini-btn" disabled={createBusy} onClick={() => void doCreateGroup()}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 群资料弹窗：群名/成员数 + 邀请/退群 + 成员列表（按 my_role 显隐管理操作）。 */}
      {groupPanel && (() => {
        const gp = groupInfos[groupPanel];
        return (
          <div className="modal-mask" onClick={() => setGroupPanel(null)}>
            <div className="modal group-modal" onClick={(e) => e.stopPropagation()}>
              {!gp ? (
                <div className="empty">加载群资料…</div>
              ) : (
                <>
                  <div className="group-head">
                    <Avatar url={gp.avatar_url} label={gp.name} />
                    <div className="group-head-info">
                      <div className="group-name">
                        {gp.name}
                        {gp.my_role !== "member" && (
                          <button className="icon-btn" title="修改群名" onClick={() => void doRenameGroup(gp)}><SquarePen size={16} /></button>
                        )}
                      </div>
                      <div className="group-sub">{gp.members.length} 位成员</div>
                    </div>
                  </div>
                  <div className="group-actions">
                    <button className="mini-btn" onClick={() => setInviteDraft({ convId: gp.conv_id, selected: [] })}>
                      <UserPlus size={15} className="menu-icon" />邀请成员
                    </button>
                    <button className="mini-btn ghost danger-text" onClick={() => void doLeaveGroup(gp.conv_id)}>
                      <LogOut size={15} className="menu-icon" />退出群聊
                    </button>
                  </div>
                  <div className="section-label">成员（{gp.members.length}）</div>
                  <div className="modal-list">
                    {gp.members.map((m) => (
                      <div key={m.user_id} className="convitem static">
                        <Avatar url={m.avatar_url} label={m.nickname || m.user_id} />
                        <div className="convbody">
                          <div className="convpeer">
                            {m.nickname || m.user_id}{m.user_id === uid && <span className="me-tag">我</span>}
                            {m.role === "owner" && <span className="role-badge owner">群主</span>}
                            {m.role === "admin" && <span className="role-badge">管理员</span>}
                          </div>
                          <div className="convlast">{m.user_id}</div>
                        </div>
                        {canManageMember(gp, m) && (
                          <div className="row-actions">
                            <button className="mini-btn ghost" title="管理"
                              onClick={(e) => { e.stopPropagation(); setMemberMenu({ x: e.clientX, y: e.clientY, convId: gp.conv_id, m }); }}>⋯</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="modal-actions">
                <button className="link" onClick={() => setGroupPanel(null)}>关闭</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 邀请成员弹窗：不在群内的好友多选。 */}
      {inviteDraft && (() => {
        const inGroup = new Set((groupInfos[inviteDraft.convId]?.members ?? []).map((m) => m.user_id));
        const candidates = accepted.filter((f) => !inGroup.has(f.user_id));
        return (
          <div className="modal-mask" onClick={() => setInviteDraft(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>邀请成员</h3>
              {candidates.length === 0 && <div className="empty">好友都已在群里了</div>}
              <div className="modal-list">
                {candidates.map((f) => {
                  const on = inviteDraft.selected.includes(f.user_id);
                  return (
                    <button key={f.user_id} className="check-row"
                      onClick={() => setInviteDraft({
                        ...inviteDraft,
                        selected: on ? inviteDraft.selected.filter((x) => x !== f.user_id) : [...inviteDraft.selected, f.user_id],
                      })}>
                      <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>
                      <Avatar url={f.avatar_url} label={friendLabel(f)} />
                      <span className="row-label">{friendLabel(f)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="modal-actions">
                <button className="link" onClick={() => setInviteDraft(null)}>取消</button>
                <button className="mini-btn" disabled={inviteDraft.selected.length === 0} onClick={() => void doInvite()}>
                  邀请{inviteDraft.selected.length > 0 ? `（${inviteDraft.selected.length}）` : ""}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 群成员管理 ⋯ 菜单（按角色矩阵显隐；服务端仍会二次校验）。 */}
      {memberMenu && (() => {
        const gp = groupInfos[memberMenu.convId];
        const m = memberMenu.m;
        const cid = memberMenu.convId;
        if (!gp) return null;
        const run = (fn: () => Promise<void>) => { setMemberMenu(null); void doGroupAction(cid, fn); };
        return (
          <div className="ctx-menu" style={{ left: memberMenu.x, top: memberMenu.y }} onClick={(e) => e.stopPropagation()}>
            {gp.my_role === "owner" && m.role === "member" && (
              <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "admin"))}>设为管理员</button>
            )}
            {gp.my_role === "owner" && m.role === "admin" && (
              <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "member"))}>撤销管理员</button>
            )}
            {gp.my_role === "owner" && (
              <button onClick={() => {
                setMemberMenu(null);
                if (window.confirm(`确定把群主转让给 ${m.nickname || m.user_id}？你将变为普通成员。`)) {
                  void doGroupAction(cid, () => clientRef.current!.transferGroup(cid, m.user_id));
                }
              }}>转让群主</button>
            )}
            <button className="danger" onClick={() => {
              setMemberMenu(null);
              if (window.confirm(`确定把 ${m.nickname || m.user_id} 移出群聊？`)) {
                void doGroupAction(cid, () => clientRef.current!.removeGroupMember(cid, m.user_id));
              }
            }}>移出群聊</button>
          </div>
        );
      })()}

      {toast && <div className="toast">{toast}</div>}
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

