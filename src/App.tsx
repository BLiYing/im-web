import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IMClient, registerAccount, type ConnState } from "./sdk/imSdk";
import { AppServicesProvider, type AppServices } from "./AppServicesContext";
import { useGroupActions } from "./useGroupActions";
import { useMessageStore } from "./useMessageStore";
import { useLocalPreload } from "./useLocalPreload";
import { MemberMenu } from "./components/MemberMenu";
import { loadConversation, markMessageDeleted, type MsgRecord } from "./sdk/localStore";
import { planBatchDelete } from "./selectDelete";
import type { KeyedDebounced } from "./keyedDebounce";
import { useBatchDelete } from "./useBatchDelete";
import { fetchServerConfig, fetchGroupMembersPage } from "./sdk/serverConfigApi";
import { convIdFor, type ServerConfig, type ChatMessage, type Conversation, type FriendEntry, type GroupInfo, type GroupMember, type Favorite, type PinnedMessage, type UserCard } from "./sdk/protocol";
import { QRCardModal, QRScannerModal, QRResultModal, JoinRequestsModal } from "./QRUI";
import { errorCode } from "./qr";
import { activeMentionQuery, resolveMentions, resolveMentionAll, resolveMentionSpans, countsAsUnread } from "./mention";
import { remarkMap, displayNameOf } from "./remarks";
import { resolveDetailFollow } from "./detailFollow";
import { makeNameResolvers } from "./chatNaming";
import { useGroupInfoRefresh } from "./useGroupInfoRefresh";
import { nextPinnedIndex, clampPinnedIndex } from "./pinned";
import AvatarCropper from "./AvatarCropper";
import { isOnline, presenceFromConversation, presenceText, type Presence } from "./sdk/presence";
import { buildMessageActions, buildConversationActions, type MenuAction, type MessageCtx } from "./menus";
import { isViewableMedia, msgKey } from "./album";
import { jumpDomToSeq } from "./messageJump";
import { useVoiceTranscript } from "./useVoiceTranscript";
import { conversationTime, fullDate, monthDay } from "./time";
import { MessageList } from "./components/MessageList";
import { DetailPanel } from "./components/DetailPanel";
import type { DetailTab } from "./components/DetailTabs";
import { Composer } from "./components/Composer";
import { ContactsTab } from "./components/ContactsTab";
import { SidebarTabs } from "./components/SidebarTabs";
import { ChatHeader } from "./components/ChatHeader";
import { ChatActionsProvider, type ChatActions } from "./ChatActionsContext";
import { useEvent } from "./useEvent";
import {
  replyPreviewOf,
  parseChatRecord, copyImageToClipboard,
  syntheticViewerMessage, minSeqOf, type ChatRecord,
  SELECT_MAX,
} from "./messageContent";
import { Avatar } from "./components/Avatar";
import { HomeSearchResults } from "./components/HomeSearchResults";
import { highlightText } from "./searchHighlight";
import { hitSnippet } from "./searchPredicate";
import { useChatSearch } from "./useChatSearch";
import { useMediaServerPaging } from "./useMediaServerPaging";
import { useViewerNav } from "./useViewerNav";
import { useDetailServerArchive } from "./useDetailServerArchive";
import { pickQuerySource } from "./convQuerySource";
import { useMediaDownload } from "./useMediaDownload";
import { useMediaSend } from "./useMediaSend";
import { useVoiceSend } from "./useVoiceSend";
import { useForward } from "./useForward";
import { useFavorites } from "./useFavorites";
import { useGroupOps } from "./useGroupOps";
import { useContactShare, CONTACT_MAX_SELECTION } from "./useContactShare";
import { useReport } from "./useReport";
import { convPreview as buildConvPreview, isMissedCallPreview } from "./convPreview";
import { useMentions } from "./useMentions";
import { useQR } from "./useQR";
import { useAppearanceSettings } from "./useAppearanceSettings";
import { useFriendOps } from "./useFriendOps";
import { useProfileEdit } from "./useProfileEdit";
import { ChatBanners } from "./components/ChatBanners";
import { ChatScrollbarThumb } from "./components/ChatScrollbarThumb";
import { type LinkPreview } from "./components/LinkCard";
import { LoginView } from "./components/LoginView";
import { SESSION_KEY, loadSession, saveSession } from "./session";
import { useDevices } from "./useDevices";
import { useDialogs } from "./useDialogs";
import { useToast } from "./useToast";
import { renderRow, type Row } from "./components/rows";
import { SettingsPanelsHost } from "./components/settings/SettingsPanelsHost";
import { useAccountNotifySettings } from "./useAccountNotifySettings";
import { langPrefLabel, useT } from "./i18n";
import { buildSettingsInfoRows } from "./settingsInfoRows";
import { ConfirmDialog, PromptDialog } from "./components/Dialogs";
import { PinnedListModal } from "./components/modals/PinnedListModal";
import { GroupsModal } from "./components/modals/GroupsModal";
import { FriendRequestsModal } from "./components/modals/FriendRequestsModal";
import { FriendRequestModal } from "./components/modals/FriendRequestModal";
import { CreateGroupModal } from "./components/modals/CreateGroupModal";
import { publicNameOf } from "./groupName";
import { FriendPickerModal } from "./components/modals/FriendPickerModal";
import { adminCandidates, transferCandidates } from "./groupAdmin";
import { useUserProfiles } from "./useUserProfiles";
import { RtcHost } from "./rtc/RtcHost";
import { rtcNameOf } from "./rtc/rtcProfiles";
import { CallHistoryPanel } from "./components/CallHistoryPanel";
import { useMemberSearch } from "./useMemberSearch";
import { AdminPickerModal } from "./components/modals/AdminPickerModal";
import { TransferOwnerModal } from "./components/modals/TransferOwnerModal";
import { ConfirmSendCardModal } from "./components/modals/ConfirmSendCardModal";
import { MuteDurationModal } from "./components/modals/MuteDurationModal";
import { GroupBansModal } from "./components/modals/GroupBansModal";
import { ReadReceiptsModal } from "./components/modals/ReadReceiptsModal";
import { GroupTextModal, type GroupTextKind } from "./components/modals/GroupTextModal";
import { FavoritesModal } from "./components/modals/FavoritesModal";
import { ForwardPicker } from "./components/modals/ForwardPicker";
import { RecordModal } from "./components/modals/RecordModal";
import { TextReader } from "./components/TextReader";
import { MediaViewer } from "./components/MediaViewer";
import { GalleryModal } from "./components/modals/GalleryModal";
import { LOG_TAG, logger, setLogContext } from "./logging/logger";
import { SYSTEM_UID } from "./sdk/protocol";
import { unreadBadgeText } from "./unreadBadge";
import { useDesktopIntegration } from "./useDesktopIntegration";
import { useFaviconBadge } from "./useFaviconBadge";
import { useMuteExpiryTick } from "./useMuteExpiryTick";
import { usePageVisibleAgain } from "./usePageVisibleAgain";
import { useConvMute } from "./useConvMute";
import { isMutedNow } from "./muteState";
import { ContextMenusHost } from "./components/ContextMenusHost";
import { makeDesktopTitleOf } from "./desktopWiring";
import { makeMessageTextRenderers } from "./components/messageText";
import { pauseVoicePlayback } from "./components/VoiceBubble";
import { unreadBelowCount } from "./unreadBelow";
import { coversSpan } from "./sdk/ranges";
import { visibleSlice } from "./renderWindow";
import { moreLocalAbove } from "./windowPlan";
import { ReadTick } from "./components/ReadTick";
import {
  Settings, Bookmark, Settings2, Gauge, Bell, Database, Lock, Folder,
  MonitorSmartphone, Languages, Smile, Users, Megaphone,
  Headphones, Phone,
  BellOff, Menu,
  Pin,
  Search, X,
  UserPlus } from "lucide-react";

type Phase = "login" | "app"; // 登录页 / 双栏主界面（左列表 + 右聊天，Telegram 桌面式）
type Tab = "chats" | "contacts"; // 左栏顶部页签：消息 / 通讯录（components/SidebarTabs.tsx）

// 群成员上限**不再硬编码**：它是部署级配置（后端 `-max-group-members`，默认 2000），
// 登录后经 GET /api/v1/server-config 拉一次。
//
// 这里曾写死 500，而后端 2026-08-31 已放到 2000——端上会在选到第 501 人时误拦，
// 用户看到的是"明明还能加却加不了"。**部署配置一律读接口，别在端上复制一份。**
// 拉取失败时的兜底：给一个保守值，让 UI 可用；真超限由服务端 GroupMemberLimit 兜底拒绝。
const FALLBACK_MAX_GROUP_MEMBERS = 500;
// 转发目标会话上限：一次最多转给 9 个会话，与 iOS kIMForwardMaxSelection / 微信一致。

// 收藏 → 合成 ChatMessage：转发/从收藏发送统一走 sendForwardToTarget（§6，媒体/文件透传 URL 不重传）。


/** 大群说明全文（**升级后**时态）。三条与 docs/design/SUPERGROUP_DESIGN.md §4.1 同源——
 *  那一节是三端唯一真相源（后台升级确认框 / iOS 满员告知行与大群说明行 / Web 满员告知块 / 本常量）。
 *  改文案时按该节搜一圈，几处一起改。
 *
 *  **不写具体人数**：上限是部署级配置，硬编码就会与服务端口径分叉（同 SUPERGROUP_DESIGN §3 两层闸门）。
 *  满员告知块能写数字，是因为它本来就要判 serverConfig 才显示。 */
const SUPER_GROUP_NOTICE_KEYS = ["group.text.super_notice_1", "group.text.super_notice_2", "group.text.super_notice_3", "group.text.super_notice_4"];

