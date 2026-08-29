import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IMClient, registerAccount, type ConnState } from "./sdk/imSdk";
import { AppServicesProvider, type AppServices } from "./AppServicesContext";
import { useGroupActions } from "./useGroupActions";
import { useMessageStore } from "./useMessageStore";
import { MemberMenu } from "./components/MemberMenu";
import { loadConversation, clearMessages, markMessageDeleted, type MsgRecord } from "./sdk/localStore";
import { convIdFor, type ChatMessage, type Conversation, type FriendEntry, type GroupInfo, type GroupMember, type GroupSummary, type Favorite, type PinnedMessage, type GroupBan, type JoinRequest } from "./sdk/protocol";
import { QRCardModal, QRScannerModal, QRResultModal, JoinRequestsModal } from "./QRUI";
import { errorCode } from "./qr";
import { activeMentionQuery, resolveMentions, resolveMentionAll, countsAsUnread, segmentMentions, MENTION_ALL_LABEL } from "./mention";
import { remarkMap, displayNameOf } from "./remarks";
import { resolveDetailFollow } from "./detailFollow";
import { resolvePeerAvatar, resolvePeerNickname } from "./peerAvatar";
import { nextPinnedIndex, clampPinnedIndex } from "./pinned";
import AvatarCropper from "./AvatarCropper";
import { isOnline, presenceFromConversation, presenceText, type Presence } from "./sdk/presence";
import { buildMessageActions, buildConversationActions, type MenuAction, type MessageCtx } from "./menus";
import { isViewableMedia, msgKey, resolveJumpTarget } from "./album";
import { formatTime } from "./time";
import { MessageList } from "./components/MessageList";
import { DetailPanel } from "./components/DetailPanel";
import { Composer } from "./components/Composer";
import { ContactsTab } from "./components/ContactsTab";
import { ChatHeader } from "./components/ChatHeader";
import { ChatActionsProvider, type ChatActions } from "./ChatActionsContext";
import { useEvent } from "./useEvent";
import { textTier, charCountLabel } from "./longtext";
import {
  parseDownloadSettings,
} from "./download";
import { clamp } from "./color";
import {
  replyPreviewOf,
  parseChatRecord, copyImageToClipboard,
  syntheticViewerMessage, minSeqOf, type ChatRecord,
  splitTextByURL,
} from "./messageContent";
import { Avatar } from "./components/Avatar";
import { HomeSearchResults } from "./components/HomeSearchResults";
import { highlightText } from "./searchHighlight";
import { hitSnippet } from "./searchPredicate";
import { useChatSearch } from "./useChatSearch";
import { useMediaDownload } from "./useMediaDownload";
import { useMediaSend } from "./useMediaSend";
import { useForward } from "./useForward";
import { useFavorites } from "./useFavorites";
import { useMentions } from "./useMentions";
import { useQR } from "./useQR";
import { useAppearanceSettings } from "./useAppearanceSettings";
import { useFriendOps } from "./useFriendOps";
import { useProfileEdit } from "./useProfileEdit";
import { ChatBanners } from "./components/ChatBanners";
import { AnchoredMenu } from "./components/AnchoredMenu";
import { type LinkPreview } from "./components/LinkCard";
import { LoginView } from "./components/LoginView";
import { SESSION_KEY, loadSession, saveSession } from "./session";
import { useDevices } from "./useDevices";
import { useDialogs } from "./useDialogs";
import { useToast } from "./useToast";
import { renderRow, type Row } from "./components/rows";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { DataStoragePanel } from "./components/settings/DataStoragePanel";
import { EditProfilePanel } from "./components/settings/EditProfilePanel";
import { DevicesPanel } from "./components/settings/DevicesPanel";
import { PrivacySecurityPanel } from "./components/settings/PrivacySecurityPanel";
import { BlockedListPanel } from "./components/settings/BlockedListPanel";
import { ChangePasswordPanel } from "./components/settings/ChangePasswordPanel";
import { GeneralPanel } from "./components/settings/GeneralPanel";
import { WallpaperPanel } from "./components/settings/WallpaperPanel";
import { WallpaperColorPanel } from "./components/settings/WallpaperColorPanel";
import { ConfirmDialog, PromptDialog } from "./components/Dialogs";
import { PinnedListModal } from "./components/modals/PinnedListModal";
import { GroupsModal } from "./components/modals/GroupsModal";
import { CreateGroupModal } from "./components/modals/CreateGroupModal";
import { InviteMembersModal } from "./components/modals/InviteMembersModal";
import { MuteDurationModal } from "./components/modals/MuteDurationModal";
import { GroupBansModal } from "./components/modals/GroupBansModal";
import { ReadReceiptsModal } from "./components/modals/ReadReceiptsModal";
import { GroupTextModal } from "./components/modals/GroupTextModal";
import { FavoritesModal } from "./components/modals/FavoritesModal";
import { ForwardPicker } from "./components/modals/ForwardPicker";
import { RecordModal } from "./components/modals/RecordModal";
import { TextReader } from "./components/TextReader";
import { MediaViewer } from "./components/MediaViewer";
import { GalleryModal } from "./components/modals/GalleryModal";
import { LOG_TAG, logger, setLogContext } from "./logging/logger";
import { SYSTEM_UID } from "./sdk/protocol";
import {
  Settings, Bookmark, Settings2, Gauge, Bell, Database, Lock, Folder,
  MonitorSmartphone, Languages, Smile, Phone, AtSign, Users, Megaphone,
  Headphones, 
  Trash2, BellOff, Menu,
  Pin,
  Search, FileText, MessageCircle, X, Forward,
  ChevronDown, ChevronUp, QrCode,
} from "lucide-react";

type Phase = "login" | "app"; // 登录页 / 双栏主界面（左列表 + 右聊天，Telegram 桌面式）
type Tab = "chats" | "contacts"; // 左栏顶部：会话列表 / 通讯录

// 群成员上限（含群主），与后端 group.MaxGroupMembers=500 对齐（该值不由接口下发，两端各自硬编码）。
// 建群时群主已占 1 席，故初始成员（好友）最多可选 MAX_GROUP_MEMBERS-1；超限由服务端 GroupMemberLimit 兜底拒绝。
const MAX_GROUP_MEMBERS = 500;
const MAX_INITIAL_MEMBERS = MAX_GROUP_MEMBERS - 1;
// 转发目标会话上限：一次最多转给 9 个会话，与 iOS kIMForwardMaxSelection / 微信一致。

// 收藏 → 合成 ChatMessage：转发/从收藏发送统一走 sendForwardToTarget（§6，媒体/文件透传 URL 不重传）。