export default function App() {
  const [phase, setPhase] = useState<Phase>("login");
  // uid 恒为**内部 ID**（10 位数字，服务端分配）：本地库分区、conv_id 推导、接口参数都用它。
  const [uid, setUid] = useState(() => loadSession()?.uid || "");
  // loginName 是登录框里输入的 **username**（公开句柄）。登录接口只认它，内部 ID 由响应带回。
  const [loginName, setLoginName] = useState(() => loadSession()?.username || "user1001");
  const [nickname, setNickname] = useState(""); // 仅注册用：显示名，必填
  // client 的事件回调在登录**之前**就已闭包捕获变量，而内部 ID 要等 /login 响应才知道——
  // 回调里判断「这事件是不是我干的」必须读 ref 的当前值，捕获 uid state 会永远拿到登录前的空串。
  const uidRef = useRef(uid);
  useEffect(() => { uidRef.current = uid; }, [uid]);
  const [password, setPassword] = useState(""); // 登录密码（空=走开发期免密）
  const restoreRef = useRef(loadSession()); // 待静默重登的已存会话（含 uid + username）
  const refreshRef = useRef(""); // 本会话手上那枚续期凭据：落盘用（替代此前存在本地的明文密码）
  const [restoring, setRestoring] = useState(() => !!restoreRef.current); // 恢复中：登录页显示过渡态
  const [authBusy, setAuthBusy] = useState(false); // 登录/注册请求进行中
  const [authErr, setAuthErr] = useState(""); // 登录/注册错误文案
  const [loginTab, setLoginTab] = useState<"password" | "qr">("password"); // 登录页页签：密码 / 扫码
  // 扫码登录待入场会话：poll 领到 {uid,token} 后先 setUid 再由 effect 用新 uid 闭包跑 enterApp。
  const pendingQrRef = useRef<{ uid: string; token: string; refresh: string } | null>(null);
  const [qrTrigger, setQrTrigger] = useState(0);
  const [state, setState] = useState<ConnState>("disconnected");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // 会话消息表 + 去重/墓碑集 + 去重/patch/append/删除方法：收口到 useMessageStore（纯逻辑见 messageStore.ts）。
  const {
    msgsByConv, setMsgsByConv, seenByConv, deletedByConv,
    appendMsg: appendMsgRaw, patchMsg, removeMsgRow, applyOp, removeSeq, clearConv,
    preload: preloadMsgs, reset: resetMsgStore, ingestInbound, applyAck, markRejected,
  } = useMessageStore();
  const [peer, setPeer] = useState("");
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState<Record<string, Presence>>({}); // user -> 在线态（租约模型，见 sdk/presence.ts）
  const [, setPresenceTick] = useState(0); // 仅用于驱动在线态重算的心跳，见下方 useEffect
  const [peerReadSeq, setPeerReadSeq] = useState<Record<string, number>>({}); // convId -> 对端已读位点
  // 覆盖式（不管几人同时打字，只记最新一位）：{convId,uid} → 副标题拼「{昵称} 正在输入」；单聊时 uid 冗余但保留统一形状。
  const [typingConv, setTypingConv] = useState<{ convId: string; uid: string } | null>(null);
  const [entryUnread, setEntryUnread] = useState(0); // 进会话时的未读数（红点/↓N 计数，服务端 cap 999）
  const [entryReadSeq, setEntryReadSeq] = useState(0); // 进会话时的已读位点（精确定位未读分割线，CHAT_UX §4）
  const [showJump, setShowJump] = useState(false); // 右下角"跳到底部"按钮是否显示
  const [jumpCount, setJumpCount] = useState(0); // 按钮上的未读条数
  // jumpCapped：↓N 的初值来自服务端未读，撞上限时它是"至少这么多"（OFFLINE_BACKLOG_DESIGN §6.1）。
  // ↓N 一律不数本地：本地有缺口时数出来的必然偏小，而那种错不会报错、只是数字悄悄不对。
  const [jumpCapped, setJumpCapped] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 长按/右键菜单
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null); // 正在引用回复的目标消息（撤回后清）
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null); // 正在编辑的消息（M4-5，编辑态）
  const [translations, setTranslations] = useState<Record<number, string>>({}); // convSeq -> 译文（挂气泡下，M4-5）
  // 合并转发详情弹窗：栈式，支持嵌套「套娃」下钻/返回（栈顶=当前展示层，空=关闭）。
  const [recordStack, setRecordStack] = useState<ChatRecord[]>([]);
  const recordView = recordStack.length > 0 ? recordStack[recordStack.length - 1] : null;
  // 当前层里嵌套合并转发条目的子记录解析结果（按 item 下标缓存），避免每次 render 重复 JSON.parse。
  const recordNested = useMemo(() => {
    const m = new Map<number, ChatRecord>();
    recordView?.items.forEach((it, i) => { if (it.ct === "chat_record") m.set(i, parseChatRecord(it.c)); });
    return m;
  }, [recordView]);
  // 媒体查看器（镜像 iOS）：图片/视频全屏 + 下载/媒体库/更多；fromGallery=从媒体库进入（不再显示媒体库按钮）。
  const [viewer, setViewer] = useState<{ m: ChatMessage; fromGallery?: boolean } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false); // 会话媒体库（蒙层网格）
  const [viewerMore, setViewerMore] = useState(false);   // 查看器「更多」浮层（hover 显示）
  const [expandedTexts, setExpandedTexts] = useState<Set<string>>(new Set()); // 中长文本"展开全文"记忆（按消息 key）
  const [textReader, setTextReader] = useState<ChatMessage | null>(null); // 超长文本全屏阅读器（null=关闭）
  const [readerFontStep, setReaderFontStep] = useState(0); // 阅读器字号档偏移：-1/0/1/2/3（与 iOS IMTextReader 一致）
  // 本浏览器解不了该视频的编码（HEVC 等）→ 换成"下载后本地播放"的降级卡片，避免黑屏。
  // 按被查看的 URL 复位：换一条视频要重新给它一次播放机会，否则一次失败会连累后面每条。
  const [videoUnplayable, setVideoUnplayable] = useState(false);
  // 封面待点（对齐 iOS，任务3 优化）：视频页默认只显封面图，点 ▶ 才挂 <video> 播放。
  // 否则每翻到一条视频都要挂原生 controls 条 + preload=metadata 拉流，出现"黑色加载条"并使翻页发卡。
  const [videoStarted, setVideoStarted] = useState(false);
  // 按被查看**消息**（非 content URL）复位：两条不同消息可能引用同一视频 URL（如转发件），
  // 用 URL 作 key 会漏复位 → 第二条跳过封面直接自动播/沿用上一条的不可播态。msgKey 逐消息唯一。
  const viewedKey = viewer ? msgKey(viewer.m) : undefined;
  useEffect(() => { setVideoUnplayable(false); setVideoStarted(false); }, [viewedKey]);
  const [selectMode, setSelectMode] = useState(false); // 多选态
  const [selected, setSelected] = useState<Set<number>>(new Set()); // 已选消息的 convSeq 集合
  // selected 的「最新值」镜像：勾选上限闸要在一轮同步的多次 toggle 里累计计数（见 toggleSelected）。
  const selectedRef = useRef<Set<number>>(selected);
  selectedRef.current = selected; // 每次渲染同步：enter/exitSelectMode 等外部 setSelected 也随之生效
  const [tab, setTab] = useState<Tab>("chats"); // 左栏当前 Tab：消息 / 通讯录
  const contactsScrollRef = useRef<HTMLDivElement>(null); // 通讯录滚动容器（好友列表虚拟化的滚动父，见 VirtualList）
  const [contactFilter, setContactFilter] = useState(""); // 通讯录本地过滤（按备注/昵称/uid 即时筛已有好友；桌面端替代 iOS 的 A–Z 索引尺）
  const [friends, setFriends] = useState<FriendEntry[]>([]); // 全量好友/申请关系（含 pending/requested/accepted）
  // 本机显示名用的备注表：我给他起的备注 > 群昵称/全局昵称 > uid。**只用于渲染**——
  // 会被写进发出去的内容的地方（合并转发条目名 useForward.nameOf、@token）一律用公开名。
  // **必须放在早退（登录页分支）之前**：hooks 数量每次渲染必须一致，放到下面 senderLabel 旁边会炸。
  const remarks = useMemo(() => remarkMap(friends), [friends]);
  // 头像裁切请求（方案 C）：选好图后开裁切弹窗；确定拿到 blob 交给 onDone（个人/群各自上传落库）。
  const [friendMenu, setFriendMenu] = useState<{ x: number; y: number; userId: string } | null>(null); // 好友行 ⋯ 菜单
  const [convMenu, setConvMenu] = useState<{ x: number; y: number; c: Conversation } | null>(null); // 会话行右键菜单
  const [chatMenu, setChatMenu] = useState(false); // 聊天页右上 ⋮ 下拉菜单
  const [contactDraft, setContactDraft] = useState<{ peer: string; remark: string } | null>(null); // 编辑联系人（备注名）弹窗
  // 轻量浮层提示（如"xx（开发中）"）：状态 + 自动消失 + comingSoon 抽到 useToast（须先于用到它们的回调）。
  const { toast, setToast, comingSoon } = useToast();
  // 应用内确认/输入弹窗（替代原生 window.confirm/prompt）：状态与 askConfirm/askPrompt 抽到 useDialogs；
  // 弹窗本体 JSX 仍在下方渲染。须在使用 askConfirm/askPrompt 的回调之前调用（此处即最靠前）。
  const { confirmDlg, setConfirmDlg, promptDlg, setPromptDlg, askConfirm, askPrompt } = useDialogs();
  // 群公告/群简介全文视图（决策 16/17）：只读全文 + 复制 +（管理员）编辑；简介无发布者/时间/编辑。
  const [fullTextModal, setFullTextModal] = useState<{ kind: GroupTextKind; convId: string } | null>(null);
  const [accountCard, setAccountCard] = useState(false); // 左上角头像气泡卡片
  const [showSettings, setShowSettings] = useState(false); // 设置面板（占据侧栏列，右侧聊天保留）
  const [showCallHistory, setShowCallHistory] = useState(false); // 最近通话面板（CALL_HISTORY_DESIGN.md）
  const [privacyOpen, setPrivacyOpen] = useState(false); // 隐私与安全容器页（拉齐 iOS）
  const [blockedOpen, setBlockedOpen] = useState(false); // 已屏蔽的用户子面板（从隐私页进入）
  const [changePwdOpen, setChangePwdOpen] = useState(false); // 修改密码子面板（从隐私页进入）
  const [generalOpen, setGeneralOpen] = useState(false); // 通用设置子面板
  const [notificationsOpen, setNotificationsOpen] = useState(false); // 通知设置子面板（NOTIFICATIONS_DESIGN）
  const [languageOpen, setLanguageOpen] = useState(false); // 语言选择子面板
  const [performanceOpen, setPerformanceOpen] = useState(false); // 动画与性能（省电模式）子面板
  const t = useT(); // 同时订阅界面语言：切换时 App 重渲染（须在任何早退之前，见 saveRemark 处「login early-return」注释）
  // ---- 已登录设备 / 多设备管理（P2）：状态与操作抽到 useDevices（组件体后段调用，依赖 clientRef/askConfirm/setToast）----
  // ---- 自动下载策略 + 下载门控（M4-7，草图 §09 Web 映射）----
  // Web 只吃 Wi-Fi 档（浏览器分不清移动/Wi-Fi），且**始终提供手动下载**；策略本身仍随账号多端同步。
  const [dataStorageOpen, setDataStorageOpen] = useState(false);        // 设置 ▸ 数据与存储 子面板
  // 查看器一关（点蒙层 / ✕ / 定位·转发·删除等 setViewer(null) 的任一路径），「更多」浮层一并收起：
  // 否则残留的 viewerMore=true 会在下次打开任意媒体时立刻弹出上一张的菜单。
  useEffect(() => { if (!viewer) setViewerMore(false); }, [viewer]);
  // 通用设置项：theme / timeFormat / fontSize / sendKey / wallpaper 均为本机真功能。
  // ---- 群聊（M3-4）----
  const [groupConvId, setGroupConvId] = useState(""); // 当前打开的群会话 conv_id（"" = 单聊模式，peer 生效）
  const convId = peer ? convIdFor(uid, peer) : groupConvId; // 当前会话 id（唯一定义，下方各处引用；勿再内联重算）
  const [groupInfos, setGroupInfos] = useState<Record<string, GroupInfo>>({}); // conv_id -> 群资料缓存（标题/气泡昵称回退/资料面板共用）
  // @提及（M4-8，仅群聊）：面板开合 + 过滤词 + 候选表（显示名→uid，发送时按文本里是否还留着 token 复核）。
  // ---- 会话内搜索（SEARCH_DESIGN §4/§5）：顶栏搜索框 + 底部命中导航 ▲▼ + 📅日历 + 👤来自（纯本地）----
  // searchOpen/searchQuery 留在此处（受控）：下方 highlightSearch 定义在 useChatSearch 调用点之前、消息气泡渲染
  // 要读它俩；其余会话内搜索/日历/来自/首页搜索的全部状态与逻辑已抽到 useChatSearch（见下方 const search=…）。
  const [searchOpen, setSearchOpen] = useState(false);              // 会话内搜索态开关
  const [searchQuery, setSearchQuery] = useState("");               // 关键词（content+caption 大小写不敏感子串）
  // 已读名单弹窗（M4-8）：null=关闭；tab 切换已读/未读。
  const [readReceipts, setReadReceipts] = useState<{ read: string[]; unread: string[]; tab: "read" | "unread" } | null>(null);
  // 会话详情面板（右侧抽屉，对齐 iOS IMChatDetailViewController；单聊/群聊共用）。null=关闭。
  // fromOwnChat：从「当前正在聊的这个人」的聊天页顶栏头像进来的——此时不显示「消息」入口
  // （你已经在这个会话里了，点它等于原地不动）。与 iOS 的 showsMessagePill 取反同义。
  const [detail, setDetail] = useState<{ convId: string; isGroup: boolean; peer?: string; fromOwnChat?: boolean } | null>(null);
  const [peerCards, setPeerCards] = useState<Record<string, UserCard>>({}); // uid → GET /users/{id} 的权威名片（资料面板拉）
  const [deletedPeers, setDeletedPeers] = useState<Set<string>>(new Set());  // 确认已注销的 uid（资料面板显空态）
  const [detailTab, setDetailTab] = useState<DetailTab>("media"); // voice tab 2026-08-26；contacts tab 2026-08-29
  const [detailMsgs, setDetailMsgs] = useState<ChatMessage[]>([]); // 详情页签数据源（本地历史）
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 详情文件行右键菜单（转发/定位/取消下载/删除，对齐 iOS 长按）
  const [deleteMenu, setDeleteMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 删除两档子菜单 B（为所有人删除/仅删除自己）——由菜单 A 的「删除」展开，对齐 iOS 子菜单
  const [manageOpen, setManageOpen] = useState(false); // 群管理二级视图（改名/头像/简介/公告/禁言）
  const [adminPanelOpen, setAdminPanelOpen] = useState(false); // 群管理 →「管理员」二级面板（群主可增删、管理员只读）
  const [adminPicker, setAdminPicker] = useState<{ convId: string; selected: string[] } | null>(null); // 添加管理员弹窗（多选 ≤5）
  const [transferPicker, setTransferPicker] = useState<string | null>(null); // 选择新群主弹窗（单选即确认）的 conv_id
  // 二维码体系（QRCODE P0）+ G3 入群 UI 状态。
  const [muteDurationFor, setMuteDurationFor] = useState<{ convId: string; m: GroupMember } | null>(null); // 成员禁言时长选择
  const [detailMore, setDetailMore] = useState(false);  // 详情「更多」菜单开合
  const [friendRequests, setFriendRequests] = useState(false); // 通讯录「新的朋友」弹窗
  // 「发好友申请」弹窗草稿（全站五个加好友入口共用，见 FriendRequestModal 注释）。
  const [friendReqDraft, setFriendReqDraft] = useState<{ userId: string; name: string } | null>(null);
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; convId: string; m: GroupMember } | null>(null); // 成员行 ⋯ 菜单
  const memberMenuRef = useRef<HTMLDivElement | null>(null); // 菜单本体：捕获阶段关闭时用来排除菜单内点击
  // 外观/通用设置簇 → useAppearanceSettings（阶段 8a）：主题/字号/时间格式/发送键/壁纸 + 持久化 effect + isDark。
  const {
    theme, setTheme, isDark, fontSize, setFontSize, timeFormat, setTimeFormat, sendKey, setSendKey,
    wallpaper, setWallpaper, wallpaperBlur, setWallpaperBlur, wallpaperOpen, setWallpaperOpen,
    wallpaperColorOpen, setWallpaperColorOpen, colorHSV, pickWallpaperImage, resetWallpaper, applyWallpaperColor, openWallpaperColor,
  } = useAppearanceSettings(setToast);
  const clientRef = useRef<IMClient | null>(null);
  const notif = useAccountNotifySettings({ clientRef }); // 通知设置簇（private/group/badge 账号级+服务端同步，M5；inApp/desktop 仍每设备本地）；须在下方 useDesktopIntegration 之前
  // 系统深色偏好（仅在 theme==="system" 时决定实际明暗）：跟随 prefers-color-scheme 实时变化，供默认壁纸随主题切换。

  // 下载门控/缓存簇 → useMediaDownload（阶段 4）。须在 clientRef/setViewer/groupConvId/uid/setToast 之后、services useMemo（捕获 refreshDownloadSettings）与 enterApp/logout（调 restore/reset）之前。
  const {
    dlSettings, setDlSettings, dlStates, dlBlobs, mediaOptedIn, expiredSet,
    refreshDownloadSettings, saveDownloadSettings, mediaGate, mediaSrc, openReadyFile, saveMessageToDisk,
    markExpiredIfGone, onPassiveMediaError, onGateTap, clearMediaCache,
    optInMedia, restoreDownloadState, resetDownloadState,
  } = useMediaDownload({ uid, groupConvId, clientRef, setToast, setViewer });
  // 打开查看器 = 用户主动看原图 → 标记「已解门控」（对齐 iOS 档 B「点某格才打开查看器，此时才允许拉原件」）：
  // 之后该图/视频在气泡/相册/详情宫格/媒体库/引用条都显真帧、刷新仍在（opt-in 落 localStorage）。
  useEffect(() => {
    const vm = viewer?.m;
    if (!vm || !vm.content || vm.from === uid || vm.recalledAt) return;
    if (vm.contentType !== "image" && vm.contentType !== "video") return;
    optInMedia(vm.content);
  }, [viewer, uid, optInMedia]);
  // 会话置顶消息（G0）：conv_id -> 置顶集合（服务端按 pinned_at 倒序）。进会话拉一次，
  // 之后靠实时 msg_op{op:pin} 帧触发重拉——置顶是低频操作，重拉比在本地拼装列表更不容易错。
  const [pinnedByConv, setPinnedByConv] = useState<Record<string, PinnedMessage[]>>({});
  // 置顶集合镜像：WS 回调是登录那一刻建的闭包（见 enterApp），读不到后续的 state——
  // onMsgOp 要判断「被撤回/编辑的这条是不是横幅里的置顶项」，只能经 ref 取当前值（同 messagesRef 套路）。
  const pinnedRef = useRef<Record<string, PinnedMessage[]>>({});
  const schedulePinnedRefreshRef = useRef<KeyedDebounced | null>(null); // 置顶横幅合并重拉（见 schedulePinnedRefresh）
  const [pinnedIdx, setPinnedIdx] = useState(0);          // 多条置顶时横幅显示第几条（点条轮转）
  const [pinnedListOpen, setPinnedListOpen] = useState(false);
  // 顶部横幅本地收起（✕）：按「账号 + 会话 + 内容签名」记，仅隐藏视图、不动服务端置顶/公告。
  // 持久化到 localStorage——退出会话/刷新后仍保持收起，直到内容变化（新置顶/改公告）签名变了才复现。
  const [dismissedBanners, setDismissedBanners] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("im_dismissed_banners") || "{}") as Record<string, boolean>; }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("im_dismissed_banners", JSON.stringify(dismissedBanners)); } catch { /* 隐私模式写失败可忽略 */ }
  }, [dismissedBanners]);
  const composerRef = useRef<HTMLTextAreaElement>(null); // 聊天输入框（自适应高度 + 发送键策略）
  const currentConvRef = useRef<string>(""); // 当前打开的会话（供消息回调判断是否标记已读）
  // 桌面端集成（角标/通知/自启）。**必须在登录早退之前**（hook 数恒定）；回调经 bindCallbacks 回写。
  const desktop = useDesktopIntegration({ conversations, selfUid: uid, currentConvId: currentConvRef.current, notifySettings: notif.settings });
  // Web 标签页 favicon 角标（NOTIFICATIONS_P1_DESIGN §3）：仅浏览器版生效，hook 内部按 platform().isDesktop 短路。
  useFaviconBadge(conversations, notif.settings.badge.includeMuted);
  // 定时免打扰到期刷新（NOTIFICATIONS_P1_DESIGN §4.4）：到最近一个未来 mute_until 强制重渲染一次，
  // 列表铃铛/未读变灰/上面两个角标/例外列表这些都现读 Date.now()，App 一重渲染就自动翻新，不发请求。
  useMuteExpiryTick(conversations);
  // 超级群成员分页（2 万人量级）：`GET /groups/{id}` 只回我自己，成员表得按页拉。
  // 普通群不用这套（服务端一次全量下发，改走分页只会多打请求）。
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  // 渲染窗口：**可移动的区间**，不是"尾部 N 条"。
  //
  // 第一版写成了尾部计数，跳到第 123 条时只能靠把窗口"撑大"到覆盖它——实测直接涨到 3 万条
  // 全渲染，等于没做窗口。正确模型是窗口**移动**：anchor 为空=贴最新，非空=以那条为中心。
  const RENDER_WINDOW_STEP = 200;
  // 渲染窗口的**硬上限**（3 页，对齐 iOS 的 kIMWindowMaxPages）。
  //
  // 窗口在进会话时是 200 条，但向上展开那条路原先是 `size + STEP` 一路加到本地全量——
  // 实测每上翻一次 +200 行 / +1400 个 DOM 节点，翻 6 次就到 1400 行 / 9802 节点，
  // 二十来次即回到 W2 当初要消灭的量级（那次现场是 4199 行 / 29537 节点）。
  // 触顶之后改为**滑动**：以当前顶部那条为锚点重开一窗，等量丢掉下方那截，
  // 位置由 histAnchorRef 的按消息补偿保住（与取回更早一页同一套）。
  const RENDER_WINDOW_MAX = RENDER_WINDOW_STEP * 3;
  const [renderView, setRenderView] = useState<{ anchor: number | null; size: number }>(
    { anchor: null, size: RENDER_WINDOW_STEP });
  const renderViewRef = useRef(renderView);               // 稳定回调（driveLocate）里读当前值
  const msgsByConvRef = useRef<Record<string, ChatMessage[]>>({}); // 同上：定位要判本地库有没有
  const [superMembers, setSuperMembers] = useState<GroupMember[]>([]);
  const [superCursor, setSuperCursor] = useState<{ next: string; hasMore: boolean }>({ next: "", hasMore: false });
  // 成员分页的**在途守卫**。用 ref 不用 state：state 要等下一次渲染才可见，而连点的间隔比那还短——
  // 2000 人群实测连点「加载更多成员」，两次点击读到同一个 superCursor.next，同一页被拉两次、
  // 追加两次，列表里整整多出 50 行重复成员（iOS 侧一直有这个守卫，Web 漏了）。
  const superLoadingRef = useRef(false);
  // 同一件事的**可渲染副本**：ref 改了不触发重渲染，而按钮文案与「自动续拉是否挂监听」都要看它。
  const [superLoading, setSuperLoading] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef<number>(0);
  const msgsRef = useRef<HTMLDivElement>(null); // 消息滚动容器
  const messagesRef = useRef<ChatMessage[]>([]); // 当前会话已加载消息镜像（供定义在派生之前的回调读取，如 jumpToSeq）
  const dividerRef = useRef<HTMLDivElement>(null); // 未读分割线（进会话定位用）
  // 上滚加载历史前的保位锚点：seq=当时渲染集最早那条、top=它相对容器顶的偏移。
  // 窗口是**定长滑动**的（恒 200 条，OFFLINE_BACKLOG_DESIGN §4.7）：取回一页后上沿下移、下沿同步收窄，
  // scrollHeight 几乎不变，靠「前后 scrollHeight 之差」补偿会算出 0，用户正看的那条被甩到 100 行开外。
  // 按「同一条消息补偿前后的位置差」保位才对；h/t 仅作该条已不在窗口内时的兜底。
  const histAnchorRef = useRef<{ seq: number; top: number | null; h: number; t: number } | null>(null);
  // 向**下**翻页的保位锚点（与 histAnchorRef 对称）。定长窗口贴最新时是「滑动」而不是「变长」：
  // 取回 [201..400] 后 visibleSlice 给出的是 [201..400]，上一窗 [1..200] 整段从 DOM 里消失，
  // scrollTop 数值没变、指向的却是 200 条之后的另一条消息——用户一路往下读会**每翻一页跳一页**。
  // 锚点取窗口**最后一条**：向下翻页只会从顶部丢行，最后一条必然还在，是唯一稳的参照物。
  const tailAnchorRef = useRef<{ seq: number; top: number } | null>(null);
  const pendingScrollRef = useRef(false); // 刚进会话，待定位到未读/底部
  const wasNearBottomRef = useRef(true); // 追加消息前用户是否贴近底部
  // 「用户真的在往下滚」的证据：wheel(deltaY>0) / touchmove / 方向键。
  // scroll 事件本身分不清是手在滚还是程序在滚：定位移窗后浏览器钳位 scrollTop 会派发 scroll、
  // layout effect / jumpToSeq 赋 scrollTop 也会派发——只看 scroll 就把"跳到历史"当成"用户滚到底
  // 想回最新"，跳转当场被冲回尾部（2026-09-05 用户三报「仍然没解决」的真根因，见 onMsgsScroll）。
  const userScrollIntentRef = useRef(false);
  const prevMaxSeqRef = useRef(0); // 上次渲染的最大 conv_seq（判断底部是否来了更新的消息）
  const entryUnreadRef = useRef(0); // 进会话时的未读数（按钮初始计数）
  const entryUnreadCappedRef = useRef(false); // 该未读数是否撞了服务端计数上限
  const prevMinSeqRef = useRef(0); // 上次渲染的最小 conv_seq（判断顶部是否插了更早历史）
  const prevLenRef = useRef(0); // 上次渲染的消息条数（区分"新增消息"与"原条状态变更"如被拒收）
  // 区间清单（本地有哪几段）变更计数：渲染切段要同步读 client.rangesOf(convId)，
  // 而"预热完成""开窗拿回一段"这两种变更不一定伴随消息条数变化，没有它就不会重算。
  const [rangesTick, setRangesTick] = useState(0);
  const loadingOlderRef = useRef(false); // 是否正在上滚加载更早历史
  const loadingNewerRef = useRef(false); // 是否正在下滚加载更新历史
  const latestSeqRef = useRef(0); // 该会话服务端最新 conv_seq（判断下方是否还有未加载）
  const forceBottomRef = useRef(false); // jumpToBottom 触发的"强制定位到底"（忽略未读分割线）
  // 「自己刚发了一条」→ 下一次布局无条件贴底（CHAT_UX §9）。在历史里发消息时，下面滚动 effect 的
  // `lastMine && (grew || wasNearBottom)` 两个条件会同时不成立：跨窗口移动时 `grew`（按条数比）
  // 反而变短（锚点窗 600 → 尾窗 200），人在历史里 wasNearBottom 也是 false，于是一行滚动都不发生。
  const sendStickRef = useRef(false);
  const maxReadReportedRef = useRef(0); // 已上报的最大已读 conv_seq（可见即读，单调不回退）
  const pendingReadRef = useRef(0); // 已滚入视口的最大 conv_seq（节流后上报）
  const readTimerRef = useRef<number | null>(null); // 可见即读上报的节流定时器
  const conversationRefreshTimerRef = useRef<number | null>(null); // sync 批量消息只触发一次会话列表刷新
  // 会话列表刷新节流：ack/receipt/conv_update/group/msg_op 都会触发一次 fetchConversations，
  // 高频收发时叠成请求风暴（日志见同时 3-4 个 GET 在飞、300-400ms）。合并进 400ms 窗口只发一次，
  // 且串行化（在飞时置脏，回来后再补一次），避免并发拉取。
  const listRefreshTimerRef = useRef<number | null>(null);
  const listRefreshInFlightRef = useRef(false);
  const listRefreshDirtyRef = useRef(false);

  // 出箱消息的本地回显入口（文本/媒体/语音/转发/名片**都**走它，入站走 ingestInbound）：在这单点做
  // "发送即回到最新"——窗口拉回贴最新 + 置位 sendStickRef。此前只有 send()（文本）复位了窗口，
  // 发图/发语音/转发/发名片全没有，在历史里发这些同样看不到自己刚发的那条（2026-09-05 用户实测第 1 条）。
  const appendMsg = useCallback((cid: string, m: ChatMessage) => {
    if (cid === currentConvRef.current) {
      sendStickRef.current = true;
      setRenderView({ anchor: null, size: RENDER_WINDOW_STEP });
    }
    appendMsgRaw(cid, m);
  }, [appendMsgRaw]);

  // 语音转文字（展开态表 + 发起/收起 + WS 落地 + 面板撑高后把文字补进视口）：见 useVoiceTranscript.ts。
  const { transcripts, transcribeMessage, applyRemoteTranscript } = useVoiceTranscript({ clientRef, setToast, setMenu, boxRef: msgsRef });

  // 在线态定时重算：服务端**不推下线帧**，对端离线是靠本地租约到期体现的——而"租约到期"是
  // 纯粹的时间流逝，不改变任何 state，React 不会因此重渲染。不自己敲这个心跳的话，用户静止不动时
  // 副标题与列表绿点会永远停在「在线」。30s 周期同时让降档后的「N 分钟前在线」随时间推进。
  useEffect(() => {
    const id = setInterval(() => setPresenceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // 打开单聊时若还没有该对端的在线态，补拉一次快照。
  // 会话列表只覆盖「已有会话」的对端；从通讯录点进一个从没聊过的好友，列表里根本没有这一项，
  // 而 broadcastOnline 的收件人也取自会话成员（此时同样不含我），故不补这一下就永远是空白。
  useEffect(() => {
    if (!peer || groupConvId || presence[peer]) return;
    let cancelled = false;
    void clientRef.current?.fetchUserPresence(peer)
      .then((p) => { if (!cancelled) setPresence((prev) => (prev[peer] ? prev : { ...prev, [peer]: p })); })
      .catch(() => { /* 在线态是锦上添花，失败静默 */ });
    return () => { cancelled = true; };
    // presence 故意不进依赖：只在「首次没有」时拉一次，避免拿到空态后反复重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer, groupConvId]);

  // 资料卡片跟随会话切换：卡片开着时切到另一个会话 → 卡片切到新会话对应的资料卡（群/单聊）。
  // 只在会话 id 变化时触发（依赖 peer/groupConvId）；对「群成员资料页」这类不改变当前会话的入口无影响
  // ——它们不改 peer/groupConvId，effect 不会跑，卡片保持不动。
  useEffect(() => {
    const activeCid = groupConvId || (peer ? convIdFor(uid, peer) : "");
    const follow = resolveDetailFollow({
      detailOpen: !!detail,
      detailConvId: detail?.convId ?? "",
      activeCid,
      isGroup: !!groupConvId,
    });
    if (follow.action === "group") openGroupPanel(follow.convId);
    else if (follow.action === "peer") openPeerDetail(peer, true); // fromOwnChat：已在该会话里，不显示「消息」入口
    // openGroupPanel/openPeerDetail 为稳定的普通函数；detail 仅取快照判定，无需进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer, groupConvId, uid]);

  // 对端不在线时低频重拉快照（每 2 分钟）。
  // 单聊 topic 随首条消息才建立，故「好友但从没聊过」的对端不在 broadcastOnline 的收件人集合里——
  // 他上线时我收不到 presence 帧。租约模型只会让状态降级，没有任何东西能把它升回「在线」，
  // 不轮询的话这类会话里对方永远显示为离线。已在线时不轮询（有租约 + 有帧，够用了）。
  useEffect(() => {
    if (!peer || groupConvId) return;
    const id = setInterval(() => {
      if (isOnline(presence[peer])) return;
      void clientRef.current?.fetchUserPresence(peer)
        .then((p) => setPresence((prev) => ({ ...prev, [peer]: p })))
        .catch(() => { /* 失败静默 */ });
    }, 120_000);
    return () => clearInterval(id);
  }, [peer, groupConvId, presence]);

  // 用会话列表里的在线态快照播种 presence 表。仅覆盖单聊且带快照的项——
  // 群聊无对端、老响应无这些字段，此时保留既有值（多半来自 presence 帧，比空值新）。
  const seedPresenceFromConversations = useCallback((convs: Conversation[]) => {
    setPresence((prev) => {
      const next = { ...prev };
      for (const c of convs) {
        if (c.is_group || !c.peer || c.peer_presence === undefined) continue;
        next[c.peer] = presenceFromConversation(c);
      }
      return next;
    });
  }, []);

  const refreshConversations = useCallback(async (): Promise<Conversation[]> => {
    try {
      const convs = await clientRef.current?.fetchConversations();
      if (convs) {
        setConversations(convs);
        seedPresenceFromConversations(convs); // 在线态**初始值**：presence 帧只报变化，不播种就只能靠碰巧撞上对方上线
        clientRef.current?.cacheConversations(convs); // 缓存：刷新/离线先秒显
        return convs;
      }
    } catch {
      /* 忽略 */
    }
    return [];
  }, []);

  // 本地库预载（登录 / 重连走全量 preloadLocal；会话刷新走 preloadNew，只登记新冒出来的会话）：见 useLocalPreload。
  const { preloadLocal, preloadNew } = useLocalPreload({ clientRef, seenByConv, deletedByConv, preloadMsgs });

  const scheduleConversationRefresh = useCallback(() => {
    if (conversationRefreshTimerRef.current !== null) {
      clearTimeout(conversationRefreshTimerRef.current);
    }
    conversationRefreshTimerRef.current = window.setTimeout(() => {
      conversationRefreshTimerRef.current = null;
      void refreshConversations().then(async (latest) => {
        if (latest.length === 0) return;
        // 新会话立即登记并只同步它们。开窗/翻页/conv_bump 也走到这里：已登记的会话不重读本地库、不再全量 sync。
        const fresh = await preloadNew(latest);
        if (fresh.length) clientRef.current?.syncTracked(fresh);
      });
    }, 150);
  }, [refreshConversations, preloadNew]);

  // 会话列表节流刷新：把一阵 ack/receipt/conv_update 风暴合并成 400ms 一发，并串行化拉取。
  // 与 scheduleConversationRefresh 的区别：那条负责 sync 批量新消息（还要 preloadLocal + syncTracked），
  // 这条只重拉列表，供纯"列表要变"的实时事件用，最省资源。
  const scheduleListRefresh = useCallback(() => {
    if (listRefreshTimerRef.current !== null) return; // 窗口内已排队，本次并入
    listRefreshTimerRef.current = window.setTimeout(() => {
      listRefreshTimerRef.current = null;
      if (listRefreshInFlightRef.current) { listRefreshDirtyRef.current = true; return; } // 有在飞的：置脏待补
      void (async () => {
        listRefreshInFlightRef.current = true;
        try {
          do {
            listRefreshDirtyRef.current = false;
            await refreshConversations();
          } while (listRefreshDirtyRef.current); // 拉取期间又来了事件 → 再补一次，收敛到最新
        } finally {
          listRefreshInFlightRef.current = false;
        }
      })();
    }, 400);
  }, [refreshConversations]);

  /**
   * 拉超级群成员的下一页。普通群不调用（服务端已随群资料一次全量下发）。
   * cursor 为空表示重新从第一页开始（打开群资料页时）。
   */
  const loadSuperMembers = useCallback(async (convId: string, cursor: string) => {
    const tok = clientRef.current?.authToken ?? "";
    if (!convId || !tok) return;
    if (superLoadingRef.current) return; // 连点/慢网下的重复请求（见 superLoadingRef 注释）
    superLoadingRef.current = true;
    setSuperLoading(true);
    try {
      const page = await fetchGroupMembersPage(tok, convId, { cursor, limit: 50 });
      setSuperMembers((prev) => {
        if (!cursor) return page.members;
        // 按 user_id 去重再追加。守卫已挡住连点，这里兜的是另一种重叠：keyset 游标翻页期间
        // 有人进群/退群，相邻两页可能覆盖到同一个人。2000 人的群这事随时可能发生。
        const seen = new Set(prev.map((m) => m.user_id));
        return [...prev, ...page.members.filter((m) => !seen.has(m.user_id))];
      });
      setSuperCursor({ next: page.next_cursor ?? "", hasMore: !!page.has_more });
    } catch {
      // 拉不到就维持现状：成员 Tab 少几行，不影响聊天本身。
      setSuperCursor((prev) => ({ ...prev, hasMore: false }));
    } finally {
      superLoadingRef.current = false;
      setSuperLoading(false);
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

  // 拉群资料进缓存 + 群成员表过期检测（会话开着时有人改名再发消息 → 节流重拉），见 useGroupInfoRefresh.ts。
  const refreshGroupInfo = useGroupInfoRefresh(clientRef, setGroupInfos, groupConvId, msgsByConv, groupInfos);

  // 打开群会话：与 openChat 同一套进会话定位逻辑，只是标识从 peer 换成 conv_id。
  const openGroupChat = useCallback((cid: string) => {
    if (!cid) return;
    setPeer("");
    setGroupConvId(cid);
    currentConvRef.current = cid;
    setRenderView({ anchor: null, size: RENDER_WINDOW_STEP }); // 切会话回到贴最新
    clientRef.current?.watchUsers([]); // 切到群聊：清空单聊在线态关注（群成员在线不走 watch）
    const conv = conversations.find((c) => c.conv_id === cid);
    const readSeq = conv?.read_seq ?? 0;
    const latestSeq = conv?.latest_conv_seq ?? 0;
    // 群聊已读双勾：用「全员已读位点」播种 peerReadSeq —— 群里没有单一对端，只有**人人都读过**
    // 才算已读（读得最慢的成员决定位点）。非实时：进会话/刷新列表时取快照值（后端不推群 receipt）。
    setPeerReadSeq((prev) => ({ ...prev, [cid]: Math.max(prev[cid] ?? 0, conv?.group_read_seq ?? 0) }));
    setEntryUnread(conv?.unread ?? 0);
    entryUnreadRef.current = conv?.unread ?? 0;
    entryUnreadCappedRef.current = conv?.unread_capped === true;
    setEntryReadSeq(readSeq);
    latestSeqRef.current = latestSeq;
    pendingScrollRef.current = true;
    forceBottomRef.current = false;
    setShowJump(false);
    setJumpCount(0);
    maxReadReportedRef.current = readSeq;
    pendingReadRef.current = readSeq;
    clientRef.current?.openConversation(cid, readSeq, latestSeq, conv?.unread ?? 0, maxSeqOf(msgsByConvRef.current[cid] ?? []));
    void refreshGroupInfo(cid); // 群资料：标题成员数 / 气泡昵称回退 / 资料面板
    // 进会话即清手动"标未读"（IM 通行做法）；多端经 conv_update 同步。
    if (conv?.marked_unread) {
      void clientRef.current?.updateConvSettings(cid, { pinned_at: conv.pinned_at ?? 0, muted: !!conv.muted, marked_unread: false }).then(() => refreshConversations()).catch(() => {});
    }
    void refreshConversations();
  }, [conversations, refreshConversations, refreshGroupInfo]);

  // 群聊已读双勾「非实时」刷新：会话列表刷新（进会话/sync 后）时，把当前打开群的「全员已读位点」
  // 喂进 peerReadSeq，使「全员都读过→蓝双勾」无需退出会话即可更新——后端刻意不推群 receipt
  // （避免 O(N²) 扇出），会话列表快照是这个蓝勾唯一的更新时机。单调只增，不覆盖单聊的实时位点。
  useEffect(() => {
    if (!groupConvId) return;
    const gseq = conversations.find((c) => c.conv_id === groupConvId)?.group_read_seq ?? 0;
    if (gseq > 0) {
      setPeerReadSeq((prev) => (gseq > (prev[groupConvId] ?? 0) ? { ...prev, [groupConvId]: gseq } : prev));
    }
  }, [conversations, groupConvId]);

  // 找人/好友动作/黑名单 → useFriendOps；本人资料 → useProfileEdit（阶段 8b）。须在 refreshFriends/clientRef/setToast 之后。
  const { searchQ, setSearchQ, searchResults, setSearchResults, busyUser, blockedList, doSearch, doFriendAction, openBlacklist, unblock } =
    useFriendOps({ clientRef, setToast, refreshFriends });
  const { myInfo, setMyInfo, profileDraft, setProfileDraft, profileBusy, cropReq, setCropReq, loadMyInfo, openProfile, saveProfile, onPickAvatar,
    profileEditing, enterProfileEditing, cancelProfileEditing } =
    useProfileEdit({ clientRef, setToast });

  // token 非空=扫码登录路径（无密码，走 connectWithToken）；否则密码/免密登录。
  // name 是 **username**（登录凭据）；token 非空则走扫码会话（此时 knownUid 是票据带回的内部 ID）。
  const enterApp = useCallback(async (name: string, pwd: string, token?: string, knownUid?: string, refresh = "") => {
    if (!name && !knownUid) {
      setAuthErr(t("login.error.username_required"));
      return;
    }
    refreshRef.current = refresh;
    setAuthBusy(true);
    setAuthErr("");
    // 防「被自己上一次登录踢下线」：先断旧 client，否则同 device_id 再登被 upsert 顶替，旧 client 拿撤销 token 探活得 100101 触发 logout 把新会话一起踢回登录页。
    clientRef.current?.disconnect(); clientRef.current = null;
    const client = new IMClient({
      onState: (nextState) => {
        setState(nextState);
        // 离线冷启动后重连成功：补取权威会话列表、登记新会话并从各自连续游标同步。
        if (nextState === "connected" && clientRef.current) {
          void refreshConversations().then(async (latest) => {
            if (latest.length === 0) return;
            await preloadLocal(latest);
            clientRef.current?.syncTracked();
          });
        }
      },
      onMessage: (m, live) => {
        // 入站落库：本端已删拦截 + 同 conv_seq 去重（命中则合并权威元数据、不新增）见 useMessageStore.ingestInbound。
        // 可见即读：不在收到时立即标已读；新消息若落在视口内（贴底）会由 markVisibleRead 读到，看历史时留到滚下去再读。
        // 仅**新追加**才刷会话列表（合并/丢弃不刷）；全量/多页同步连续投递很多条，各自触发的刷新走节流合并。
        // 桌面通知只发**实时且新追加**的：live=false 是同步/开窗的批量投递（离线积压、翻页），弹了等于把历史又通知一遍。
        if (ingestInbound(m)) { scheduleConversationRefresh(); if (live) desktop.notifyInbound(m); }
      },
      // 一页历史到达（上滑/下滑分页的响应，含出错/空页）：解除该会话的分页忙标志。
      // 忙标志此前只靠「渲染集边界移动」复位——页里全是本地已有的（去重后一条没新增）、
      // 已到可见下界回空页、或请求被服务端拒绝时，边界不动、标志永远卡住，上下翻页从此全被当 busy 跳过。
      // 以「响应到了」为准才可靠；边界移动那条复位仍保留，两者取先到者。
      // 「本地有哪几段」变了：重算渲染切段（切段判"中间是没下载、还是本就不是消息"要问它）。
      onRanges: () => setRangesTick((t) => t + 1),
      onHistoryPage: (cid) => {
        if (cid !== currentConvRef.current) return;
        loadingOlderRef.current = false;
        loadingNewerRef.current = false;
      },
      onAck: (clientMsgId, ok, convSeq, serverTs) => {
        // 按 clientMsgId 换 status/conv_seq/服务器时间戳 + 成功者登记去重集（防 sync/carbon 重复回显），见 applyAck。
        applyAck(clientMsgId, ok, convSeq, serverTs);
        // 自己发送成功 → 刷新列表（新会话首条上屏、更新最后一条）。走节流：连发/群发不各拉一次（否则 GET 风暴）。
        if (ok) scheduleListRefresh();
      },
      onReceipt: (convId, from, status, upToSeq) => {
        if (status !== "read") return;
        if (from === uidRef.current) {
          // 多端已读同步（M1）：我在另一端已读 → 本端列表未读清零（服务端已记位点，刷新即得）+ 收掉读过那段的桌面通知。
          scheduleListRefresh(); desktop.clearNotifications({ convId, upTo: upToSeq });
        } else {
          setPeerReadSeq((prev) => ({ ...prev, [convId]: Math.max(prev[convId] ?? 0, upToSeq) }));
          // 对端已读 → 刷新左侧列表，让"我发的最后一条"在列表里也即时变蓝双勾（否则要切会话才更新）。
          scheduleListRefresh();
        }
      },
      // 超级群轻量信号（2 万人量级）：服务端不推全文，只说「某会话最新到 seq 了」。
      //   · 会话列表：走既有的节流刷新，从服务端拿到权威的预览/未读（比自己拼更不容易错）。
      //   · **正开着的那个会话**：贴底跟随时补上新的那段（不补就停在旧消息上，最像"消息丢了"）；
      //     在翻历史时不补，↓N 计数、点 ↓ 再取（C4，判据见 windowPlan.planBumpCatchUp）。
      // 没开着的会话不拉，那正是信号化省下的开销。
      onConvBump: (items) => {
        scheduleConversationRefresh();
        const openConv = currentConvRef.current;
        if (!openConv) return;
        const hit = items.find((it) => it.conv_id === openConv);
        if (!hit) return;
        // 本地最新取**本地全量**（不是渲染窗口）：锚点模式的窗口不含尾部。跟随与否看 wasNearBottomRef。
        const localNewest = maxSeqOf(msgsByConvRef.current[openConv] ?? []);
        clientRef.current?.catchUpOnBump(openConv, hit.latest_seq, localNewest, wasNearBottomRef.current);
      },
      // 锚点窗口到达：消息已落库，这里只决定"滚过去"还是"告诉用户没了"。
      // **anchor_found=false 才是真的没有**——旧实现靠"翻满 40 页没见到"来猜，会误报删除。
      onWindow: (meta) => {
        const pend = pendingLocateRef.current;
        if (!pend || pend.convId !== meta.convId) return;
        // 锚点对不上=这帧回的是更早那次开窗（连点了两个定位入口），用了它会跳到上一个目标。
        if (meta.anchor !== pend.seq) return;
        // 「最早」不认这条：它的锚点 conv_seq=1 十有八九不是一条消息（msg_op 事件行/墓碑/
        // 入群前不可见的行都占号），而这一窗**照样带回了最早那一段**，丢掉它才是真的白跑。
        if (!meta.anchorFound && !pend.earliest) {
          pendingLocateRef.current = null;
          setToast(t("conv.error.original_deleted"));
          return;
        }
        // 只记「窗口已到」，**滚动交给 driveLocate**（下一次渲染后由 effect 推进）。
        // 这里直接 jumpToSeq 是错的：开窗只把消息灌进本地库，**渲染窗口还停在贴最新那一段**
        //（visibleSlice 按 renderView.anchor 切片，没人动过它），目标根本没有 DOM 节点，
        // 于是第一次点击必然落空——只弹一句"原消息较早，请上拉加载后重试"；再点一次才因为
        //"本地已有"走到 driveLocate 的移窗分支。这就是「点置顶消息要点两次才过去」
        //（2026-09-05 实测：置顶横幅 / 搜索「最早」/ 引用条 / 详情页定位全中，它们共用这条路）。
        pendingLocateRef.current = { ...pend, windowed: true };
      },
      onPresence: (user, p) => setPresence((prev) => ({ ...prev, [user]: p })),
      onTyping: (convId, from) => {
        if (from === uidRef.current) return;
        setTypingConv({ convId, uid: from });
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setTypingConv(null), 3000);
      },
      // 好友关系实时变更：刷新通讯录（"新的朋友"红点/列表即时更新，无需切 Tab）。
      // event=remark 是备注名多端同步（本人在 iOS / 另一个浏览器改了备注，只推给本人各端）：
      // 显示名取自会话行的 peer_remark，故必须连会话列表一起刷，否则聊天页/列表还挂着旧名字。
      onFriend: (event) => {
        void refreshFriends();
        if (event === "remark") scheduleListRefresh();
      },
      // 群成员/资料实时变更：刷新会话列表 + 该群资料缓存；自己被移出 → 提示并退出该会话。
      onGroup: (event, cid, _from, target, result) => {
        // G3 join_result 推给非成员申请人：审批结果只提示，不去拉群资料（被拒时非成员，会 403）。
        if (event === "join_result") {
          setToast(t(result === "approved" ? "conv.qr.join_approved" : "conv.qr.join_rejected"));
          if (result === "approved") scheduleListRefresh();
          return;
        }
        scheduleListRefresh();
        if (event !== "dissolve") void refreshGroupInfo(cid); // 被移出时 fetch 报 300203 → 自动清缓存；解散后群已不存在，无需再拉
        // G3 join_request 只推群主/管理员：pending_count 随上面 refreshGroupInfo 更新 → 聊天页审批横幅/详情页红点即时刷新。
        // 待审列表开着则重拉；未开则给一条轻提示（横幅才是主要落点，保持不吵）。
        if (event === "join_request") {
          void reloadJoinRequests(cid);
          setToast(t("group.event.join_request_new"));
          return;
        }
        // 被移出/别端退群（leave，服务端连退群者本人也推）且 target=自己，或群被解散（dissolve，管理端处置，对全体生效）→ 提示并退出该会话。
        if (((event === "remove" || event === "leave") && target === uidRef.current) || event === "dissolve") {
          setToast(t(event === "dissolve" ? "group.event.dissolved" : event === "leave" ? "group.event.left" : "group.event.removed"));
          setDetail((d) => (d?.convId === cid ? null : d));
          if (currentConvRef.current === cid) {
            currentConvRef.current = "";
            setGroupConvId("");
          }
        }
      },
      // 某条消息被拒收（被拉黑）→ 标记该条发送失败 + 把原因挂到该条 note（微信式：红❗+下方居中系统行，不弹窗）。
      onMsgRejected: (clientMsgId, msg, code) => markRejected(clientMsgId, msg, code),
      // 消息操作（撤回/编辑/置顶）应用到某条消息（按 conv_seq 定位）→ 就地打补丁（撤回→墓碑，编辑→改文本）。
      onMsgOp: (cid, targetSeq, patch) => {
        // 编辑改了正文 → **同时清掉 @ 片段**：偏移是相对原文的，留着会按错位的位置高亮，
        // 而且点进去是另一个人（服务端落库时也清了，这里是内存态与之对齐）。
        const opPatch = patch.content !== undefined ? { ...patch, mentionSpans: undefined } : patch;
        applyOp(cid, targetSeq, opPatch); // 按 conv_seq 就地打补丁（撤回→墓碑/编辑→改文本/置顶）
        if (patch.recalledAt !== undefined) desktop.clearNotifications({ convId: cid, convSeqs: [targetSeq] }); // 撤回 → 收回它的桌面通知
        // 置顶态变化（G0）：重拉该会话置顶集合刷新顶部横幅（含别人置顶/取消置顶的实时同步）。
        // 撤回/编辑若命中横幅里的置顶项**也要重拉**：服务端置顶列表已剔除撤回消息（PinnedMessages
        // 带 recalled_at = 0）、编辑则改了文案；不刷会留一条指向墓碑/旧文案的横幅——点它只会滚到
        // 一条「撤回了一条消息」的系统行并高亮，用户看不出原消息已经没了（与 iOS +SendService 同口径）。
        const touchesPinnedBanner = (patch.recalledAt !== undefined || patch.editedAt !== undefined)
          && (pinnedRef.current[cid] ?? []).some((pm) => pm.convSeq === targetSeq);
        if (patch.pinnedAt !== undefined || touchesPinnedBanner) void refreshPinned(cid);
        // 全屏阅读器持有的是 ChatMessage 快照：被读的这条一旦撤回/编辑，快照即失真（撤回内容仍可读可复制）→ 关闭，让用户回到会话看最新态。
        setTextReader((r) => (r && r.convId === cid && r.convSeq === targetSeq ? null : r));
        scheduleListRefresh(); // 撤回后会话列表预览也要更新（"撤回了一条消息"）
      },
      // 我发起的操作被拒（如撤回超时 300008、无权删除 300006）→ toast 提示（不改消息本身）。
      onMsgOpFailed: (_op, _cid, _seq, msg) => setToast(msg),
      // 消息被物理移除（任务2）：为所有人删除（op=delete）/ 仅为我删除（msg_hidden）→ 从聊天列表 + 详情文件列表移除该条。
      // 若删掉的正好是一条置顶消息，服务端下次不再返回它——重拉一次免得横幅指向已消失的消息。
      // **不看是否命中横幅**（置顶列表还没加载完时会漏判、横幅晚一拍），改成按会话合并：短时间内多条移除
      // （别人批量删、msg_hidden 批量帧）只拉一次。只管打开过的会话——没拉过置顶的会话进来时自会拉。
      onMessageRemoved: (cid, targetSeq) => {
        // 经 ref 取：本回调是登录时建的闭包，schedulePinnedRefresh 声明在下方，别让它依赖声明顺序与 memo 恒定。
        if (cid === currentConvRef.current || cid in pinnedRef.current) schedulePinnedRefreshRef.current?.(cid);
        removeSeq(cid, targetSeq); desktop.clearNotifications({ convId: cid, convSeqs: [targetSeq] }); // 从聊天列表移除该条 + 收回它的桌面通知
        setDetailMsgs((prev) => prev.filter((m) => !(m.convId === cid && m.convSeq === targetSeq)));
        setViewer((v) => (v && v.m.convId === cid && v.m.convSeq === targetSeq ? null : v)); // 正在查看的媒体被删 → 关查看器
        setTextReader((r) => (r && r.convId === cid && r.convSeq === targetSeq ? null : r)); // 正在全屏读的文本被删（为所有人删/仅删我）→ 关阅读器
        scheduleListRefresh(); // 会话列表末条预览可能随之变化
      },
      // 会话级设置变更（置顶/免打扰/标未读/删除会话，M4.5）：多端同步 → 重新拉取权威会话列表覆盖本地。
      onConvUpdate: () => { scheduleListRefresh(); },
      // 账号级配置变更（M4-7）：另一端改了自动下载策略 → 重拉（零新链路的多端同步）。
      onVoiceTranscript: (convId, convSeq, status, text) => { void convId; applyRemoteTranscript(convSeq, status, text); },
      onCapabilitiesUpdate: (version) => {
        logger.info(LOG_TAG.media, "capabilities_update_received", { version });
        void refreshDownloadSettings();
      },
      onNotifySettingsUpdate: (version) => void notif.onServerVersionBump(version), // 账号级通知设置版本变更（M5 §6.13）→ 本端按需重拉
      // 续期凭据变化（登录下发 / 改密轮换 / 已死清空）→ 记下并尽快落盘；uid 尚未定时由入场末尾那次 saveSession 兜住。
      onRefreshToken: (t) => { refreshRef.current = t; if (uidRef.current) saveSession({ uid: uidRef.current, username: name || loginName, refresh: t, token }); },
      // 鉴权失效分两类处理：
      // ① 100101 吊销/被踢下线 → 强制退登，直接跳登录页（不给可取消弹窗——被踢是不可协商的，
      //    「边看本地边被踢」自相矛盾）；原因写到登录页顶部红字。与 iOS 握手 401 直跳登录对齐。
      // ② 其余（100102 过期等良性失效）→ 仍弹框二选一：确定重新登录 / 取消留看本地缓存聊天记录。
      onAuthError: (msg, code) => {
        // 兜底：只有「当前活动 client」的鉴权失效才处理；被顶替的旧 client 残留重连不得代表新会话踢 app。
        if (client !== clientRef.current) return;
        if (code === 100101) {
          logout();
          // 重连路径里 100101 只会是「会话被吊销」（活 token 老化只会得 100102），即被踢/退其他/超限 LRU。
          setAuthErr(t("login.session_revoked")); // logout 会清 authErr，故放其后
          return;
        }
        void askConfirm(t("login.reconnect_failed_confirm", { msg }), { okText: t("login.relogin") })
          .then((ok) => {
            if (!ok) return;
            logout();
            setAuthErr(msg); // logout 会清 authErr，故放其后
          });
      },
    });
    clientRef.current = client;
    setLogContext(name || knownUid || ""); // 让后续每条 dev 日志带上账号标签（登录后换成内部 ID）
    try {
      if (token) await client.connectWithToken(knownUid || "", token, refresh); // 扫码登录：票据已带内部 ID
      else await client.connect(name, pwd, refresh); // 首次登录失败（密码错误等）会抛错
    } catch (e) {
      const code = (e as { code?: number }).code;
      const cached = client.cachedConversations();
      if (code === undefined && cached.length > 0) {
        // 服务器不可达不是登录态失效：保留 client 的后台重连，直接进入本地会话页显示“未连接”。
        // 注意此路径拿不到新的内部 ID（压根没连上），只能沿用已存会话里的那个。
        clientRef.current = client;
        setConversations(cached);
        await preloadLocal(cached);
        saveSession({ uid: knownUid || uid, username: name || loginName, refresh: refreshRef.current, token });
        setAuthBusy(false);
        setPhase("app");
        return;
      }
      client.disconnect();
      clientRef.current = null;
      setAuthBusy(false);
      setAuthErr((e as Error).message || t("login.error.login_failed"));
      return;
    }
    // 连接成功：client.userId 是服务端分配的**内部 ID**（密码路径由 /login 响应带回，
    // 扫码路径就是票据里的那个）。从这一刻起本地库分区、conv_id 推导、接口参数全部用它。
    const myUID = client.userId;
    uidRef.current = myUID;
    setUid(myUID);
    setLogContext(myUID);

    // 先用缓存的会话列表 + 本地消息秒显（刷新/弱网即时可见）。
    const cached = client.cachedConversations();
    if (cached.length) {
      setConversations(cached);
      await preloadLocal(cached);
    }
    // 再拉服务端最新会话列表，预载本地消息并按本地位点增量同步补新消息。
    const convs = await refreshConversations();
    if (convs.length) await preloadLocal(convs);
    client.syncTracked(); // OPEN 前调用安全无副作用；onopen 会从各会话连续持久化位点补拉到最新
    void refreshFriends(); // 拉好友关系：让"通讯录"Tab 的新申请红点即时显示
    void loadMyInfo();     // 拉本人资料：左上角头像 / 设置页头部立即可用
    void refreshDownloadSettings(); void notif.syncAfterLogin(myUID); // 拉账号级自动下载策略 + 通知设置（M4-7/M5，多端同步）
    // 部署级能力/配额（超级群开关、群成员上限）：本次会话内不会变，登录后拉一次即可。
    // 失败不阻断登录——UI 会退回保守默认值，真超限仍由服务端兜底拒绝。
    // **取 client.authToken 而不是入参 token**：入参只有扫码登录路径才有值，
    // 密码/免密登录时是 undefined——照它取会静默 401（第一版就是这么错的）。
    void fetchServerConfig(client.authToken).then(setServerConfig).catch(() => { /* 保守默认即可 */ });
    void restoreDownloadState(myUID); // 回灌解门控记录 / 失效标记 / Cache Storage 已下载文件（见 useMediaDownload）
    // 保持登录：刷新后静默重登（Web #4）。扫码登录存 token（无密码，过期即回登录）。
    // **username 必须一起存**：重登走 /login，而它只认 username。
    saveSession({ uid: myUID, username: name || loginName, refresh: refreshRef.current, token });
    setAuthBusy(false);
    setPhase("app");
  }, [uid, loginName, appendMsg, refreshConversations, preloadLocal, scheduleConversationRefresh, scheduleListRefresh, refreshFriends, loadMyInfo, refreshGroupInfo]);

  // 静默恢复登录（Web #4）：挂载后若有已存会话 → 直接用存储凭据重登（成功直达主界面；
  // 网络失败且有本地会话缓存时直接进入会话页显示“未连接”；鉴权失败或无缓存才回登录页。
  useEffect(() => {
    const r = restoreRef.current;
    if (!r || phase !== "login") return;
    restoreRef.current = null;
    // 内部 ID 先落地（本地缓存按它分区，网络不可达时也要能显示本地会话）；username 供重登用。
    setUid(r.uid);
    uidRef.current = r.uid;
    setLoginName(r.username);
    void enterApp(r.username, r.legacyPwd ?? "", r.token, r.uid, r.refresh).finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 扫码登录入场：等 setUid 落地（uid===待入场 uid）后，用带正确 uid 的 enterApp 闭包连接。
  useEffect(() => {
    const p = pendingQrRef.current;
    if (!p || phase !== "login" || uid !== p.uid) return;
    pendingQrRef.current = null;
    void enterApp("", "", p.token, p.uid, p.refresh);
  }, [uid, phase, qrTrigger, enterApp]);

  // 注册账号（用户名 + 昵称 + 密码≥6位）→ 成功后直接登录。
  const doRegister = useCallback(async () => {
    if (!loginName || password.length < 6) {
      setAuthErr(t("login.error.register_requirements"));
      return;
    }
    // 昵称必填：全端显示名回退链止于它，留空会让界面露出 10 位数字内部 ID。后端也会拒，这里前置提示。
    if (!nickname.trim()) {
      setAuthErr(t("login.error.nickname_required"));
      return;
    }
    setAuthBusy(true);
    setAuthErr("");
    try {
      await registerAccount(loginName, password, nickname.trim());
    } catch (e) {
      setAuthBusy(false);
      setAuthErr((e as Error).message || t("login.error.register_failed"));
      return;
    }
    await enterApp(loginName, password); // 注册成功 → 直接用同一密码登录
  }, [loginName, nickname, password, enterApp]);

  const openChat = useCallback((p: string) => {
    if (!p || p === uid) {
      setToast(t("chat.error.invalid_uid"));
      return;
    }
    const cid = convIdFor(uid, p);
    setPeer(p);
    setGroupConvId(""); // 切回单聊模式
    currentConvRef.current = cid;
    setRenderView({ anchor: null, size: RENDER_WINDOW_STEP }); // 切会话回到贴最新
    clientRef.current?.watchUsers([p]); // 订阅对端在线态：首聊尚无会话也能即时收到上线（服务端 watch，PROTOCOL §5.5）
    // 进会话定位（CHAT_UX §3）：以 read_seq 为锚点——有未读则停在首条未读，否则到最新。
    const conv = conversations.find((c) => c.conv_id === cid);
    const readSeq = conv?.read_seq ?? 0;
    const latestSeq = conv?.latest_conv_seq ?? 0;
    // 进会话即用服务端已知的对端已读位点给聊天详情播种（否则只靠实时回执：对方早前已读、本标签页没在场时，
    // 列表显双勾而详情仍显单勾）。取较大值，避免覆盖刚到的更新回执。
    setPeerReadSeq((prev) => ({ ...prev, [cid]: Math.max(prev[cid] ?? 0, conv?.peer_read_seq ?? 0) }));
    setEntryUnread(conv?.unread ?? 0);
    entryUnreadRef.current = conv?.unread ?? 0;
    entryUnreadCappedRef.current = conv?.unread_capped === true;
    setEntryReadSeq(readSeq);
    latestSeqRef.current = latestSeq;
    pendingScrollRef.current = true;
    forceBottomRef.current = false;
    setShowJump(false);
    setJumpCount(0);
    // 可见即读：已读起点=进入前位点；只有滚入视口超过它的消息才上报（见 markVisibleRead）。
    maxReadReportedRef.current = readSeq;
    pendingReadRef.current = readSeq;
    clientRef.current?.openConversation(cid, readSeq, latestSeq, conv?.unread ?? 0, maxSeqOf(msgsByConvRef.current[cid] ?? [])); // 加载锚点窗口，余下双向分页
    // 进会话即清手动"标未读"（IM 通行做法：打开视为已处理）；多端经 conv_update 同步。
    if (conv?.marked_unread) {
      void clientRef.current?.updateConvSettings(cid, { pinned_at: conv.pinned_at ?? 0, muted: !!conv.muted, marked_unread: false }).then(() => refreshConversations()).catch(() => {});
    }
    void refreshConversations(); // 选会话后刷新列表（更新其他会话 / 排序）
  }, [uid, conversations, refreshConversations]);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY); // 显式退出/鉴权失效才清会话；网络失败不清（下次刷新仍自动重登）
    clientRef.current?.disconnect();
    clientRef.current = null;
    if (conversationRefreshTimerRef.current !== null) {
      clearTimeout(conversationRefreshTimerRef.current);
      conversationRefreshTimerRef.current = null;
    }
    schedulePinnedRefreshRef.current?.cancelAll(); // 挂着的置顶横幅合并重拉：别在登出后/换号后替旧会话去拉
    resetMsgStore(); // 清空消息表 + 去重/墓碑集
    currentConvRef.current = "";
    setConversations([]);
    setPresence({});
    setPeerReadSeq({});
    setFriends([]);
    setSearchResults(null);
    setSearchQ("");
    setTab("chats");
    // 登录页不保留任何已登录态面板；否则重新登录后设置面板会继续覆盖左栏。
    setShowSettings(false);
    setProfileDraft(null);
    setGeneralOpen(false);
    resetDevices();
    setWallpaperOpen(false);
    setWallpaperColorOpen(false);
    setMyInfo(null);
    setPassword("");
    setAuthErr("");
    setGroupConvId("");
    setGroupInfos({});
    setDetail(null);
    setGroupsModal(null);
    resetDownloadState(); // 下载门控缓存（M4-7）：revoke blob / 清下载态 / 清解门控与失效标记（见 useMediaDownload）
    setDataStorageOpen(false);
    setPhase("login");
  }, []);

  const deselect = useCallback(() => {
    currentConvRef.current = "";
    setPeer("");
    setGroupConvId("");
    setTypingConv(null);
    clientRef.current?.watchUsers([]); // 退出会话：取消在线态关注
    void refreshConversations();
  }, [refreshConversations]);

  // 媒体上传进度（M4+）：key=本地占位 clientMsgId，值为**媒体本体**已传/总字节数，
  // 在气泡左上角显“3.9 MB / 7.9 MB”（镜像 iOS）。传完/失败即删键，角标切回视频时长。
  // 失败的媒体/文件消息要能重试，就必须留住原始 File（浏览器无法从消息里还原它）。仅内存，刷新即失效。
  // 记 convId/groupId：重试时按**原会话/原相册**重发（不耦合当前打开的会话，宫格成员回原格）。
  // 语音发送簇 → useVoiceSend：录音条松手立即插占位、上传失败原地转 Failed（红❗可重传，不重录）。
  // 须先于 useMediaSend——resendOne 的语音分支要注入它的 retryVoiceUpload。
  const { sendVoice, retryVoiceUpload } = useVoiceSend({ uid, convId, clientRef, setToast, appendMsg, patchMsg, removeMsgRow });

  // 媒体/文件发送簇 → useMediaSend（阶段 5）：attachPanel/粘贴攒批/上传进度/批发·单发流水线/重试/附件入口。
  // 须在 clientRef/useMessageStore/uid/peer/groupConvId/setToast 之后、send()（deps 捕获 sendMediaBatch/uploadAndSend/pastedImages）之前。
  const {
    attachPanel, setAttachPanel, pendingFilesRef, uploadProgress, teardownOutboxUpload, hasActiveSend, toggleUploadPause,
    cancelSendMessage, pastedImages, setPastedImages, removePastedImage, onComposerPaste, addPastedFiles, sendMediaBatch, uploadAndSend,
    retryUpload, resendMessage, onMediaBubbleTap, fileInputRef, attachAnchorRef, cancelAttachClose, scheduleAttachClose, attachItems, pickFile, onFilePicked,
  } = useMediaSend({ uid, peer, groupConvId, clientRef, setToast, appendMsg, patchMsg, removeMsgRow, retryVoiceUpload });

  // @提及簇 → useMentions（阶段 7b）：须在 send()（读 mentionCandidates/mentionAllPending）之前；convId 在此处尚未定义，
  // 用与其定义完全相同的表达式就地计算（脚本已断言一致）。
  const {
    mentionQuery, setMentionQuery, mentionFilter, setMentionFilter, mentionActive, setMentionActive,
    mentionCandidates, mentionAllPending, mentionPanelRef, mentionActiveRef, mentionRows, pickMention, onMentionNavKey,
  } = useMentions({ convId, groupConvId, peer, uid, groupInfos, friends, input, setInput, composerRef,
    // 超级群 @人：候选走服务端搜索（本地成员表只有我自己）。q 为空时取第一页，够列出前几十人。
    searchGroupMembers: useCallback(async (cid: string, q: string) => {
      const tok = clientRef.current?.authToken ?? "";
      if (!tok) return [];
      const page = await fetchGroupMembersPage(tok, cid, { q, limit: 20 });
      return page.members;
    }, []),
  });
  const send = useCallback(() => {
    const text = input.trim();
    const client = clientRef.current;
    const cid = convId;
    if (!client || !cid) return;
    // 先发预览条攒的粘贴件（Web #2）：图片走相册批量通道（≥2 张聚簇成宫格），
    // 文件走既有文件通道（≥8MB 自动分片可暂停续传）；文字随后补发一条文本。
    if (pastedImages.length) {
      const items = pastedImages;
      setPastedImages([]);
      // 图说合并（Telegram 模型）：**恰好单件 + 有文字 + 非编辑/非引用态** → 文字作为 caption 与该媒体
      // 同发**一条**消息，不再补发独立文本。多件（相册）/编辑/引用态一律走原有「媒体+文本各发」路径
      //（相册不支持 caption；Web sendMedia 不支持 replyTo，引用态保持文本单发以免丢引用）。
      const caption = items.length === 1 && text && !(editingMsg && editingMsg.convSeq > 0) && !(replyTo && replyTo.convSeq > 0)
        ? text : undefined;
      // 配文 @提及（仅群聊）：从 caption 文本按输入框累积的 token 还原 uid / @所有人，随媒体消息上行（被@强提醒）。
      const capMentions = caption && !peer ? resolveMentions(caption, mentionCandidates.current) : [];
      const capMentionAll = caption ? (!peer && resolveMentionAll(caption, mentionAllPending.current)) : false;
      // 片段（2026-09-01）：位置随消息走，收端不必反查群成员表——超级群没那张表。
      const capSpans = caption && !peer ? resolveMentionSpans(caption, mentionCandidates.current, capMentionAll) : [];
      const capMentionOpts = { mentions: capMentions.length ? capMentions : undefined, mentionAll: capMentionAll || undefined,
                               mentionSpans: capSpans.length ? capSpans : undefined };
      const imgs = items.filter((pi) => pi.kind === "image" || pi.kind === "video");
      if (imgs.length) void sendMediaBatch(imgs.map((pi) => pi.file), caption ? { caption, ...capMentionOpts } : undefined);
      for (const pi of items) {
        if (pi.kind === "file") void uploadAndSend(pi.file, "file", undefined, caption, capMentionOpts.mentions, capMentionOpts.mentionAll);
        window.setTimeout(() => URL.revokeObjectURL(pi.url), 60_000);
      }
      if (caption) {
        // 文字已随媒体作为 caption 发出：清输入与提及态，不再走下面的独立文本发送。
        setInput("");
        mentionCandidates.current = {};
        mentionAllPending.current = false;
        setMentionQuery(null);
        return;
      }
    }
    if (!text) return;
    // 编辑态（M4-5）：发 msg_op edit 而非新消息；内容由服务端广播回 onMsgOp 更新。
    if (editingMsg && editingMsg.convSeq > 0) {
      client.editMessage(cid, editingMsg.convSeq, text);
      setEditingMsg(null); setInput("");
      return;
    }
    // 引用回复（M4-2）：带上目标 conv_seq + 本端即时快照（媒体→[图片]等；服务端会冻结权威快照给收件方）。
    const rt = replyTo && replyTo.convSeq > 0
      ? { convSeq: replyTo.convSeq, preview: replyPreviewOf(replyTo), from: replyTo.from }
      : undefined;
    // @提及（M4-8）：按输入框里**仍留着**的 token 还原 uid（删了 token 就自动不 @ 他）。
    const mentions = !peer ? resolveMentions(text, mentionCandidates.current) : [];
    const mentionAll = !peer && resolveMentionAll(text, mentionAllPending.current);
    // 片段（2026-09-01）：与 mentions 同源同规则，只是多记了每个 token 的位置（UTF-16 偏移）。
    // 收端有它就直接高亮，不必反查群成员表——超级群不下发成员表，老路在那里对普通成员失效。
    const mentionSpans = !peer ? resolveMentionSpans(text, mentionCandidates.current, mentionAll) : [];
    const sendOpts = {
      ...(rt ? { replyTo: rt } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(mentionAll ? { mentionAll: true } : {}),
      ...(mentionSpans.length ? { mentionSpans } : {}),
    };
    const clientMsgId = client.sendText(text, peer, cid, Object.keys(sendOpts).length ? sendOpts : undefined); // 群聊 to 为空：服务端按 conv_id 查成员写扩散
    appendMsg(cid, {
      clientMsgId, convId: cid, from: uid, content: text, contentType: "text",
      convSeq: 0, timestamp: Date.now(), status: "sending",
      mentions: mentions.length ? mentions : undefined, mentionAll: mentionAll || undefined,
      mentionSpans: mentionSpans.length ? mentionSpans : undefined,
      replyToConvSeq: rt?.convSeq, replySnapshot: rt?.preview, replyToFrom: rt?.from,
    });
    setInput("");
    setReplyTo(null);
    // 发出即清提及态，下一条重新累积。
    mentionCandidates.current = {};
    mentionAllPending.current = false;
    setMentionQuery(null);
  }, [input, peer, groupConvId, uid, appendMsg, replyTo, editingMsg, pastedImages, sendMediaBatch, uploadAndSend]);

  // 引用某条消息（M4-2）：进入引用态（输入框上方显示引用条，发送时带上）。
  const replyMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    setReplyTo(m);
  }, []);

  // 上传并发送图片/文件（M4-6）：上传 → 发 content_type=image|video|file 消息（content=URL）+ 乐观上屏。


  // 应用级稳定服务（见 AppServicesContext）。**必须在所有 early return 之前调用**（Rules of Hooks）。
  // 依赖全是 ref/setter/空依赖 useCallback → 身份恒定，此 memo 事实上只在挂载时建一次，消费组件不会因它
  // 重渲染。别塞高频 state（§七）。
  // 打开「发好友申请」弹窗。**稳定身份**（setState 恒定），可以安全进 services。
  const askFriendRequest = useCallback((userId: string, name: string) => {
    setFriendReqDraft({ userId, name });
  }, []);
  const services = useMemo<AppServices>(() => ({
    clientRef, setToast, comingSoon, askConfirm, askPrompt,
    refreshConversations, refreshFriends, refreshGroupInfo, refreshDownloadSettings, askFriendRequest,
  }), [setToast, comingSoon, askConfirm, askPrompt,
       refreshConversations, refreshFriends, refreshGroupInfo, refreshDownloadSettings, askFriendRequest]);

  // 群资料写操作簇：收口到 useGroupActions（只吃 services）。仍留 App 的 pickGroupAvatar/doEditGroupRemark 复用 doGroupAction。
  // App 仍用到的：doGroupAction（pickGroupAvatar 复用）、doEditAnnouncement（全文视图「编辑」）、doEditMyGroupNickname（详情主视图）。
  // rename/intro/mute/settings 已随 GroupManagePanel 迁出（它自取 useGroupActions）。
  const { doGroupAction, doEditAnnouncement, doEditMyGroupNickname, doSetAdmins, doRevokeAdmin, doTransferOwner } = useGroupActions(services);





  // 转发（M4-3）：打开会话选择器，选目标后逐条转发（带 forward_from 溯源）。
  // 链接富预览抓取（供 LinkCard；稳定引用避免重复请求）。
  const fetchLinkPreview = useCallback(async (url: string): Promise<LinkPreview> => {
    const c = clientRef.current;
    if (!c) throw new Error(t("conn.state.disconnected"));
    return c.linkPreview(url);
  }, []);
  // 进入多选态（M4-3）：从消息右键进入时预选当前消息（相册某格 → 只预选该格，逐格勾选 2a）；从标题栏进入不预选。
  const enterSelectMode = useCallback((m?: ChatMessage) => {
    setMenu(null); setChatMenu(false); setSelectMode(true);
    setSelected(new Set(m && m.convSeq > 0 ? [m.convSeq] : []));
  }, []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  // 勾选上限闸（2026-09-06）：**用 ref 同步推进**，不能读 `selected` 这个 state。
  // 相册整组全选在 MessageList 里是一轮 N 次 toggleSelected（见 toggleAlbumGroup），同一次渲染内
  // `selected` 不会变——按 state 判上限的话，98 条时勾一个 10 张的相册，10 次全看到 98<100 全放行，
  // 最终 108 条。ref 在本函数里同步前进，后续几次才看得见前面刚加进去的。
  const toggleSelected = useCallback((seq: number) => {
    const next = new Set(selectedRef.current);
    if (next.has(seq)) {
      next.delete(seq); // 取消勾选永远放行
    } else {
      if (next.size >= SELECT_MAX) { setToast(t("chat.select.max", { count: SELECT_MAX })); return; }
      next.add(seq);
    }
    selectedRef.current = next;
    setSelected(next);
  }, []);
  // 相册整组全选/全不选在 MessageList 就地用 toggleSelected 循环实现（见 toggleAlbumGroup），此处不再单列。
  // 转发簇 → useForward（阶段 6）：须在 exitSelectMode/setMenu/useMessageStore/selected/groupInfos 之后。
  const {
    forwarding, setForwarding, forwardMode, setForwardMode, forwardMulti, setForwardMulti, forwardTargets, setForwardTargets,
    forwardMessage, closeForwardPicker, toggleForwardTarget, sendForwardToTarget, doForwardToTargets, forwardSelected, setForwardVerb,
  } = useForward({ uid, peer, groupConvId, clientRef, setToast, appendMsg, msgsByConv, groupInfos, selected, setMenu, exitSelectMode,
    // 合并转发条目的头像快照（相对路径；同源直接可当 <img src>）：我自己 → 本人资料；
    // 群 → 成员表；单聊 → 会话行的对端头像。都取不到就不带 `a`，读端按 uid 兜底。
    recordSenderAvatar: (m) => {
      if (m.from === uid) return myInfo?.avatar_url || undefined;
      const gm = groupInfos[m.convId]?.members.find((x) => x.user_id === m.from);
      if (gm?.avatar_url) return gm.avatar_url;
      const c = conversations.find((x) => x.conv_id === m.convId);
      return (c && !c.is_group && c.peer === m.from && c.peer_avatar_url) || undefined;
    },
    // 合并转发卡片标题用的**公开名**：单聊读会话行的 peer_nickname（**不是 peer_remark**——
    // 备注仅本人可见，写进卡片等于把「我给他起的私房名」发给收件人）。群聊用不到这两个值。
    // 直接从 conversations 取而不调 peerNick()：那个函数定义在本调用点之后，取值会 TDZ。
    peerPublicName: conversations.find((c) => !c.is_group && c.peer === peer)?.peer_nickname || "",
    myPublicName: myInfo?.nickname || "",
    // **不回落 loginName**：扫码登录时 name 传空串，saveSession 会把登录框里残留的默认值
    // （"user1001"）当成我的 username 存下来——那可能是**别人的**句柄。而这个值会被写进
    // 合并转发条目名发给收件人。资料没拉回时宁可让它空着（落到「未命名用户」），也不能给错的。
    myUsername: myInfo?.username || "",
  });
  // 收藏「来自X」补拉到的个人名片（uid→名片）与"已试过"集合，见下方 useEffect。
  const [favUserCards, setFavUserCards] = useState<Record<string, UserCard>>({});
  const favResolveTriedRef = useRef<{ groups: Set<string>; users: Set<string> }>({ groups: new Set(), users: new Set() });
  // 收藏簇 → useFavorites（阶段 6）：消费 useForward 的 setForwardMode/setForwarding/sendForwardToTarget。
  const {
    favorites, setFavorites, favPick, favTotal, favLoadingMore, loadMoreFavorites,
    favoriteMessage, favoriteSelected, openFavorites, openFavoritesPick, closeFavorites,
    favoriteActions, sendFavoritesToCurrent,
  } = useFavorites({ clientRef, setToast, setMenu, setAttachPanel, saveMessageToDisk, conversations, currentConvRef, setForwardMode, setForwarding, sendForwardToTarget, msgsByConv, selected, exitSelectMode });

  // 群的写操作 + 它们各自的弹窗状态（建群/退群/解散/邀请/黑名单/入群审批/群备注/群头像）→ useGroupOps。
  // 那七个 state 只有这一族操作会读写，此前混在 App 的四十多个 state 里看不出谁和谁是一伙的。
  const {
    groupsModal, setGroupsModal, createDraft, setCreateDraft, createBusy, createAvatarBusy,
    inviteDraft, setInviteDraft, joinReqModal, setJoinReqModal,
    groupBans, groupBansModal, setGroupBansModal,
    openGroupsModal, doDissolveGroup, doCreateGroup, doLeaveGroup,
    openGroupBans, doUnban, openJoinRequests, reloadJoinRequests, decideJoin,
    doEditGroupRemark, pickGroupAvatar, pickCreateGroupAvatar, doInvite,
  } = useGroupOps({
    clientRef, setToast, askConfirm, askPrompt, refreshConversations, refreshGroupInfo, doGroupAction,
    openGroupChat, deselect, currentConvRef, loadSuperMembers, setCropReq, setTab, setDetail, setGroupInfos,
    conversations, groupInfos,
  });

  // 语音**跟着页面走**：离开这条语音所属的那一页就暂停（保留位点，回来点一下接着听）。
  // 三条 cleanup 各管一处——单例 audio 挂在模块上，页面一关组件就卸载了，声音却还在放，
  // 用户找不到任何暂停按钮（2026-09-05 用户反馈）。与 iOS `pauseOnLeavingScreen` 同语义。
  //
  // 写成 **cleanup** 而不是"值变了就停"：cleanup 恰好在「离开旧值」时跑一次，
  // 而在依赖值上判 `if (!x) pause()` 会在首渲染就误停一次，且分不清"关掉"与"换了一个"。
  //
  // ⚠️ 依赖必须是**「在哪一页」的标识**，不能是承载数据的对象/数组本身：`favorites` 是收藏列表数组，
  // 翻页追加（loadMoreFavorites）与删一条都会换掉数组身份 → cleanup 触发 → 正在听的语音被莫名暂停。
  // `detail` 同理（今天只在开/关时赋值，但哪天顺手刷新一下就复现同样的问题）。故都归一成字符串键。
  const detailKey = detail ? `${detail.convId}|${detail.peer ?? ""}` : "";
  const favoritesOpen = favorites !== null;
  useEffect(() => { if (!convId) return; return () => pauseVoicePlayback(); }, [convId]);             // 切/离开会话
  useEffect(() => { if (!detailKey) return; return () => pauseVoicePlayback(); }, [detailKey]);       // 关/切资料卡片（语音页签）
  useEffect(() => { if (!favoritesOpen) return; return () => pauseVoicePlayback(); }, [favoritesOpen]); // 关收藏弹窗

  // 个人名片簇 → useContactShare（CONTACT_CARD_DESIGN §8）：入口 ① 选好友 + 二次确认发进当前会话；
  // 入口 ②③ 合成一条 contact 消息交给**已有的**转发选择页（故消费 useForward 的 setForwardMode/setForwarding）。
  const {
    cardPicker, cardConfirm, contactCandidates,
    openContactPicker, toggleContactPick, confirmContactPick, sendContactCards, shareContactCard,
    closeContactPicker, closeContactConfirm,
  } = useContactShare({ clientRef, setToast, uid, friends, conversations, currentConvRef, appendMsg, setAttachPanel, setForwardMode, setForwarding, setForwardVerb });

  // 多选批量删除：两档与单条删除同源（见 selectDelete.ts）。原先这里只抹本机内存 + IndexedDB 墓碑、
  // 根本不问服务端——按钮却写着「仅为我删除」，与单条那档（hide，多端同步）同名不同义：换台设备消息还在。
  // 本地移除统一交给 SDK 的 onMessageRemoved（hide 成功 / msg_op delete 广播回帧），这里不再乐观抹内存，
  // 失败的那几条因此原样留在屏上，和提示的失败条数对得上。
  const batchDeletePlan = useMemo(
    () => planBatchDelete(selectMode ? (msgsByConv[convId] ?? []) : [], selected, uid, groupInfos[convId]?.my_role),
    [selectMode, msgsByConv, convId, selected, uid, groupInfos],
  );
  // 重新拉某会话的置顶集合（G0）。best-effort：拉不到就不显横幅，绝不打断聊天。
  const refreshPinned = useCallback(async (cid: string) => {
    if (!cid) return;
    try {
      const items = (await clientRef.current?.fetchPinned(cid)) ?? [];
      setPinnedByConv((prev) => ({ ...prev, [cid]: items }));
    } catch (e) {
      logger.warn(LOG_TAG.ui, "fetch_pinned_failed", { conv_id: cid, message: (e as Error).message });
    }
  }, []);

  // 置顶横幅合并重拉 + 批量删除执行（useBatchDelete.ts）。logout 定义在前面且依赖为 []，经 ref 取到调度器（同 pinnedRef 套路）。
  const { schedulePinnedRefresh, runBatchDelete } = useBatchDelete(refreshPinned, setToast);
  schedulePinnedRefreshRef.current = schedulePinnedRefresh;

  // 仅为我删除：批量 hide（上限 SELECT_MAX 条，与服务端 100 同值）。
  const deleteSelected = useCallback(() => {
    const cid = convId, client = clientRef.current, { seqs } = batchDeletePlan;
    exitSelectMode();
    if (!client || seqs.length === 0) return;
    runBatchDelete(cid, seqs, (s) => client.hideMessages(cid, s));
  }, [convId, batchDeletePlan, exitSelectMode, runBatchDelete]);
  // 为所有人删除：批量 delete。走 REST，WS 断着也能删（成功项 SDK 直接本地移除，不等广播帧）。
  const deleteSelectedForEveryone = useCallback(() => {
    const cid = convId, client = clientRef.current, { seqs, canEveryone } = batchDeletePlan;
    if (!client || !canEveryone) return;
    exitSelectMode();
    runBatchDelete(cid, seqs, (s) => client.deleteMessagesForEveryone(cid, s));
  }, [convId, batchDeletePlan, exitSelectMode, runBatchDelete]);

  // 多选批量收藏（favoriteSelected）已收进 useFavorites（收藏动作簇，见其 return）。

  // 跳转到被引用的原消息（点击气泡引用条）：高亮该行并滚入视口。
  const jumpToSeq = useCallback((seq: number) => {
    const box = msgsRef.current;
    if (!box) { setToast(t("conv.locate.not_in_view")); return; }
    // DOM 部分（找节点 / 居中 / 闪烁 / 跳不到的提示）在 messageJump.ts；这里只供 ref 与回调。
    // 跳走后不再「贴底」：否则从底部跳到较早的目标时，下方媒体异步加载完成会触发 onMediaLoad
    // 把 scrollTop 拽回 scrollHeight，定位当场被冲掉。
    jumpDomToSeq(box, messagesRef.current, seq, { onLeaveTail: () => { wasNearBottomRef.current = false; }, setToast });
  }, []);

  // 跨窗口定位：目标不在当前窗口时，**以它为锚点开一窗**（一次请求直达）。
  //
  // 旧实现是「从最新往前一页页翻，最多 40 页」——40 次往返，翻满还没找到就报出**假的**
  // 「原消息已被删除」（在大群里 8000 条可能只是几小时的量）。现在服务端的 window_resp
  // 直接给出 anchor_found：真没有才说没有。见 IMServer/docs/design/MESSAGE_WINDOW_DESIGN.md。
  // 待完成的一次定位。
  // `windowed`：已经为它开过一次窗（开过还没有 = 真没有，不再重开，见 driveLocate 末尾）。
  // `earliest`：「跳到最早」——目标不是某个确定的 conv_seq，而是"会话首条"这个概念，
  //   开窗回来后才知道它到底是第几号（见 driveLocate 里的重定目标）。
  type PendingLocate = { convId: string; seq: number; windowed?: boolean; earliest?: boolean };
  const pendingLocateRef = useRef<PendingLocate | null>(null);
  const WINDOW_SIDE = 60; // 定位时锚点两侧各取多少条（够填满几屏，且一次请求内）
  const driveLocate = useCallback(() => {
    const pend = pendingLocateRef.current;
    if (!pend || pend.convId !== currentConvRef.current) return; // 会话切走 → 交给新一轮 locateInChat
    const local = msgsByConvRef.current[pend.convId] ?? [];
    // 「最早」开窗回来后**重定目标**：conv_seq=1 经常不是一条消息——msg_op 事件行（撤回/编辑/
    // 置顶）、已删墓碑、入群前对我不可见的行都占号却不成为消息。钉死 1 的话，服务端明明把
    // 最早那一段都给了，客户端却因为 1 号不是消息而无处可落。改成落到**本地实际最早的一条**。
    const seq = pend.earliest && pend.windowed ? (minSeqOf(local) || pend.seq) : pend.seq;
    if (messagesRef.current.some((x) => x.convSeq === seq)) {
      pendingLocateRef.current = null;
      requestAnimationFrame(() => jumpToSeq(seq)); // 已在渲染窗口内：直接滚动高亮
      return;
    }
    // **本地库有、只是没渲染出来** → 移窗即可，不必请求
    // （首次进会话的 sync 常把历史全灌进本地库，那时目标多半就在本地）。
    if (local.some((x) => x.convSeq === seq)) {
      // 把窗口**移到**目标处（不是撑大——撑大会把整个会话渲染出来，第一版就是这么错的）。
      // 移窗 = 主动离开尾部：先把"贴底"状态清掉，否则新窗一渲染，layout effect 的
      // 「末条是我发的且原本贴底 → 贴底」会把人按到那一段的底部，onMediaLoad 也会跟着拽。
      // 同时清掉「用户想往下滚」的意图（见 userScrollIntentRef）——内容从 9000px 缩成 700px 时
      // 浏览器会把 scrollTop 钳到新上限并**派发一次 scroll 事件**，那不是用户的手。
      wasNearBottomRef.current = false;
      userScrollIntentRef.current = false;
      setRenderView({ anchor: seq, size: RENDER_WINDOW_STEP });
      return; // 移窗触发重渲染 → 本 effect 再跑一次，那时走上面的"已在窗口内"分支
    }
    // 开过窗、消息也灌进本地了，却还是找不到 → 锚点是一条**永远不会成为消息的行**
    // （服务端 anchor_found 只保证 im_message 里有这一行，msg_op 事件行同样在那张表里）。
    // 必须就此打住：不打住的话本 effect 会一轮轮重开同一个窗，无限往返。
    if (pend.windowed) { pendingLocateRef.current = null; setToast(t("conv.error.original_deleted")); return; }
    // 本地库也没有 → 以它为锚点开一窗。回包只把消息灌进本地库并标记 windowed，
    // 剩下的移窗/滚动仍旧走这里（见 onWindow 处的说明）。
    clientRef.current?.requestWindow(pend.convId, pend.seq, WINDOW_SIDE, WINDOW_SIDE);
  }, [jumpToSeq, setToast]);
  // 消息窗口变化后推进一步定位。
  //
  // **依赖必须包含 `renderView`（渲染窗口本身），不能只有 `msgsByConv`**：
  // driveLocate 的「本地库有、只是没渲染」分支走的是 setRenderView 移窗，而移窗**不改**
  // msgsByConv——只依赖后者的话，effect 不会再跑，pendingLocate 就永远停在那里，
  // 表现为「点搜索结果没反应」（2026-09-03 实测：有缺口的会话里翻搜索命中定位不过去）。
  // 目标是否已渲染本来就该由「渲染集变了」来驱动，而渲染集 = msgsByConv 切 renderView。
  useEffect(() => { driveLocate(); }, [msgsByConv, renderView, driveLocate]);

  const locateInChat = useCallback((cid: string, seq: number, opts?: { earliest?: boolean }) => {
    if (!cid || seq <= 0) { setToast(t("conv.locate.unavailable")); return; }
    pendingLocateRef.current = { convId: cid, seq, earliest: opts?.earliest };
    if (cid !== currentConvRef.current) {
      // 详情所属会话未打开（如从通讯录/群成员进的资料页）→ 先打开它，加载窗口后由 effect 定位。
      if (cid.startsWith("g_")) openGroupChat(cid);
      else {
        const peer = cid.replace(/^u_/, "").split("_u_").find((x) => x !== uid);
        if (peer) openChat(peer); else { pendingLocateRef.current = null; setToast(t("conv.locate.unavailable")); }
      }
      return;
    }
    driveLocate(); // 同会话：立即试一次（在窗口内直接跳；更早则启动自动上翻）
  }, [uid, openChat, openGroupChat, driveLocate]);

  // 本地删除一条消息（仅本端：从内存列表 + 去重集移除，不影响对端）。
  const deleteMessage = useCallback((m: ChatMessage) => {
    // 删除一条仍在发送的本地出箱件：必须同时停掉上传（abort 分片 + 取消集合拦住小文件/poster/sendMedia），
    // 否则"删除"只抹掉气泡而上传照跑、消息照发（幽灵送达）。已发出的消息（convSeq>0）走纯本地删除。
    if (m.from === uid && m.convSeq === 0 && m.clientMsgId) teardownOutboxUpload(m.clientMsgId, hasActiveSend(m));
    setMsgsByConv((prev) => {
      const list = (prev[m.convId] ?? []).filter((x) =>
        m.clientMsgId ? x.clientMsgId !== m.clientMsgId : x.convSeq !== m.convSeq
      );
      return { ...prev, [m.convId]: list };
    });
    // 持久化删除：落墓碑（IndexedDB 读盘过滤）+ 内存墓碑（拦服务端实时/补拉重推）+ 抹本地记录。
    // 二者缺一都会"删了又冒出来"：只落 IndexedDB → 实时重推绕过读盘过滤；只记内存 → 刷新后内存墓碑丢失、读盘又载回。
    if (m.convSeq > 0) {
      (deletedByConv.current[m.convId] ??= new Set()).add(m.convSeq);
      void markMessageDeleted(uid, m.convId, { convSeq: m.convSeq });
    } else if (m.clientMsgId && m.status === "failed") {
      void markMessageDeleted(uid, m.convId, { clientMsgId: m.clientMsgId });
    }
    setMenu(null);
  }, [uid, teardownOutboxUpload]);

  const copyMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    // 图说消息（带 caption）：复制**仅复制文本**（caption），与「这类消息的文本操作作用于文本」约定一致。
    // caption 只存在于 image/video/file，故一个非空判断即可覆盖三类。
    if (m.caption) { void navigator.clipboard?.writeText(m.caption); setToast(t("common.copied")); return; }
    // 纯图片（无 caption）：复制真实图片字节（可粘贴回输入框直接发图）；失败或非图片：复制文本/URL。
    if (m.contentType === "image") {
      copyImageToClipboard(m.content).then(() => setToast(t("common.copied_image")))
        .catch(() => { void navigator.clipboard?.writeText(m.content); setToast(t("common.copied_link")); });
      return;
    }
    void navigator.clipboard?.writeText(m.content);
  }, []);

  // 长文本消息 key（记忆"展开全文"用）：**必须带 convId**——conv_seq 每会话各自从 1 递增，
  // 不加会话前缀会让 A 会话 seq-5 与 B 会话 seq-5 撞键、展开态跨会话串号。
  // **优先用 clientMsgId**（本端消息发送中→ack 全程都在，且不随 convSeq 从 0 变 N 而翻转）；
  // 对端消息无 clientMsgId → 退回 seq-N。若两者都无（极少）则空串。
  // 文本消息的渲染一族（@提及高亮 / URL 可点 / 搜索高亮 / 长文本三档）已整块平移到
  // components/messageText.tsx；工厂调用在下方 openPeerDetail 之后（它要用那两个回调）。

  // 点置顶横幅/置顶列表行的跳转（G0）：先判目标是不是**已被撤回**。服务端置顶列表本就剔除撤回消息，
  // 但横幅是快照——重拉失败（best-effort）、msg_op 帧还没到、重拉在飞时点击，都可能停在旧集合上。
  // 这时直接 jumpToSeq 会滚到一条「撤回了一条消息」的系统行并高亮，用户看不出原消息已经没了。
  // 故显式提示 + 顺手重拉一次让横幅收敛（iOS 同口径，见 +PinnedBanner 的 didRequestJumpToConvSeq）。
  const jumpToPinned = useCallback((seq: number) => {
    // 查**本地全量**而不是渲染窗口：置顶消息天然是较早那条，十有八九不在窗口里，
    // 只查窗口的话这个判定基本恒假，「原消息已被撤回」这条提示等于没了。
    const localAll = msgsByConvRef.current[currentConvRef.current] ?? [];
    if (localAll.some((m) => m.convSeq === seq && m.recalledAt)) {
      setToast(t("conv.error.original_recalled"));
      void refreshPinned(currentConvRef.current);
      return;
    }
    // 走统一定位入口：置顶消息天然是较早那条，**最需要跨窗口定位**——
    // 此前这里直接 jumpToSeq，目标不在窗口就只弹"请上拉加载后重试"，等于让用户自己翻。
    locateInChat(currentConvRef.current, seq);
  }, [locateInChat, refreshPinned, setToast]);

  // 置顶 / 取消置顶（G0）：发 msg_op，成功由服务端广播回 msg_op 帧（onMsgOp 里重拉横幅），
  // 越权/失效由 onMsgOpFailed toast。乐观更新交给帧回来那一下，避免本地先亮再被打回。
  const pinMessage = useCallback((m: ChatMessage, pinned: boolean) => {
    setMenu(null);
    if (m.convSeq > 0) clientRef.current?.pinMessage(m.convId, m.convSeq, pinned);
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
      } catch (e) { setToast(t("chat.error.translate_failed", { detail: (e as Error).message })); }
    })();
  }, []);

  // 举报簇（AG-3）→ useReport：长按菜单举报这条 / 资料页举报这个人 / 多选批量举报同一发送者的多条。
  const { reportMsg, reportPeer, reportSelected, reportableSender, reportHasMine } = useReport({
    clientRef, uid, remarks, askPrompt, setToast, setMenu,
    convId, msgsByConv, selected, selectMode, exitSelectMode,
  });


  // ---- 已登录设备（P2）：状态 + 加载/踢下线操作 ----
  const { devices, devicesOpen, setDevicesOpen, devicesErr, revokingSid, loadDevices, revokeDevice, revokeOtherDevices, resetDevices } =
    useDevices({ clientRef, askConfirm, setToast });

  // 打开群公告/简介全文视图（三入口共用：横幅点击 / 详情页卡点击）。
  const openGroupText = useCallback((kind: GroupTextKind, cid: string) => {
    setFullTextModal({ kind, convId: cid });
  }, []);

  // 群公告自动弹窗（每版本一次）：进群且群资料回来后，若有非空公告且 announcement_at 比本地
  // 已看过的版本更新，自动打开公告全文一次并记下版本；同版本再进群 / 重渲染都不再弹。
  // 已看版本按 uid+cid 存 localStorage（换账号互不影响）；annPoppedRef 兜住 setItem 前的重入。
  const annPoppedRef = useRef<Record<string, number>>({}); // cid -> 本会话已弹过的 announcement_at
  useEffect(() => {
    const cid = groupConvId;
    if (!cid || !uid) return;
    const gi = groupInfos[cid];
    if (!gi) return; // 群资料还没回来（refreshGroupInfo 异步），下次 groupInfos 更新再判
    const ann = (gi.announcement ?? "").trim();
    const at = gi.announcement_at ?? 0;
    if (!ann || at <= 0) return; // 无公告不弹
    const key = `im.annseen.${uid}.${cid}`;
    let seen = 0;
    try { seen = Number(localStorage.getItem(key)) || 0; } catch { /* 忽略 */ }
    if (at <= seen) return; // 该版本已看过
    if (annPoppedRef.current[cid] === at) return; // 本会话本版本已弹过，防重入
    annPoppedRef.current[cid] = at;
    try { localStorage.setItem(key, String(at)); } catch { /* 配额满等，忽略 */ }
    // 自己就是本版公告的发布者（管理员/群主刚编辑）→ 不弹窗（内容自己写的、已知），仅记版本供下版仍能弹。
    // 与 iOS 拉齐（maybeAutoPopAnnouncement 同 announcementBy === userID 守卫）。
    if (gi.announcement_by && gi.announcement_by === uid) return;
    openGroupText("announcement", cid);
  }, [groupConvId, groupInfos, uid, openGroupText]);

  // 为所有人删除（任务2）：Telegram 式，删除后对端也消失。走 WS msg_op op=delete，服务端广播回
  // onMessageRemoved 物理移除本地；被拒走 onMsgOpFailed → toast。**不再单独居中确认**——两档子菜单 B
  // 里选中「为所有人删除」这一动作本身即确认（对齐 iOS 子菜单、去掉居中弹窗）。
  const deleteFileForEveryone = useCallback((m: ChatMessage) => {
    if (m.convSeq <= 0) { setToast(t("conv.error.not_synced_cannot_delete")); return; }
    clientRef.current?.deleteMessageForEveryone(m.convId, m.convSeq);
  }, []);

  // 仅删除自己（任务2）：仅从我的所有设备移除，对端不受影响。走 REST 落 per-user 隐藏表 + 多设备同步。
  const hideFileForMe = useCallback(async (m: ChatMessage) => {
    if (m.convSeq <= 0) { setToast(t("conv.error.not_synced_cannot_delete")); return; }
    try { await clientRef.current?.hideMessage(m.convId, m.convSeq); }
    catch (e) { setToast(t("conv.error.delete_failed_detail", { detail: (e as Error).message })); }
  }, []);

  // 能否「为所有人删除」某条消息：我发的，或我是该群群主/管理员（与后端权限一致）。
  const canDeleteForEveryone = useCallback((m: ChatMessage) => {
    if (m.from === uid) return true;
    const role = groupInfos[m.convId]?.my_role;
    return role === "owner" || role === "admin";
  }, [uid, groupInfos]);

  // 删除路由（聊天页 + 详情各 tab 统一，对齐 iOS）：本地未发出件→本地删；已发出且可为所有人删→弹两档子菜单 B；
  // 只能删自己→直接仅删自己。x/y 为菜单 A 的锚点，子菜单 B 就地弹出并带过渡动画。
  const requestDelete = useCallback((m: ChatMessage, x: number, y: number) => {
    if (m.convSeq <= 0) { deleteMessage(m); return; }        // 本地失败/未发出：服务器无此消息，本地删
    if (canDeleteForEveryone(m)) { setDeleteMenu({ x, y, m }); return; } // 两档子菜单
    void hideFileForMe(m);                                    // 仅能删自己：直接隐藏
  }, [deleteMessage, canDeleteForEveryone, hideFileForMe]);

  // 会话"设为已读"：推进已读位点（清未读数）+ 清除手动"标未读"标记，再刷新列表。
  const markReadConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        if (c.unread > 0) clientRef.current?.markRead(c.conv_id, c.latest_conv_seq);
        if (c.marked_unread) {
          await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: false });
        }
        await refreshConversations();
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  }, [refreshConversations]);

  // 会话"标为未读"：手动置红点（不改已读位点，不计数）。
  const markUnreadConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: true });
        await refreshConversations();
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  }, [refreshConversations]);

  // 会话置顶/取消置顶：pinned_at=现在/0（后端据此把置顶会话排在列表顶）。
  const setConvPinned = useCallback((c: Conversation, pinned: boolean) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: pinned ? Date.now() : 0, muted: !!c.muted, marked_unread: !!c.marked_unread });
        await refreshConversations();
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  }, [refreshConversations]);

  // 会话免打扰/取消 + 时长二级菜单状态：抽到 useConvMute（CODING_STYLE §7 决策树①，自己有状态+一组操作）。
  const { setConvMuted, convMuteMenu, setConvMuteMenu, requestMute } = useConvMute({
    clientRef, refreshConversations, setToast, closeConvMenu: () => setConvMenu(null),
  });

  // 删除会话（仅本人，后端记 cleared_at 不删消息）：若删的是当前打开会话则退出，否则刷新列表。
  const deleteConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.deleteConversation(c.conv_id);
        if (currentConvRef.current === c.conv_id) deselect(); // deselect 内部会 refreshConversations
        else await refreshConversations();
      } catch (e) { setToast(t("conv.error.delete_failed_detail", { detail: (e as Error).message })); }
    })();
  }, [refreshConversations, deselect]);

  /** 打开某条自己发的群消息的已读名单（M4-8）：按需拉取，不做常驻轮询。 */
  const openReadReceipts = useCallback((m: ChatMessage) => {
    setMenu(null);
    void (async () => {
      try {
        const r = await clientRef.current?.fetchReadReceipts(m.convId, m.convSeq);
        if (!r) return;
        // 超限群（>2000 人）服务端回 enabled=false：静默不开面板，与 iOS 隐藏入口一致。
        if (!r.enabled) { setToast(t("receipts.error.group_too_large")); return; }
        setReadReceipts({ read: r.read, unread: r.unread, tab: "read" });
      } catch (e) { setToast(t("receipts.error.load_failed", { detail: (e as Error).message })); }
    })();
  }, []);

  // 消息菜单动作（数据驱动）：copy/delete/report* 接真实实现，其余 comingSoon。useMemo 避免每次渲染重建。
  const messageActions = useMemo<MenuAction<MessageCtx>[]>(
    () => buildMessageActions({
      copy: copyMessage,
      reply: replyMessage,
      forward: forwardMessage,
      favorite: favoriteMessage,
      download: saveMessageToDisk,
      edit: editMessage,
      translate: translateMessage,
      multiSelect: enterSelectMode,
      readReceipts: openReadReceipts,
      recall: recallMessage,
      pin: pinMessage,
      // 聊天菜单的「删除」在渲染层按锚点特判 → requestDelete（两档子菜单/仅删自己/本地删，需菜单 x/y）；
      // 此 handler 不经 a.run 触发，仅为 buildMessageActions 的类型契约占位（requestDelete 内部另直接用 deleteMessage 处理 convSeq<=0）。
      delete: deleteMessage,
      reportMsg,
      cancelSend: cancelSendMessage,
      transcribe: transcribeMessage,
      comingSoon,
    }),
    [copyMessage, replyMessage, forwardMessage, favoriteMessage, saveMessageToDisk, editMessage, translateMessage, enterSelectMode, recallMessage, pinMessage, deleteMessage, reportMsg, cancelSendMessage, transcribeMessage, comingSoon],
  );

  // 全屏文本阅读器：Esc 关闭（点蒙层/✕ 已在 JSX 处理）。
  useEffect(() => {
    if (!textReader) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTextReader(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [textReader]);

  // 会话菜单动作（数据驱动，M4.5 全接后端）：置顶/免打扰切换、标已读/未读、删除会话。
  const conversationActions = useMemo<MenuAction<{ c: Conversation }>[]>(
    () => buildConversationActions({
      setPinned: setConvPinned,
      setMuted: setConvMuted,
      markRead: markReadConv,
      markUnread: markUnreadConv,
      delete: deleteConv,
    }),
    [setConvPinned, setConvMuted, markReadConv, markUnreadConv, deleteConv],
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

  // 会话右键菜单（含免打扰时长二级菜单）：点空白/滚动/Esc 关闭（与消息菜单一致）。
  useEffect(() => {
    if (!convMenu && !convMuteMenu) return;
    const close = () => { setConvMenu(null); setConvMuteMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [convMenu, convMuteMenu]);

  // 群成员 ⋯ 菜单：点空白/滚动/Esc 关闭。
  // ⚠️ 必须用**捕获阶段**监听 click：该菜单由详情面板内的 ⋯ 触发，而 `.detail-panel` 自身挂了
  // `onClick={e => e.stopPropagation()}`（防误关面板），冒泡阶段的 window 监听收不到面板内的点击，
  // 导致点面板任意处菜单都不消失。捕获阶段在 stopPropagation 生效前就能拿到事件。
  // 菜单自身的点击由 ref 排除（菜单项各自负责关闭），否则会在按钮 handler 前先卸载菜单。
  useEffect(() => {
    if (!memberMenu) return;
    const close = (e: Event) => {
      if (memberMenuRef.current?.contains(e.target as Node)) return;
      setMemberMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMemberMenu(null); };
    window.addEventListener("click", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [memberMenu]);

  // 资料卡「更多」菜单：点空白/滚动/Esc 关闭。
  // 与成员菜单同理走**捕获阶段**：菜单挂在 `.detail-panel` 内，而面板自身 `onClick={e => e.stopPropagation()}`
  // （防误关抽屉），冒泡阶段的 window 监听收不到面板内的点击 —— 那正是「点空白处菜单不消失」的成因。
  // 排除整个 `.detail-pill-anchor`（按钮 + 菜单）：只排除菜单的话，再点一次「更多」会先被这里关掉、
  // 再被按钮的 toggle 打开，菜单永远关不掉。
  useEffect(() => {
    if (!detailMore) return;
    const close = (e: Event) => {
      if ((e.target as Element)?.closest?.(".detail-pill-anchor")) return;
      setDetailMore(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetailMore(false); };
    window.addEventListener("click", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [detailMore]);

  // 详情文件行右键菜单：点空白/滚动/Esc 关闭。与成员菜单同理走**捕获阶段**——菜单虽渲染在顶层，但触发点
  // 在 `.detail-panel`（挂了 stopPropagation）内，冒泡阶段的 window 监听收不到面板内的点击。菜单自身点击由
  // `.ctx-menu` 排除（菜单项各自负责关闭），避免在按钮 handler 前先卸载菜单。
  useEffect(() => {
    if (!fileMenu && !deleteMenu) return;
    const closeAll = () => { setFileMenu(null); setDeleteMenu(null); };
    const close = (e: Event) => { if ((e.target as Element)?.closest?.(".ctx-menu")) return; closeAll(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAll(); };
    window.addEventListener("click", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [fileMenu, deleteMenu]);

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

  // 输入框随内容自适应高度（换行时变高，最多 ~5 行；发送清空后回到单行）。
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const onInputChange = useCallback((val: string) => {
    setInput(val);
    // @提及（M4-8，仅群聊）：按光标位置判断是否处在 @ 输入态，据此开合面板并实时过滤。
    // 桌面端用贴输入框的内联下拉（Web IM 惯例），语义与 iOS 的半屏卡一致。
    if (groupConvId && !peer) {
      // 消息框里 @ 后的字符**实时驱动列表匹配**（任务1）：query 存进 mentionQuery，由 mentionRows 据此过滤。
      // **不写** mentionFilter——面板顶部搜索框是独立搜索，用户没在其中打字时保持空。
      const caret = composerRef.current?.selectionStart ?? val.length;
      setMentionQuery(activeMentionQuery(val, caret));
    } else if (mentionQuery !== null) {
      setMentionQuery(null);
    }
    const now = Date.now();
    const cid = convId;
    if (val && cid && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      clientRef.current?.sendTyping(cid);
    }
  }, [peer, groupConvId, uid, mentionQuery]);

  /**
   * @面板当前候选行（渲染与键盘导航共用同一份，避免两处各算一次导致高亮与实际选中错位）。
   * 「@所有人」占首位、仅群主/管理员且无过滤词时出现（一旦开始搜人，列表就该只剩人）。
   */


  const stateText = { connected: t("conn.state.connected"), connecting: t("conn.state.connecting"), disconnected: t("conn.state.disconnected") }[state];

  // 进会话拉一次置顶集合（G0）；切会话时把横幅索引复位到第一条。
  useEffect(() => {
    setPinnedIdx(0);
    setPinnedListOpen(false);
    if (convId) void refreshPinned(convId);
  }, [convId, refreshPinned]);

  // 切换会话时清空 @提及态（M4-8）：input 不随会话清空，候选表若留到下一个会话，
  // 按时间戳排序（发送中/失败的 convSeq=0 但有发送时刻，故按时间能正确落位——
  // 否则它们会被挤到末尾，导致"解除拉黑后新发的消息排在更早的失败消息之前"）。
  // conv_seq 仅作同一毫秒内的次级排序，保证已送达消息间仍按服务端顺序。
  const allLocal = (msgsByConv[convId] ?? [])
    .slice()
    .sort((a, b) => (a.timestamp - b.timestamp) || ((a.convSeq || Number.MAX_SAFE_INTEGER) - (b.convSeq || Number.MAX_SAFE_INTEGER)));
  // **渲染窗口**：只渲染尾部 renderWindow 条，不是本地全部。
  //
  // 本地库仍保全量（搜索、媒体时间线都要用），但**渲染**必须有上限——
  // 此前这里直接把 msgsByConv 全量交给列表：3 万条的会话实测渲染 4000+ 条时 DOM 已近 3 万节点
  // 且还在涨（见 MESSAGE_WINDOW_DESIGN §1）。往上滚会自动扩窗（见 onScroll 的 loadOlder 分支）。
  //
  // 按窗口切片。anchor 为空 = 贴最新（待发/失败的 conv_seq=0 消息时间戳是"现在"，
  // 排序后必在最新一批里，故尾部切片自然包含它们，不必额外挑）。
  // 切片规则连同"不跨缺口"一起收在 renderWindow.ts（带单测）。**必须按连续段切**：
  // allLocal 是横跨缺口的扁平数组，按下标开窗会把缺口另一侧的旧岛拼到窗口里——
  // 两段不相邻的历史紧挨着渲染，时间戳还递增，看不出任何异常（§4.7）。
  // 切段按区间清单判"中间那几个 seq 是没下载、还是本就不成为消息"（msg_op 事件行 / 已删墓碑 /
  // 对我不可见的行都占 seq 却不是消息）。只看 seq 连号会把它们当缺口，进而把尾段切碎——
  // 18 条的大群删掉一张图后，尾段只剩最后那条系统消息，界面看着就是空会话（2026-09-03 实测）。
  void rangesTick; // 清单变更由它驱动重算（值本身不用，读的是 SDK 的当前镜像）
  const localRanges = clientRef.current?.rangesOf(convId) ?? [];
  const messages = visibleSlice(allLocal, renderView.anchor, renderView.size, localRanges);
  messagesRef.current = messages; // 每次渲染同步镜像（jumpToSeq 等早于此处定义，经 ref 取当前值）
  renderViewRef.current = renderView;      // 同上：driveLocate 定义在前，要读当前窗口
  msgsByConvRef.current = msgsByConv;     // 同上：定位要判断目标是否已在本地库
  pinnedRef.current = pinnedByConv; // 同上：WS 回调（onMsgOp）判断撤回/编辑是否命中置顶项要读当前集合

  // ===== 会话内搜索 / 日历 / 「来自」发件人 / 首页全局搜索：状态+逻辑抽到 useChatSearch（CODING_STYLE §7）。
  // searchOpen/searchQuery 受控注入（见上）；副作用依赖（locateInChat/setToast/客户端）注入进去。
  // **传 allLocal 而不是 messages**：搜索/日历/发件人候选问的是"整个会话"，不是"现在渲染的那一窗"。
  // W2 引入渲染窗口后一度传了切片，实测「会话内搜索」在 3 万条的群里只命中 98 条（= 窗口条数）。=====
  // localComplete / online / getToken：决定"整会话问题"问本地还是问服务端（§4.9 三态）。
  // localComplete 直接问 SDK 有没有收到过 too_long——"本地有缺口"的权威来源（同一事实两处推导迟早分叉）。
  const localComplete = !clientRef.current?.hasGap(convId);
  // RtcHost 换票用：引用必须稳定（RtcHost 的 effect 拿它当依赖），空依赖数组只建一次，
  // 调用时刻经 clientRef.current 读到的永远是当前值（不是这里闭包住的快照）。
  const getRtcAuthToken = useCallback(() => clientRef.current?.authToken ?? "", []);
  const search = useChatSearch({
    searchOpen, setSearchOpen, searchQuery, setSearchQuery,
    allMessages: allLocal, convId, groupConvId, uid, groupInfos, conversations,
    locateInChat, setToast,
    localComplete, online: state === "connected",
    getToken: () => clientRef.current?.authToken ?? "",
    clearedUpTo: clientRef.current?.clearedUpToOf(convId) ?? 0,
  });

  // 会话媒体的服务端续拉（§4.9 第 5 项）：本地有缺口且在线时，查看器翻页 / 媒体库在本地那一段之上往更旧续拉；
  // 本地齐全时 enabled=false，与改造前完全一样。
  const mediaPaging = useMediaServerPaging({
    convId,
    enabled: pickQuerySource(localComplete, state === "connected") === "server",
    oldestLocalSeq: messages.find((mm) => mm.convSeq > 0)?.convSeq ?? 0,
    newestLocalSeq: messages.reduce((mx, mm) => (mm.convSeq > mx ? mm.convSeq : mx), 0),
    getToken: () => clientRef.current?.authToken ?? "",
    clearedUpTo: clientRef.current?.clearedUpToOf(convId) ?? 0,
  });

  // 资料页「媒体/文件/语音」页签：本地有缺口且在线时并入服务端分页（§4.9 第 5 项）；本地齐全时与改造前一样。
  const detailArchive = useDetailServerArchive({
    convId: detail?.convId ?? "",
    enabled: !!detail && pickQuerySource(!clientRef.current?.hasGap(detail.convId), state === "connected") === "server",
    getToken: () => clientRef.current?.authToken ?? "",
    clearedUpTo: detail ? (clientRef.current?.clearedUpToOf(detail.convId) ?? 0) : 0,
  });
  // 任务3 · 查看器媒体时间线 + 左右翻页（含「翻过最旧一张去服务端续拉」）：见 useViewerNav。
  const { viewerList, viewerIdx, goViewer } = useViewerNav({ viewer, setViewer, messages, mediaPaging, setViewerMore, setToast, t });
  // 首条未读下标：conv_seq > read_seq 的第一条对端消息（精确，CHAT_UX §4）。
  // **必须与服务端未读口径一致**（M4-8）：服务端 unreadCount 排除 msg_op 事件行与 system 系统消息，
  // 这里若只按 from !== uid 找，分割线会落到不计未读的系统行上——
  // 表现为「以下为 N 条新消息」下方实际多出几行（群改名/入群留痕都会触发）。
  const firstUnreadIdx =
    entryUnread > 0
      ? messages.findIndex((m) => m.from !== uid && m.convSeq > entryReadSeq && countsAsUnread(m.contentType))
      : -1;
  // 末条"自己消息"的状态签名：被拒收/ack 会改其 status/note（条数不变），用它当滚动 effect 的依赖，
  // 否则仅 messages.length 不变 → effect 不重跑 → 系统行变高后不贴底（问题1）。
  const tail = messages[messages.length - 1];
  const tailSig = tail && tail.from === uid ? `${tail.status}|${tail.note ?? ""}` : "";
  // 渲染窗口签名：**不能只依赖 messages.length**。窗口是定长滑动的——取回更早一页后渲染集从
  // [29602..29801] 变成 [29502..29701]，条数纹丝不动，只看 length 的 effect 根本不重跑：
  // 忙标志 loadingOlderRef 永远复位不了，之后每次上滑都被当成 busy 跳过，历史就此翻不动
  //（2026-09-03 libeyond↔user1001 三万条会话实测：停在首页上沿）。
  const curMin = minSeqOf(messages);
  const curMax = maxSeqOf(messages);
  const windowSig = `${curMin}|${curMax}|${messages.length}`;

  // 进会话定位 / 新消息贴底 / 顶部插历史保位 / 在上看历史累加跳转计数（纯 DOM 滚动）。
  useLayoutEffect(() => {
    if (phase !== "app" || !convId) return;
    const box = msgsRef.current;
    if (!box) return;
    // 条数是否增加：新增消息=true；仅原条状态变更（被拒收/ack 改 status/note）=false。
    const grew = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;
    // 贴底 + 收掉"↓N"（贴底即读到最新，按钮没有存在的意义）。三处共用：自己发送 / 末条变高 / 收到新消息。
    const stickBottom = () => {
      box.scrollTop = box.scrollHeight;
      wasNearBottomRef.current = true;
      setShowJump(false);
      setJumpCount(0);
      setJumpCapped(false);
    };

    if (pendingScrollRef.current) {
      if (messages.length === 0) return; // 等锚点窗口到达再定位
      if (firstUnreadIdx >= 0 && !forceBottomRef.current && dividerRef.current) {
        // 停在首条未读（分割线滚到容器顶）。不用 Element.scrollIntoView——它会沿祖先链一路把
        // 能滚的都滚，含 html/#root，导致整个 .app 被顶出视口、顶部与卡片间距"塌陷"（刷新才复位）；
        // 改为只动 .msgs 自身的 scrollTop，把分割线顶对齐到容器顶，滚动严格限定在消息容器内。
        box.scrollTop += dividerRef.current.getBoundingClientRect().top - box.getBoundingClientRect().top;
        // 定位后实测是否已贴底：未读不多、整屏放得下时分割线滚到顶仍贴底 → 不显示 ↓N（CHAT_UX §7）。
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        wasNearBottomRef.current = nearBottom;
        setShowJump(!nearBottom && entryUnreadRef.current > 0);
        setJumpCount(nearBottom ? 0 : entryUnreadRef.current);
        setJumpCapped(!nearBottom && entryUnreadCappedRef.current);
      } else {
        box.scrollTop = box.scrollHeight; // 无未读 / 强制到底
        wasNearBottomRef.current = true;
        setShowJump(false);
      }
      pendingScrollRef.current = false;
      forceBottomRef.current = false;
      sendStickRef.current = false; // 进会话定位自带落点，别再被上一轮的发送旗子拽一次
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 自己刚发了一条（appendMsg 置位）：**无条件贴底**，不看 grew / wasNearBottom。
    // 必须早于下面的分页保位分支——在历史里发消息时窗口刚被拉回贴最新，curMin/curMax 会同时暴涨，
    // 与"下滚翻页"的形状撞车，落进那些分支就只保位、不贴底。
    if (sendStickRef.current && messages.length > 0) {
      sendStickRef.current = false;
      stickBottom();
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      if (curMax > latestSeqRef.current) latestSeqRef.current = curMax;
      return;
    }

    const wasLoadingNewer = loadingNewerRef.current;
    if (curMin < prevMinSeqRef.current) loadingOlderRef.current = false;
    if (curMax > prevMaxSeqRef.current) loadingNewerRef.current = false;

    // 上滑取回/展开更早历史 → 保位，视觉位置不跳。
    // 判据是「上滑意图 + 上沿确实下移」，**不看 curMax**：锚点模式的窗口以锚点居中切片，
    // 扩窗时下沿也会同步向后长（29702..29901 → 29602..30001），若照旧要求 curMax 不变，
    // 这一步会掉进下面的"真·新消息"分支——对端消息被数成 ↓100 的假角标、自己的消息则直接把人甩到底。
    if (histAnchorRef.current && curMin < prevMinSeqRef.current) {
      const a = histAnchorRef.current;
      histAnchorRef.current = null;
      const row = a.seq > 0 ? box.querySelector<HTMLElement>(`.msg-item[data-seq="${a.seq}"]`) : null;
      if (row && a.top !== null) {
        // 用户上滑前正看着的那条，补偿后仍在原位（Telegram 同款：按消息保位，不按高度差）。
        box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - a.top;
      } else {
        box.scrollTop = box.scrollHeight - a.h + a.t; // 那条已不在窗口（被删等）：退回高度差补偿
      }
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      return;
    }

    // 下滚分页加载的更新历史（≤ latest）：插在下方。
    if (curMax > prevMaxSeqRef.current && curMax <= latestSeqRef.current && wasLoadingNewer) {
      // 窗口只是变长（上沿没动）⇒ 位置本就不用动；窗口已封顶开始**滑动**（上沿前移）⇒
      // 顶部那一段从 DOM 里消失、下方内容整体上移，必须按同一条消息摆回去，否则每翻一页跳一页。
      const a = tailAnchorRef.current;
      tailAnchorRef.current = null;
      if (a && curMin > prevMinSeqRef.current) {
        const row = box.querySelector<HTMLElement>(`.msg-item[data-seq="${a.seq}"]`);
        if (row) box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - a.top;
      }
      prevMinSeqRef.current = curMin;
      prevMaxSeqRef.current = curMax;
      // 重新评估「跳底钮」：loadNewer 追加内容后若用户仍视觉贴底，隐藏按钮
      //（早退不重算就会一直显示，即便用户已被自动带回底部）。
      const nearBottomPx = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      if (nearBottomPx) { setShowJump(false); setJumpCount(0); setJumpCapped(false); }
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
      if (grew || wasNearBottomRef.current) stickBottom();
    } else if (newPeer > 0) {
      if (wasNearBottomRef.current) {
        stickBottom();
      } else {
        setJumpCount((n) => n + newPeer);
        setShowJump(true);
      }
    }
  }, [phase, convId, windowSig, uid, firstUnreadIdx, tailSig]);

  // 窗口停在历史某一段时，把「回到最新」按钮亮出来——**它是唯一的回程**。
  //
  // iOS 的 `openLocalWindowAroundConvSeq:` 末尾就有一句 `updateJumpButton`（"窗口离开末尾 → ↓N 要显示"），
  // Web 一直没有对应动作：`showJump` 只在 `onMsgsScroll` 与进会话的 layout effect 里算，而
  // **"点置顶跳过去"根本不产生滚动事件**。更要命的是跳到的那一段常常整屏就放得下
  //（2026-09-05 实测：20000 人大群点置顶落在 13 条的旧岛上，scrollHeight 695 / 视口 650，
  // 只有 45px 可滚且已在底部）——滚不出事件，`onMsgsScroll` 里那条"贴底且窗口不在本地末尾就回到贴最新"
  // 的兜底也永远轮不到，用户被彻底困在这一段里，只能切走会话再切回来。这就是用户报的
  // 「点击置顶消息，无法一次回到消息位置」。
  //
  // 判据用**最大 conv_seq** 而非"最后一个元素"，理由同 onMsgsScroll 里那处：本地库按到达顺序存。
  useEffect(() => {
    if (phase !== "app" || !convId || renderView.anchor === null) return;
    if (maxSeqOf(messages) >= maxSeqOf(msgsByConv[convId] ?? [])) return; // 窗口已含本地最新 ⇒ 不算停在历史
    setShowJump(true);
  }, [phase, convId, renderView.anchor, windowSig, messages, msgsByConv]);

  // 图片/视频异步加载：贴底 useLayoutEffect 时高度≈0、加载完才撑高，依赖不变 effect 不重跑 → 媒体被挤出视口下方（问题2）。
  // 故媒体加载完成后，若此前处于贴底状态则再贴一次底。图片(onLoad)/视频(onLoadedData)共用此回调。
  const onMediaLoad = useCallback(() => {
    const box = msgsRef.current;
    if (box && wasNearBottomRef.current) box.scrollTop = box.scrollHeight;
  }, []);

  // 可见即读（CHAT_UX §6）：视口内最大 conv_seq 超过已滚入位点则节流上报；**页面 hidden 时不算读**（切走标签页/最小化
  // 对方会误见已读，2026-10-05 联调实测），回到前台由 usePageVisibleAgain 补扫。同时更新视口下方未读数 ↓N。
  const markVisibleRead = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    const boxBottom = box.getBoundingClientRect().bottom;
    const items = box.querySelectorAll<HTMLElement>(".msg-item[data-seq]");
    let maxSeq = 0;
    items.forEach((el) => {
      // 相册主行带 data-seq-end=宫格末条 seq：看到宫格即视为读到整组，否则以相册结尾的会话已读卡在首条、未读清不掉。
      const seq = Number(el.dataset.seqEnd || el.dataset.seq);
      // 元素顶部已进入容器可见底边 → 视为已滚入（被看到过）；其中最大 seq = 当前看到的最深位置。
      if (seq > 0 && el.getBoundingClientRect().top < boxBottom) maxSeq = Math.max(maxSeq, seq);
    });
    if (maxSeq > pendingReadRef.current && !document.hidden) {
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
    // ↓N = 视口下方仍未读的对端消息数。
    //
    // **数 DOM 只在本地齐全时才对**（IMServer/docs/design/OFFLINE_BACKLOG_DESIGN.md §4.9 第 8 项）：
    // items 是渲染出来的那一窗（200 条），离线积压留了缺口时，缺口里的消息根本没下载，
    // 数出来最多就是「窗口条数」——1 万条未读会显示成 ↓195，看着像个正常数字，其实是错的。
    // 有缺口时改用服务端最新位点减去已滚入位点（O(1)，不依赖本地有多少）。
    //
    // **数本地全量、不数 DOM**（2026-09-03 修）：上翻过一页后窗口切到锚点模式，它**不含尾部**，
    // 于是实时到来的对端消息压根不在 DOM 里——角标恒 0，用户在读历史时完全不知道来了新消息，
    // 而左侧会话列表的红点却在涨，同一屏两个数打架。角标问的是"下面还有多少没读"，
    // 那是个关于**整个会话**的问题，按 §4.9 的判据就该用本地全量而不是当前渲染的那一窗。
    const cid = currentConvRef.current;
    const localAll = msgsByConvRef.current[cid] ?? [];
    // 两个量**一趟扫完**：这段每次滚动都会跑，长会话下本地全量可达十万条，
    // 为 localNewest 再扫一遍等于把每帧成本翻倍。
    let loadedBelow = 0;
    let localNewest = 0;
    for (const m of localAll) {
      if (m.convSeq > localNewest) localNewest = m.convSeq;
      if (m.convSeq > pendingReadRef.current && m.from !== uidRef.current && countsAsUnread(m.contentType)) loadedBelow++;
    }
    const client = clientRef.current;
    const head = client?.headOf(cid) ?? 0;
    // 「已滚入位点到 head 之间，服务端给过的本地都有吗」——区间清单里**含** msg_op 事件行/墓碑等
    // "占了 conv_seq 却不是消息"的行，所以这才是「下面还缺不缺东西」的正确判据（见 unreadBelow.ts）。
    const floor = client?.visibleFloorOf(cid) ?? 0;   // 有效可见下界（服务端下界 ∪ 清空位点）：以内的号不算「下面还缺」
    const coveredBelowFrontier = head > 0
      && coversSpan(client?.rangesOf(cid) ?? [], Math.max(pendingReadRef.current, floor) + 1, head);
    setJumpCount(unreadBelowCount({
      hasGap: !!client?.hasGap(cid),
      head,
      pendingRead: pendingReadRef.current,
      loadedBelow,
      localNewest,
      coveredBelowFrontier,
      floor,
    }));
    setJumpCapped(false); // 这里算的是真实差值/真实条数，不是被服务端计数上限截断的值
  }, [refreshConversations]);

  // 进会话/新消息渲染后扫一遍可见消息（覆盖"整屏放得下、不触发滚动"的短会话；滚动另由 onMsgsScroll 处理）。
  // 依赖里的 `allLocal.length` 不能换成 `messages.length`：锚点窗不含尾部，新消息只进本地全量，只看窗口条数永不重算角标。
  useEffect(() => {
    if (phase === "app" && convId) markVisibleRead();
  }, [phase, convId, messages.length, allLocal.length, markVisibleRead]);
  usePageVisibleAgain(() => { if (phase === "app" && currentConvRef.current) markVisibleRead(); });

  const onMsgsScroll = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    markVisibleRead(); // 可见即读：滚到哪、读到哪
    const cid = currentConvRef.current;
    const list = msgsByConv[cid] ?? [];
    const nearBottomPx = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const newest = maxSeqOf(list);
    // 刻意**不再**取 minSeqOf(list) 当"历史边界"：本地全量的最小 seq 在有缺口时
    // 指向缺口另一侧的旧岛，不是用户正看到的那一段（见下方上滚分支）。
    const moreBelow = Math.max(newest, clientRef.current?.visibleFloorOf(cid) ?? 0) < latestSeqRef.current; // 下方还有未加载的更新历史（清空位点以内的不算）
    // 按钮显示只看「视觉贴底」（与 iOS updateJumpButton 对齐）——若 moreBelow=true 亦一并纳入
    // 判定，会出现「用户视觉已在最底部，但按钮仍显」的伪 bug（未读多/大群/进会话瞬间 push 到达时高发）：
    // 视觉贴底后 L1792 会自动 loadNewer 追齐，此时不必弹按钮打扰。
    // wasNearBottomRef 语义同源：新内容到来时是否贴底跟随（onMediaLoad / layout effect 共用）。
    const busy = loadingOlderRef.current || loadingNewerRef.current;
    const localAll = msgsByConv[cid] ?? [];
    // 窗口是否已经贴到本地最新一条（锚点模式下窗口停在历史某段，下面要靠它判断"该往前移窗了"）。
    // **比最大 conv_seq，不比"最后一个元素"**：localAll 是**到达顺序**（appendTo 一路 push），
    // 而定位开窗取回的是一段**旧**消息，它们就被追加在数组末尾——于是"窗口末条 === 本地末条"
    // 恒成立，这一支永远不触发：跳到历史后往下滚就再也回不到最新消息（2026-09-05 实测，
    // 滚到那一段底部纹丝不动）。渲染用的 allLocal 是排过序的副本，localAll 不是。
    const windowAtLocalEnd = renderView.anchor === null || maxSeqOf(messagesRef.current) >= maxSeqOf(localAll);
    // 「贴底」只在窗口含本地最新时才算数：停在历史某一段的底部**不是**贴底——
    // 否则一次钳位 scroll 就把 ↓ 收掉、把 wasNearBottom 置真，之后 onMediaLoad 又把人拽到那一段底部。
    const atTail = nearBottomPx && windowAtLocalEnd;
    wasNearBottomRef.current = atTail;
    setShowJump(!atTail);
    if (atTail) setJumpCount(0);

    if (nearBottomPx && !windowAtLocalEnd) {
      // **跳到历史后往下滚**：本地还有更新的内容，只是不在窗口里 → 直接回到"贴最新"模式。
      // 不做这一步的话，用户跳到第 123 条后往下滚会卡在窗口末尾（loadNewer 去问服务端，
      // 而数据本就在本地，什么也不会变），再也回不到最新消息。
      //
      // **必须是用户的手**（userScrollIntentRef）。定位移窗后有三种不是手的 scroll 事件：
      // 内容缩短时浏览器钳位 scrollTop、layout effect 贴底赋值、jumpToSeq 自己的赋值——
      // 它们全在 rAF 之前派发（HTML「update the rendering」里 scroll steps 先于 animation
      // frame callbacks）。旧岛整屏放得下时 nearBottomPx 恒真，于是刚跳过去就被这一支冲回
      // 尾部，用户看到的就是"点了没反应 / 闪一下又回去了"（2026-09-05 用户三报「仍然没解决」，
      // 隐藏标签页不派发 scroll 事件，前两轮实测都没撞上）。
      if (userScrollIntentRef.current) setRenderView({ anchor: null, size: RENDER_WINDOW_STEP });
    } else if (nearBottomPx && moreBelow && !busy) {
      loadingNewerRef.current = true; // 下滚到底 → 加载更新一页
      // 保位锚点：窗口末尾那条 + 它距容器顶的偏移（与上滚那一路同一套「按同一条消息补偿」）。
      const lastRendered = maxSeqOf(messagesRef.current);
      const lastRow = lastRendered > 0 ? box.querySelector<HTMLElement>(`.msg-item[data-seq="${lastRendered}"]`) : null;
      tailAnchorRef.current = lastRow
        ? { seq: lastRendered, top: lastRow.getBoundingClientRect().top - box.getBoundingClientRect().top }
        : null;
      // **先把窗口长到上限再谈滑动**（与上滚那一路对称）：没长满时新的一页直接接在下方，
      // 上沿不动 ⇒ 根本不需要补偿；长满 RENDER_WINDOW_MAX 之后才开始滑，那时才靠锚点摆回去。
      setRenderView((v) => (v.anchor === null && v.size < RENDER_WINDOW_MAX
        ? { ...v, size: Math.min(v.size + RENDER_WINDOW_STEP, RENDER_WINDOW_MAX) } : v));
      clientRef.current?.loadNewer(cid, newest);
    } else if (box.scrollTop < 120 && !busy) {
      // 上滚到顶：**先扩渲染窗口**（本地已有的那部分不必再请求），本地也见底了才去拉更早的一页。
      // 分两步是因为本地库常常比渲染窗口大得多——首次进会话的 sync 会把历史全灌进本地库，
      // 那时"往上滚"应该是瞬时展开已有内容，而不是空跑一次网络请求。
      const oldestRendered = minSeqOf(messagesRef.current);
      const topRow = oldestRendered > 0 ? box.querySelector<HTMLElement>(`.msg-item[data-seq="${oldestRendered}"]`) : null;
      histAnchorRef.current = { // 保位，避免视觉跳动（按这条消息补偿，见 histAnchorRef 定义处）
        seq: oldestRendered,
        top: topRow ? topRow.getBoundingClientRect().top - box.getBoundingClientRect().top : null,
        h: box.scrollHeight, t: box.scrollTop,
      };
      // **展开渲染窗口前先确认本地这一段是连着的**（OFFLINE_BACKLOG_DESIGN §4.7）：有缺口时
      // msgsByConv 里存着缺口**两侧**的消息，直接扩窗会把另一侧的旧岛静默接上来——界面照常、
      // 时间戳也递增，只是中间少了几万条且没有任何提示。判据在 windowPlan.ts（与 renderWindow.ts
      // 的切段判据同源），**是区间清单不是 seq 连号**。锚点必须用「当前渲染出来的最早一条」，
      // 不能用本地全量最小 seq——后者在有缺口时指向缺口另一侧的旧岛（极端就是 seq=1），
      // 于是「oldest > 1」恒假、上滚什么都不发生（2026-09-03 实测）。
      const localAllForConv = msgsByConv[cid] ?? [];
      // 本地实际存在的消息里、比上沿更早的那个**最大** conv_seq（没有则 0）——判据只认它。
      const prevLocalSeq = localAllForConv.reduce((mx, m) => (m.convSeq > 0 && m.convSeq < oldestRendered ? Math.max(mx, m.convSeq) : mx), 0);
      const contiguousAbove = moreLocalAbove(clientRef.current?.rangesOf(cid) ?? [], oldestRendered, prevLocalSeq);
      const localCount = localAllForConv.length;
      const roomToGrow = Math.min(localCount, RENDER_WINDOW_MAX);
      if (contiguousAbove && renderView.size < roomToGrow) {
        // 未触顶：扩大窗口（保持当前锚点），把本地已有的更早内容展开出来。
        setRenderView((v) => ({ ...v, size: Math.min(v.size + RENDER_WINDOW_STEP, roomToGrow) }));
      } else if (contiguousAbove) {
        // 已触顶：**滑动**而不是继续长。以当前顶部那条为锚点重开一窗——visibleSlice 会把它
        // 摆在窗口中间，于是上方多出半窗、下方等量丢掉，DOM 恒定在上限内。
        // 不这么做就只剩两条路：要么无限长（回到 W2 之前），要么什么都不做（往上滚不动）。
        setRenderView({ anchor: oldestRendered, size: RENDER_WINDOW_MAX });
      } else if (oldestRendered > 1 && !clientRef.current?.atHistoryFloor(cid, oldestRendered)) {
        // atHistoryFloor = 服务端的权威答案（has_before=false）；`>1` 只是猜，对有可见下界的新成员恒真。
        loadingOlderRef.current = true;
        // **切到锚点模式**：anchor=null 的窗口恒等于"本地最新 size 条"，于是补回来的更早消息
        // 永远进不了这一窗——屏幕纹丝不动，而 loadingOlderRef 靠"渲染集最小 seq 下降"复位，
        // 不降就永久卡在"加载中"，之后每次上滑都被当成 busy 跳过（2026-09-03 实测）。
        // 把锚点钉在用户当前看的顶部那条，新内容就出现在它上方，位置也不会被甩走。
        // **保持当前窗口大小**，不要重置回 STEP（2026-09-03 实测）：
        // 重置的话，居中到旧顶部只露出半窗＝100 条新内容，下一次上滑又靠扩窗补 100，
        // 于是窗口在 200↔400 之间来回抖、每次只前进 100 条——libeyond 在 2 万人大群里
        // 上滑的观感就是"加载不出更多"。保持尺寸后稳定在「一次上滑 = 一页 200 条」。
        setRenderView((v) => ({ anchor: oldestRendered, size: v.size }));
        clientRef.current?.loadOlder(cid, oldestRendered);
      }
    }
  }, [msgsByConv, renderView]);

  const jumpToBottom = useCallback(() => {
    const box = msgsRef.current;
    if (!box) return;
    // 窗口拉回"贴最新"：跳到历史后窗口停在那一段，不复位的话点"回到底部"只会滚到那一段的底，
    // 而不是会话的最新消息。
    setRenderView({ anchor: null, size: RENDER_WINDOW_STEP });
    const cid = currentConvRef.current;
    const newest = maxSeqOf(msgsByConv[cid] ?? []);
    // 无条件先滚一次消除假死（500人大群必现）：openConversation 拉回一页若全命中 seen → mergeMetaBySeq 不改 messages.length → layout effect 不重跑 → pendingScrollRef 卡住。真新消息到达时 layout effect 会再精修。
    box.scrollTop = box.scrollHeight;
    // C4（OFFLINE_BACKLOG §4.8）：最后一页本地不齐才 window_req(anchor=0)；只比最大 seq 会漏掉「尾部是跳号登记的孤岛」。
    if (clientRef.current?.jumpToLatest(cid, latestSeqRef.current, newest)) {   // 真发了请求才等响应来滚
      setEntryUnread(0);
      forceBottomRef.current = true;
      pendingScrollRef.current = true;
    }
    wasNearBottomRef.current = true;
    setShowJump(false);
    setJumpCount(0);
  }, [msgsByConv]);

  // 层2：落地页「在网页版中打开」带 /?qr=<邀请链接> 进来——挂载时截获并从地址栏剥离（防刷新重放/泄露到历史），
  // 登录进入主界面后按扫码同款流程处理（未登录先登录再续，与扫码登录的 pending 套路同理）。
  // ⚠️ 必须放在下方 `if (phase === "login") return` 之前：hook 在提前 return 之后会随 phase 改变 hook 数量
  // → "Rendered more hooks than during the previous render" 白屏（2026-08-14 踩过）。
  // handleScanRaw 定义在提前 return 之后：仅在 phase==="app" 的渲染里才会被 effect 读到，届时已初始化，无 TDZ。
  // 聊天动作 Context（阶段 1 · MessageList 消费）：成员皆 setter/ref/useCallback，定义均在 login 早退之前；
  // 本 useMemo 亦须在早退之前（hook 数恒定）。reactive 值与晚定义的 openPeerDetail/handleScanRaw 走 MessageList props。
  // 函数成员一律经 useEvent 包成恒定身份（send/onGateTap/pickMention… 的 useCallback 依赖 input/dlStates/uploadProgress 等高频 state，
  // 直接放进来会让 Context 值每次按键/上传 tick 重建、所有消费组件重渲染——/code-review 2026-08-22）。setter/ref 本身恒定。
  const locateInChatEv = useEvent(locateInChat);
  const onGateTapEv = useEvent(onGateTap);
  const onMediaBubbleTapEv = useEvent(onMediaBubbleTap);
  const openReadyFileEv = useEvent(openReadyFile);
  const onPassiveMediaErrorEv = useEvent(onPassiveMediaError);
  const retryUploadEv = useEvent(retryUpload);
  const resendMessageEv = useEvent(resendMessage);
  const toggleUploadPauseEv = useEvent(toggleUploadPause);
  const toggleSelectedEv = useEvent(toggleSelected);
  const fetchLinkPreviewEv = useEvent(fetchLinkPreview);
  const onMediaLoadEv = useEvent(onMediaLoad);
  const jumpToBottomEv = useEvent(jumpToBottom);
  const unblockEv = useEvent(unblock);
  const exitSelectModeEv = useEvent(exitSelectMode);
  const forwardSelectedEv = useEvent(forwardSelected);
  const deleteSelectedEv = useEvent(deleteSelected);
  const deleteSelectedForEveryoneEv = useEvent(deleteSelectedForEveryone);
  const favoriteSelectedEv = useEvent(favoriteSelected);
  const reportSelectedEv = useEvent(reportSelected);
  const removePastedImageEv = useEvent(removePastedImage);
  const cancelAttachCloseEv = useEvent(cancelAttachClose);
  const scheduleAttachCloseEv = useEvent(scheduleAttachClose);
  const pickFileEv = useEvent(pickFile);
  const openFavoritesPickEv = useEvent(openFavoritesPick);
  const openContactPickerEv = useEvent(openContactPicker);
  const onFilePickedEv = useEvent(onFilePicked);
  const pickMentionEv = useEvent(pickMention);
  const onInputChangeEv = useEvent(onInputChange);
  const onComposerPasteEv = useEvent(onComposerPaste);
  const sendEv = useEvent(send);
  // Web P1 语音：发送/失败重试逻辑已收进 useVoiceSend（松手立即插占位，上传失败原地转 Failed
  // 可重传，对齐 iOS，见该文件顶部注释与 2026-09-24 current_task）；这里只包一层恒定身份。
  const sendVoiceEv = useEvent(sendVoice);

  const chatActions = useMemo<ChatActions>(() => ({
    setMenu, setViewer, setInput, setRecordStack, setToast, locateInChat: locateInChatEv,
    onGateTap: onGateTapEv, onMediaBubbleTap: onMediaBubbleTapEv, openReadyFile: openReadyFileEv, onPassiveMediaError: onPassiveMediaErrorEv,
    retryUpload: retryUploadEv, resendMessage: resendMessageEv, toggleUploadPause: toggleUploadPauseEv, toggleSelected: toggleSelectedEv, fetchLinkPreview: fetchLinkPreviewEv,
    onMediaLoad: onMediaLoadEv, pendingFilesRef,
    jumpToBottom: jumpToBottomEv, unblock: unblockEv, setEditingMsg, setReplyTo, exitSelectMode: exitSelectModeEv,
    forwardSelected: forwardSelectedEv, deleteSelected: deleteSelectedEv, deleteSelectedForEveryone: deleteSelectedForEveryoneEv, favoriteSelected: favoriteSelectedEv,
    reportSelected: reportSelectedEv, removePastedImage: removePastedImageEv,
    cancelAttachClose: cancelAttachCloseEv, scheduleAttachClose: scheduleAttachCloseEv, setAttachPanel, pickFile: pickFileEv,
    openFavoritesPick: openFavoritesPickEv, openContactPicker: openContactPickerEv, onFilePicked: onFilePickedEv, setMentionFilter, pickMention: pickMentionEv,
    setMentionActive, onInputChange: onInputChangeEv, onComposerPaste: onComposerPasteEv, addPastedFiles, send: sendEv,
    sendVoice: sendVoiceEv,
    attachAnchorRef, fileInputRef, mentionPanelRef, mentionActiveRef, composerRef,
  // 全部成员身份恒定 → 依赖为空，Context 值只建一次。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // 我在当前打开的群管理面板里，但角色被**别处**降成了普通成员（另一台设备/另一端撤了我的管理员、
  // 或把群主转给了别人）→ 整个面板对我不再成立，收起来并说一句。不收的话：管理员列表页只是悄悄少掉
  // 「添加/撤销」，返回后群管理页那一排开关照样可点，点下去只会吃一句英文的 no group permission。
  // 收在这一个 effect 里而不是两个面板各判一次（角色是同一份 my_role，判定只该有一处）。
  useEffect(() => {
    if (!manageOpen || !detail?.isGroup) return;
    const role = groupInfos[detail.convId]?.my_role;
    if (role && role === "member") {
      setManageOpen(false);
      setAdminPanelOpen(false);
      setToast(t("group.error.not_admin"));
    }
  }, [manageOpen, detail, groupInfos, setToast]);

  // 二维码簇 → useQR（阶段 7c）：openPeerDetail 定义在早退后，经 ref 注入（定义处回写 .current）。
  const openPeerDetailRef = useRef<(peer: string) => void>(() => {});
  const { qrScan, setQrScan, qrCardModal, setQrCardModal, qrResult, setQrResult, handleScanRaw, openMyCard, openGroupCard, resetQRCard, qrResultActions } =
    useQR({ phase, uid, myInfo, groupInfos, clientRef, setToast, openChat, openGroupChat, refreshConversations, openPeerDetailRef, askFriendRequest });

  // 收藏「来自X」缺名补齐（**必须在登录早退之前**：hook 数每次渲染要一致）。
  // groupInfos 只在**打开过**那个群时才有成员表，friends 又只覆盖好友——于是"没聊过的群里、
  // 非好友发的收藏"来源名一律露出 10 位内部 ID（用户反馈）。这里按需两级补拉：先拉群资料
  // （拿群昵称，与聊天里看到的名字一致），仍缺再拉个人名片。每个 id 只发一次（成功与否都记进
  // favResolveTriedRef），失败静默——来源名不值得打断浏览收藏。
  // 判据**不复用**下方的 favSourceLabel：那是早退之后定义的 const，写进这里就等着 TDZ。
  useEffect(() => {
    if (!favorites) return;
    const client = clientRef.current;
    if (!client) return;
    const tried = favResolveTriedRef.current;
    for (const f of favorites) {
      const from = f.source_from;
      if (!from || from === uid) continue;
      const cid = f.source_conv_id || "";
      const known = remarks.has(from)
        || friends.some((x) => x.user_id === from)
        || !!groupInfos[cid]?.members.some((x) => x.user_id === from)
        || !!favUserCards[from];
      if (known) continue;
      if (cid.startsWith("g_") && !groupInfos[cid] && !tried.groups.has(cid)) {
        tried.groups.add(cid);
        void refreshGroupInfo(cid); // 成员表回来后 groupInfos 变化 → 本 effect 重跑，仍缺的转走名片补拉
        continue;
      }
      if (!tried.users.has(from)) {
        tried.users.add(from);
        void client.userProfile(from)
          .then((u) => setFavUserCards((m) => ({ ...m, [from]: u })))
          .catch(() => undefined); // 已注销/网络失败：保持内部 ID 占位
      }
    }
  }, [favorites, groupInfos, friends, remarks, favUserCards, uid, refreshGroupInfo]);

  // ⚠️ **必须放在下面的登录早退之前**：hooks 数量每次渲染必须一致（Rules of Hooks）。
  // 「添加管理员 / 选择新群主」在**超级群**下的候选源：端上只有治理集（群主+管理员），
  // 候选必须来自服务端搜索。各给一个 hook 实例——两个弹窗状态独立，共用一个会互相清结果。
  // 普通群传 undefined，hook 空转，弹窗照旧走本地过滤。
  const adminPickerSuperConv = adminPicker && groupInfos[adminPicker.convId]?.is_super ? adminPicker.convId : undefined;
  const transferSuperConv = transferPicker && groupInfos[transferPicker]?.is_super ? transferPicker : undefined;
  const adminSearch = useMemberSearch(adminPickerSuperConv, clientRef.current?.authToken ?? "");
  const transferSearch = useMemberSearch(transferSuperConv, clientRef.current?.authToken ?? "");

  // 当前详情抽屉打开的群若是**超级群**，成员表要走分页（gp.members 只含我自己）。
  // 返回 conv_id 供拉取与透传；普通群返回空串，走原来的全量渲染。
  const activeSuperGroupId = useMemo(() => {
    if (!detail?.isGroup || !detail.convId) return "";
    const gp = groupInfos[detail.convId];
    return gp?.is_super ? detail.convId : "";
  }, [detail, groupInfos]);
  // 打开超级群详情（或换了个群）→ 从第一页重新拉；离开则清空，免得下次串到别的群的成员。
  useEffect(() => {
    superLoadingRef.current = false; // 切群即复位：否则上一群的在途标记会把新群的首页请求挡掉
    setSuperLoading(false);
    if (!activeSuperGroupId) { setSuperMembers([]); setSuperCursor({ next: "", hasMore: false }); return; }
    void loadSuperMembers(activeSuperGroupId, "");
  }, [activeSuperGroupId, loadSuperMembers]);

  // uid → 公开名片的兜底解析（超级群成员表不下发 / 发送者已退群时，头像与昵称的唯一来源）。
  // ⚠️ 与下面两个 hook 一样**必须在登录早退之前**（Rules of Hooks）。
  const userProfiles = useUserProfiles(clientRef.current?.authToken ?? "");
  // 当前渲染窗口里"成员表给不出身份"的 uid：发送者、被 @ 的人、被引用者。
  // 只声明**看得见的那一屏**，不是整个会话——2 万人群里前者是几十个，后者是无穷。
  const unresolvedViewUids = useMemo(() => {
    if (!convId) return [] as string[];
    const members = groupInfos[convId]?.members;
    const known = new Set((members ?? []).map((m) => m.user_id));
    const want = new Set<string>();
    for (const m of messages) {
      // 发送者：消息自带 from_nickname，但**没有 from_avatar**，所以有名字也仍要解析头像。
      if (m.from && !known.has(m.from)) want.add(m.from);
      if (m.replyToFrom && !known.has(m.replyToFrom)) want.add(m.replyToFrom);
      for (const u of m.mentions ?? []) if (u && !known.has(u)) want.add(u);
    }
    return [...want];
  }, [convId, groupInfos, messages]);
  // 依赖 request（引用稳定）而不是整个 userProfiles 对象——后者每次渲染都是新的，
  // 会让这个 effect 每帧都跑一遍（App 因输入/在线态跳动重渲染很频繁）。
  const requestProfiles = userProfiles.request;
  useEffect(() => { requestProfiles(unresolvedViewUids); }, [unresolvedViewUids, requestProfiles]);

  // ---- 登录 ----
  if (phase === "login") {
    return (
      <LoginView
        restoring={restoring} uid={loginName} nickname={nickname} password={password}
        authErr={authErr} authBusy={authBusy} loginTab={loginTab}
        onUid={setLoginName} onNickname={setNickname} onPassword={setPassword} onLoginTab={setLoginTab}
        onLogin={(pwd) => void enterApp(loginName, pwd)} onRegister={() => void doRegister()}
        onQRLogin={(loginUid, token, refreshToken) => {
          pendingQrRef.current = { uid: loginUid, token, refresh: refreshToken };
          setUid(loginUid);
          setQrTrigger((n) => n + 1); // uid 不变时也强制触发入场 effect
        }}
      />
    );
  }

  // ---- 双栏主界面（左会话列表常驻 + 右聊天详情） ----
  const readSeq = peerReadSeq[convId] ?? 0;
  const peerBlocked = !!peer && friends.some((f) => f.user_id === peer && f.blocked); // 我拉黑了对方（blocked 标记，与 status 正交）

  // 通讯录派生：我对每个对端的关系状态、收到的申请、已是好友、新申请红点数。
  // 拉黑的好友 status 仍是 accepted，但搜索结果按"已拉黑"展示，故 blocked 覆盖 status。
  const friendStatus = new Map(friends.map((f) => [f.user_id, f.blocked ? "blocked" : f.status]));
  const blockedSet = new Set(friends.filter((f) => f.blocked).map((f) => f.user_id));
  const incoming = friends.filter((f) => f.status === "pending"); // 别人申请我，待我同意/拒绝
  // 我申请别人、待对方通过。「新的朋友」页要显示它——只显示 incoming 的话，
  // 发起方点完「加好友」就再也看不到这件事的下文（自己写了什么理由、对方通过了没有）。
  const outgoing = friends.filter((f) => f.status === "requested").sort((a, b) => b.updated_at - a.updated_at);
  const accepted = friends.filter((f) => f.status === "accepted").sort((a, b) => b.updated_at - a.updated_at);
  // 本地过滤好友：命中备注 / 昵称 / uid 任一（子串，大小写不敏感）。空串=不过滤。
  const contactFilterQ = contactFilter.trim().toLowerCase();
  const filteredAccepted = contactFilterQ
    ? accepted.filter((f) =>
        (f.remark || "").toLowerCase().includes(contactFilterQ) ||
        (f.nickname || "").toLowerCase().includes(contactFilterQ) ||
        // 按公开句柄搜：资料页显示 @zhangsan，用户回通讯录搜 zhangsan 就该能找到
        //（这个一致性正是"好友列表下发 username"的主要理由，见 ACCOUNT_IDENTITY_REDESIGN §7.4）。
        (f.username || "").toLowerCase().includes(contactFilterQ) ||
        // 内部 ID 仍可搜（粘贴 ID 精准定位），但它不在任何地方展示，属兜底能力。
        f.user_id.toLowerCase().includes(contactFilterQ))
    : accepted;
  const incomingCount = incoming.length;
  // 「这个人 / 这个会话在本机叫什么、用哪张头像」的一族只读派生 → chatNaming.ts（纯工厂，可单测）。
  // **整组一次性解构**而不是各自散在下面：它们互相引用（convDisplayLabel→convLabel、
  // localNameOf→memberNick、chatTitle→groupRemark…），分散定义时的声明顺序曾踩过 TDZ 白屏
  //（2026-08-20：homeConvHits 在 convDisplayLabel 之前引用它）。一次拿全就没有顺序问题。
  const {
    labelOf, friendLabel, convLabel, convDisplayLabel, convAvatarUrl,
    peerAvatar, peerNick, peerUsername, groupRemark,
    memberNick, localNameOf, senderLabel, groupMemberLabel, senderRole, senderAvatar,
  } = makeNameResolvers({
    remarks, friends, conversations, groupInfos, peerCards, searchResults, profileCards: userProfiles.cards,
    windowMessages: messages,
  });

  // 当前聊天对端的会话项与显示名（聊天页标题/备注预填用）。
  const peerConv = conversations.find((c) => c.peer === peer);
  const peerLabel = peerConv ? convLabel(peerConv) : displayNameOf(peer, remarks, peerNick(peer), peerUsername(peer));
  const groupConv = conversations.find((c) => c.conv_id === groupConvId); // 当前群会话（供头部菜单静音/删除，M4.5）

  // ---- 群聊派生 + 动作（早退 return 之后：全部普通函数，禁用 Hook）----
  const isGroupChat = !!groupConvId;
  const activeGroupInfo = groupConvId ? groupInfos[groupConvId] : undefined;
  // 当前会话的置顶集合与横幅上那条。索引可能因别人取消置顶而越界 → 夹紧。
  const activePinned = pinnedByConv[convId] ?? [];
  const pinnedShownIdx = clampPinnedIndex(pinnedIdx, activePinned.length);
  const pinnedShown = activePinned[pinnedShownIdx];
  // 横幅收起键**带账号 + 内容签名**（对齐 iOS）：换账号互不影响；新置顶/改公告生成新键 → 自动复现，而非一收永久隐藏。
  const pinDismissKey = `${uid}:${convId}:pin:${activePinned.length}:${activePinned[0]?.convSeq ?? 0}`;
  const annDismissKey = `${uid}:${groupConvId}:announce:${activeGroupInfo?.announcement_at ?? 0}`;
  // 能否置顶：群内读 perm_pin——开=仅群主/管理员，关=全员可置顶（对齐服务端 hub.go 校验）；单聊任一方可。
  const canPinHere = isGroupChat
    ? (!activeGroupInfo?.perm_pin || activeGroupInfo?.my_role === "owner" || activeGroupInfo?.my_role === "admin")
    : !!peer;
  // G2 输入栏禁言锁：成员级禁言（my_mute_until）或全员禁言（且我是普通成员）→ 禁用输入并改占位。
  // 服务端仍是权威（发上来照样拒 300208/300206），这里只提前告知、不给试错。
  const composerMuteReason: string | null = (() => {
    // 系统通知会话（peer=system）：不能回复——同一锁机制统一到 composer disabled + 占位。
    // 见 docs/design/SYSTEM_NOTICE_SESSION_DESIGN.md §5.2；服务端也会拒 send_msg to=system（护栏 §2.2）。
    if (!isGroupChat && peer === SYSTEM_UID) return t("chat.input.disabled_system");
    if (!isGroupChat || !activeGroupInfo) return null;
    if ((activeGroupInfo.my_mute_until ?? 0) > Date.now()) return t("chat.input.disabled_muted");
    if ((activeGroupInfo.mute_until ?? 0) > Date.now() && activeGroupInfo.my_role === "member") return t("chat.input.disabled_mute_all");
    return null;
  })();

  const activeGroupConv = groupConvId ? conversations.find((c) => c.conv_id === groupConvId) : undefined;
  const chatTitle = isGroupChat
    ? (groupRemark(groupConvId) || activeGroupInfo?.name || activeGroupConv?.name || t("common.group_chat"))
    : peerLabel;
  // 同 DetailPanel：优先 member_count。超级群的 members 只含我自己，
  // 用 members.length 会让标题变成「群名（1）」。
  const chatMemberCount = activeGroupInfo?.member_count ?? activeGroupInfo?.members.length ?? activeGroupConv?.member_count ?? 0;
  const chatAvatarURL = isGroupChat
    ? (activeGroupInfo?.avatar_url || activeGroupConv?.avatar_url)
    : (peerConv?.peer_avatar_url || peerAvatar(peer));
  // 「大群」标注：大群不显示已读双勾/正在输入/成员在线态，副标题点明缘由，
  // 否则用户会把"功能没了"当成 bug 报上来。
  const chatIsSuper = activeGroupInfo?.is_super ?? activeGroupConv?.is_super ?? false;
  const chatSubtitle = isGroupChat
    ? (chatMemberCount > 0 ? t(chatIsSuper ? "chat.header.member_count_super" : "chat.header.member_count", { count: chatMemberCount }) : t(chatIsSuper ? "group.text.super" : "common.group_chat"))
    // 单聊：真实在线态（原先「最近上线」是写死的假文案，对谁都显示）。取不到快照时为空串，不占位。
    : presenceText(presence[peer]);
  // 单聊固定"正在输入"；群里覆盖式记最新一位打字者，副标题拼「{昵称} 正在输入」
  //（对齐 iOS `IMChatViewController+Socket.m` 的 `im_navigationSubtitle`）。
  const visibleChatSubtitle = (() => {
    if (!convId || !typingConv || typingConv.convId !== convId) return chatSubtitle;
    if (!isGroupChat) return t("chat.typing");
    // 备注优先（本机显示）：列表/气泡都显备注了，副标题还显真名会显得是另一个人。
    return t("chat.typing_named", { name: localNameOf(typingConv.uid, convId, typingConv.uid) });
  })();
  // ===== 首页全局搜索派生（SEARCH_DESIGN §3）：会话/联系人从内存列表，聊天记录用 homeRecordHits（不聚合）=====
  const homeQ = search.homeSearch.trim().toLowerCase();
  const homeConvHits = homeQ ? conversations.filter((c) => convDisplayLabel(c).toLowerCase().includes(homeQ)) : [];
  const homeFriendHits = homeQ ? accepted.filter((f) =>
    friendLabel(f).toLowerCase().includes(homeQ) ||
    (f.nickname || "").toLowerCase().includes(homeQ) ||
    f.user_id.toLowerCase().includes(homeQ)) : [];
  const convById = (cid: string) => conversations.find((c) => c.conv_id === cid);
  const recordSnippet = (r: MsgRecord) => hitSnippet(r, homeQ); // 优先真正含 needle 的字段（见 searchPredicate，/code-review #3）
  // 打开某会话（供首页搜索点击）：群走 openGroupChat，单聊从 conv_id 还原 peer。
  const openConvById = (cid: string) => {
    if (cid.startsWith("g_")) { openGroupChat(cid); return; }
    const c = convById(cid);
    if (c && !c.is_group) { openChat(c.peer); return; }
    const peerId = cid.replace(/^u_/, "").split("_u_").find((x) => x !== uid);
    if (peerId) openChat(peerId);
  };

  // 回写桌面端回调：打开会话直接复用上面的 openConvById（它比另写一份稳，会话不在列表时能还原 peer）。
  desktop.bindCallbacks({ titleOf: makeDesktopTitleOf(conversations, convDisplayLabel), senderOf: senderLabel, onOpenConversation: openConvById });

  // 会话列表项显示名/头像/预览（群聊 vs 单聊）——convDisplayLabel/convAvatarUrl 已上移至 convLabel 之后（见那里注释）。
  // 收藏来源显示名（副行「来自X」）：本人→我；好友→备注/昵称；群成员→群昵称/昵称；否则 uid（按 UI.md 优先级）。
  const favSourceLabel = (f: Favorite): string => {
    if (!f.source_from) return t("fav.source.unknown");
    if (f.source_from === uid) return t("common.me");
    const fr = friends.find((x) => x.user_id === f.source_from);
    if (fr) return friendLabel(fr);
    const nick = memberNick(f.source_conv_id, f.source_from);
    if (nick) return displayNameOf(f.source_from, remarks, nick);
    // 补拉到的名片（见下方 useEffect）：备注 > 昵称 > @句柄。仍没有才回退内部 ID——
    // 这个回退值同时是"尚未解析"的判据，补齐逻辑照它筛。
    const card = favUserCards[f.source_from];
    if (card) return displayNameOf(f.source_from, remarks, card.nickname, card.username);
    return f.source_from;
  };
  // 会话列表预览行 → convPreview.ts（纯派生 + 单测；踩过的坑与口径记在那边）。
  const convPreview = (c: Conversation): string => buildConvPreview(c, { uid, localNameOf });

  // 加载详情页签数据源（本地历史消息，供 媒体/文件/链接 页签过滤）。
  const loadDetailMsgs = (cid: string) => {
    void loadConversation(uid, cid).then(setDetailMsgs).catch(() => setDetailMsgs([]));
  };

  // 打开群聊详情面板（拉最新资料 + 本地消息）。默认页签=成员（对齐 iOS 群聊成员恒第一）。
  const openGroupPanel = (cid: string) => {
    setManageOpen(false); setAdminPanelOpen(false); setDetailMore(false); setDetailTab("members");
    setDetail({ convId: cid, isGroup: true });
    setDetailMsgs([]); loadDetailMsgs(cid);
    void refreshGroupInfo(cid);
  };

  // 打开单聊详情面板（对方资料）。默认页签=媒体。
  // fromOwnChat=true 表示从该会话自己的聊天页顶栏进来 → 不显示「消息」入口（已经在这个会话里了）。
  // 群成员列表 / 群聊气泡头像等外部入口保持 false，仍给「消息」发起单聊（与 iOS showsMessagePill 一致）。
  const openPeerDetail = (peer: string, fromOwnChat = false) => {
    if (!peer) return;
    // §6 第四分支：点到的是我自己（分享我的名片后自己再点那张卡）→ 进**编辑资料**。
    // 此前是 `peer === uid` 直接 return，点了毫无反应，用户以为卡坏了；iOS 侧同样已补此分支。
    if (peer === uid) { void openProfile(); return; }
    const cid = convIdFor(uid, peer);
    setManageOpen(false); setAdminPanelOpen(false); setDetailMore(false); setDetailTab("media");
    setDetail({ convId: cid, isGroup: false, peer, fromOwnChat });
    setDetailMsgs([]); loadDetailMsgs(cid);
    void loadPeerCard(peer);
  };

  // 单聊资料面板的**对端权威资料**：进页拉一次 GET /users/{id}。
  // 此前完全没拉——面板只显示打开它的那个入口透传的东西，所以从名片卡（冻结快照）进来
  // 会永远停在旧昵称旧头像，设计 §6「先用快照填首屏、再拉最新覆盖」形同虚设（/code-review 2026-08-29）。
  // 拉到的卡喂进 peerCards，由 peerSources 参与多源兜底；404（200001）标记该 uid 已注销，面板显空态。
  const loadPeerCard = async (peer: string) => {
    const client = clientRef.current;
    if (!client || !peer || peer === uid) return;
    try {
      const card = await client.userProfile(peer);
      setPeerCards((prev) => ({ ...prev, [peer]: card }));
      setDeletedPeers((prev) => { const n = new Set(prev); n.delete(peer); return n; });
    } catch (e) {
      // 只有"确认不存在"才转空态；网络/5xx 保持快照可读（对显示 fail-open）。
      if (errorCode(e) === 200001) setDeletedPeers((prev) => new Set(prev).add(peer));
    }
  };
  openPeerDetailRef.current = openPeerDetail; // 供 useQR（早退前调用）在点击时取到早退后定义的函数

  // 文本渲染一族（原本是本文件里六个互相调用的闭包，见 components/messageText.tsx 顶部）。
  // 放在这里是因为它要 memberNick 与 openPeerDetail，两者都到上面才声明完。
  const { renderMentionText, renderMessageText } = makeMessageTextRenderers({
    memberNick, searchOpen, searchQuery, selectMode, expandedTexts, setExpandedTexts,
    onOpenReader: (m) => { setTextReader(m); setReaderFontStep(0); },
    onOpenPeer: (uid) => { setTextReader(null); openPeerDetail(uid); },
  });

  // 清空聊天记录（仅本机，对齐 iOS）：存储事务清消息 + 区间并抬「清空位点」（§6.7，否则切走再切回会把服务端那一页拉回来）→ 清内存。
  const doClearHistory = (cid: string) => {
    void (async () => {
      if (!(await askConfirm(t("chat.clear.confirm"), { okText: t("chat.clear.ok"), danger: true }))) return;
      if ((await clientRef.current?.clearConversation(cid, conversations.find((c) => c.conv_id === cid)?.latest_conv_seq ?? 0)) === undefined) return;   // 登出过渡态（无 client）：没清成就别报「已清空」
      clearConv(cid); // 内存同步清空（当前会话/缓存）
      setDetailMsgs([]);
      setToast(t("chat.clear.done"));
    })();
  };

  // 点拒收系统行的「发送好友申请」（非好友 200103 的恢复入口，微信式）。
  // 服务端 Request 对「我侧陈旧 accepted」已放行——单向删除后被删方的唯一恢复路径。
  // 与其余四个入口一样走统一的申请弹窗（填验证消息），不直接发。
  const requestFriendFromNote = (target: string) => {
    askFriendRequest(target, displayNameOf(target, remarks, peerNick(target), peerUsername(target)));
  };

  // 单聊拉黑/取消拉黑（拉黑二次确认）。
  const doToggleBlock = (peer: string, block: boolean) => {
    void (async () => {
      if (block && !(await askConfirm(t("friend.block.confirm"), { okText: t("common.block"), danger: true }))) return;
      try {
        await clientRef.current!.friendAction(block ? "block" : "unblock", peer);
        void refreshFriends();
        setToast(t(block ? "friend.block.done" : "friend.block.undone"));
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  };

  // 单聊「删除好友」（资料卡「更多」菜单，二次确认）。
  // 删完**不关面板**：refreshFriends 后本页自动切成非好友视图（只剩「加好友」），
  // 用户能直接看到关系已变——弹回聊天页反而让人怀疑到底删没删。
  const doRemoveFriend = (peer: string) => {
    void (async () => {
      if (!(await askConfirm(t("friend.delete.confirm"), { okText: t("common.delete"), danger: true }))) return;
      await doFriendAction(peer, async () => {
        await clientRef.current!.removeFriend(peer);
        setToast(t("friend.delete.done"));
      });
    })();
  };

  // ---- 二维码体系（QRCODE P0）----


  // ---- 入群审批（G3）----

  // 我在本群的昵称（G1，任意成员）：走后端 → 刷新群资料（气泡回退名随之更新）。
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
      setToast(t("contact.remark.save_failed", { detail: (e as Error).message }));
    }
  };
  const openFriendChat = (id: string) => { setTab("chats"); openChat(id); };

  // 左上角头像卡片的行（≈ Telegram Web 汉堡菜单；数据驱动：加一项 = append 一条）。
  // 「我的资料」不再单列——资料在设置页顶部展示、经铅笔进入编辑；退出登录移到设置页底部。
  const accountRows: Row[] = [
    { id: "settings", label: t("settings.title"), icon: Settings, chevron: true, onClick: () => { setAccountCard(false); setShowSettings(true); } },
    { id: "favorites", label: t("common.saved_messages"), icon: Bookmark, chevron: true, onClick: () => { setAccountCard(false); openFavorites(); } },
    // 最近通话（CALL_HISTORY_DESIGN.md §0.1/§2）：复用既有翻译 key。**不带 iconTint**——本菜单其余行都是
    // 线条图标，带 tint 会渲染成设置页那种彩色方块，比同菜单的「设置」「收藏消息」大一圈（2026-09-29 用户报）。
    { id: "recentCalls", label: t("ios.settings.row.recent_calls"), icon: Phone, chevron: true,
      onClick: () => { setAccountCard(false); setShowCallHistory(true); } },
  ];

  // 设置列表（对齐 Telegram **Web** 版布局；数据驱动：加一行 = append 一条；接后端 = 换 onClick）。
  // Web 版条目与 iOS 版不同——各自镜像对应平台的 Telegram 客户端。
  const settingsGroups: Row[][] = [
    [
      { id: "general", label: t("settings.row.general"), icon: Settings2, iconTint: "gray", chevron: true, onClick: () => setGeneralOpen(true) },
      { id: "animations", label: t("settings.row.animations"), icon: Gauge, iconTint: "orange", chevron: true, onClick: () => setPerformanceOpen(true) },
      { id: "notifications", label: t("settings.row.notifications"), icon: Bell, iconTint: "red", chevron: true, onClick: () => setNotificationsOpen(true) },
      { id: "data", label: t("settings.row.data_storage"), icon: Database, iconTint: "green", chevron: true, onClick: () => setDataStorageOpen(true) },
      { id: "privacy", label: t("settings.row.privacy"), icon: Lock, iconTint: "indigo", chevron: true, onClick: () => { setPrivacyOpen(true); void openBlacklist(); } },
      { id: "folders", label: t("settings.row.folders"), icon: Folder, iconTint: "blue", chevron: true, onClick: () => comingSoon(t("settings.row.folders")) },
      { id: "devices", label: t("settings.row.devices"), icon: MonitorSmartphone, iconTint: "teal", chevron: true, onClick: () => { setDevicesOpen(true); void loadDevices(); } },
      { id: "language", label: t("settings.language.title"), icon: Languages, iconTint: "purple", value: langPrefLabel(), chevron: true, onClick: () => setLanguageOpen(true) },
      { id: "stickers", label: t("settings.row.stickers"), icon: Smile, iconTint: "pink", chevron: true, onClick: () => comingSoon(t("settings.row.stickers")) },
    ],
  ];

  // 设置页顶部名片下的资料卡（手机号/用户名）。
  const settingsInfoRows = buildSettingsInfoRows({ t, myInfo, uid, openProfile, openMyCard, shareContactCard });

  // 通讯录顶部入口行（数据驱动）。
  const contactEntries: Row[] = [
    { id: "groups", label: t("common.group_chat"), icon: Users, iconTint: "blue", chevron: true, onClick: () => void openGroupsModal() },
    // 「新的朋友」独立入口（2026-09-05）：此前它是好友列表上方的一段，好友一多就被挤到看不见，
    // 而"有人加我"恰恰是需要主动去处理的事。红色徽标显待确认数（0 时不显，别摆一个恒亮的 0）——
    // 早先走的是 value（灰色小字），跟"设置项当前值"长得一模一样，一眼扫过去根本不像有待办。
    { id: "friendRequests", label: t("friend.requests.title"), icon: UserPlus, iconTint: "green", chevron: true,
      badge: incomingCount > 0 ? unreadBadgeText(incomingCount) : undefined,
      onClick: () => { setFriendRequests(true); void refreshFriends(); } },
    { id: "official", label: t("contacts.row.official_accounts"), icon: Megaphone, iconTint: "orange", chevron: true, onClick: () => comingSoon(t("contacts.row.official_accounts")) },
    { id: "service", label: t("contacts.row.service_accounts"), icon: Headphones, iconTint: "teal", chevron: true, onClick: () => comingSoon(t("contacts.row.service_accounts")) },
  ];

  return (
    <AppServicesProvider value={services}>
    <ChatActionsProvider value={chatActions}>
    <div className={`app ${peer || groupConvId ? "has-sel" : "no-sel"}`}>
      <aside className="sidebar">
        <header>
          <div className="account-anchor">
            <button className="account-menu-btn" title={t("common.menu")} aria-label={t("common.menu")}
              onClick={(e) => { e.stopPropagation(); setAccountCard((v) => !v); }}>
              <Menu size={22} />
            </button>
            {accountCard && (
              <div className="menu-card" onClick={(e) => e.stopPropagation()}>
                {accountRows.map((r) => renderRow(r, "menu-card-row"))}
              </div>
            )}
          </div>
          {/* 显示公开句柄而非 uid（10 位随机内部 ID）。没有 username 时只留连接状态。 */}
          <span className="account-meta">{myInfo?.username ? `@${myInfo.username} · ` : ""}{stateText}</span>
        </header>
        <SidebarTabs tab={tab} conversations={conversations} incomingCount={incomingCount} includeMuted={notif.settings.badge.includeMuted}
          onChats={() => setTab("chats")}
          onContacts={() => { setTab("contacts"); void refreshFriends(); }} />
        {tab === "chats" ? (
        <div className="convlist">
          {/* 首页全局搜索框（SEARCH_DESIGN §3/§04）：输入即出「会话 / 联系人 / 聊天记录」三分组。 */}
          <div className="home-search">
            <Search size={15} className="home-search-lead" />
            <input className="home-search-input" value={search.homeSearch} placeholder={t("common.search")}
              onChange={(e) => search.setHomeSearch(e.target.value)} />
            {search.homeSearch && <button className="home-search-clear" title={t("common.clear")} onClick={() => search.setHomeSearch("")}><X size={14} /></button>}
          </div>
          {homeQ ? (
          <HomeSearchResults
            homeConvHits={homeConvHits} homeFriendHits={homeFriendHits} homeRecordHits={search.homeRecordHits}
            convAvatarUrl={convAvatarUrl} convDisplayLabel={convDisplayLabel} friendLabel={friendLabel}
            convById={convById} recordSnippet={recordSnippet}
            highlight={(t, k) => highlightText(t, homeQ, k)}
            openConvById={openConvById} openPeerDetail={openPeerDetail}
            onRecordClick={(cid, seq) => { search.setHomeSearch(""); locateInChat(cid, seq); }}
          />
          ) : (
          <>
          {conversations.length === 0 && <div className="empty">{t("conv.list.empty_find_contacts")}</div>}
          {conversations.map((c) => {
            // 定时免打扰到期后按未免打扰渲染（NOTIFICATIONS_P1_DESIGN §4.3）：铃铛消失、未读数不再置灰。
            const mutedNow = isMutedNow(!!c.muted, c.mute_until, Date.now());
            return (
            <div key={c.conv_id} className={`convitem ${c.conv_id === convId ? "active" : ""} ${c.pinned_at ? "pinned" : ""}`}
              onClick={() => (c.is_group ? openGroupChat(c.conv_id) : openChat(c.peer))}
              onContextMenu={(e) => { e.preventDefault(); setConvMenu({ x: e.clientX, y: e.clientY, c }); }}>
              <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer}>
                {!c.is_group && isOnline(presence[c.peer]) && <span className="presence-dot" />}
              </Avatar>
              <div className="convbody">
                <div className="convtop">
                  <span className="convpeer">
                    {c.pinned_at ? <Pin size={12} className="conv-pin" /> : null}
                    {convDisplayLabel(c)}
                    {/* 「大群」标记：用户在列表里第一个察觉到的异常正是这里——这个群没有在线绿点、
                        没有「正在输入」。不标出来就会被当成 bug 报上来（SUPERGROUP_DESIGN §9）。
                        文字 pill 而非图标：标记的价值是**解释**那些消失的能力，图标不自解释；
                        与聊天页副标题、群资料页说明行、后台列表 pill 同一套语汇。 */}
                    {c.is_super ? <span className="conv-super-tag">{t("group.text.super")}</span> : null}
                    {mutedNow ? <BellOff size={12} className="conv-mute" /> : null}
                  </span>
                  <span className="convtime">
                    {c.last_message ? conversationTime(c.last_message.timestamp, timeFormat) : ""}
                  </span>
                </div>
                <div className={`convlast${isMissedCallPreview(c, uid) ? " missed-call" : ""}`}>
                  {/* 群「@我」红字前缀（M4-8）：未读区间内被 @（含 @所有人）。不另加右侧红 @ 角标——左侧红字已够醒目。 */}
                  {c.is_group && c.mention_unread ? <span className="conv-mention">{t("conv.list.mention_tag")}</span> : null}
                  {/* 待审入群角标（G3）：仅群主/管理员会收到 pending_count>0，一眼看到有人等待审批。 */}
                  {c.is_group && (c.pending_count ?? 0) > 0
                    ? <span className="conv-pending-badge">{t("conv.list.pending_badge", { count: unreadBadgeText(c.pending_count!) })}</span>
                    : null}
                  {/* 我发的最后一条的已读/未读勾：放在预览文字前（对齐 Android / Telegram 列表），不挤时间 */}
                  {!c.is_group && c.last_message?.from === uid && (
                    <ReadTick read={c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0)} className="convck" />
                  )}
                  {convPreview(c)}
                </div>
              </div>
              {/* 免打扰置灰未读数，但**被 @ 时破例回到高亮**——免打扰只压普通消息，不压 @我（M4-8）。
                  正在查看的会话未读一律按 0 渲染（c.conv_id === convId）：收到本会话新消息时，列表刷新(150ms)会
                  先拿到服务端 unread=1，而清未读靠可见即读(300ms 防抖 + markRead 往返)才落地，不屏蔽就会闪一下「1」。
                  屏蔽后与 read 往返彻底解耦，任何时序都不闪。 */}
              {c.conv_id === convId ? null
                : c.unread > 0
                ? <span className={`badge ${mutedNow && !c.mention_unread ? "muted" : ""}`}>{unreadBadgeText(c.unread, c.unread_capped)}</span>
                : c.marked_unread ? <span className={`badge dot ${mutedNow ? "muted" : ""}`} aria-label={t("common.unread")} /> : null}
            </div>
            );
          })}
          </>
          )}
        </div>
        ) : (
        <ContactsTab
          searchQ={searchQ} setSearchQ={setSearchQ} doSearch={doSearch} onScan={() => setQrScan(true)} contactEntries={contactEntries} contactsScrollRef={contactsScrollRef}
          searchResults={searchResults} friendStatus={friendStatus} labelOf={labelOf} openFriendChat={openFriendChat} busyUser={busyUser} doFriendAction={doFriendAction}
          accepted={accepted} filteredAccepted={filteredAccepted} contactFilter={contactFilter} setContactFilter={setContactFilter} contactFilterQ={contactFilterQ}
          friendLabel={friendLabel} presence={presence} setFriendMenu={setFriendMenu}
        />
        )}

        {/* 设置页体系的 12 个子面板路由：见 components/settings/SettingsPanelsHost
            （open 开关/数据仍全部由 App 拥有，那边只做「按开关渲染 + 拼胶水」，CODING_STYLE §7 决策树②）。 */}
        <SettingsPanelsHost
          showSettings={showSettings} setShowSettings={setShowSettings}
          myInfo={myInfo} uid={uid} stateText={stateText} infoRows={settingsInfoRows} groups={settingsGroups}
          openProfile={openProfile} logout={logout}
          dataStorageOpen={dataStorageOpen} setDataStorageOpen={setDataStorageOpen}
          dlSettings={dlSettings} setDlSettings={setDlSettings} dlBlobs={dlBlobs} mediaOptedIn={mediaOptedIn}
          saveDownloadSettings={saveDownloadSettings} clearMediaCache={clearMediaCache}
          profileDraft={profileDraft} setProfileDraft={setProfileDraft} profileBusy={profileBusy} profileEditing={profileEditing}
          enterProfileEditing={enterProfileEditing} cancelProfileEditing={cancelProfileEditing} saveProfile={saveProfile} onPickAvatar={onPickAvatar}
          devicesOpen={devicesOpen} setDevicesOpen={setDevicesOpen} devices={devices} devicesErr={devicesErr} revokingSid={revokingSid}
          loadDevices={loadDevices} revokeDevice={revokeDevice} revokeOtherDevices={revokeOtherDevices}
          privacyOpen={privacyOpen} setPrivacyOpen={setPrivacyOpen}
          blockedOpen={blockedOpen} setBlockedOpen={setBlockedOpen} blockedList={blockedList} busyUser={busyUser} friendLabel={friendLabel} unblock={unblock}
          changePwdOpen={changePwdOpen} setChangePwdOpen={setChangePwdOpen}
          generalOpen={generalOpen} setGeneralOpen={setGeneralOpen}
          fontSize={fontSize} setFontSize={setFontSize} theme={theme} setTheme={setTheme}
          timeFormat={timeFormat} setTimeFormat={setTimeFormat} sendKey={sendKey} setSendKey={setSendKey}
          desktop={desktop} setWallpaperOpen={setWallpaperOpen}
          notificationsOpen={notificationsOpen} setNotificationsOpen={setNotificationsOpen} notif={notif} conversations={conversations}
          convDisplayLabel={convDisplayLabel} convAvatarUrl={convAvatarUrl} setConvMuted={setConvMuted} openConvById={openConvById}
          languageOpen={languageOpen} setLanguageOpen={setLanguageOpen} performanceOpen={performanceOpen} setPerformanceOpen={setPerformanceOpen}
          wallpaperOpen={wallpaperOpen} wallpaper={wallpaper} isDark={isDark} wallpaperBlur={wallpaperBlur}
          setWallpaperBlur={setWallpaperBlur} setWallpaper={setWallpaper}
          pickWallpaperImage={pickWallpaperImage} openWallpaperColor={openWallpaperColor} resetWallpaper={resetWallpaper}
          wallpaperColorOpen={wallpaperColorOpen} setWallpaperColorOpen={setWallpaperColorOpen}
          colorHSV={colorHSV} applyWallpaperColor={applyWallpaperColor}
        />
      </aside>

      {/* chat 面板始终挂载（即使未选会话），让 VList 在 app 加载时就测到稳定高度；
          未选会话时用 .main-empty 覆盖层遮住。否则条件挂载会让 virtua 在布局未定时测到 0。 */}
      <main className="main">
        <div className="chat">
          {/* 标题栏（搜索态=ChatSearchBar；否则 返回/身份/搜索/呼叫/⋯菜单）：见 components/ChatHeader（动作打包 actions 注入）。 */}
          <ChatHeader
            searchOpen={searchOpen} isGroupChat={isGroupChat} peer={peer} groupConvId={groupConvId} searchQuery={searchQuery} setSearchQuery={setSearchQuery} search={search}
            chatTitle={chatTitle} chatAvatarURL={chatAvatarURL} visibleChatSubtitle={visibleChatSubtitle} chatMenu={chatMenu} setChatMenu={setChatMenu}
            groupInfos={groupInfos} groupConv={groupConv} peerConv={peerConv} peerBlocked={peerBlocked}
            actions={{ deselect, openGroupPanel, openPeerDetail, setInviteDraft, setConvMuted, enterSelectMode, doLeaveGroup, setContactDraft, doToggleBlock, deleteConv }}
          />
          {/* 聊天头横幅（审批 G3 / 公告 G1 / 置顶 G0）：见 components/ChatBanners（状态/动作在 App 组装）。 */}
          <ChatBanners
            isGroupChat={isGroupChat} groupInfo={activeGroupInfo}
            dismissedBanners={dismissedBanners} annDismissKey={annDismissKey} pinDismissKey={pinDismissKey}
            dismiss={(key) => setDismissedBanners((d) => ({ ...d, [key]: true }))}
            pinnedShown={pinnedShown} pinnedShownIdx={pinnedShownIdx} activePinned={activePinned}
            onOpenJoinRequests={() => void openJoinRequests(groupConvId)}
            onOpenAnnouncement={() => openGroupText("announcement", groupConvId)}
            onJumpPinned={() => { jumpToPinned(pinnedShown!.convSeq); setPinnedIdx(nextPinnedIndex(pinnedShownIdx, activePinned.length)); }}
            onOpenPinnedList={() => setPinnedListOpen(true)}
          />
          <div className="msgs" ref={msgsRef} onScroll={onMsgsScroll}
            onWheel={(e) => { if (e.deltaY > 0) userScrollIntentRef.current = true; }}
            onTouchMove={() => { userScrollIntentRef.current = true; }}
            onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "End" || e.key === " ") userScrollIntentRef.current = true; }}>
            <MessageList
                messages={messages} peer={peer} isGroupChat={isGroupChat} isSuperGroup={chatIsSuper} uid={uid}
                selectMode={selectMode} selected={selected} menu={menu} readSeq={readSeq} firstUnreadIdx={firstUnreadIdx}
                timeFormat={timeFormat} translations={translations} transcripts={transcripts} uploadProgress={uploadProgress} dividerRef={dividerRef}
                mediaGate={mediaGate} mediaSrc={mediaSrc} senderLabel={senderLabel} localNameOf={localNameOf} senderRole={senderRole} senderAvatar={senderAvatar}
                renderMentionText={renderMentionText} renderMessageText={renderMessageText}
                openPeerDetail={openPeerDetail} handleScanRaw={handleScanRaw} requestFriendFromNote={requestFriendFromNote}
              />
          </div>
          {/* 常驻滚动条滑块：必须是 .msgs 的兄弟（不在滚动容器内、不 portal 到 body），原因见组件注释。 */}
          <ChatScrollbarThumb targetRef={msgsRef} />
          {/* 底部区（跳底/拉黑提示/编辑·引用条/多选栏/粘贴条/附件/@面板/输入框）：见 components/Composer（逻辑仍在 App）。 */}
          <Composer
            convId={convId} peer={peer} uid={uid} isGroupChat={isGroupChat} peerLabel={peerLabel} peerBlocked={peerBlocked}
            input={input} sendKey={sendKey} composerMuteReason={composerMuteReason} showJump={showJump} jumpCount={jumpCount} jumpCapped={jumpCapped}
            editingMsg={editingMsg} replyTo={replyTo} selectMode={selectMode} selected={selected}
            reportableSender={reportableSender} reportHasMine={reportHasMine} canDeleteEveryone={batchDeletePlan.canEveryone} pastedImages={pastedImages}
            attachPanel={attachPanel} attachItems={attachItems} mentionQuery={mentionQuery} mentionFilter={mentionFilter}
            mentionRows={mentionRows} mentionActive={mentionActive} mediaGate={mediaGate} senderLabel={senderLabel} onMentionNavKey={onMentionNavKey}
          />
        </div>
        {!convId && <div className="main-empty">{t("chat.empty_select")}</div>}
      </main>

      {cropReq && (
        <AvatarCropper
          file={cropReq.file}
          onCancel={() => setCropReq(null)}
          onConfirm={(blob) => { const req = cropReq; setCropReq(null); void req.onDone(blob); }}
        />
      )}

      {/* 媒体查看器（镜像 iOS）：见 components/MediaViewer（派生态与动作在 App 组装）。 */}
      {viewer && (
        <MediaViewer
          m={viewer.m}
          fromGallery={viewer.fromGallery}
          videoUnplayable={videoUnplayable}
          videoStarted={videoStarted}
          isExpired={expiredSet.has(viewer.m.content)}
          unsupported={viewer.m.contentType !== "video" && mediaGate(viewer.m)?.phase === "unsupported"}
          mediaKey={msgKey(viewer.m)}
          viewerIdx={viewerIdx}
          viewerCount={viewerList.length}
          hasOlder={mediaPaging.hasMore}
          hasNewer={mediaPaging.hasMoreNewer}
          chatTitle={chatTitle}
          more={viewerMore}
          onClose={() => { setViewer(null); setViewerMore(false); }}
          onDismissMore={() => setViewerMore(false)}
          onStartVideo={() => setVideoStarted(true)}
          onVideoError={() => {
            logger.warn(LOG_TAG.media, "video_playback_unsupported", {
              conv_id: viewer.m.convId, conv_seq: viewer.m.convSeq, has_poster: Boolean(viewer.m.posterUrl),
            });
            setVideoUnplayable(true);
            void markExpiredIfGone(viewer.m); // 404=源已清理（非编码问题）→ 落持久失效标记
          }}
          onImageError={() => void onPassiveMediaError(viewer.m)}
          onNav={goViewer}
          onToggleMore={() => setViewerMore((v) => !v)}
          onOpenGallery={() => setGalleryOpen(true)}
          onLocate={() => { const mm = viewer.m; setViewer(null); setViewerMore(false); setGalleryOpen(false); setDetail(null); locateInChat(mm.convId || currentConvRef.current, mm.convSeq); }}
          onFavorite={() => favoriteMessage(viewer.m)}
          onCopy={() => {
            // 图说（带 caption）：复制文本（与长按菜单「复制」同口径）。
            if (viewer.m.caption) { void navigator.clipboard?.writeText(viewer.m.caption); setToast(t("common.copied")); return; }
            // 图片：复制图片字节（可粘贴回输入框直接发图）；其余非视频：复制链接。
            if (viewer.m.contentType === "image") {
              copyImageToClipboard(viewer.m.content).then(() => setToast(t("common.copied_image")))
                .catch(() => { void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast(t("common.copied_link")); });
            } else {
              void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast(t("common.copied_link"));
            }
          }}
          onForward={() => {
            // 相册查看器视角看不到 caption/mentions（气泡下方那段附言不在视野内），转发时不带
            // （对齐 iOS forwardMediaFromViewerMessage: 与本页详情文件 tab 转发的取舍）。
            const mm = viewer.m;
            setViewer(null); setGalleryOpen(false);
            setForwarding([{ ...mm, caption: undefined, mentions: undefined, mentionAll: false }]);
          }}
          onDelete={(x, y) => {
            // 统一走两档路由（对齐详情/聊天）：可为所有人删则弹子菜单 B，否则仅删自己；删成功后查看器由 onMessageRemoved 关闭。
            const m = viewer.m;
            if (m.convSeq <= 0) { deleteMessage(m); setViewer(null); return; }
            requestDelete(m, x, y);
          }}
        />
      )}

      {/* 超长文本全屏阅读器：见 components/TextReader。 */}
      {textReader && (
        <TextReader
          message={textReader}
          fontStep={readerFontStep}
          renderBody={renderMentionText}
          onFontStep={setReaderFontStep}
          onCopy={() => { void navigator.clipboard?.writeText(textReader.content); setToast(t("common.copied_full_text")); }}
          onClose={() => setTextReader(null)}
        />
      )}

      {/* 会话媒体库：见 components/modals/GalleryModal（items 为倒序可视媒体，最新在前）。 */}
      {galleryOpen && (
        <GalleryModal
          items={[...mediaPaging.merge(messages.filter(isViewableMedia))].reverse()}
          hasMore={mediaPaging.hasMore}
          loadingMore={mediaPaging.loading}
          onLoadMore={() => { void mediaPaging.loadOlder().then((added) => { if (added === null) setToast(t("media.viewer.offline_partial_notice")); }); }}
          gateOf={mediaGate}
          onGate={onGateTap}
          onOpen={(mm) => { setGalleryOpen(false); setViewer({ m: mm, fromGallery: true }); }}
          onMenu={(e, mm) => setFileMenu({ x: e.clientX, y: e.clientY, m: mm })}
          onMediaError={(mm) => void onPassiveMediaError(mm)}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {/* 收藏列表（M4-4 / B 方案 §14）：见 components/modals/FavoritesModal；门控 glue 与聊天页同一套 useMediaDownload。 */}
      {favorites && (
        <FavoritesModal
          favorites={favorites}
          total={favTotal} loadingMore={favLoadingMore} onLoadMore={loadMoreFavorites}
          mode={favPick ? "pick" : "browse"}
          sourceLabel={favSourceLabel}
          actions={favoriteActions}
          onOpenMedia={(f, kind) => {
            setFavorites(null);
            setViewer({ m: syntheticViewerMessage(`fav-${f.id}`, f.content, kind), fromGallery: true });
          }}
          onOpenLink={(url) => window.open(url, "_blank", "noreferrer")}
          glue={{ gateOf: mediaGate, mediaSrc, onGateTap, onOpenFile: (m) => void openReadyFile(m), onMediaError: (m) => void onPassiveMediaError(m) }}
          myUid={uid} conversations={conversations} convDisplayLabel={convDisplayLabel} convAvatarUrl={convAvatarUrl}
          onOpenRecord={(f) => setRecordStack([parseChatRecord(f.content)])}
          // 名片行 → 名片里那个人的资料页。与点聊天气泡、点详情页名片行**三处同一落点**（§6）：
          // 先关收藏弹窗再开资料面板（Web 一直避免弹窗套弹窗）。
          onOpenContact={(userId) => { closeFavorites(); openPeerDetail(userId); }}
          contactDisplayName={(userId, fallback) => displayNameOf(userId, remarks, fallback)}
          onPick={sendFavoritesToCurrent}
          onPickLimit={setToast}
          onClose={closeFavorites}
          fetchLinkPreview={fetchLinkPreview}
        />
      )}

      {/* 最近通话（CALL_HISTORY_DESIGN.md）：只读通话历史，数据直连 im-rtc SDK，不经过 IMServer。
          名字/头像走与通话界面同一条解析链（rtcNameOf + peerAvatar）；群通话行跳转 chatGroupId 对应的群会话。 */}
      {showCallHistory && (
        <CallHistoryPanel
          myUid={uid}
          timeFormat={timeFormat}
          nameOf={(u) => rtcNameOf(remarks, u, peerNick(u), peerUsername(u))}
          avatarOf={peerAvatar}
          groupNameOf={(cid) => { const c = convById(cid); return c ? convDisplayLabel(c) : undefined; }}
          groupAvatarOf={(cid) => { const c = convById(cid); return c ? convAvatarUrl(c) : undefined; }}
          onOpenGroup={(cid) => { setShowCallHistory(false); openGroupChat(cid); }}
          onCallUnavailable={() => setToast(t("chat.message.call_unavailable"))}
          onClose={() => setShowCallHistory(false)}
        />
      )}

      {/* 转发会话选择器（M4-3）：见 components/modals/ForwardPicker。 */}
      {forwarding && (
        <ForwardPicker
          count={forwarding.length}
          conversations={conversations}
          multi={forwardMulti}
          mode={forwardMode}
          targets={forwardTargets}
          convAvatarUrl={convAvatarUrl}
          convDisplayLabel={convDisplayLabel}
          onToggleMulti={() => { setForwardMulti((v) => !v); setForwardTargets([]); }}
          onSetMode={setForwardMode}
          onToggleTarget={toggleForwardTarget}
          onForward={doForwardToTargets}
          onClose={closeForwardPicker}
        />
      )}

      {/* 合并转发详情（镜像 iOS）：见 components/modals/RecordModal（栈式下钻，合成消息在 App 构造）。 */}
      {recordView && (
        <RecordModal
          view={recordView}
          uid={uid}
          canGoBack={recordStack.length > 1}
          nestedAt={(i) => recordNested.get(i)}
          onBack={() => setRecordStack((s) => s.slice(0, -1))}
          onDrill={(sub) => setRecordStack((s) => [...s, sub])}
          onOpenMedia={(i, content, kind) => {
            setRecordStack([]);
            setViewer({ m: syntheticViewerMessage(`rec-${i}`, content, kind), fromGallery: true });
          }}
          onClose={() => setRecordStack([])}
          // 名片条目 → 该人资料页；先关记录弹窗再开资料面板（Web 侧避免弹窗套弹窗）。
          onOpenContact={(userId) => { setRecordStack([]); openPeerDetail(userId); }}
        />
      )}

      {/* 已读名单（M4-8）：见 components/modals/ReadReceiptsModal。 */}
      {readReceipts && (
        <ReadReceiptsModal
          data={readReceipts}
          lookupMember={(id) => groupConvId ? groupInfos[groupConvId]?.members.find((x) => x.user_id === id) : undefined}
          memberLabel={groupMemberLabel}
          onTab={(tab) => setReadReceipts((r) => (r ? { ...r, tab } : r))}
          onClose={() => setReadReceipts(null)}
        />
      )}

      {/* 全部置顶消息（G0）：见 components/modals/PinnedListModal。 */}
      {pinnedListOpen && (
        <PinnedListModal
          pinned={activePinned} isGroupChat={isGroupChat} timeFormat={timeFormat} canPin={canPinHere}
          onJump={jumpToPinned}
          onUnpin={(seq) => clientRef.current?.pinMessage(convId, seq, false)}
          onClose={() => setPinnedListOpen(false)}
        />
      )}

      {/* 右键 / ⋯ 菜单（消息 / 会话 + 免打扰时长 / 详情内容 + 删除两档 / 好友行）：见 components/ContextMenusHost。 */}
      <ContextMenusHost
        menu={menu} setMenu={setMenu} messageActions={messageActions} uid={uid} peer={peer} groupConvId={groupConvId}
        chatIsSuper={chatIsSuper} canPinHere={canPinHere} transcripts={transcripts} requestDelete={requestDelete}
        convMenu={convMenu} setConvMenu={setConvMenu} conversationActions={conversationActions} requestMute={requestMute}
        convMuteMenu={convMuteMenu} setConvMuted={setConvMuted}
        fileMenu={fileMenu} setFileMenu={setFileMenu} deleteMenu={deleteMenu} setDeleteMenu={setDeleteMenu} dlStates={dlStates}
        setForwardMode={setForwardMode} setForwarding={setForwarding} setGalleryOpen={setGalleryOpen} setViewer={setViewer}
        locateInChat={locateInChat} onGateTap={onGateTap} hideFileForMe={hideFileForMe} deleteFileForEveryone={deleteFileForEveryone}
        friendMenu={friendMenu} setFriendMenu={setFriendMenu} blockedSet={blockedSet} doFriendAction={doFriendAction} unblock={unblock}
      />

      {contactDraft && (
        <div className="modal-mask" onClick={() => setContactDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {/* 文案与 iOS editRemark 对齐：标题=「设置备注名」，正文说明在标题下，输入框无标签、占位=对方昵称 */}
            <h3>{t("contact.edit.remark_placeholder")}</h3>
            <div className="modal-hint">{t("chat.detail.remark_alert_message")}</div>
            <input value={contactDraft.remark} maxLength={32}
              placeholder={conversations.find((c) => !c.is_group && c.peer === contactDraft.peer)?.peer_nickname || ""}
              onChange={(e) => setContactDraft({ ...contactDraft, remark: e.target.value })} />
            <div className="modal-actions">
              <button className="link" onClick={() => setContactDraft(null)}>{t("common.cancel")}</button>
              <button className="mini-btn" onClick={() => void saveRemark()}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 黑名单已从独立 Modal 收编为「隐私与安全 → 已屏蔽的用户」子面板（BlockedListPanel），此处不再渲染。 */}

      {/* 「新的朋友」列表：通讯录入口（群聊下方）。见 components/modals/FriendRequestsModal。 */}
      {friendRequests && (
        <FriendRequestsModal
          incoming={incoming} outgoing={outgoing} labelOf={friendLabel} busyUser={busyUser}
          onAccept={(id) => void doFriendAction(id, () => clientRef.current!.friendAction("accept", id))}
          onReject={(id) => void doFriendAction(id, () => clientRef.current!.friendAction("reject", id))}
          onClose={() => setFriendRequests(false)}
        />
      )}

      {/* 「发好友申请」弹窗：全站五个加好友入口共用（见 FriendRequestModal 注释）。 */}
      {friendReqDraft && (
        <FriendRequestModal
          name={friendReqDraft.name}
          // 预填「我是<我的昵称>」：这是**发出去**的内容，故取公开昵称而不是任何本地显示名。
          defaultHello={myInfo?.nickname ? t("friend.request.hello_prefill", { name: myInfo.nickname }) : ""}
          busy={busyUser === friendReqDraft.userId}
          onSend={(hello) => {
            const { userId } = friendReqDraft;
            setFriendReqDraft(null);
            void doFriendAction(userId, async () => {
              // 已直接成为好友（对方先申请过我 / 我曾单向删除对方而对方仍视我为好友）→ **不吐司**
              // 「已发送好友申请」，那会误导用户以为还要等对方通过；doFriendAction 的 refreshFriends
              // 会让界面立即切成好友态。
              const became = await clientRef.current!.requestFriend(userId, hello);
              setToast(t(became ? "friend.request.became_friends" : "friend.request.sent"));
            });
          }}
          onClose={() => setFriendReqDraft(null)}
        />
      )}

      {/* 「群聊」列表 / 建群弹窗：见 components/modals/GroupsModal · CreateGroupModal。 */}
      {groupsModal !== null && (
        <GroupsModal
          groups={groupsModal} uid={uid} remarks={remarks}
          onCreate={() => setCreateDraft({ name: "", selected: [] })}
          onOpen={(cid) => { setGroupsModal(null); setTab("chats"); openGroupChat(cid); }}
          onClose={() => setGroupsModal(null)}
        />
      )}

      {/* 建群两步弹窗：myPublicName 是预填群名的第一位，必须用**公开名**（昵称）而非备注——
          群名会随建群请求发出去并显示给全群，见 groupName.ts 文件头的隐私红线。 */}
      {createDraft && (
        <CreateGroupModal
          draft={createDraft} accepted={accepted} friendLabel={friendLabel}
          myPublicName={publicNameOf({ nickname: myInfo?.nickname, username: myInfo?.username, user_id: uid })}
          busy={createBusy} avatarBusy={createAvatarBusy}
          maxInitialMembers={(serverConfig?.max_group_members ?? FALLBACK_MAX_GROUP_MEMBERS) - 1}
          onChange={setCreateDraft}
          onPickAvatar={pickCreateGroupAvatar}
          onCreate={() => void doCreateGroup()}
          onCancel={() => setCreateDraft(null)}
        />
      )}

      {/* 会话详情抽屉：见 components/DetailPanel（派生 + JSX 整块平移；稳定服务走 Context，其余动作按组注入）。 */}
      {detail && (
        <DetailPanel detail={detail}
          serverConfig={serverConfig}
          superMembers={activeSuperGroupId ? superMembers : undefined}
          superHasMore={activeSuperGroupId ? superCursor.hasMore : false}
          onLoadMoreMembers={() => activeSuperGroupId && void loadSuperMembers(activeSuperGroupId, superCursor.next)}
          membersLoading={superLoading}
          conversations={conversations} groupInfos={groupInfos} friends={friends} uid={uid}
          detailTab={detailTab} detailMsgs={detailArchive.merge(detailMsgs)} archive={detailArchive} detailMore={detailMore} manageOpen={manageOpen} adminPanelOpen={adminPanelOpen} groupBans={groupBans}
          groupRemark={groupRemark} peerNick={peerNick} peerUsername={peerUsername} peerAvatar={peerAvatar} memberLabel={groupMemberLabel} mediaGate={mediaGate} mediaSrc={mediaSrc} canManageMember={canManageMember}
          onShareContact={shareContactCard}
          contactDisplayName={(userId, fallback) => displayNameOf(userId, remarks, fallback)}
          peerDeleted={!!detail.peer && deletedPeers.has(detail.peer)}
          peerPresenceText={detail.isGroup || !detail.peer ? "" : presenceText(presence[detail.peer])}
          onClose={() => { setDetail(null); setDetailMore(false); setManageOpen(false); setAdminPanelOpen(false); }}
          setDetailTab={setDetailTab} setDetailMore={setDetailMore} setManageOpen={setManageOpen}
          setAdminPanelOpen={setAdminPanelOpen}
          openAdminPicker={(cid) => setAdminPicker({ convId: cid, selected: [] })}
          openTransferPicker={(cid) => setTransferPicker(cid)}
          revokeAdmin={(cid, m) => void doRevokeAdmin(cid, m.user_id, groupMemberLabel(m))}
          setContactDraft={setContactDraft} setInviteDraft={setInviteDraft} setMemberMenu={setMemberMenu} setFileMenu={setFileMenu}
          openChat={openChat} openInChatSearch={(targetConvId, targetPeer, targetIsGroup) => {
            // 目标会话就是当前会话 → 直接开；否则**先切过去**（微信式：点搜索直接进那个会话的搜索态），
            // armInChatSearch 记下待办，切换落定后由 useChatSearch 的 [convId] effect 打开。
            search.armInChatSearch(targetConvId);
            if (targetConvId === convId) return;
            if (targetIsGroup) openGroupChat(targetConvId); else openChat(targetPeer);
          }}
          doClearHistory={doClearHistory} doToggleBlock={doToggleBlock} doReportPeer={reportPeer} doRemoveFriend={doRemoveFriend} doLeaveGroup={doLeaveGroup} doDissolveGroup={doDissolveGroup}
          setConvPinned={setConvPinned} setConvMuted={setConvMuted} openGroupText={openGroupText} openGroupCard={openGroupCard}
          doEditMyGroupNickname={doEditMyGroupNickname} doEditGroupRemark={doEditGroupRemark} pickGroupAvatar={pickGroupAvatar}
          openJoinRequests={openJoinRequests} openGroupBans={openGroupBans} openPeerDetail={openPeerDetail}
        />
      )}

      {/* 邀请成员弹窗：见 components/modals/FriendPickerModal（候选=非群内好友）。 */}
      {inviteDraft && (() => {
        // 「已在群里」排除集来自 gp.members。**超级群下它只有我自己**（2 万人服务端不下发），
        // 所以老成员照样会出现在候选里。这是**刻意不补**的：端上根本拿不到 2 万人的完整名单，
        // 想补全就得为每个好友查一次成员身份。正确做法是让服务端当权威——它会跳过老成员
        // （幂等，不是错误），doInvite 按返回的 added 给准确反馈。别把这里"修"成本地全量过滤。
        const inGroup = new Set((groupInfos[inviteDraft.convId]?.members ?? []).map((m) => m.user_id));
        const candidates = accepted.filter((f) => !inGroup.has(f.user_id));
        return (
          <FriendPickerModal
            selected={inviteDraft.selected} candidates={candidates} friendLabel={friendLabel}
            onToggle={(userId) => setInviteDraft({
              ...inviteDraft,
              selected: inviteDraft.selected.includes(userId)
                ? inviteDraft.selected.filter((x) => x !== userId)
                : [...inviteDraft.selected, userId],
            })}
            onInvite={() => void doInvite()}
            onCancel={() => setInviteDraft(null)}
          />
        );
      })()}

      {/* 添加管理员（GROUP_ADMIN_TRANSFER_DESIGN §5.3）：候选＝本群普通成员（本地过滤掉群主/现有管理员/我），
          一次 ≤5 人、串行下发（后端每设一次发一条系统消息，且没有批量接口）。 */}
      {adminPicker && groupInfos[adminPicker.convId] && (
        <AdminPickerModal
          candidates={adminPickerSuperConv
            // 超级群：服务端搜索结果 − 治理集 − 我（服务端不认识"谁已经是管理员"，排除在端上做；
            // 治理集有界且随群资料下发，所以这份排除集是**全的**）。
            ? adminSearch.results.filter((m) => m.role === "member" && m.user_id !== uid)
            : adminCandidates(groupInfos[adminPicker.convId], uid)}
          remote={adminPickerSuperConv
            ? { query: adminSearch.query, setQuery: adminSearch.setQuery, failed: adminSearch.failed }
            : undefined}
          selected={adminPicker.selected}
          memberLabel={groupMemberLabel}
          onToggle={(userId) => setAdminPicker({
            ...adminPicker,
            selected: adminPicker.selected.includes(userId)
              ? adminPicker.selected.filter((x) => x !== userId)
              : [...adminPicker.selected, userId],
          })}
          onConfirm={() => {
            const d = adminPicker;
            // 全失败就把弹窗留着（选中态还在，用户能换个人重试），与 iOS「停在选人页」对齐。
            void doSetAdmins(d.convId, d.selected).then(({ ok }) => { if (ok > 0) setAdminPicker(null); });
          }}
          onCancel={() => setAdminPicker(null)}
        />
      )}

      {/* 转让群组：单选即确认（点行 → askConfirm → transferGroup）。成功后**必须关掉群管理与管理员面板**——
          那一刻我已是普通成员，整页对我不再可见，留着下一次点击必然 300204。 */}
      {transferPicker && groupInfos[transferPicker] && (
        <TransferOwnerModal
          candidates={transferSuperConv
            ? transferSearch.results.filter((m) => m.user_id !== uid) // 超级群：全体成员 − 我，走服务端搜索
            : transferCandidates(groupInfos[transferPicker], uid)}
          remote={transferSuperConv
            ? { query: transferSearch.query, setQuery: transferSearch.setQuery, failed: transferSearch.failed }
            : undefined}
          memberLabel={groupMemberLabel}
          onPick={(m) => {
            const cid = transferPicker;
            // **先关选人弹窗再弹二次确认**：确认是顺序的第二个弹窗，不是嵌套
            // （两层 .modal 遮罩会叠深，且 ESC 只关一层——本仓一直避免弹窗套弹窗）。
            setTransferPicker(null);
            void doTransferOwner(cid, m.user_id, groupMemberLabel(m)).then((ok) => {
              if (!ok) return;                       // 取消或失败：停在群管理面板，可再点一次转让
              setAdminPanelOpen(false);
              setManageOpen(false);                  // 详情抽屉保持打开：group 帧会把「群管理」行刷没
            });
          }}
          onCancel={() => setTransferPicker(null)}
        />
      )}

      {/* 个人名片入口 ①（CONTACT_CARD_DESIGN §8.2）：选好友 → 二次确认 → 发进当前会话。
          选人复用通用 FriendPickerModal（与群邀请同一组件，只换三处文案 + 传上限 9）；
          确认是**顺序**的第二个弹窗，不是嵌套（Web 侧一直避免弹窗套弹窗）。 */}
      {cardPicker && (
        <FriendPickerModal
          selected={cardPicker.selected} candidates={contactCandidates} friendLabel={friendLabel}
          title={t("contact_card.picker.title")} confirmLabel={t("common.send")} emptyText={t("contact_card.picker.empty")} maxSelection={CONTACT_MAX_SELECTION}
          onToggle={toggleContactPick}
          onInvite={confirmContactPick}
          onCancel={closeContactPicker}
        />
      )}
      {cardConfirm && (
        <ConfirmSendCardModal
          cards={cardConfirm}
          targetName={(() => {
            const c = conversations.find((x) => x.conv_id === convId);
            return c ? convDisplayLabel(c) : "";
          })()}
          displayName={(userId, fallback) => displayNameOf(userId, remarks, fallback)}
          onSend={() => sendContactCards(cardConfirm)}
          onCancel={closeContactConfirm}
        />
      )}

      {/* 群成员管理 ⋯ 菜单（按角色矩阵显隐；服务端仍会二次校验）。 */}
      {memberMenu && groupInfos[memberMenu.convId] && (
        <MemberMenu menu={memberMenu} gp={groupInfos[memberMenu.convId]} uid={uid} friends={friends} memberLabel={groupMemberLabel}
          menuRef={memberMenuRef} onClose={() => setMemberMenu(null)} onOpenChat={openChat}
          onMutePick={setMuteDurationFor} />
      )}

      {/* 禁言时长选择（G2）：见 components/modals/MuteDurationModal（until 时间戳在此算）。 */}
      {muteDurationFor && (
        <MuteDurationModal
          onPick={(ms) => {
            const { convId, m } = muteDurationFor;
            const until = ms < 0 ? -1 : Date.now() + ms;
            setMuteDurationFor(null);
            void doGroupAction(convId, () => clientRef.current!.muteGroupMember(convId, m.user_id, until));
          }}
          onCancel={() => setMuteDurationFor(null)}
        />
      )}

      {/* 群黑名单弹窗（G2）：见 components/modals/GroupBansModal。 */}
      {groupBansModal && (
        <GroupBansModal
          bans={groupBansModal.bans}
          remarks={remarks}
          onUnban={(userId) => void doUnban(groupBansModal.convId, userId)}
          onClose={() => setGroupBansModal(null)}
        />
      )}

      {/* 扫一扫（QRCODE P0）：摄像头 / 上传 / 拖拽 / 粘贴 → resolve。 */}
      {qrScan && (
        <QRScannerModal
          onRaw={(raw) => void handleScanRaw(raw)}
          onClose={() => setQrScan(false)}
          onMyCard={() => { setQrScan(false); void openMyCard(); }}
        />
      )}

      {/* 名片码 / 群码展示模态。 */}
      {qrCardModal && (
        <QRCardModal
          title={qrCardModal.title}
          subtitle={qrCardModal.subtitle}
          name={qrCardModal.name}
          avatarUrl={qrCardModal.avatarUrl}
          card={qrCardModal.card}
          canReset={qrCardModal.canReset}
          onReset={resetQRCard}
          onClose={() => setQrCardModal(null)}
        />
      )}

      {/* 扫码结果分支（user / group / unknown / expired）。 */}
      {qrResult && (
        <QRResultModal
          result={qrResult.data}
          actions={qrResultActions}
          onClose={() => setQrResult(null)}
        />
      )}

      {/* 待审入群申请列表（G3，群主/管理员）。 */}
      {joinReqModal && (
        <JoinRequestsModal
          requests={joinReqModal.requests}
          loading={joinReqModal.loading}
          onDecide={(uid2, accept) => decideJoin(joinReqModal.convId, uid2, accept)}
          onClose={() => setJoinReqModal(null)}
        />
      )}

      {/* 群公告 / 群简介全文视图（决策 16/17）：见 components/modals/GroupTextModal。 */}
      {fullTextModal && (() => {
        const gp = groupInfos[fullTextModal.convId];
        if (!gp) return null;
        const kind = fullTextModal.kind;
        const isAnn = kind === "announcement";
        const text = kind === "super" ? SUPER_GROUP_NOTICE_KEYS.map((k) => t(k)).join("\n") : ((isAnn ? gp.announcement : gp.intro) ?? "");
        const byName = isAnn && gp.announcement_by ? (memberNick(gp.conv_id, gp.announcement_by) || gp.announcement_by) : "";
        const at = isAnn ? (gp.announcement_at ?? 0) : 0;
        const meta = kind === "super"
          ? t("group.text.super_meta")
          : (isAnn && (byName || at > 0)
            ? `${byName}${byName && at > 0 ? " · " : ""}${at > 0 ? t("group.announcement.published_at", { time: fmtDateTime(at) }) : ""}`
            : undefined);
        const close = () => setFullTextModal(null);
        return (
          <GroupTextModal
            kind={kind}
            text={text}
            meta={meta}
            canEdit={isAnn && gp.my_role !== "member"}
            onCopy={() => navigator.clipboard?.writeText(text).then(() => setToast(t("common.copied")), () => setToast(t("common.copy_failed")))}
            onEdit={() => { close(); void doEditAnnouncement(gp); }}
            onClose={close}
          />
        );
      })()}

      {/* 应用内确认/输入弹窗：见 components/Dialogs（状态在 useDialogs）。 */}
      {confirmDlg && <ConfirmDialog dlg={confirmDlg} set={setConfirmDlg} />}
      {promptDlg && <PromptDialog dlg={promptDlg} set={setPromptDlg} />}

      {/* im-rtc 通话：登录态下挂载 = 起引擎，退出登录卸载 = 销毁；名字头像走本页的解析链。 */}
      <RtcHost uid={uid} getAuthToken={getRtcAuthToken} record={{ clientRef, appendMsg }} profileKey={[userProfiles.cards, friends, conversations, groupInfos]}
        profiles={{ nameOf: (u) => rtcNameOf(remarks, u, peerNick(u), peerUsername(u)), avatarOf: peerAvatar, request: requestProfiles,
          // 服务端分页 + 搜索：普通群、超级群同一条路（超级群本地成员表只有我自己）。
          groupMembers: async (cid, opts) => {
            const tok = clientRef.current?.authToken ?? "";
            if (!tok) throw new Error(t("common.error.not_logged_in"));
            const page = await fetchGroupMembersPage(tok, cid, { cursor: opts.cursor, q: opts.q, limit: 50 });
            return { members: page.members, nextCursor: page.has_more && page.members.length > 0 ? page.next_cursor : "" };
          } }} />

      {toast && <div className="toast">{toast}</div>}
    </div>
    </ChatActionsProvider>
    </AppServicesProvider>
  );
}


// 毫秒时间戳 → "M月d日 HH:mm"（往年带年份）。群公告发布时间用。
function fmtDateTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const md = monthDay(d);
  if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;
  return `${fullDate(d)} ${hm}`;
}

// 消息列表里的最大 conv_seq（发送中的 0 不计）。
function maxSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > m) m = x.convSeq;
  return m;
}