/** convSeq→文本 表的两个通用改法（转写面板用）：删一项 / 仅当该项仍展开时写入。 */
const omitSeq = (r: Record<number, string>, seq: number): Record<number, string> => {
  const n = { ...r }; delete n[seq]; return n;
};
const setIfOpen = (r: Record<number, string>, seq: number, text: string): Record<number, string> =>
  (r[seq] === undefined ? r : { ...r, [seq]: text }); // 未展开（用户已取消）就别把面板又拉回来

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
  const [restoring, setRestoring] = useState(() => !!restoreRef.current); // 恢复中：登录页显示过渡态
  const [authBusy, setAuthBusy] = useState(false); // 登录/注册请求进行中
  const [authErr, setAuthErr] = useState(""); // 登录/注册错误文案
  const [loginTab, setLoginTab] = useState<"password" | "qr">("password"); // 登录页页签：密码 / 扫码
  // 扫码登录待入场会话：poll 领到 {uid,token} 后先 setUid 再由 effect 用新 uid 闭包跑 enterApp。
  const pendingQrRef = useRef<{ uid: string; token: string } | null>(null);
  const [qrTrigger, setQrTrigger] = useState(0);
  const [state, setState] = useState<ConnState>("disconnected");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // 会话消息表 + 去重/墓碑集 + 去重/patch/append/删除方法：收口到 useMessageStore（纯逻辑见 messageStore.ts）。
  const {
    msgsByConv, setMsgsByConv, seenByConv, deletedByConv,
    appendMsg, patchMsg, removeMsgRow, applyOp, removeSeq, clearConv,
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
  const [menu, setMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 长按/右键菜单
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null); // 正在引用回复的目标消息（撤回后清）
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null); // 正在编辑的消息（M4-5，编辑态）
  const [translations, setTranslations] = useState<Record<number, string>>({}); // convSeq -> 译文（挂气泡下，M4-5）
  // convSeq -> 转写文本（服务端识别）。空串 = 识别中；未定义 = 未展开。
  // 与 translations 分开：翻译是文本消息的译文，转写是语音的文字，两者可同时存在。
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});
  const transcriptsRef = useRef<Record<number, string>>({}); // 同 messagesRef/pinnedRef：稳定回调读当前展开态
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
  const [tab, setTab] = useState<Tab>("chats"); // 左栏当前 Tab：会话 / 通讯录
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
  const [fullTextModal, setFullTextModal] = useState<{ kind: "announcement" | "intro"; convId: string } | null>(null);
  const [accountCard, setAccountCard] = useState(false); // 左上角头像气泡卡片
  const [showSettings, setShowSettings] = useState(false); // 设置面板（占据侧栏列，右侧聊天保留）
  const [privacyOpen, setPrivacyOpen] = useState(false); // 隐私与安全容器页（拉齐 iOS）
  const [blockedOpen, setBlockedOpen] = useState(false); // 已屏蔽的用户子面板（从隐私页进入）
  const [changePwdOpen, setChangePwdOpen] = useState(false); // 修改密码子面板（从隐私页进入）
  const [generalOpen, setGeneralOpen] = useState(false); // 通用设置子面板
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
  const [detailTab, setDetailTab] = useState<"members" | "media" | "files" | "voice" | "links">("media"); // voice tab 2026-08-26
  const [detailMsgs, setDetailMsgs] = useState<ChatMessage[]>([]); // 详情页签数据源（本地历史）
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 详情文件行右键菜单（转发/定位/取消下载/删除，对齐 iOS 长按）
  const [deleteMenu, setDeleteMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 删除两档子菜单 B（为所有人删除/仅删除自己）——由菜单 A 的「删除」展开，对齐 iOS 子菜单
  const [manageOpen, setManageOpen] = useState(false); // 群管理二级视图（改名/头像/简介/公告/禁言）
  const [groupBans, setGroupBans] = useState<GroupBan[] | null>(null); // 当前群黑名单（管理面板显示计数）
  const [groupBansModal, setGroupBansModal] = useState<{ convId: string; bans: GroupBan[] } | null>(null); // 黑名单弹窗
  // 二维码体系（QRCODE P0）+ G3 入群 UI 状态。
  const [joinReqModal, setJoinReqModal] = useState<{ convId: string; requests: JoinRequest[]; loading: boolean } | null>(null);
  const [muteDurationFor, setMuteDurationFor] = useState<{ convId: string; m: GroupMember } | null>(null); // 成员禁言时长选择
  const [detailMore, setDetailMore] = useState(false);  // 详情「更多」菜单开合
  const [groupsModal, setGroupsModal] = useState<GroupSummary[] | null>(null); // 通讯录「群聊」列表弹窗
  const [createDraft, setCreateDraft] = useState<{ name: string; selected: string[] } | null>(null); // 建群弹窗（群名 + 选中好友）
  const [createBusy, setCreateBusy] = useState(false);
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; convId: string; m: GroupMember } | null>(null); // 成员行 ⋯ 菜单
  const memberMenuRef = useRef<HTMLDivElement | null>(null); // 菜单本体：捕获阶段关闭时用来排除菜单内点击
  const [inviteDraft, setInviteDraft] = useState<{ convId: string; selected: string[] } | null>(null); // 邀请成员弹窗
  // 外观/通用设置簇 → useAppearanceSettings（阶段 8a）：主题/字号/时间格式/发送键/壁纸 + 持久化 effect + isDark。
  const {
    theme, setTheme, isDark, fontSize, setFontSize, timeFormat, setTimeFormat, sendKey, setSendKey,
    wallpaper, setWallpaper, wallpaperBlur, setWallpaperBlur, wallpaperOpen, setWallpaperOpen,
    wallpaperColorOpen, setWallpaperColorOpen, colorHSV, pickWallpaperImage, resetWallpaper, applyWallpaperColor, openWallpaperColor,
  } = useAppearanceSettings(setToast);
  // 系统深色偏好（仅在 theme==="system" 时决定实际明暗）：跟随 prefers-color-scheme 实时变化，供默认壁纸随主题切换。

  const clientRef = useRef<IMClient | null>(null);
  // 下载门控/缓存簇 → useMediaDownload（阶段 4）。须在 clientRef/setViewer/groupConvId/uid/setToast 之后、
  // services useMemo（捕获 refreshDownloadSettings）与 enterApp/logout（调 restore/reset）之前。
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
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef<number>(0);
  const msgsRef = useRef<HTMLDivElement>(null); // 消息滚动容器
  const messagesRef = useRef<ChatMessage[]>([]); // 当前会话已加载消息镜像（供定义在派生之前的回调读取，如 jumpToSeq）
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
  const conversationRefreshTimerRef = useRef<number | null>(null); // sync 批量消息只触发一次会话列表刷新
  // 会话列表刷新节流：ack/receipt/conv_update/group/msg_op 都会触发一次 fetchConversations，
  // 高频收发时叠成请求风暴（日志见同时 3-4 个 GET 在飞、300-400ms）。合并进 400ms 窗口只发一次，
  // 且串行化（在飞时置脏，回来后再补一次），避免并发拉取。
  const listRefreshTimerRef = useRef<number | null>(null);
  const listRefreshInFlightRef = useRef(false);
  const listRefreshDirtyRef = useRef(false);

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

  // 登录后从本地库（IndexedDB）预载各会话历史 → 打开会话即秒显，刷新不丢已下载的历史；
  // 同时读取独立的连续同步游标；本地消息最大值与服务端 latest 都不能证明中间没有空洞。
  const preloadLocal = useCallback(async (convs: Conversation[]) => {
    const client = clientRef.current;
    if (!client) return;
    const loaded: Record<string, ChatMessage[]> = {};
    for (const c of convs) {
      const local = await client.loadLocal(c.conv_id);
      const continuousCursor = await client.loadSyncCursor(c.conv_id);
      client.trackConversation(c.conv_id, continuousCursor);
      // 载入删除墓碑（须早于 syncTracked）：被删的 conv_seq 进内存墓碑，onMessage 收到服务端重推时直接丢弃。
      const del = await client.loadDeletedSeqs(c.conv_id);
      if (del.length) deletedByConv.current[c.conv_id] = new Set(del);
      if (local.length === 0) continue;
      loaded[c.conv_id] = local;
      const seen = (seenByConv.current[c.conv_id] ??= new Set());
      local.forEach((m) => m.convSeq > 0 && seen.add(m.convSeq)); // 防服务端同步重复回显
    }
    if (Object.keys(loaded).length) preloadMsgs(loaded);
  }, []);

  const scheduleConversationRefresh = useCallback(() => {
    if (conversationRefreshTimerRef.current !== null) {
      clearTimeout(conversationRefreshTimerRef.current);
    }
    conversationRefreshTimerRef.current = window.setTimeout(() => {
      conversationRefreshTimerRef.current = null;
      void refreshConversations().then(async (latest) => {
        if (latest.length === 0) return;
        await preloadLocal(latest); // 新会话也立即登记，避免等刷新页面后才补洞
        clientRef.current?.syncTracked();
      });
    }, 150);
  }, [refreshConversations, preloadLocal]);

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
    clientRef.current?.watchUsers([]); // 切到群聊：清空单聊在线态关注（群成员在线不走 watch）
    const conv = conversations.find((c) => c.conv_id === cid);
    const readSeq = conv?.read_seq ?? 0;
    const latestSeq = conv?.latest_conv_seq ?? 0;
    // 群聊已读双勾：用「全员已读位点」播种 peerReadSeq —— 群里没有单一对端，只有**人人都读过**
    // 才算已读（读得最慢的成员决定位点）。非实时：进会话/刷新列表时取快照值（后端不推群 receipt）。
    setPeerReadSeq((prev) => ({ ...prev, [cid]: Math.max(prev[cid] ?? 0, conv?.group_read_seq ?? 0) }));
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
    // 进会话即清手动"标未读"（IM 通行做法）；多端经 conv_update 同步。
    if (conv?.marked_unread) {
      void clientRef.current?.updateConvSettings(cid, { pinned_at: conv.pinned_at ?? 0, muted: !!conv.muted, marked_unread: false }).then(() => refreshConversations()).catch(() => {});
    }
    void refreshConversations();
  }, [conversations, refreshConversations, refreshGroupInfo]);

  // 群聊已读双勾「非实时」刷新：会话列表刷新（进会话/sync 后）时，把当前打开群的「全员已读位点」
  // 喂进 peerReadSeq，使「全员都读过→绿✓✓」无需退出会话即可更新——后端刻意不推群 receipt
  // （避免 O(N²) 扇出），会话列表快照是这个绿勾唯一的更新时机。单调只增，不覆盖单聊的实时位点。
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
  const { myInfo, setMyInfo, profileDraft, setProfileDraft, profileBusy, cropReq, setCropReq, loadMyInfo, openProfile, saveProfile, onPickAvatar } =
    useProfileEdit({ clientRef, setToast });

  // token 非空=扫码登录路径（无密码，走 connectWithToken）；否则密码/免密登录。
  // name 是 **username**（登录凭据）；token 非空则走扫码会话（此时 knownUid 是票据带回的内部 ID）。
  const enterApp = useCallback(async (name: string, pwd: string, token?: string, knownUid?: string) => {
    if (!name && !knownUid) {
      setAuthErr("请填写用户名");
      return;
    }
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
      onMessage: (m) => {
        // 入站落库：本端已删拦截 + 同 conv_seq 去重（命中则合并权威元数据、不新增）见 useMessageStore.ingestInbound。
        // 可见即读：不在收到时立即标已读；新消息若落在视口内（贴底）会由 markVisibleRead 读到，看历史时留到滚下去再读。
        // 仅**新追加**才刷会话列表（合并/丢弃不刷）；全量/多页同步连续投递很多条，各自触发的刷新走节流合并。
        if (ingestInbound(m)) scheduleConversationRefresh();
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
          // 多端已读同步（M1）：我在另一端已读 → 本端列表未读清零（服务端已记位点，刷新即得）。
          scheduleListRefresh();
        } else {
          setPeerReadSeq((prev) => ({ ...prev, [convId]: Math.max(prev[convId] ?? 0, upToSeq) }));
          // 对端已读 → 刷新左侧列表，让"我发的最后一条"在列表里也即时变绿✓✓（否则要切会话才更新）。
          scheduleListRefresh();
        }
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
          setToast(result === "approved" ? "你的入群申请已通过，进群聊天吧" : "你的入群申请未通过");
          if (result === "approved") scheduleListRefresh();
          return;
        }
        scheduleListRefresh();
        if (event !== "dissolve") void refreshGroupInfo(cid); // 被移出时 fetch 报 300203 → 自动清缓存；解散后群已不存在，无需再拉
        // G3 join_request 只推群主/管理员：pending_count 随上面 refreshGroupInfo 更新 → 聊天页审批横幅/详情页红点即时刷新。
        // 待审列表开着则重拉；未开则给一条轻提示（横幅才是主要落点，保持不吵）。
        if (event === "join_request") {
          void reloadJoinRequests(cid);
          setToast("有新的入群申请");
          return;
        }
        // 被移出（remove 且 target=自己）或群被解散（dissolve，管理端处置，对全体生效）→ 提示并退出该会话。
        if ((event === "remove" && target === uidRef.current) || event === "dissolve") {
          setToast(event === "dissolve" ? "该群已被解散" : "你已被移出群聊");
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
        applyOp(cid, targetSeq, patch); // 按 conv_seq 就地打补丁（撤回→墓碑/编辑→改文本/置顶）
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
      onMessageRemoved: (cid, targetSeq) => {
        void refreshPinned(cid);
        removeSeq(cid, targetSeq); // 从聊天列表按 conv_seq 移除该条
        setDetailMsgs((prev) => prev.filter((m) => !(m.convId === cid && m.convSeq === targetSeq)));
        setViewer((v) => (v && v.m.convId === cid && v.m.convSeq === targetSeq ? null : v)); // 正在查看的媒体被删 → 关查看器
        setTextReader((r) => (r && r.convId === cid && r.convSeq === targetSeq ? null : r)); // 正在全屏读的文本被删（为所有人删/仅删我）→ 关阅读器
        scheduleListRefresh(); // 会话列表末条预览可能随之变化
      },
      // 会话级设置变更（置顶/免打扰/标未读/删除会话，M4.5）：多端同步 → 重新拉取权威会话列表覆盖本地。
      onConvUpdate: () => { scheduleListRefresh(); },
      // 账号级配置变更（M4-7）：另一端改了自动下载策略 → 重拉（零新链路的多端同步）。
      onVoiceTranscript: (convId, convSeq, status, text) => {
        // 只在该条仍处于展开态时落文本——用户可能在等结果期间点了「取消转文字」。
        if (status === "done" && text) {
          setTranscripts((prev) => setIfOpen(prev, convSeq, text));
        } else if (status === "failed") {
          setToast("识别失败，请稍后重试");
          setTranscripts((prev) => (prev[convSeq] === undefined ? prev : omitSeq(prev, convSeq)));
        }
        void convId;
      },
      onCapabilitiesUpdate: (version) => {
        logger.info(LOG_TAG.media, "capabilities_update_received", { version });
        void refreshDownloadSettings();
      },
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
          setAuthErr("此设备的登录已被移除，请重新登录"); // logout 会清 authErr，故放其后
          return;
        }
        void askConfirm(`${msg}。点"确定"重新登录；"取消"可继续查看本地聊天记录。`, { okText: "重新登录" })
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
      if (token) await client.connectWithToken(knownUid || "", token); // 扫码登录：票据已带内部 ID
      else await client.connect(name, pwd); // 首次登录失败（密码错误等）会抛错
    } catch (e) {
      const code = (e as { code?: number }).code;
      const cached = client.cachedConversations();
      if (code === undefined && cached.length > 0) {
        // 服务器不可达不是登录态失效：保留 client 的后台重连，直接进入本地会话页显示“未连接”。
        // 注意此路径拿不到新的内部 ID（压根没连上），只能沿用已存会话里的那个。
        clientRef.current = client;
        setConversations(cached);
        await preloadLocal(cached);
        saveSession({ uid: knownUid || uid, username: name || loginName, pwd, token });
        setAuthBusy(false);
        setPhase("app");
        return;
      }
      client.disconnect();
      clientRef.current = null;
      setAuthBusy(false);
      setAuthErr((e as Error).message || "登录失败");
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
    void refreshDownloadSettings(); // 拉账号级自动下载策略（M4-7，多端同步）
    void restoreDownloadState(myUID); // 回灌解门控记录 / 失效标记 / Cache Storage 已下载文件（见 useMediaDownload）
    // 保持登录：刷新后静默重登（Web #4）。扫码登录存 token（无密码，过期即回登录）。
    // **username 必须一起存**：重登走 /login，而它只认 username。
    saveSession({ uid: myUID, username: name || loginName, pwd, token });
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
    void enterApp(r.username, r.pwd, r.token, r.uid).finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 扫码登录入场：等 setUid 落地（uid===待入场 uid）后，用带正确 uid 的 enterApp 闭包连接。
  useEffect(() => {
    const p = pendingQrRef.current;
    if (!p || phase !== "login" || uid !== p.uid) return;
    pendingQrRef.current = null;
    void enterApp("", "", p.token, p.uid);
  }, [uid, phase, qrTrigger, enterApp]);

  // 注册账号（用户名 + 昵称 + 密码≥6位）→ 成功后直接登录。
  const doRegister = useCallback(async () => {
    if (!loginName || password.length < 6) {
      setAuthErr("用户名必填，密码至少 6 位");
      return;
    }
    // 昵称必填：全端显示名回退链止于它，留空会让界面露出 10 位数字内部 ID。后端也会拒，这里前置提示。
    if (!nickname.trim()) {
      setAuthErr("请填写昵称（这是别人看到的名字）");
      return;
    }
    setAuthBusy(true);
    setAuthErr("");
    try {
      await registerAccount(loginName, password, nickname.trim());
    } catch (e) {
      setAuthBusy(false);
      setAuthErr((e as Error).message || "注册失败");
      return;
    }
    await enterApp(loginName, password); // 注册成功 → 直接用同一密码登录
  }, [loginName, nickname, password, enterApp]);

  const openChat = useCallback((p: string) => {
    if (!p || p === uid) {
      setToast("请输入有效的对方 uid");
      return;
    }
    const cid = convIdFor(uid, p);
    setPeer(p);
    setGroupConvId(""); // 切回单聊模式
    currentConvRef.current = cid;
    clientRef.current?.watchUsers([p]); // 订阅对端在线态：首聊尚无会话也能即时收到上线（服务端 watch，PROTOCOL §5.5）
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
  // 媒体/文件发送簇 → useMediaSend（阶段 5）：attachPanel/粘贴攒批/上传进度/批发·单发流水线/重试/附件入口。
  // 须在 clientRef/useMessageStore/uid/peer/groupConvId/setToast 之后、send()（deps 捕获 sendMediaBatch/uploadAndSend/pastedImages）之前。
  const {
    attachPanel, setAttachPanel, pendingFilesRef, uploadProgress, teardownOutboxUpload, hasActiveSend, toggleUploadPause,
    cancelSendMessage, pastedImages, setPastedImages, removePastedImage, onComposerPaste, sendMediaBatch, uploadAndSend,
    retryUpload, onMediaBubbleTap, fileInputRef, attachAnchorRef, cancelAttachClose, scheduleAttachClose, attachItems, pickFile, onFilePicked,
  } = useMediaSend({ uid, peer, groupConvId, clientRef, setToast, appendMsg, patchMsg, removeMsgRow });

  // @提及簇 → useMentions（阶段 7b）：须在 send()（读 mentionCandidates/mentionAllPending）之前；convId 在此处尚未定义，
  // 用与其定义完全相同的表达式就地计算（脚本已断言一致）。
  const {
    mentionQuery, setMentionQuery, mentionFilter, setMentionFilter, mentionActive, setMentionActive,
    mentionCandidates, mentionAllPending, mentionPanelRef, mentionActiveRef, mentionRows, pickMention, onMentionNavKey,
  } = useMentions({ convId, groupConvId, peer, uid, groupInfos, friends, input, setInput, composerRef });
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
      const capMentionOpts = { mentions: capMentions.length ? capMentions : undefined, mentionAll: capMentionAll || undefined };
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
    const sendOpts = {
      ...(rt ? { replyTo: rt } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(mentionAll ? { mentionAll: true } : {}),
    };
    const clientMsgId = client.sendText(text, peer, cid, Object.keys(sendOpts).length ? sendOpts : undefined); // 群聊 to 为空：服务端按 conv_id 查成员写扩散
    appendMsg(cid, {
      clientMsgId, convId: cid, from: uid, content: text, contentType: "text",
      convSeq: 0, timestamp: Date.now(), status: "sending",
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
  const services = useMemo<AppServices>(() => ({
    clientRef, setToast, comingSoon, askConfirm, askPrompt,
    refreshConversations, refreshFriends, refreshGroupInfo, refreshDownloadSettings,
  }), [setToast, comingSoon, askConfirm, askPrompt,
       refreshConversations, refreshFriends, refreshGroupInfo, refreshDownloadSettings]);

  // 群资料写操作簇：收口到 useGroupActions（只吃 services）。仍留 App 的 pickGroupAvatar/doEditGroupRemark 复用 doGroupAction。
  // App 仍用到的：doGroupAction（pickGroupAvatar 复用）、doEditAnnouncement（全文视图「编辑」）、doEditMyGroupNickname（详情主视图）。
  // rename/intro/mute/settings 已随 GroupManagePanel 迁出（它自取 useGroupActions）。
  const { doGroupAction, doEditAnnouncement, doEditMyGroupNickname } = useGroupActions(services);





  // 转发（M4-3）：打开会话选择器，选目标后逐条转发（带 forward_from 溯源）。
  // 链接富预览抓取（供 LinkCard；稳定引用避免重复请求）。
  const fetchLinkPreview = useCallback(async (url: string): Promise<LinkPreview> => {
    const c = clientRef.current;
    if (!c) throw new Error("未连接");
    return c.linkPreview(url);
  }, []);
  // 进入多选态（M4-3）：从消息右键进入时预选当前消息（相册某格 → 只预选该格，逐格勾选 2a）；从标题栏进入不预选。
  const enterSelectMode = useCallback((m?: ChatMessage) => {
    setMenu(null); setChatMenu(false); setSelectMode(true);
    setSelected(new Set(m && m.convSeq > 0 ? [m.convSeq] : []));
  }, []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  const toggleSelected = useCallback((seq: number) => {
    setSelected((prev) => { const n = new Set(prev); n.has(seq) ? n.delete(seq) : n.add(seq); return n; });
  }, []);
  // 相册整组全选/全不选在 MessageList 就地用 toggleSelected 循环实现（见 toggleAlbumGroup），此处不再单列。
  // 转发簇 → useForward（阶段 6）：须在 exitSelectMode/setMenu/useMessageStore/selected/groupInfos 之后。
  const {
    forwarding, setForwarding, forwardMode, setForwardMode, forwardMulti, setForwardMulti, forwardTargets, setForwardTargets,
    forwardMessage, closeForwardPicker, toggleForwardTarget, sendForwardToTarget, doForwardToTargets, forwardSelected,
  } = useForward({ uid, peer, groupConvId, clientRef, setToast, appendMsg, msgsByConv, groupInfos, selected, setMenu, exitSelectMode });
  // 收藏簇 → useFavorites（阶段 6）：消费 useForward 的 setForwardMode/setForwarding/sendForwardToTarget。
  const {
    favorites, setFavorites, favPick, favTotal, favLoadingMore, loadMoreFavorites,
    favoriteMessage, favoriteSelected, openFavorites, openFavoritesPick, closeFavorites,
    favoriteActions, sendFavoritesToCurrent,
  } = useFavorites({ clientRef, setToast, setMenu, setAttachPanel, saveMessageToDisk, conversations, currentConvRef, setForwardMode, setForwarding, sendForwardToTarget, msgsByConv, selected, exitSelectMode });

  // 多选批量删除（仅本端）。
  const deleteSelected = useCallback(() => {
    const cid = convId;
    setMsgsByConv((prev) => {
      const list = (prev[cid] ?? []).filter((m) => !(m.convSeq > 0 && selected.has(m.convSeq)));
      return { ...prev, [cid]: list };
    });
    // 持久化删除（同 deleteMessage）：内存墓碑 + IndexedDB 墓碑，防实时/读盘两条路径复现。
    selected.forEach((s) => {
      if (s > 0) { (deletedByConv.current[cid] ??= new Set()).add(s); void markMessageDeleted(uid, cid, { convSeq: s }); }
    });
    exitSelectMode();
  }, [peer, uid, groupConvId, selected, exitSelectMode]);

  // 多选批量收藏（favoriteSelected）已收进 useFavorites（收藏动作簇，见其 return）。

  // 跳转到被引用的原消息（点击气泡引用条）：高亮该行并滚入视口。
  const jumpToSeq = useCallback((seq: number) => {
    const box = msgsRef.current;
    if (!box) { setToast("原消息不在当前视图"); return; }
    const list = messagesRef.current;
    let el = box.querySelector(`[data-seq="${seq}"]`);
    // 相册宫格成员：优先定位并高亮**那一格**（tile 带 data-album-seq），而非整条宫格主行。
    // 主行只有 leader 带 data-seq，非 leader 成员靠 tile 命中；找不到 tile 再回退到主行。目标决策见 resolveJumpTarget。
    const tgt = resolveJumpTarget(list, seq);
    if (tgt.kind === "album-tile") {
      const tile = box.querySelector(`[data-album-seq="${seq}"]`);
      if (tile) el = tile;
      else if (!el) el = box.querySelector(`[data-seq="${tgt.leaderSeq}"]`);
    }
    if (!el) {
      // 跳不到分两种，**按模型判定而非 DOM**（宫格从行/未来虚拟化都可能不渲染节点）：
      // 目标比已加载最早一条还早 → 还没上拉加载到；落在已加载窗口内却缺失 → 已被本地删除。
      // 窗口内无任何已确认消息（minSeq=0）判不出方向 → 回退通用提示。
      const earliest = minSeqOf(list);
      setToast(earliest === 0 ? "原消息不在当前视图"
        : seq < earliest ? "原消息较早，请上拉加载后重试" : "原消息已被删除");
      return;
    }
    const node = el;
    const flash = () => {
      node.classList.add("flash");
      window.setTimeout(() => node.classList.remove("flash"), 1200);
    };
    // 把目标行滚到容器纵向居中。只动 .msgs 自身 scrollTop（不用 scrollIntoView——会连带滚动 html/#root
    // 把 .app 顶出视口、间距塌陷）。**用瞬时赋值而非 `scrollTo({behavior:"smooth"})`**：本容器上方有大量
    // 异步布局的媒体（gated 缩略/视频），平滑滚动的动画目标被持续变化的 scrollHeight 打断，远距离目标**滚不动**
    // （实测 scrollTo smooth 到 5000px 外的目标 scrollTop 纹丝不动）；瞬时赋值可靠命中。
    const scrollToNode = () => {
      const r = node.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      box.scrollTop = box.scrollTop + (r.top - br.top) - (box.clientHeight - r.height) / 2;
    };
    const r0 = node.getBoundingClientRect();
    const br0 = box.getBoundingClientRect();
    if (r0.top >= br0.top && r0.bottom <= br0.bottom) { flash(); return; } // 已在视口内 → 直接闪
    // 跳走后不再「贴底」：否则从底部跳到较早的目标时，下方媒体（视频/图片）异步加载完成会触发
    // onMediaLoad 把 scrollTop 拽回 scrollHeight，定位当场被冲掉（远距离目标必现，近处目标因差值小看似正常）。
    wasNearBottomRef.current = false;
    scrollToNode();
    // 下一帧再校正一次：抵消滚动后上方媒体继续异步布局造成的目标位移，然后高亮。
    requestAnimationFrame(() => { scrollToNode(); flash(); });
  }, []);

  // 「定位到聊天」跨窗口定位（详情文件/媒体列表读的是本地全量，聊天页是分页窗口——较早的目标不在窗口内，
  // jumpToSeq 直接找不到）。机制：记一个待定位目标，**自动上翻分页直到目标进入窗口再滚动高亮**；到顶仍无=已删除。
  const pendingLocateRef = useRef<{ convId: string; seq: number; tries: number } | null>(null);
  const MAX_LOCATE_PAGES = 40; // 上限：极长历史兜底，避免异常时无限翻页
  const driveLocate = useCallback(() => {
    const pend = pendingLocateRef.current;
    if (!pend || pend.convId !== currentConvRef.current) return; // 会话切走 → 交给新一轮 locateInChat
    const list = messagesRef.current;
    if (list.some((x) => x.convSeq === pend.seq)) {
      pendingLocateRef.current = null;
      requestAnimationFrame(() => jumpToSeq(pend.seq)); // 等新插入的行渲染出 DOM 节点再滚动高亮
      return;
    }
    const oldest = minSeqOf(list);
    if (oldest === 0) return;                              // 窗口尚未加载完，等下一次 msgsByConv 变化
    if (oldest <= 1 || pend.tries >= MAX_LOCATE_PAGES) {   // 到顶仍没有 / 翻页超上限 → 判定已删除
      pendingLocateRef.current = null;
      setToast("原消息已被删除");
      return;
    }
    if (pend.seq < oldest) {                               // 目标更早 → 继续上翻一页（保位，避免视觉跳动）
      if (loadingOlderRef.current) return;                // 有一页在飞，等它到达后本流程再被触发
      if (pend.tries === 0) setToast("正在定位…");
      const box = msgsRef.current;
      if (box) histAnchorRef.current = { h: box.scrollHeight, t: box.scrollTop };
      pend.tries += 1;
      loadingOlderRef.current = true;
      clientRef.current?.loadOlder(pend.convId, oldest);
    } else {                                               // 落在已加载窗口内却缺失 → 已被删除
      pendingLocateRef.current = null;
      setToast("原消息已被删除");
    }
  }, [jumpToSeq]);
  // 每次消息窗口变化（分页到达）推进一步定位。
  useEffect(() => { driveLocate(); }, [msgsByConv, driveLocate]);
  const locateInChat = useCallback((cid: string, seq: number) => {
    if (!cid || seq <= 0) { setToast("该消息无法定位"); return; }
    pendingLocateRef.current = { convId: cid, seq, tries: 0 };
    if (cid !== currentConvRef.current) {
      // 详情所属会话未打开（如从通讯录/群成员进的资料页）→ 先打开它，加载窗口后由 effect 定位。
      if (cid.startsWith("g_")) openGroupChat(cid);
      else {
        const peer = cid.replace(/^u_/, "").split("_u_").find((x) => x !== uid);
        if (peer) openChat(peer); else { pendingLocateRef.current = null; setToast("该消息无法定位"); }
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
    if (m.caption) { void navigator.clipboard?.writeText(m.caption); setToast("已复制"); return; }
    // 纯图片（无 caption）：复制真实图片字节（可粘贴回输入框直接发图）；失败或非图片：复制文本/URL。
    if (m.contentType === "image") {
      copyImageToClipboard(m.content).then(() => setToast("已复制图片"))
        .catch(() => { void navigator.clipboard?.writeText(m.content); setToast("已复制链接"); });
      return;
    }
    void navigator.clipboard?.writeText(m.content);
  }, []);

  // 长文本消息 key（记忆"展开全文"用）：**必须带 convId**——conv_seq 每会话各自从 1 递增，
  // 不加会话前缀会让 A 会话 seq-5 与 B 会话 seq-5 撞键、展开态跨会话串号。
  // **优先用 clientMsgId**（本端消息发送中→ack 全程都在，且不随 convSeq 从 0 变 N 而翻转）；
  // 对端消息无 clientMsgId → 退回 seq-N。若两者都无（极少）则空串。
  const msgTextKey = (m: ChatMessage) => `${m.convId}:${m.clientMsgId ? `c-${m.clientMsgId}` : m.convSeq > 0 ? `seq-${m.convSeq}` : ""}`;
  const toggleTextExpand = useCallback((key: string) => {
    setExpandedTexts((prev) => { const nx = new Set(prev); if (nx.has(key)) nx.delete(key); else nx.add(key); return nx; });
  }, []);
  // 被 @ 者条目（气泡内 @昵称 高亮 + 点击跳资料）：mentions 是服务端过滤后的 uid，回本地群成员表取昵称；
  // mention_all 追加「所有人」（uid 空＝仅高亮不可点）。单聊无 mentions，返回空。
  // 无昵称成员：发送侧回填的 token 就是 `@<uid>`（displayName = nickname || user_id），
  // 故这里同样回退 uid 才能匹配上——否则 `@1002` 这类既不高亮也点不动（修复用户反馈）。
  const mentionEntriesFor = (m: ChatMessage): { name: string; uid: string }[] => {
    const out: { name: string; uid: string }[] = [];
    if (m.mentionAll) out.push({ name: MENTION_ALL_LABEL, uid: "" });
    for (const uid of m.mentions ?? []) {
      out.push({ name: memberNick(m.convId, uid) || uid, uid });
    }
    return out;
  };
  // 命中词高亮 highlightText 已抽到 ./searchHighlight（纯函数，与首页聊天记录摘要共用）。
  const highlightSearch = (text: string, keyBase: string): ReactNode =>
    searchOpen ? highlightText(text, searchQuery, keyBase) : text;
  // 一段"非提及"文本里的 URL 切成蓝色下划线可点 <a>；无 URL 直接走搜索高亮（原行为）。
  // 搜索态命中词高亮**不进入** URL 子串（避免 <a> 里嵌 <mark> 的选中/复制怪异）——搜索是临时态，可接受。
  const renderLinkifiedText = (text: string, keyBase: string): ReactNode => {
    const parts = splitTextByURL(text);
    if (parts.length === 1 && parts[0].kind === "t") return highlightSearch(text, keyBase);
    return parts.map((p, i) => p.kind === "u"
      ? <a key={`${keyBase}-u${i}`} href={p.text} target="_blank" rel="noopener noreferrer"
           className="msg-link" onClick={(e) => e.stopPropagation()}>{p.text}</a>
      : <Fragment key={`${keyBase}-t${i}`}>{highlightSearch(p.text, `${keyBase}-h${i}`)}</Fragment>);
  };
  // 把一段文本渲染为高亮 @提及的节点：命中的 `@昵称` token 上色；有 uid 且非多选态时可点 → 跳该成员资料页。
  // @所有人 无 uid 只高亮不可点。无提及时叠加会话内搜索命中词高亮 + URL 高亮（http(s) → 蓝色下划线可点）。
  const renderMentionText = (m: ChatMessage, text: string) => {
    const entries = mentionEntriesFor(m);
    if (entries.length === 0) return renderLinkifiedText(text, "sh");
    const uidByName = new Map(entries.map((e) => [e.name, e.uid]));
    return segmentMentions(text, entries.map((e) => e.name)).map((s, i) => {
      if (!s.mention) return <Fragment key={i}>{renderLinkifiedText(s.text, `sh${i}`)}</Fragment>;
      const uid = uidByName.get(s.text.slice(1)); // 去掉 @ 取昵称查 uid
      if (selectMode || !uid) return <span key={i} className="mention-hl">{s.text}</span>;
      return <span key={i} className="mention-hl mention-tap"
                   onClick={(e) => { e.stopPropagation(); setTextReader(null); openPeerDetail(uid); }}>{s.text}</span>;
    });
  };
  // 文本消息内容的三档渲染（阈值见 longtext.ts，与 iOS 统一）：
  //   short 全显；long 折叠 8 行 + 就地展开；huge 摘要卡 → 全屏阅读器。均对 @昵称 高亮。
  const renderMessageText = (m: ChatMessage) => {
    const tier = textTier(m.content);
    if (tier === "short") return <span className="btext">{renderMentionText(m, m.content)}</span>;
    // 多选态：整行点击=勾选（见 .row onClick）。此时长文本不接管点击——摘要卡不开阅读器、
    // 折叠切换也不吞事件，让点击冒泡到行去切换选中（与 iOS `self.selecting` 早返回一致）。
    if (tier === "huge") {
      return (
        <span className="btext longtext-card" onClick={selectMode ? undefined : () => { if (window.getSelection()?.toString()) return; setTextReader(m); setReaderFontStep(0); }} title={selectMode ? undefined : "查看全文"}>
          <span className="lt-card-head">
            <span className="lt-card-icon"><FileText size={16} /></span>
            <span className="lt-card-meta">
              <span className="lt-card-title">长文本 · {charCountLabel(m.content)}</span>
              <span className="lt-card-sub">点击查看全文</span>
            </span>
          </span>
          {/* 预览只切前 200 字：卡片仅 3 行可见，全文塞进 DOM 会让每次列表重渲染 diff 数十 KB 文本节点（全文留给阅读器）。 */}
          <span className="lt-card-preview">{m.content.slice(0, 200)}</span>
        </span>
      );
    }
    // long：折叠/展开就地切换。
    const key = msgTextKey(m);
    const expanded = expandedTexts.has(key);
    return (
      <span className="btext">
        <span className={expanded ? "lt-body" : "lt-body collapsed"}>{renderMentionText(m, m.content)}</span>
        <span className="lt-toggle" onClick={(e) => { if (selectMode) return; e.stopPropagation(); toggleTextExpand(key); }}>
          {expanded ? <>收起 <ChevronUp size={13} /></> : <>展开全文 <ChevronDown size={13} /></>}
        </span>
      </span>
    );
  };

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

  // 点置顶横幅/置顶列表行的跳转（G0）：先判目标是不是**已被撤回**。服务端置顶列表本就剔除撤回消息，
  // 但横幅是快照——重拉失败（best-effort）、msg_op 帧还没到、重拉在飞时点击，都可能停在旧集合上。
  // 这时直接 jumpToSeq 会滚到一条「撤回了一条消息」的系统行并高亮，用户看不出原消息已经没了。
  // 故显式提示 + 顺手重拉一次让横幅收敛（iOS 同口径，见 +PinnedBanner 的 didRequestJumpToConvSeq）。
  const jumpToPinned = useCallback((seq: number) => {
    if (messagesRef.current.some((m) => m.convSeq === seq && m.recalledAt)) {
      setToast("原消息已被撤回");
      void refreshPinned(currentConvRef.current);
      return;
    }
    jumpToSeq(seq);
  }, [jumpToSeq, refreshPinned, setToast]);

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
      } catch (e) { setToast(`翻译失败：${(e as Error).message}`); }
    })();
  }, []);

  /**
   * 语音转文字（服务端识别）。已展开 → 收起（**只收本地面板，不删服务端结果**：
   * 服务端按音频内容缓存、会话内共享，一个人"取消"不该把别人也能看到的结果删掉）。
   * 未展开 → 请求：命中缓存立刻出文本；否则先显"识别中…"，结果经 WS voice_transcript 帧到达。
   */
  const transcribeMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    if (m.convSeq <= 0) return;
    if (transcriptsRef.current[m.convSeq] !== undefined) { // 已展开 → 只收面板，不发请求
      setTranscripts((prev) => omitSeq(prev, m.convSeq));
      return;
    }
    setTranscripts((prev) => ({ ...prev, [m.convSeq]: "" })); // 空串=识别中
    void (async () => {
      try {
        const r = await clientRef.current?.transcribeVoice(m.convId, m.convSeq);
        if (r && r.status === "done" && r.text) setTranscripts((prev) => setIfOpen(prev, m.convSeq, r.text));
        // pending：维持"识别中…"，等 WS 帧。
      } catch (e) {
        // 业务码文案统一在 FRIENDLY_MESSAGES（api() 已据码本地化 message）；只有非业务错误
        // （网络/解析）才补前缀，否则会吐出裸的 "Failed to fetch"。
        const msg = (e as Error).message;
        setToast(errorCode(e) ? msg : `转文字失败：${msg}`);
        setTranscripts((prev) => omitSeq(prev, m.convSeq));
      }
    })();
  }, []);

  // 举报（AG-3）：举报某条消息 / 举报发送者。仅对“对方的消息”可用。
  const reportMessage = useCallback(async (m: ChatMessage, kind: "message" | "user") => {
    setMenu(null);
    const what = kind === "message" ? "举报这条消息" : `举报用户 ${m.from}`;
    const reason = await askPrompt(what, "", { placeholder: "请填写举报理由", okText: "提交举报" });
    if (reason === null) return; // 取消
    try {
      if (kind === "message") {
        // 用 (conv_id, conv_seq) 定位消息：客户端无需持有 server_msg_id（本地库存的是复合键）。
        await clientRef.current?.report("message", String(m.convSeq), reason, m.convId);
      } else {
        await clientRef.current?.report("user", m.from, reason);
      }
      setToast("举报已提交，感谢反馈。");
    } catch (e) {
      setToast(`举报失败：${(e as Error).message}`);
    }
  }, []);

  // ---- 已登录设备（P2）：状态 + 加载/踢下线操作 ----
  const { devices, devicesOpen, setDevicesOpen, devicesErr, revokingSid, loadDevices, revokeDevice, revokeOtherDevices, resetDevices } =
    useDevices({ clientRef, askConfirm, setToast });

  // 打开群公告/简介全文视图（三入口共用：横幅点击 / 详情页卡点击）。
  const openGroupText = useCallback((kind: "announcement" | "intro", cid: string) => {
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
    if (m.convSeq <= 0) { setToast("该消息尚未同步，暂不能删除"); return; }
    clientRef.current?.deleteMessageForEveryone(m.convId, m.convSeq);
  }, []);

  // 仅删除自己（任务2）：仅从我的所有设备移除，对端不受影响。走 REST 落 per-user 隐藏表 + 多设备同步。
  const hideFileForMe = useCallback(async (m: ChatMessage) => {
    if (m.convSeq <= 0) { setToast("该消息尚未同步，暂不能删除"); return; }
    try { await clientRef.current?.hideMessage(m.convId, m.convSeq); }
    catch (e) { setToast(`删除失败：${(e as Error).message}`); }
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
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 会话"标为未读"：手动置红点（不改已读位点，不计数）。
  const markUnreadConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: true });
        await refreshConversations();
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 会话置顶/取消置顶：pinned_at=现在/0（后端据此把置顶会话排在列表顶）。
  const setConvPinned = useCallback((c: Conversation, pinned: boolean) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: pinned ? Date.now() : 0, muted: !!c.muted, marked_unread: !!c.marked_unread });
        await refreshConversations();
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 会话免打扰/取消：muted 切换（弱提示，不改红点/未读）。
  const setConvMuted = useCallback((c: Conversation, muted: boolean) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted, marked_unread: !!c.marked_unread });
        await refreshConversations();
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
  }, [refreshConversations]);

  // 删除会话（仅本人，后端记 cleared_at 不删消息）：若删的是当前打开会话则退出，否则刷新列表。
  const deleteConv = useCallback((c: Conversation) => {
    setConvMenu(null);
    void (async () => {
      try {
        await clientRef.current?.deleteConversation(c.conv_id);
        if (currentConvRef.current === c.conv_id) deselect(); // deselect 内部会 refreshConversations
        else await refreshConversations();
      } catch (e) { setToast(`删除失败：${(e as Error).message}`); }
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
        if (!r.enabled) { setToast("该群人数过多，不支持查看已读详情"); return; }
        setReadReceipts({ read: r.read, unread: r.unread, tab: "read" });
      } catch (e) { setToast(`拉取已读状态失败：${(e as Error).message}`); }
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
      reportMsg: (m) => void reportMessage(m, "message"),
      reportUser: (m) => void reportMessage(m, "user"),
      cancelSend: cancelSendMessage,
      transcribe: transcribeMessage,
      comingSoon,
    }),
    [copyMessage, replyMessage, forwardMessage, favoriteMessage, saveMessageToDisk, editMessage, translateMessage, enterSelectMode, recallMessage, pinMessage, deleteMessage, reportMessage, cancelSendMessage, transcribeMessage, comingSoon],
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


  const updateColorFromSpectrum = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    applyWallpaperColor({
      h: colorHSV.h,
      s: clamp(((event.clientX - rect.left) / rect.width) * 100),
      v: clamp(100 - ((event.clientY - rect.top) / rect.height) * 100),
    });
  };

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


  const stateText = { connected: "已连接", connecting: "连接中…", disconnected: "未连接" }[state];

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
  const messages = (msgsByConv[convId] ?? [])
    .slice()
    .sort((a, b) => (a.timestamp - b.timestamp) || ((a.convSeq || Number.MAX_SAFE_INTEGER) - (b.convSeq || Number.MAX_SAFE_INTEGER)));
  messagesRef.current = messages; // 每次渲染同步镜像（jumpToSeq 等早于此处定义，经 ref 取当前值）
  pinnedRef.current = pinnedByConv; // 同上：WS 回调（onMsgOp）判断撤回/编辑是否命中置顶项要读当前集合
  transcriptsRef.current = transcripts; // 同上：transcribeMessage 判断"已展开→收起"要读当前值

  // ===== 会话内搜索 / 日历 / 「来自」发件人 / 首页全局搜索：状态+逻辑抽到 useChatSearch（CODING_STYLE §7）。
  // searchOpen/searchQuery 受控注入（见上）；副作用依赖（jumpToSeq/locateInChat/setToast/各 ref/客户端）注入进去。=====
  const search = useChatSearch({
    searchOpen, setSearchOpen, searchQuery, setSearchQuery,
    messages, convId, groupConvId, uid, groupInfos, conversations, msgsByConv,
    messagesRef, currentConvRef, loadingOlderRef, msgsRef, histAnchorRef, clientRef,
    jumpToSeq, locateInChat, setToast, maxLocatePages: MAX_LOCATE_PAGES,
  });

  // 任务3 · 查看器媒体时间线：当前会话全部图/视频按时序混排，供查看器左右翻页（Telegram 式）。
  // 口径与媒体库一致（image|video && 未撤回 && content 非空）；仅覆盖**内存中已加载**的消息——翻到头即停，
  // 不自动拉更早（第一版约定）。合成消息（收藏/记录预览：convSeq=0 且不在会话流内）mediaId 找不到 → 不显箭头、不翻页。
  //
  // 稳定标识 mediaId：**必须用 convSeq**（会话内唯一，收到/同步的消息都有）。绝不能用 clientMsgId——
  // 入站消息（别人发的 + 自己刷新后重新同步的）在 imSdk.processIncoming 里根本不写 clientMsgId（全为 undefined），
  // 一旦拿它 findIndex，会一律命中"第一条 undefined"的媒体，导致点最后一张却定位到最前、翻页错乱/卡死。
  // 仅本地待发件（convSeq=0）无 convSeq，回退用其本地生成的 clientMsgId。见 album.ts msgKey。
  const viewerList = viewer
    ? messages.filter((mm) => isViewableMedia(mm) && !!mm.content)
    : [];
  const viewerIdx = viewer ? viewerList.findIndex((mm) => msgKey(mm) === msgKey(viewer.m)) : -1;
  const goViewer = (delta: number) => {
    if (viewerIdx < 0) return;
    const ni = viewerIdx + delta;
    if (ni < 0 || ni >= viewerList.length) return;
    setViewerMore(false); // 翻页收起「更多」浮层，避免停留在上一张的菜单上
    setViewer((v) => (v ? { m: viewerList[ni], fromGallery: v.fromGallery } : v));
  };
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      // 视频获焦时把 ←/→ 让给原生播放器做 ±5s 跳转，不劫持为翻页（点箭头仍可翻页）。
      if (document.activeElement instanceof HTMLVideoElement) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goViewer(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goViewer(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, viewerIdx, viewerList.length]);
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
        // 停在首条未读（分割线滚到容器顶）。不用 Element.scrollIntoView——它会沿祖先链一路把
        // 能滚的都滚，含 html/#root，导致整个 .app 被顶出视口、顶部与卡片间距"塌陷"（刷新才复位）；
        // 改为只动 .msgs 自身的 scrollTop，把分割线顶对齐到容器顶，滚动严格限定在消息容器内。
        box.scrollTop += dividerRef.current.getBoundingClientRect().top - box.getBoundingClientRect().top;
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
      // 重新评估「跳底钮」：loadNewer 追加内容后若用户仍视觉贴底，隐藏按钮
      //（早退不重算就会一直显示，即便用户已被自动带回底部）。
      const nearBottomPx = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      if (nearBottomPx) { setShowJump(false); setJumpCount(0); }
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

  // 图片/视频是异步加载的：贴底 useLayoutEffect 触发时元素高度≈0，加载完成后气泡才撑高，
  // 而依赖数组里没有值随之改变 → effect 不重跑 → 媒体被挤出视口下方（发图/发视频不贴底，问题2）。
  // 故媒体加载完成后，若此前处于贴底状态则再贴一次底。图片(onLoad)/视频(onLoadedData)共用此回调。
  const onMediaLoad = useCallback(() => {
    const box = msgsRef.current;
    if (box && wasNearBottomRef.current) box.scrollTop = box.scrollHeight;
  }, []);

  // 可见即读（CHAT_UX §6 完整语义）：扫描在视口内的消息，取最大 conv_seq；超过已滚入位点则节流上报。
  // 同时把"↓N"更新为视口下方仍未读的对端消息数（随滚动递减，滚到底为 0）。
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
    // 按钮显示只看「视觉贴底」（与 iOS updateJumpButton 对齐）——若 moreBelow=true 亦一并纳入
    // 判定，会出现「用户视觉已在最底部，但按钮仍显」的伪 bug（未读多/大群/进会话瞬间 push 到达时高发）：
    // 视觉贴底后 L1792 会自动 loadNewer 追齐，此时不必弹按钮打扰。
    // wasNearBottomRef 语义同源：新内容到来时是否贴底跟随（onMediaLoad / layout effect 共用）。
    wasNearBottomRef.current = nearBottomPx;
    setShowJump(!nearBottomPx);
    if (nearBottomPx) setJumpCount(0);

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
    // 无条件先滚一次消除假死（500人大群必现）：openConversation 拉回一页若全命中 seen → mergeMetaBySeq 不改 messages.length → layout effect 不重跑 → pendingScrollRef 卡住。真新消息到达时 layout effect 会再精修。
    box.scrollTop = box.scrollHeight;
    if (newest < latestSeqRef.current) {
      setEntryUnread(0);
      forceBottomRef.current = true;
      pendingScrollRef.current = true;
      clientRef.current?.openConversation(cid, latestSeqRef.current, latestSeqRef.current);
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
  const toggleUploadPauseEv = useEvent(toggleUploadPause);
  const toggleSelectedEv = useEvent(toggleSelected);
  const fetchLinkPreviewEv = useEvent(fetchLinkPreview);
  const onMediaLoadEv = useEvent(onMediaLoad);
  const jumpToBottomEv = useEvent(jumpToBottom);
  const unblockEv = useEvent(unblock);
  const exitSelectModeEv = useEvent(exitSelectMode);
  const forwardSelectedEv = useEvent(forwardSelected);
  const deleteSelectedEv = useEvent(deleteSelected);
  const favoriteSelectedEv = useEvent(favoriteSelected);
  const removePastedImageEv = useEvent(removePastedImage);
  const cancelAttachCloseEv = useEvent(cancelAttachClose);
  const scheduleAttachCloseEv = useEvent(scheduleAttachClose);
  const pickFileEv = useEvent(pickFile);
  const openFavoritesPickEv = useEvent(openFavoritesPick);
  const onFilePickedEv = useEvent(onFilePicked);
  const pickMentionEv = useEvent(pickMention);
  const onInputChangeEv = useEvent(onInputChange);
  const onComposerPasteEv = useEvent(onComposerPaste);
  const sendEv = useEvent(send);
  // Web P1 语音：上传 ?as=voice → sendMedia contentType=voice + waveform，**发出即乐观回显一行**
  // （status=sending，applyAck 按 clientMsgId 转 sent/failed）。此前没有回显行，ack patch 落空，
  // 发送后要刷新页面才看得到（2026-08-26 修）。
  const sendVoice = useCallback(async (blob: Blob, fileName: string, waveformBase64: string, durationMs: number) => {
    const client = clientRef.current;
    const cid = convId;
    if (!client || !cid) return;
    try {
      const { url, size } = await client.uploadVoice(blob, fileName);
      const clientMsgId = client.sendMedia(url, "voice", peer || "", cid, {
        duration: durationMs, fileSize: size, waveform: waveformBase64,
      });
      appendMsg(cid, {
        clientMsgId, convId: cid, from: uid, content: url, contentType: "voice",
        duration: durationMs, waveform: waveformBase64, fileSize: size,
        convSeq: 0, timestamp: Date.now(), status: "sending",
      });
    } catch (e) {
      setToast((e as Error).message || "语音发送失败");
    }
  }, [convId, peer, uid, appendMsg]);
  const sendVoiceEv = useEvent(sendVoice);

  const chatActions = useMemo<ChatActions>(() => ({
    setMenu, setViewer, setInput, setRecordStack, setToast, locateInChat: locateInChatEv,
    onGateTap: onGateTapEv, onMediaBubbleTap: onMediaBubbleTapEv, openReadyFile: openReadyFileEv, onPassiveMediaError: onPassiveMediaErrorEv,
    retryUpload: retryUploadEv, toggleUploadPause: toggleUploadPauseEv, toggleSelected: toggleSelectedEv, fetchLinkPreview: fetchLinkPreviewEv,
    onMediaLoad: onMediaLoadEv, pendingFilesRef,
    jumpToBottom: jumpToBottomEv, unblock: unblockEv, setEditingMsg, setReplyTo, exitSelectMode: exitSelectModeEv,
    forwardSelected: forwardSelectedEv, deleteSelected: deleteSelectedEv, favoriteSelected: favoriteSelectedEv, removePastedImage: removePastedImageEv,
    cancelAttachClose: cancelAttachCloseEv, scheduleAttachClose: scheduleAttachCloseEv, setAttachPanel, pickFile: pickFileEv,
    openFavoritesPick: openFavoritesPickEv, onFilePicked: onFilePickedEv, setMentionFilter, pickMention: pickMentionEv,
    setMentionActive, onInputChange: onInputChangeEv, onComposerPaste: onComposerPasteEv, send: sendEv,
    sendVoice: sendVoiceEv,
    attachAnchorRef, fileInputRef, mentionPanelRef, mentionActiveRef, composerRef,
  // 全部成员身份恒定 → 依赖为空，Context 值只建一次。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // 二维码簇 → useQR（阶段 7c）：openPeerDetail 定义在早退后，经 ref 注入（定义处回写 .current）。
  const openPeerDetailRef = useRef<(peer: string) => void>(() => {});
  const { qrScan, setQrScan, qrCardModal, setQrCardModal, qrResult, setQrResult, handleScanRaw, openMyCard, openGroupCard, resetQRCard, qrResultActions } =
    useQR({ phase, uid, myInfo, groupInfos, clientRef, setToast, openChat, openGroupChat, refreshFriends, refreshConversations, openPeerDetailRef });

  // ---- 登录 ----
  if (phase === "login") {
    return (
      <LoginView
        restoring={restoring} uid={loginName} nickname={nickname} password={password}
        authErr={authErr} authBusy={authBusy} loginTab={loginTab}
        onUid={setLoginName} onNickname={setNickname} onPassword={setPassword} onLoginTab={setLoginTab}
        onLogin={(pwd) => void enterApp(loginName, pwd)} onRegister={() => void doRegister()}
        onQRLogin={(loginUid, token) => {
          pendingQrRef.current = { uid: loginUid, token };
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
  const accepted = friends.filter((f) => f.status === "accepted").sort((a, b) => b.updated_at - a.updated_at);
  // 本地过滤好友：命中备注 / 昵称 / uid 任一（子串，大小写不敏感）。空串=不过滤。
  const contactFilterQ = contactFilter.trim().toLowerCase();
  const filteredAccepted = contactFilterQ
    ? accepted.filter((f) =>
        (f.remark || "").toLowerCase().includes(contactFilterQ) ||
        (f.nickname || "").toLowerCase().includes(contactFilterQ) ||
        f.user_id.toLowerCase().includes(contactFilterQ))
    : accepted;
  const incomingCount = incoming.length;
  const labelOf = (id: string, nick: string) => (nick && nick.trim()) || id; // 有昵称显昵称，否则显 uid
  // 好友显示名优先级：备注名 > 昵称 > uid（§头像/显示名规则）。
  const friendLabel = (f: FriendEntry) => (f.remark && f.remark.trim()) || (f.nickname && f.nickname.trim()) || f.user_id;
  // 会话对端显示名优先级：备注 > 昵称 > uid。
  const convLabel = (c: Conversation) => (c.peer_remark && c.peer_remark.trim()) || (c.peer_nickname && c.peer_nickname.trim()) || c.peer;
  // 会话列表项显示名/头像（群聊 vs 单聊）。**定义前置**：首页全局搜索派生（homeConvHits）在下方更早处引用，
  // 若留在原位置会 TDZ「Cannot access 'convDisplayLabel' before initialization」——有会话时输入搜索即白屏（2026-08-20 修）。
  const convDisplayLabel = (c: Conversation) => (c.is_group ? ((c.remark || "").trim() || c.name || "群聊") : convLabel(c));
  const convAvatarUrl = (c: Conversation) => (c.is_group ? c.avatar_url : c.peer_avatar_url);
  // 对端头像/昵称多来源兜底（会话 > 好友 > 任一群成员表 > 搜索结果）：从没聊过的群成员点开单聊/资料卡时
  // 没有会话行，头像/名字需从其它内存来源回退，否则只显示首字母圈/uid（群里气泡却正常）。
  const peerSources = () => ({ conversations, friends, groups: Object.values(groupInfos), search: searchResults });
  const peerAvatar = (id: string) => resolvePeerAvatar(id, peerSources());
  const peerNick = (id: string) => resolvePeerNickname(id, peerSources());
  // 当前聊天对端的会话项与显示名（聊天页标题/备注预填用）。
  const peerConv = conversations.find((c) => c.peer === peer);
  const peerLabel = peerConv ? convLabel(peerConv) : (peerNick(peer) || peer);
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
    // 见 docs/SYSTEM_NOTICE_SESSION_DESIGN.md §5.2；服务端也会拒 send_msg to=system（护栏 §2.2）。
    if (!isGroupChat && peer === SYSTEM_UID) return "此会话不支持回复";
    if (!isGroupChat || !activeGroupInfo) return null;
    if ((activeGroupInfo.my_mute_until ?? 0) > Date.now()) return "你已被管理员禁言";
    if ((activeGroupInfo.mute_until ?? 0) > Date.now() && activeGroupInfo.my_role === "member") return "本群已开启全员禁言";
    return null;
  })();

  const activeGroupConv = groupConvId ? conversations.find((c) => c.conv_id === groupConvId) : undefined;
  // 群备注（G1，仅本人可见）——**服务端多端同步**：从会话列表状态读该会话的 remark（随 /conversations 拉取，
  // conv_update 后自动刷新）。定义在 chatTitle/详情用它之前，避免 TDZ。
  const groupRemark = (cid: string): string =>
    (conversations.find((c) => c.conv_id === cid)?.remark || "").trim();
  const chatTitle = isGroupChat
    ? (groupRemark(groupConvId) || activeGroupInfo?.name || activeGroupConv?.name || "群聊")
    : peerLabel;
  const chatMemberCount = activeGroupInfo?.members.length ?? activeGroupConv?.member_count ?? 0;
  const chatAvatarURL = isGroupChat
    ? (activeGroupInfo?.avatar_url || activeGroupConv?.avatar_url)
    : (peerConv?.peer_avatar_url || peerAvatar(peer));
  const chatSubtitle = isGroupChat
    ? (chatMemberCount > 0 ? `${chatMemberCount} 位成员` : "群聊")
    // 单聊：真实在线态（原先「最近上线」是写死的假文案，对谁都显示）。取不到快照时为空串，不占位。
    : presenceText(presence[peer]);
  // 群成员昵称（气泡回退用）：优先消息自带 from_nickname，其次成员表缓存，最后 uid。
  const memberNick = (cid: string, id: string): string => {
    const m = groupInfos[cid]?.members.find((x) => x.user_id === id);
    // 群昵称优先（G1），回退全局昵称；都无返回空串让调用方回退 uid。
    return (m?.group_nickname && m.group_nickname.trim()) || (m?.nickname && m.nickname.trim()) || "";
  };
  // 群 typing 显示昵称（对齐 iOS `IMChatViewController+Socket.m` `im_navigationSubtitle`）：
  /** 某人在**本机**的显示名：备注 > 群昵称/全局昵称 > fallback（一般是服务端字面）> uid。
   *  系统消息里的名字、引用条发送者、typing 副标题共用；会发出去的内容一律不经过这里。 */
  const localNameOf = (id: string, cid: string, fallback?: string): string =>
    displayNameOf(id, remarks, memberNick(cid, id) || fallback);

  // 单聊固定"正在输入"；群里覆盖式记最新一位打字者，副标题拼「{昵称} 正在输入」，昵称找不到回退 uid。
  // 声明放在 memberNick / localNameOf 之后：IIFE 立即执行，二者必须先在作用域里初始化，否则命中 TDZ。
  const visibleChatSubtitle = (() => {
    if (!convId || !typingConv || typingConv.convId !== convId) return chatSubtitle;
    if (!isGroupChat) return "正在输入";
    // 备注优先（本机显示）：列表/气泡都显备注了，副标题还显真名会显得是另一个人。
    return `${localNameOf(typingConv.uid, convId, typingConv.uid)} 正在输入`;
  })();
  const senderLabel = (m: ChatMessage): string =>
    displayNameOf(m.from, remarks, m.fromNickname || memberNick(m.convId, m.from));
  /** 群成员在**本机**列表里的显示名：备注 > 群昵称 > 全局昵称 > uid。
   *  成员列表/已读回执/成员菜单确认文案都用它；会发出去的内容（@token 等）仍用公开名。 */
  const groupMemberLabel = (m: { user_id: string; group_nickname?: string; nickname?: string }): string =>
    displayNameOf(m.user_id, remarks, m.group_nickname || m.nickname);
  // 发送者在本群的角色（群主/管理员气泡徽标用）：**优先本群成员表的当前角色**（晋升/降级后老消息随之变化，
  // 微信式）；成员表未加载 / 发送者已退群查不到时，回退消息自带 from_role（仅 owner/admin 冗余下发）兜底。
  const senderRole = (m: ChatMessage): "owner" | "admin" | undefined => {
    const gm = groupInfos[m.convId]?.members.find((x) => x.user_id === m.from);
    const role = gm?.role ?? m.fromRole;
    return role === "owner" ? "owner" : role === "admin" ? "admin" : undefined;
  };
  // 群成员头像 URL（气泡左侧头像列用）：从群资料成员表按 uid 取；无则空（Avatar 回退首字母圈）。
  const senderAvatar = (m: ChatMessage): string | undefined =>
    groupInfos[m.convId]?.members.find((x) => x.user_id === m.from)?.avatar_url;
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

  // 会话列表项显示名/头像/预览（群聊 vs 单聊）——convDisplayLabel/convAvatarUrl 已上移至 convLabel 之后（见那里注释）。
  // 收藏来源显示名（副行「来自X」）：本人→我；好友→备注/昵称；群成员→群昵称/昵称；否则 uid（按 UI.md 优先级）。
  const favSourceLabel = (f: Favorite): string => {
    if (!f.source_from) return "未知";
    if (f.source_from === uid) return "我";
    const fr = friends.find((x) => x.user_id === f.source_from);
    if (fr) return friendLabel(fr);
    return memberNick(f.source_conv_id, f.source_from) || f.source_from;
  };
  const mediaPreview = (ct: string, extra?: { duration?: number }): string | null => {
    if (ct === "image") return "[图片]";
    if (ct === "video") return "[视频]";
    if (ct === "file") return "[文件]";
    if (ct === "chat_record") return "[聊天记录]";
    if (ct === "voice") {
      const ms = extra?.duration ?? 0;
      const s = Math.max(0, Math.floor(ms / 1000));
      return `[语音] ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    return null;
  };
  const convPreview = (c: Conversation): string => {
    if (!c.last_message) return "（无消息）";
    // 预览里的人名也走本机显示名（备注 > 群昵称 > 昵称 > uid）——否则列表显真名、点进会话显备注，
    // 同一句话两副面孔。这里只替换名字，不挂点击（预览是纯文本）。
    const lastName = (fallback?: string) =>
      displayNameOf(c.last_message!.from, remarks, fallback || memberNick(c.conv_id, c.last_message!.from));
    // 撤回消息预览（后端已脱敏 content）：显示"撤回了一条消息"（微信式）。
    if (c.last_message.recalled_at) {
      const who = c.last_message.from === uid ? "你" : (c.is_group ? lastName(c.last_message.from_nickname) : "对方");
      return `${who}撤回了一条消息`;
    }
    const media = mediaPreview(c.last_message.content_type, { duration: c.last_message.duration }); // 图片/视频/文件/语音 → [图片]/... voice 带 m:ss
    // 系统消息：按分段拼，名字换成本机显示名；无分段（历史消息）回退整句。无发送者前缀。
    if (c.last_message.content_type === "system") {
      return c.last_message.sys_segments?.length
        ? c.last_message.sys_segments
            .map((seg) => (seg.uid ? displayNameOf(seg.uid, remarks, memberNick(c.conv_id, seg.uid) || seg.text) : seg.text))
            .join("")
        : c.last_message.content;
    }
    // 图说 caption「有字显字」（Telegram 模型）：图文/视频文/文件文带 caption 时预览直接显 caption，否则回退 [图片]/[视频]/[文件]。
    const text = c.last_message.caption || media || c.last_message.content;
    if (!c.is_group) return text;
    const who = c.last_message.from === uid ? "我" : lastName(c.last_message.from_nickname);
    return `${who}: ${text}`;
  };

  // 群动作统一包装：执行 → 刷新群资料 + 会话列表；失败 alert。
  // 打开「群聊」列表弹窗（通讯录入口）。
  const openGroupsModal = async () => {
    try {
      const list = await clientRef.current?.listGroups();
      setGroupsModal(list ?? []);
    } catch (e) {
      setToast(`加载群列表失败：${(e as Error).message}`);
    }
  };

  // 加载详情页签数据源（本地历史消息，供 媒体/文件/链接 页签过滤）。
  const loadDetailMsgs = (cid: string) => {
    void loadConversation(uid, cid).then(setDetailMsgs).catch(() => setDetailMsgs([]));
  };

  // 打开群聊详情面板（拉最新资料 + 本地消息）。默认页签=成员（对齐 iOS 群聊成员恒第一）。
  const openGroupPanel = (cid: string) => {
    setManageOpen(false); setDetailMore(false); setDetailTab("members");
    setDetail({ convId: cid, isGroup: true });
    setDetailMsgs([]); loadDetailMsgs(cid);
    void refreshGroupInfo(cid);
  };

  // 打开单聊详情面板（对方资料）。默认页签=媒体。
  // fromOwnChat=true 表示从该会话自己的聊天页顶栏进来 → 不显示「消息」入口（已经在这个会话里了）。
  // 群成员列表 / 群聊气泡头像等外部入口保持 false，仍给「消息」发起单聊（与 iOS showsMessagePill 一致）。
  const openPeerDetail = (peer: string, fromOwnChat = false) => {
    if (!peer || peer === uid) return;
    const cid = convIdFor(uid, peer);
    setManageOpen(false); setDetailMore(false); setDetailTab("media");
    setDetail({ convId: cid, isGroup: false, peer, fromOwnChat });
    setDetailMsgs([]); loadDetailMsgs(cid);
  };
  openPeerDetailRef.current = openPeerDetail; // 供 useQR（早退前调用）在点击时取到早退后定义的函数

  // 清空聊天记录（仅本机，对齐 iOS）：清 IndexedDB → 通知聊天区刷新 → 关面板。
  const doClearHistory = (cid: string) => {
    void (async () => {
      if (!(await askConfirm("清空聊天记录？将删除此会话在本机的全部消息，且无法恢复。", { okText: "清空", danger: true }))) return;
      await clearMessages(uid, cid);
      clearConv(cid); // 内存同步清空（当前会话/缓存）
      setDetailMsgs([]);
      setToast("聊天记录已清空");
    })();
  };

  // 解散群（仅群主，二次确认）。
  const doDissolveGroup = (cid: string) => {
    void (async () => {
      if (!(await askConfirm("删除并解散该群？所有成员将被移出，且不可恢复。", { okText: "解散", danger: true }))) return;
      try {
        await clientRef.current!.dissolveGroup(cid);
        setDetail(null);
        setGroupInfos((prev) => { const { [cid]: _drop, ...rest } = prev; return rest; });
        if (currentConvRef.current === cid) deselect();
        void refreshConversations();
      } catch (e) { setToast(`解散失败：${(e as Error).message}`); }
    })();
  };

  // 点拒收系统行的「发送好友申请」（非好友 200103 的恢复入口，微信式）。
  // 服务端 Request 对「我侧陈旧 accepted」已放行——单向删除后被删方的唯一恢复路径。
  // 已直接成为好友时**不吐司**「已发送好友申请」——那会误导用户以为还要等对方通过。
  const requestFriendFromNote = async (target: string) => {
    try {
      const becameFriend = await clientRef.current!.requestFriend(target);
      await refreshFriends();
      setToast(becameFriend ? "已重新成为好友" : "已发送好友申请");
    } catch (e) {
      setToast((e as Error).message || "好友申请发送失败");
    }
  };

  // 单聊拉黑/取消拉黑（拉黑二次确认）。
  const doToggleBlock = (peer: string, block: boolean) => {
    void (async () => {
      if (block && !(await askConfirm("拉黑该联系人？拉黑后将不再收到对方消息。", { okText: "拉黑", danger: true }))) return;
      try {
        await clientRef.current!.friendAction(block ? "block" : "unblock", peer);
        void refreshFriends();
        setToast(block ? "已拉黑" : "已取消拉黑");
      } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
    })();
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
      setToast(`建群失败：${(e as Error).message}`);
    } finally {
      setCreateBusy(false);
    }
  };

  // 退出群聊（群主会被服务端拦：需先转让）。
  const doLeaveGroup = async (cid: string) => {
    if (!(await askConfirm("确定退出该群聊？", { okText: "退出", danger: true }))) return;
    try {
      await clientRef.current!.leaveGroup(cid);
      setDetail(null);
      setGroupInfos((prev) => { const { [cid]: _drop, ...rest } = prev; return rest; });
      if (currentConvRef.current === cid) deselect();
      void refreshConversations();
    } catch (e) {
      setToast(`退出失败：${(e as Error).message}`);
    }
  };

  // 打开黑名单弹窗（G2）：拉一次列表。
  const openGroupBans = async (cid: string) => {
    try {
      const bans = await clientRef.current!.fetchGroupBans(cid);
      setGroupBansModal({ convId: cid, bans });
      setGroupBans(bans);
    } catch (e) { setToast(`加载黑名单失败：${(e as Error).message}`); }
  };
  const doUnban = async (cid: string, userId: string) => {
    try {
      await clientRef.current!.unbanGroupMember(cid, userId);
      const bans = await clientRef.current!.fetchGroupBans(cid);
      setGroupBansModal({ convId: cid, bans });
      setGroupBans(bans);
      setToast("已解除");
    } catch (e) { setToast(`解除失败：${(e as Error).message}`); }
  };

  // ---- 二维码体系（QRCODE P0）----


  // ---- 入群审批（G3）----

  const openJoinRequests = async (cid: string) => {
    setJoinReqModal({ convId: cid, requests: [], loading: true });
    try {
      const requests = await clientRef.current!.fetchJoinRequests(cid, ""); // ""=全部（待处理 + 已处理分段）
      setJoinReqModal({ convId: cid, requests, loading: false });
    } catch (e) {
      setJoinReqModal(null);
      setToast(`加载入群申请失败：${(e as Error).message}`);
    }
  };
  const reloadJoinRequests = async (cid: string) => {
    try {
      const requests = await clientRef.current!.fetchJoinRequests(cid, "");
      setJoinReqModal((m) => (m && m.convId === cid ? { ...m, requests, loading: false } : m));
    } catch { /* 列表已关或无权限，忽略 */ }
  };
  const decideJoin = async (cid: string, userId: string, accept: boolean) => {
    try {
      await clientRef.current!.decideJoinRequest(cid, userId, accept);
      await reloadJoinRequests(cid);
      void refreshGroupInfo(cid); // 更新 pending_count 角标
      setToast(accept ? "已同意入群" : "已拒绝");
    } catch (e) { setToast(`操作失败：${(e as Error).message}`); }
  };

  // 我在本群的昵称（G1，任意成员）：走后端 → 刷新群资料（气泡回退名随之更新）。
  // 群备注（G1，仅本人可见）：改我看到的群名，**服务端多端同步**（PUT …/remark）。
  // 成功后重拉会话列表；conv_update 也会把变更同步到本人其它端与本机列表/标题。
  const doEditGroupRemark = async (gp: GroupInfo) => {
    const cur = groupRemark(gp.conv_id);
    const v = await askPrompt("群备注", cur, { placeholder: `${gp.name}（仅自己可见）`, okText: "保存", maxLength: 30 });
    if (v === null || v.trim() === cur) return;
    try {
      await clientRef.current?.setConvRemark(gp.conv_id, v.trim());
      logger.info(LOG_TAG.app, "group_remark_updated", { conv: gp.conv_id, len: v.trim().length });
      await refreshConversations(); // 列表状态更新 → chatTitle/列表项/详情行随 remark 重渲染
    } catch (e) {
      setToast(`保存备注失败：${(e as Error).message}`);
    }
  };

  // 设置群头像（仅群主/管理员，方案 C）：选图 → 圆形裁切 → 头像专用上传 → updateGroup 带新 URL。
  const pickGroupAvatar = (gp: GroupInfo) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setCropReq({
        file,
        onDone: async (blob) => {
          try {
            setToast("上传中…");
            const { url } = await clientRef.current!.uploadAvatar(blob);
            await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, gp.name, url, gp.intro ?? ""));
            setToast("群头像已更新");
          } catch (e) { setToast(`设置群头像失败：${(e as Error).message}`); }
        },
      });
    };
    input.click();
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
      // 按业务码分支（勿直接透传服务端 message，i18n）：300207 = 被邀请者已被移出/冷却期，
      // 用邀请场景的第三人称文案，区别于自加群映射表里的第二人称「你已被移出」。
      if (errorCode(e) === 300207) setToast("该成员已被移出本群，暂时无法再次邀请");
      // 300204 = 无邀请权（竞态：打开选择器后群主刚开启「仅管理员可邀请」）。后端此码下发英文默认文案，
      // 且 300204 多场景复用不宜在 FRIENDLY_MESSAGES 一刀切映射，故在此邀请场景就地给中文（对齐 iOS）。
      else if (errorCode(e) === 300204) setToast("群主已开启「仅管理员可邀请」，你无法邀请成员");
      else setToast(`邀请失败：${(e as Error).message}`);
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
      setToast(`保存备注失败：${(e as Error).message}`);
    }
  };
  const openFriendChat = (id: string) => { setTab("chats"); openChat(id); };

  // 左上角头像卡片的行（≈ Telegram Web 汉堡菜单；数据驱动：加一项 = append 一条）。
  // 「我的资料」不再单列——资料在设置页顶部展示、经铅笔进入编辑；退出登录移到设置页底部。
  const accountRows: Row[] = [
    { id: "settings", label: "设置", icon: Settings, chevron: true, onClick: () => { setAccountCard(false); setShowSettings(true); } },
    { id: "favorites", label: "收藏消息", icon: Bookmark, chevron: true, onClick: () => { setAccountCard(false); openFavorites(); } },
  ];

  // 设置列表（对齐 Telegram **Web** 版布局；数据驱动：加一行 = append 一条；接后端 = 换 onClick）。
  // Web 版条目与 iOS 版不同——各自镜像对应平台的 Telegram 客户端。
  const settingsGroups: Row[][] = [
    [
      { id: "general", label: "通用设置", icon: Settings2, iconTint: "gray", chevron: true, onClick: () => setGeneralOpen(true) },
      { id: "animations", label: "动画与性能", icon: Gauge, iconTint: "orange", chevron: true, onClick: () => comingSoon("动画与性能") },
      { id: "notifications", label: "通知", icon: Bell, iconTint: "red", chevron: true, onClick: () => comingSoon("通知") },
      { id: "data", label: "数据与存储", icon: Database, iconTint: "green", chevron: true, onClick: () => setDataStorageOpen(true) },
      { id: "privacy", label: "隐私与安全", icon: Lock, iconTint: "indigo", chevron: true, onClick: () => { setPrivacyOpen(true); void openBlacklist(); } },
      { id: "folders", label: "聊天文件夹", icon: Folder, iconTint: "blue", chevron: true, onClick: () => comingSoon("聊天文件夹") },
      { id: "devices", label: "已登录设备", icon: MonitorSmartphone, iconTint: "teal", chevron: true, onClick: () => { setDevicesOpen(true); void loadDevices(); } },
      { id: "language", label: "语言", icon: Languages, iconTint: "purple", value: "简体中文", chevron: true, onClick: () => comingSoon("语言") },
      { id: "stickers", label: "贴纸与表情", icon: Smile, iconTint: "pink", chevron: true, onClick: () => comingSoon("贴纸与表情") },
    ],
  ];

  // 设置页顶部名片下的资料卡（手机号/用户名）。
  const settingsInfoRows: Row[] = [
    { id: "phone", label: myInfo?.phone || "未设置", icon: Phone, iconTint: "green", value: "手机号", onClick: () => void openProfile() },
    // 显示的是**公开句柄**而非 uid——后者是 10 位随机内部 ID，`@4820571639` 对用户毫无意义。
    { id: "username", label: myInfo?.username ? `@${myInfo.username}` : "未设置", icon: AtSign, iconTint: "blue", value: "用户名", onClick: () => void openProfile() },
    { id: "qr", label: "我的二维码", icon: QrCode, iconTint: "gray", value: "", chevron: true, onClick: () => void openMyCard() },
  ];

  // 通讯录顶部入口行（数据驱动）。
  const contactEntries: Row[] = [
    { id: "groups", label: "群聊", icon: Users, iconTint: "blue", chevron: true, onClick: () => void openGroupsModal() },
    { id: "official", label: "公众号", icon: Megaphone, iconTint: "orange", chevron: true, onClick: () => comingSoon("公众号") },
    { id: "service", label: "服务号", icon: Headphones, iconTint: "teal", chevron: true, onClick: () => comingSoon("服务号") },
  ];

  return (
    <AppServicesProvider value={services}>
    <ChatActionsProvider value={chatActions}>
    <div className={`app ${peer || groupConvId ? "has-sel" : "no-sel"}`}>
      <aside className="sidebar">
        <header>
          <div className="account-anchor">
            <button className="account-menu-btn" title="菜单" aria-label="菜单"
              onClick={(e) => { e.stopPropagation(); setAccountCard((v) => !v); }}>
              <Menu size={22} />
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
          {/* 首页全局搜索框（SEARCH_DESIGN §3/§04）：输入即出「会话 / 联系人 / 聊天记录」三分组。 */}
          <div className="home-search">
            <Search size={15} className="home-search-lead" />
            <input className="home-search-input" value={search.homeSearch} placeholder="搜索"
              onChange={(e) => search.setHomeSearch(e.target.value)} />
            {search.homeSearch && <button className="home-search-clear" title="清除" onClick={() => search.setHomeSearch("")}><X size={14} /></button>}
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
          {conversations.length === 0 && <div className="empty">还没有会话，去「通讯录」找人发起一个吧</div>}
          {conversations.map((c) => (
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
                    {c.muted ? <BellOff size={12} className="conv-mute" /> : null}
                  </span>
                  <span className="convtime">
                    {!c.is_group && c.last_message?.from === uid && (
                      <span className={c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "convck read" : "convck"}>
                        {c.latest_conv_seq > 0 && c.latest_conv_seq <= (c.peer_read_seq ?? 0) ? "✓✓ " : "✓ "}
                      </span>
                    )}
                    {c.last_message ? formatTime(c.last_message.timestamp, timeFormat) : ""}
                  </span>
                </div>
                <div className="convlast">
                  {/* 群「@我」红字前缀（M4-8）：未读区间内被 @（含 @所有人）。不另加右侧红 @ 角标——左侧红字已够醒目。 */}
                  {c.is_group && c.mention_unread ? <span className="conv-mention">[有人@我]</span> : null}
                  {/* 待审入群角标（G3）：仅群主/管理员会收到 pending_count>0，一眼看到有人等待审批。 */}
                  {c.is_group && (c.pending_count ?? 0) > 0
                    ? <span className="conv-pending-badge">待审 {c.pending_count! > 99 ? "99+" : c.pending_count}</span>
                    : null}
                  {convPreview(c)}
                </div>
              </div>
              {/* 免打扰置灰未读数，但**被 @ 时破例回到高亮**——免打扰只压普通消息，不压 @我（M4-8）。
                  正在查看的会话未读一律按 0 渲染（c.conv_id === convId）：收到本会话新消息时，列表刷新(150ms)会
                  先拿到服务端 unread=1，而清未读靠可见即读(300ms 防抖 + markRead 往返)才落地，不屏蔽就会闪一下「1」。
                  屏蔽后与 read 往返彻底解耦，任何时序都不闪。 */}
              {c.conv_id === convId ? null
                : c.unread > 0
                ? <span className={`badge ${c.muted && !c.mention_unread ? "muted" : ""}`}>{c.unread > 99 ? "99+" : c.unread}</span>
                : c.marked_unread ? <span className={`badge dot ${c.muted ? "muted" : ""}`} aria-label="未读" /> : null}
            </div>
          ))}
          </>
          )}
        </div>
        ) : (
        <ContactsTab
          searchQ={searchQ} setSearchQ={setSearchQ} doSearch={doSearch} onScan={() => setQrScan(true)} contactEntries={contactEntries} contactsScrollRef={contactsScrollRef}
          searchResults={searchResults} friendStatus={friendStatus} labelOf={labelOf} openFriendChat={openFriendChat} busyUser={busyUser} doFriendAction={doFriendAction}
          incoming={incoming} accepted={accepted} filteredAccepted={filteredAccepted} contactFilter={contactFilter} setContactFilter={setContactFilter} contactFilterQ={contactFilterQ}
          friendLabel={friendLabel} presence={presence} setFriendMenu={setFriendMenu}
        />
        )}

        {/* 设置面板：见 components/settings/SettingsPanel（行数据与动作在上方组装）。 */}
        {showSettings && (
          <SettingsPanel
            avatarUrl={myInfo?.avatar_url}
            name={myInfo?.nickname || (myInfo?.username ? `@${myInfo.username}` : "未命名用户")}
            seed={uid}
            stateText={stateText}
            infoRows={settingsInfoRows}
            groups={settingsGroups}
            onBack={() => setShowSettings(false)}
            onEditProfile={() => void openProfile()}
            onLogout={logout}
          />
        )}

        {/* 数据与存储：见 components/settings/DataStoragePanel（Web 只呈现 Wi-Fi 档，注释在组件内）。 */}
        {dataStorageOpen && (
          <DataStoragePanel
            settings={dlSettings}
            cachedCount={Object.keys(dlBlobs).length + mediaOptedIn.size /* 已缓存 = 应用内 blob（文件）+ 已解门控图片/视频 */}
            onSave={saveDownloadSettings}
            onClearCache={clearMediaCache}
            onReset={() => {
              void askConfirm("恢复自动下载的出厂默认设置？", { okText: "恢复默认", danger: true }).then((ok) => {
                if (!ok) return;
                const c = clientRef.current;
                if (!c) return;
                void c.resetDownloadSettings()
                  .then((r) => setDlSettings(parseDownloadSettings(r?.settings)))
                  .catch((e: Error) => setToast(`重置失败：${e.message}`));
              });
            }}
            onBack={() => setDataStorageOpen(false)}
          />
        )}

        {/* 编辑资料面板：见 components/settings/EditProfilePanel。 */}
        {profileDraft && (
          <EditProfilePanel
            draft={profileDraft}
            uid={uid}
            busy={profileBusy}
            onChange={setProfileDraft}
            onSave={() => void saveProfile()}
            onPickAvatar={onPickAvatar}
            onBack={() => setProfileDraft(null)}
          />
        )}

        {/* 已登录设备子面板：见 components/settings/DevicesPanel（状态与操作来自 useDevices）。 */}
        {devicesOpen && (
          <DevicesPanel
            devices={devices}
            err={devicesErr}
            revokingSid={revokingSid}
            onRefresh={() => void loadDevices()}
            onRevoke={(d) => void revokeDevice(d)}
            onRevokeOthers={() => void revokeOtherDevices()}
            onBack={() => setDevicesOpen(false)}
          />
        )}

        {/* 隐私与安全容器页（拉齐 iOS）：黑名单 / 修改密码 + B~E 灰置占位。 */}
        {privacyOpen && (
          <PrivacySecurityPanel
            blockedCount={blockedList ? blockedList.length : null}
            onOpenBlocked={() => setBlockedOpen(true)}
            onOpenChangePwd={() => setChangePwdOpen(true)}
            onComingSoon={comingSoon}
            onBack={() => setPrivacyOpen(false)}
          />
        )}

        {/* 已屏蔽的用户子面板（从隐私页进入；数据/解除来自 useFriendOps）。 */}
        {blockedOpen && (
          <BlockedListPanel
            list={blockedList}
            busyUser={busyUser}
            friendLabel={friendLabel}
            onUnblock={(id) => void unblock(id)}
            onBack={() => setBlockedOpen(false)}
          />
        )}

        {/* 修改密码子面板（从隐私页进入）：成功后服务端自动下线其它设备。 */}
        {changePwdOpen && (
          <ChangePasswordPanel
            onSubmit={async (o, n) => { const c = clientRef.current; if (!c) throw new Error("未连接"); await c.changePassword(o, n); }}
            onDone={() => { setChangePwdOpen(false); setToast("✓ 密码已修改，其它设备已下线"); void loadDevices(); }}
            onBack={() => setChangePwdOpen(false)}
          />
        )}

        {/* 通用设置子面板：见 components/settings/GeneralPanel。 */}
        {generalOpen && (
          <GeneralPanel
            fontSize={fontSize} theme={theme} timeFormat={timeFormat} sendKey={sendKey}
            onFontSize={setFontSize} onTheme={setTheme} onTimeFormat={setTimeFormat} onSendKey={setSendKey}
            onOpenWallpaper={() => setWallpaperOpen(true)}
            onBack={() => setGeneralOpen(false)}
          />
        )}

        {/* 聊天壁纸 / 纯色编辑：见 components/settings/WallpaperPanel · WallpaperColorPanel。 */}
        {wallpaperOpen && (
          <WallpaperPanel
            wallpaper={wallpaper} isDark={isDark} blur={wallpaperBlur}
            onSelectPreset={(id) => setWallpaper({ kind: "preset", value: id })}
            onPickImage={pickWallpaperImage}
            onOpenColor={openWallpaperColor}
            onReset={resetWallpaper}
            onToggleBlur={() => setWallpaperBlur((value) => !value)}
            onBack={() => setWallpaperOpen(false)}
          />
        )}

        {wallpaperColorOpen && (
          <WallpaperColorPanel
            colorHSV={colorHSV}
            onApply={applyWallpaperColor}
            onSpectrum={updateColorFromSpectrum}
            onBack={() => setWallpaperColorOpen(false)}
          />
        )}
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
          <div className="msgs" ref={msgsRef} onScroll={onMsgsScroll}>
            <MessageList
                messages={messages} peer={peer} isGroupChat={isGroupChat} uid={uid}
                selectMode={selectMode} selected={selected} menu={menu} readSeq={readSeq} firstUnreadIdx={firstUnreadIdx}
                timeFormat={timeFormat} translations={translations} transcripts={transcripts} uploadProgress={uploadProgress} dividerRef={dividerRef}
                mediaGate={mediaGate} mediaSrc={mediaSrc} senderLabel={senderLabel} localNameOf={localNameOf} senderRole={senderRole} senderAvatar={senderAvatar}
                renderMentionText={renderMentionText} renderMessageText={renderMessageText}
                openPeerDetail={openPeerDetail} handleScanRaw={handleScanRaw} requestFriendFromNote={requestFriendFromNote}
              />
          </div>
          {/* 底部区（跳底/拉黑提示/编辑·引用条/多选栏/粘贴条/附件/@面板/输入框）：见 components/Composer（逻辑仍在 App）。 */}
          <Composer
            convId={convId} peer={peer} uid={uid} isGroupChat={isGroupChat} peerLabel={peerLabel} peerBlocked={peerBlocked}
            input={input} sendKey={sendKey} composerMuteReason={composerMuteReason} showJump={showJump} jumpCount={jumpCount}
            editingMsg={editingMsg} replyTo={replyTo} selectMode={selectMode} selected={selected} pastedImages={pastedImages}
            attachPanel={attachPanel} attachItems={attachItems} mentionQuery={mentionQuery} mentionFilter={mentionFilter}
            mentionRows={mentionRows} mentionActive={mentionActive} mediaGate={mediaGate} senderLabel={senderLabel} onMentionNavKey={onMentionNavKey}
          />
        </div>
        {!convId && <div className="main-empty">选择左侧的会话开始聊天</div>}
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
            if (viewer.m.caption) { void navigator.clipboard?.writeText(viewer.m.caption); setToast("已复制"); return; }
            // 图片：复制图片字节（可粘贴回输入框直接发图）；其余非视频：复制链接。
            if (viewer.m.contentType === "image") {
              copyImageToClipboard(viewer.m.content).then(() => setToast("已复制图片"))
                .catch(() => { void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast("已复制链接"); });
            } else {
              void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast("已复制链接");
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
          onCopy={() => { void navigator.clipboard?.writeText(textReader.content); setToast("已复制全文"); }}
          onClose={() => setTextReader(null)}
        />
      )}

      {/* 会话媒体库：见 components/modals/GalleryModal（items 为倒序可视媒体，最新在前）。 */}
      {galleryOpen && (
        <GalleryModal
          items={[...messages].filter(isViewableMedia).reverse()}
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
          onPick={sendFavoritesToCurrent}
          onPickLimit={setToast}
          onClose={closeFavorites}
          fetchLinkPreview={fetchLinkPreview}
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
          canGoBack={recordStack.length > 1}
          nestedAt={(i) => recordNested.get(i)}
          onBack={() => setRecordStack((s) => s.slice(0, -1))}
          onDrill={(sub) => setRecordStack((s) => [...s, sub])}
          onOpenMedia={(i, content, kind) => {
            setRecordStack([]);
            setViewer({ m: syntheticViewerMessage(`rec-${i}`, content, kind), fromGallery: true });
          }}
          onClose={() => setRecordStack([])}
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

      {menu && (
        <AnchoredMenu x={menu.x} y={menu.y} className="ctx-menu">
          {messageActions
            .filter((a) => a.visible({ m: menu.m, uid, isGroup: !!groupConvId && !peer, canPin: canPinHere, hasTranscript: transcripts[menu.m.convSeq] !== undefined }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => {
                  // 删除走统一两档路由（弹子菜单 B / 直接仅删自己 / 本地删），对齐详情页；其余动作照常。
                  if (a.id === "delete") { const mm = menu.m, x = menu.x, y = menu.y; setMenu(null); requestDelete(mm, x, y); return; }
                  a.run({ m: menu.m, uid, isGroup: !!groupConvId && !peer, canPin: canPinHere, hasTranscript: transcripts[menu.m.convSeq] !== undefined }); setMenu(null);
                }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </AnchoredMenu>
      )}

      {convMenu && (
        <AnchoredMenu x={convMenu.x} y={convMenu.y} className="ctx-menu">
          {conversationActions
            .filter((a) => a.visible({ c: convMenu.c }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => { a.run({ c: convMenu.c }); setConvMenu(null); }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </AnchoredMenu>
      )}

      {fileMenu && (() => {
        // 详情内容右键菜单（**文件/媒体/链接三 tab 共用**，成员除外；对齐 iOS 详情各 tab 长按）：
        // 转发 / 定位到聊天 / 取消下载（仅下载中）/ 删除（任务2 两档）。菜单对任意 ChatMessage 通用。
        const m = fileMenu.m;
        const downloading = dlStates[m.content]?.phase === "downloading";
        return (
          <AnchoredMenu x={fileMenu.x} y={fileMenu.y} className="ctx-menu">
            <button onClick={() => {
              setFileMenu(null); setForwardMode("each");
              // 资料页文件 tab 视角只显文件名，看不到源消息的 caption/mentions；若原样透传会把当年
              // 原发件人挂在同一条文件上的「@xxx 附言」意外带到目标会话（对齐 iOS forwardFileMessage:
              // stripCaption:YES）。主流长按/查看器/多选/收藏等看得到附言的入口不受影响，仍保留 caption。
              setForwarding([{ ...m, caption: undefined, mentions: undefined, mentionAll: false }]);
            }}>
              <Forward size={16} className="menu-icon" />转发</button>
            {/* 定位=回到聊天：只关会遮聊天的宿主（媒体库 / 查看器）；详情卡是右侧列不遮聊天，按用户要求保持不消失。 */}
            <button onClick={() => { setFileMenu(null); setGalleryOpen(false); setViewer(null); locateInChat(m.convId, m.convSeq); }}>
              <MessageCircle size={16} className="menu-icon" />定位到聊天</button>
            {downloading && (
              <button onClick={() => { setFileMenu(null); onGateTap(m); }}>
                <X size={16} className="menu-icon" />取消下载</button>
            )}
            {/* 删除统一走两档路由：可为所有人删则展开子菜单 B，否则直接仅删自己（不再在此平铺两项）。 */}
            <button className="danger" onClick={() => { const x = fileMenu.x, y = fileMenu.y; setFileMenu(null); requestDelete(m, x, y); }}>
              <Trash2 size={16} className="menu-icon" />删除</button>
          </AnchoredMenu>
        );
      })()}

      {deleteMenu && (() => {
        // 删除两档子菜单 B（由菜单 A 的「删除」展开，对齐 iOS 原生子菜单）：为所有人删除 / 仅删除自己。
        // ctx-submenu-in：A→B 的自然过渡动画（从锚点淡入 + 轻微缩放/上移）。
        const m = deleteMenu.m;
        return (
          <AnchoredMenu x={deleteMenu.x} y={deleteMenu.y} className="ctx-menu ctx-submenu-in">
            {/* 破坏性重的「为所有人删除」放最后（destructive-last，与消息/会话菜单约定一致，降低误触不可逆项）。 */}
            <button className="danger" onClick={() => { setDeleteMenu(null); void hideFileForMe(m); }}>
              <Trash2 size={16} className="menu-icon" />仅删除自己</button>
            <button className="danger" onClick={() => { setDeleteMenu(null); deleteFileForEveryone(m); }}>
              <Trash2 size={16} className="menu-icon" />为所有人删除</button>
          </AnchoredMenu>
        );
      })()}

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

      {/* 黑名单已从独立 Modal 收编为「隐私与安全 → 已屏蔽的用户」子面板（BlockedListPanel），此处不再渲染。 */}

      {/* 「群聊」列表 / 建群弹窗：见 components/modals/GroupsModal · CreateGroupModal。 */}
      {groupsModal !== null && (
        <GroupsModal
          groups={groupsModal} uid={uid}
          onCreate={() => setCreateDraft({ name: "", selected: [] })}
          onOpen={(cid) => { setGroupsModal(null); setTab("chats"); openGroupChat(cid); }}
          onClose={() => setGroupsModal(null)}
        />
      )}

      {createDraft && (
        <CreateGroupModal
          draft={createDraft} accepted={accepted} friendLabel={friendLabel}
          busy={createBusy} maxInitialMembers={MAX_INITIAL_MEMBERS}
          onChange={setCreateDraft}
          onCreate={() => void doCreateGroup()}
          onCancel={() => setCreateDraft(null)}
        />
      )}

      {/* 会话详情抽屉：见 components/DetailPanel（派生 + JSX 整块平移；稳定服务走 Context，其余动作按组注入）。 */}
      {detail && (
        <DetailPanel detail={detail}
          conversations={conversations} groupInfos={groupInfos} friends={friends} uid={uid}
          detailTab={detailTab} detailMsgs={detailMsgs} detailMore={detailMore} manageOpen={manageOpen} groupBans={groupBans}
          groupRemark={groupRemark} peerNick={peerNick} peerAvatar={peerAvatar} memberLabel={groupMemberLabel} mediaGate={mediaGate} mediaSrc={mediaSrc} canManageMember={canManageMember}
          onClose={() => { setDetail(null); setDetailMore(false); setManageOpen(false); }}
          setDetailTab={setDetailTab} setDetailMore={setDetailMore} setManageOpen={setManageOpen}
          setContactDraft={setContactDraft} setInviteDraft={setInviteDraft} setMemberMenu={setMemberMenu} setFileMenu={setFileMenu}
          doFriendAction={doFriendAction} openChat={openChat} openInChatSearch={() => search.openInChatSearch()}
          doClearHistory={doClearHistory} doToggleBlock={doToggleBlock} doLeaveGroup={doLeaveGroup} doDissolveGroup={doDissolveGroup}
          setConvPinned={setConvPinned} setConvMuted={setConvMuted} openGroupText={openGroupText} openGroupCard={openGroupCard}
          doEditMyGroupNickname={doEditMyGroupNickname} doEditGroupRemark={doEditGroupRemark} pickGroupAvatar={pickGroupAvatar}
          openJoinRequests={openJoinRequests} openGroupBans={openGroupBans} openPeerDetail={openPeerDetail}
        />
      )}

      {/* 邀请成员弹窗：见 components/modals/InviteMembersModal（候选=非群内好友）。 */}
      {inviteDraft && (() => {
        const inGroup = new Set((groupInfos[inviteDraft.convId]?.members ?? []).map((m) => m.user_id));
        const candidates = accepted.filter((f) => !inGroup.has(f.user_id));
        return (
          <InviteMembersModal
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

      {/* 群成员管理 ⋯ 菜单（按角色矩阵显隐；服务端仍会二次校验）。 */}
      {memberMenu && groupInfos[memberMenu.convId] && (
        <MemberMenu menu={memberMenu} gp={groupInfos[memberMenu.convId]} uid={uid} friends={friends} memberLabel={groupMemberLabel}
          menuRef={memberMenuRef} onClose={() => setMemberMenu(null)} onOpenChat={openChat}
          onFriendAction={(userId, fn) => void doFriendAction(userId, fn)} onMutePick={setMuteDurationFor} />
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
        const isAnn = fullTextModal.kind === "announcement";
        const text = (isAnn ? gp.announcement : gp.intro) ?? "";
        const byName = isAnn && gp.announcement_by ? (memberNick(gp.conv_id, gp.announcement_by) || gp.announcement_by) : "";
        const at = isAnn ? (gp.announcement_at ?? 0) : 0;
        const meta = isAnn && (byName || at > 0)
          ? `${byName}${byName && at > 0 ? " · " : ""}${at > 0 ? `${fmtDateTime(at)} 发布` : ""}`
          : undefined;
        const close = () => setFullTextModal(null);
        return (
          <GroupTextModal
            isAnnouncement={isAnn}
            text={text}
            meta={meta}
            canEdit={isAnn && gp.my_role !== "member"}
            onCopy={() => navigator.clipboard?.writeText(text).then(() => setToast("已复制"), () => setToast("复制失败"))}
            onEdit={() => { close(); void doEditAnnouncement(gp); }}
            onClose={close}
          />
        );
      })()}

      {/* 应用内确认/输入弹窗：见 components/Dialogs（状态在 useDialogs）。 */}
      {confirmDlg && <ConfirmDialog dlg={confirmDlg} set={setConfirmDlg} />}
      {promptDlg && <PromptDialog dlg={promptDlg} set={setPromptDlg} />}

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
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;
  return `${d.getFullYear()}年${md} ${hm}`;
}

// 消息列表里的最大 conv_seq（发送中的 0 不计）。
function maxSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > m) m = x.convSeq;
  return m;
}

