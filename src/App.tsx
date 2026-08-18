import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { IMClient, registerAccount, type ConnState } from "./sdk/imSdk";
import { chunkedTaskFor } from "./sdk/chunkedUpload";
import { loadConversation, clearMessages, markMessageDeleted } from "./sdk/localStore";
import { convIdFor, type ChatMessage, type Conversation, type FriendEntry, type UserCard, type GroupInfo, type GroupMember, type GroupSummary, type Favorite, type PinnedMessage, type GroupBan, type QRCard, type QRResolved, type JoinRequest } from "./sdk/protocol";
import { QRCardModal, QRScannerModal, QRResultModal, JoinRequestsModal, QRLoginTab } from "./QRUI";
import { errorCode } from "./qr";
import { platformIcon, deviceName, deviceSubtitle } from "./devices";
import { activeMentionQuery, applyMentionToken, resolveMentions, resolveMentionAll, filterMentionMembers, canMentionAll, countsAsUnread, segmentMentions, MENTION_ALL_LABEL, type MentionCandidates } from "./mention";
import { resolveDetailFollow } from "./detailFollow";
import { resolvePeerAvatar, resolvePeerNickname } from "./peerAvatar";
import { toggleCapped } from "./selection";
import { pinnedPreview, pinnedSenderLabel, nextPinnedIndex, clampPinnedIndex } from "./pinned";
import AvatarCropper from "./AvatarCropper";
import { isOnline, presenceFromConversation, presenceText, type Presence } from "./sdk/presence";
import { attachmentContentType, shouldSendAsMediaBatch, type AttachmentPickMode } from "./attachments";
import { buildMessageActions, buildConversationActions, type MenuAction, type MessageCtx } from "./menus";
import { albumMembers, isAlbumLeader, isAlbumMember, isViewableMedia, mediaIdentity, resolveJumpTarget } from "./album";
import { formatTime } from "./time";
import { FileTypeIcon } from "./FileTypeIcon";
import { VirtualList } from "./VirtualList";
import { mediaKindForFile, webCanRenderMedia, MEDIA_PICKER_ACCEPT } from "./fileTypes";
import { textTier, charCountLabel } from "./longtext";
import { formatFileSize } from "./fileMetadata";
import { formatMediaDuration, formatUploadProgress, makeTinyThumbFromImage, probeMediaMetadata } from "./media";
import {
  applyTier, defaultDownloadSettings, downloadGlyph, downloadText, isDefaultDownloadSettings, parseDownloadSettings,
  shouldAutoDownload, tierOfPolicy, MAX_AUTO_BYTES,
  type DownloadSettings, type DownloadState, type SpeedTier, type MediaKind,
} from "./download";
import { cachePutBlob, cacheMatchBlob, cacheClear, loadStrSet, saveStrSet, expiredKey, downloadedFilesKey } from "./mediaCache";
import { WALLPAPER_PRESETS, DEFAULT_WALLPAPER, loadWallpaper, resolveWallpaper, wallpaperCSS, type WallpaperChoice } from "./wallpaper";
import { COLOR_PRESETS, clamp, hsvToHex, hexToHSV, hexToRGB, type HSVColor } from "./color";
import {
  isUrlText, localizeSnippet, replyPreviewOf, selectableInMultiSelect,
  parseChatRecord, recordItemPreview, fileNameFromContent, copyImageToClipboard,
  mediaBoxProps, isPreviewableFile, videoFrameSrc, type RecordItem, type ChatRecord,
} from "./messageContent";
import { Avatar } from "./components/Avatar";
import { AlbumGrid } from "./components/AlbumGrid";
import { QuoteThumb, QuoteSnapshotIcon } from "./components/QuoteThumb";
import { AnchoredMenu } from "./components/AnchoredMenu";
import { FileGateIcon } from "./components/FileGateIcon";
import { LinkCard, type LinkPreview } from "./components/LinkCard";
import { SESSION_KEY, loadSession } from "./session";
import { optedInKey, loadOptedIn, saveOptedIn } from "./optedIn";
import { captureVideoPoster } from "./videoPoster";
import { useDevices } from "./useDevices";
import { useDialogs } from "./useDialogs";
import { useToast } from "./useToast";
import { LOG_TAG, logger, setLogContext } from "./logging/logger";
import type { LucideIcon } from "lucide-react";
import {
  Settings, Bookmark, Settings2, Gauge, Bell, Database, Lock, Folder,
  MonitorSmartphone, Languages, Smile, Phone, AtSign, Users, Megaphone,
  Headphones, ChevronLeft, ChevronRight, SquarePen, Check,
  MoreVertical, Video, Ban, Trash2, CheckSquare, BellOff, Menu,
  Image as ImageIcon, UserPlus, LogOut, Info, Pin, PinOff, List,
  Download, LayoutGrid, MoreHorizontal, Play,
  Search, Camera, FileText, Link2, MessageCircle, X, Pipette, Star, Forward, Eye,
  ChevronDown, ChevronUp, Copy, QrCode, RefreshCw,
} from "lucide-react";

type Phase = "login" | "app"; // 登录页 / 双栏主界面（左列表 + 右聊天，Telegram 桌面式）
type Tab = "chats" | "contacts"; // 左栏顶部：会话列表 / 通讯录

// 群成员上限（含群主），与后端 group.MaxGroupMembers=500 对齐（该值不由接口下发，两端各自硬编码）。
// 建群时群主已占 1 席，故初始成员（好友）最多可选 MAX_GROUP_MEMBERS-1；超限由服务端 GroupMemberLimit 兜底拒绝。
const MAX_GROUP_MEMBERS = 500;
const MAX_INITIAL_MEMBERS = MAX_GROUP_MEMBERS - 1;
// 转发目标会话上限：一次最多转给 9 个会话，与 iOS kIMForwardMaxSelection / 微信一致。
const MAX_FORWARD_TARGETS = 9;

export default function App() {
  const [phase, setPhase] = useState<Phase>("login");
  const [uid, setUid] = useState(() => loadSession()?.uid || "1001");
  const [password, setPassword] = useState(""); // 登录密码（空=走开发期免密）
  const restoreRef = useRef<{ uid: string; pwd: string; token?: string } | null>(loadSession()); // 待静默重登的已存会话
  const [restoring, setRestoring] = useState(() => !!restoreRef.current); // 恢复中：登录页显示过渡态
  const [authBusy, setAuthBusy] = useState(false); // 登录/注册请求进行中
  const [authErr, setAuthErr] = useState(""); // 登录/注册错误文案
  const [loginTab, setLoginTab] = useState<"password" | "qr">("password"); // 登录页页签：密码 / 扫码
  // 扫码登录待入场会话：poll 领到 {uid,token} 后先 setUid 再由 effect 用新 uid 闭包跑 enterApp。
  const pendingQrRef = useRef<{ uid: string; token: string } | null>(null);
  const [qrTrigger, setQrTrigger] = useState(0);
  const [state, setState] = useState<ConnState>("disconnected");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [msgsByConv, setMsgsByConv] = useState<Record<string, ChatMessage[]>>({});
  const [peer, setPeer] = useState("");
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState<Record<string, Presence>>({}); // user -> 在线态（租约模型，见 sdk/presence.ts）
  const [, setPresenceTick] = useState(0); // 仅用于驱动在线态重算的心跳，见下方 useEffect
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
  const [forwardMode, setForwardMode] = useState<"each" | "merged">("each"); // 逐条 / 合并转发
  const [forwardMulti, setForwardMulti] = useState(false); // 转发选择器：多选目标会话模式（对齐 iOS「多选」）
  const [forwardTargets, setForwardTargets] = useState<string[]>([]); // 多选选中的目标 conv_id（有序，上限 MAX_FORWARD_TARGETS）
  // 合并转发详情弹窗：栈式，支持嵌套「套娃」下钻/返回（栈顶=当前展示层，空=关闭）。
  const [recordStack, setRecordStack] = useState<ChatRecord[]>([]);
  const recordView = recordStack.length > 0 ? recordStack[recordStack.length - 1] : null;
  // 当前层里嵌套合并转发条目的子记录解析结果（按 item 下标缓存），避免每次 render 重复 JSON.parse。
  const recordNested = useMemo(() => {
    const m = new Map<number, ChatRecord>();
    recordView?.items.forEach((it, i) => { if (it.ct === "chat_record") m.set(i, parseChatRecord(it.c)); });
    return m;
  }, [recordView]);
  const [favorites, setFavorites] = useState<Favorite[] | null>(null); // 收藏列表弹窗（null=关闭，M4-4）
  const [attachPanel, setAttachPanel] = useState(false); // 附件面板（图片或视频/文件，M4-6）
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
  // 用 URL 作 key 会漏复位 → 第二条跳过封面直接自动播/沿用上一条的不可播态。mediaIdentity 逐消息唯一。
  const viewedKey = viewer ? mediaIdentity(viewer.m) : undefined;
  useEffect(() => { setVideoUnplayable(false); setVideoStarted(false); }, [viewedKey]);
  const [selectMode, setSelectMode] = useState(false); // 多选态
  const [selected, setSelected] = useState<Set<number>>(new Set()); // 已选消息的 convSeq 集合
  const [tab, setTab] = useState<Tab>("chats"); // 左栏当前 Tab：会话 / 通讯录
  const contactsScrollRef = useRef<HTMLDivElement>(null); // 通讯录滚动容器（好友列表虚拟化的滚动父，见 VirtualList）
  const [contactFilter, setContactFilter] = useState(""); // 通讯录本地过滤（按备注/昵称/uid 即时筛已有好友；桌面端替代 iOS 的 A–Z 索引尺）
  const [friends, setFriends] = useState<FriendEntry[]>([]); // 全量好友/申请关系（含 pending/requested/accepted）
  const [searchQ, setSearchQ] = useState(""); // 找人搜索框
  const [searchResults, setSearchResults] = useState<UserCard[] | null>(null); // null=未搜索；[]=搜过无结果
  const [busyUser, setBusyUser] = useState<string | null>(null); // 正在执行好友动作的对端 uid（防重复点击）
  const [profileDraft, setProfileDraft] = useState<{ nickname: string; avatar_url: string; phone: string; tags: string } | null>(null); // 编辑资料弹窗（null=关闭）
  // 头像裁切请求（方案 C）：选好图后开裁切弹窗；确定拿到 blob 交给 onDone（个人/群各自上传落库）。
  const [cropReq, setCropReq] = useState<{ file: File; onDone: (blob: Blob) => void | Promise<void> } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [friendMenu, setFriendMenu] = useState<{ x: number; y: number; userId: string } | null>(null); // 好友行 ⋯ 菜单
  const [blockedList, setBlockedList] = useState<FriendEntry[] | null>(null); // 黑名单弹窗（null=关闭）
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
  const [myInfo, setMyInfo] = useState<{ nickname: string; phone: string; avatar_url: string } | null>(null); // 设置页顶部资料展示
  const [generalOpen, setGeneralOpen] = useState(false); // 通用设置子面板
  // ---- 已登录设备 / 多设备管理（P2）：状态与操作抽到 useDevices（组件体后段调用，依赖 clientRef/askConfirm/setToast）----
  // ---- 自动下载策略 + 下载门控（M4-7，草图 §09 Web 映射）----
  // Web 只吃 Wi-Fi 档（浏览器分不清移动/Wi-Fi），且**始终提供手动下载**；策略本身仍随账号多端同步。
  const [dataStorageOpen, setDataStorageOpen] = useState(false);        // 设置 ▸ 数据与存储 子面板
  const [dlSettings, setDlSettings] = useState<DownloadSettings | null>(null);
  const [dlStates, setDlStates] = useState<Record<string, DownloadState>>({}); // content → 下载态（**仅文件**用状态机）
  const [dlBlobs, setDlBlobs] = useState<Record<string, string>>({});          // content → objectURL（**仅文件**的应用内缓存）
  const dlBlobsRef = useRef<Record<string, string>>({});
  dlBlobsRef.current = dlBlobs;
  const dlAbortRef = useRef<Record<string, AbortController>>({}); // content → 在飞请求的中止句柄（✕ 取消要真中止）
  // 图片/视频门控（方案 B）：不下到内存 blob，只记「已解门控」的 content——解门控后直接 <img/video src=远端>，
  // 浏览器 HTTP 缓存兜底持久（刷新仍在）。门控判定本身保留：大图/视频先显模糊占位、点了才拉，省流量。
  const [mediaOptedIn, setMediaOptedIn] = useState<Set<string>>(new Set());
  // 持久失效标记（草图 §06 404 止损）：命中 404/410 的 content 落 localStorage（按 uid）。mediaGate 据此直接
  // 画失效占位、不再回源 → 掐 404 风暴、刷新仍显失效。ref 供 render 中的 onError 回调同步去重、避免重复复验。
  const [expiredSet, setExpiredSet] = useState<Set<string>>(new Set());
  const expiredRef = useRef<Set<string>>(expiredSet);
  expiredRef.current = expiredSet;
  // 「网页端无法渲染」运行期标记（编解码级失败，扩展名看不出，如 mp4 里的 HEVC）：<img>/<video> onError 且非 404 时落此集。
  // 容器级已知不支持（heic/mkv 等）由 webCanRenderMedia 直接判定、无需入集。仅内存：刷新后一次加载尝试即可复得，无需持久化。
  const [unsupportedSet, setUnsupportedSet] = useState<Set<string>>(new Set());
  const unsupportedRef = useRef<Set<string>>(unsupportedSet);
  unsupportedRef.current = unsupportedSet;
  const markUnsupported = useCallback((content: string) => {
    if (!content) return;
    setUnsupportedSet((s) => (s.has(content) ? s : new Set(s).add(content)));
  }, []);
  /** 把某 content 标记为永久失效（幂等）：更新内存态 + 持久化。 */
  const markExpired = useCallback((content: string) => {
    if (!content) return;
    setExpiredSet((s) => {
      if (s.has(content)) return s;
      const n = new Set(s); n.add(content); saveStrSet(expiredKey(uid), n); return n;
    });
  }, [uid]);
  // 打开查看器 = 用户主动看原图 → 标记「已解门控」（对齐 iOS 档 B「点某格才打开查看器，此时才允许拉原件」）：
  // 之后该图/视频在气泡/相册/详情宫格/媒体库/引用条都显真帧、刷新仍在（opt-in 落 localStorage）。
  useEffect(() => {
    const vm = viewer?.m;
    if (!vm || !vm.content || vm.from === uid || vm.recalledAt) return;
    if (vm.contentType !== "image" && vm.contentType !== "video") return;
    setMediaOptedIn((s) => { if (s.has(vm.content)) return s; const n = new Set(s); n.add(vm.content); saveOptedIn(uid, n); return n; });
  }, [viewer, uid]);
  // 查看器一关（点蒙层 / ✕ / 定位·转发·删除等 setViewer(null) 的任一路径），「更多」浮层一并收起：
  // 否则残留的 viewerMore=true 会在下次打开任意媒体时立刻弹出上一张的菜单。
  useEffect(() => { if (!viewer) setViewerMore(false); }, [viewer]);
  const [wallpaperOpen, setWallpaperOpen] = useState(false); // 通用设置 ▸ 聊天壁纸
  const [wallpaper, setWallpaper] = useState<WallpaperChoice>(loadWallpaper);
  const [wallpaperBlur, setWallpaperBlur] = useState(() => localStorage.getItem("im.wallpaperBlur") === "1");
  const [wallpaperColorOpen, setWallpaperColorOpen] = useState(false);
  const [colorHSV, setColorHSV] = useState<HSVColor>(() => hexToHSV("#567e71"));
  // 通用设置项：theme / timeFormat / fontSize / sendKey / wallpaper 均为本机真功能。
  // ---- 群聊（M3-4）----
  const [groupConvId, setGroupConvId] = useState(""); // 当前打开的群会话 conv_id（"" = 单聊模式，peer 生效）
  const [groupInfos, setGroupInfos] = useState<Record<string, GroupInfo>>({}); // conv_id -> 群资料缓存（标题/气泡昵称回退/资料面板共用）
  // @提及（M4-8，仅群聊）：面板开合 + 过滤词 + 候选表（显示名→uid，发送时按文本里是否还留着 token 复核）。
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null=面板关闭
  const [mentionFilter, setMentionFilter] = useState(""); // 面板顶部搜索框的**独立**搜索词（从空开始，不随消息框 @后文字回填；空时列表跟随 mentionQuery）
  const mentionCandidates = useRef<MentionCandidates>({});
  const mentionAllPending = useRef(false);
  const mentionPanelRef = useRef<HTMLDivElement>(null); // 面板 DOM：判定"点击是否落在面板外"
  const mentionActiveRef = useRef<HTMLButtonElement>(null); // 当前高亮行：键盘移动时滚入视野
  // 已读名单弹窗（M4-8）：null=关闭；tab 切换已读/未读。
  const [readReceipts, setReadReceipts] = useState<{ read: string[]; unread: string[]; tab: "read" | "unread" } | null>(null);
  // 会话详情面板（右侧抽屉，对齐 iOS IMChatDetailViewController；单聊/群聊共用）。null=关闭。
  // fromOwnChat：从「当前正在聊的这个人」的聊天页顶栏头像进来的——此时不显示「消息」入口
  // （你已经在这个会话里了，点它等于原地不动）。与 iOS 的 showsMessagePill 取反同义。
  const [detail, setDetail] = useState<{ convId: string; isGroup: boolean; peer?: string; fromOwnChat?: boolean } | null>(null);
  const [detailTab, setDetailTab] = useState<"members" | "media" | "files" | "links">("media");
  const [detailMsgs, setDetailMsgs] = useState<ChatMessage[]>([]); // 详情页签数据源（本地历史）
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 详情文件行右键菜单（转发/定位/取消下载/删除，对齐 iOS 长按）
  const [deleteMenu, setDeleteMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null); // 删除两档子菜单 B（为所有人删除/仅删除自己）——由菜单 A 的「删除」展开，对齐 iOS 子菜单
  const [manageOpen, setManageOpen] = useState(false); // 群管理二级视图（改名/头像/简介/公告/禁言）
  const [groupRemarkTick, setGroupRemarkTick] = useState(0); // 群备注（本地）变更计数，触发标题/列表重渲染
  const [groupBans, setGroupBans] = useState<GroupBan[] | null>(null); // 当前群黑名单（管理面板显示计数）
  const [groupBansModal, setGroupBansModal] = useState<{ convId: string; bans: GroupBan[] } | null>(null); // 黑名单弹窗
  // 二维码体系（QRCODE P0）+ G3 入群 UI 状态。
  const [qrScan, setQrScan] = useState(false); // 扫一扫浮层
  const [qrCardModal, setQrCardModal] = useState<{ title: string; subtitle: string; name: string; avatarUrl?: string; card: QRCard; canReset: boolean; kind: "me" | "group"; convId?: string } | null>(null);
  const [qrResult, setQrResult] = useState<{ data: QRResolved | { kind: "expired" }; raw: string } | null>(null);
  const [joinReqModal, setJoinReqModal] = useState<{ convId: string; requests: JoinRequest[]; loading: boolean } | null>(null);
  const [muteDurationFor, setMuteDurationFor] = useState<{ convId: string; m: GroupMember } | null>(null); // 成员禁言时长选择
  const [detailMore, setDetailMore] = useState(false);  // 详情「更多」菜单开合
  const [groupsModal, setGroupsModal] = useState<GroupSummary[] | null>(null); // 通讯录「群聊」列表弹窗
  const [createDraft, setCreateDraft] = useState<{ name: string; selected: string[] } | null>(null); // 建群弹窗（群名 + 选中好友）
  const [createBusy, setCreateBusy] = useState(false);
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; convId: string; m: GroupMember } | null>(null); // 成员行 ⋯ 菜单
  const memberMenuRef = useRef<HTMLDivElement | null>(null); // 菜单本体：捕获阶段关闭时用来排除菜单内点击
  const [inviteDraft, setInviteDraft] = useState<{ convId: string; selected: string[] } | null>(null); // 邀请成员弹窗
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => (localStorage.getItem("im.theme") as "light" | "dark" | "system") || "system");
  // 系统深色偏好（仅在 theme==="system" 时决定实际明暗）：跟随 prefers-color-scheme 实时变化，供默认壁纸随主题切换。
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem("im.fontSize")) || 15);
  const [timeFormat, setTimeFormat] = useState<"12" | "24">(() => (localStorage.getItem("im.timeFormat") as "12" | "24") || "24");
  const [sendKey, setSendKey] = useState<"enter" | "cmd">(() => (localStorage.getItem("im.sendKey") as "enter" | "cmd") || "enter");

  const clientRef = useRef<IMClient | null>(null);
  // 会话置顶消息（G0）：conv_id -> 置顶集合（服务端按 pinned_at 倒序）。进会话拉一次，
  // 之后靠实时 msg_op{op:pin} 帧触发重拉——置顶是低频操作，重拉比在本地拼装列表更不容易错。
  const [pinnedByConv, setPinnedByConv] = useState<Record<string, PinnedMessage[]>>({});
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
  const avatarFileRef = useRef<HTMLInputElement>(null); // 隐藏的本机图片选择 input
  const wallpaperFileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null); // 聊天输入框（自适应高度 + 发送键策略）
  const seenByConv = useRef<Record<string, Set<number>>>({});
  // 内存删除墓碑（convId → 被本地删的 conv_seq）：登录时从 IndexedDB 载入，onMessage 据此拦住服务端重同步的复现。
  const deletedByConv = useRef<Record<string, Set<number>>>({});
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

  const appendMsg = useCallback((convId: string, m: ChatMessage) => {
    setMsgsByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] ?? []), m] }));
  }, []);

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
    if (Object.keys(loaded).length) setMsgsByConv((prev) => ({ ...loaded, ...prev }));
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

  const doSearch = useCallback(async () => {
    const q = searchQ.trim();
    if (!q) { setSearchResults(null); return; }
    try {
      const users = await clientRef.current?.searchUsers(q);
      setSearchResults(users ?? []);
    } catch (e) {
      setToast(`搜索失败：${(e as Error).message}`);
    }
  }, [searchQ]);

  // 好友动作（申请/同意/拒绝/删除）统一走这里：执行 → 刷新关系 → 解锁按钮。
  const doFriendAction = useCallback(async (userId: string, fn: () => Promise<void>) => {
    setBusyUser(userId);
    try {
      await fn();
      await refreshFriends();
    } catch (e) {
      setToast(`操作失败：${(e as Error).message}`);
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
      setToast(`加载资料失败：${(e as Error).message}`);
    }
  }, []);

  // 打开黑名单弹窗：拉 status=blocked 的关系。
  const openBlacklist = useCallback(async () => {
    try {
      const list = await clientRef.current?.listFriends("blocked");
      setBlockedList(list ?? []);
    } catch (e) {
      setToast(`加载黑名单失败：${(e as Error).message}`);
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
      setToast(`解除失败：${(e as Error).message}`);
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
      setToast(`保存失败：${(e as Error).message}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileDraft]);

  // 选本机图片做头像：<input type=file> 浏览器自动用当前系统(Mac/Windows/Linux)的原生文件框，无需检测系统。
  // 个人头像（方案 C）：选图 → 圆形裁切 → 上传专用端点 → 存 /avatars/<hash>.jpg（不再 data URL）。
  const onPickAvatar = useCallback((file: File | undefined) => {
    if (!file) return;
    setCropReq({
      file,
      onDone: async (blob) => {
        try {
          setToast("上传中…");
          const { url } = await clientRef.current!.uploadAvatar(blob);
          setProfileDraft((d) => (d ? { ...d, avatar_url: url } : d));
          setToast("头像已更新");
        } catch (e) {
          setToast(`头像上传失败：${(e as Error).message}`);
        }
      },
    });
  }, []);

  // token 非空=扫码登录路径（无密码，走 connectWithToken）；否则密码/免密登录。
  const enterApp = useCallback(async (pwd: string, token?: string) => {
    if (!uid) {
      setAuthErr("请填写用户名");
      return;
    }
    setAuthBusy(true);
    setAuthErr("");
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
        // 本地已删的消息被服务端重同步推回来：直接丢弃（读盘时 loadConversation 也会过滤，这里挡实时路径）。
        if (m.convSeq > 0 && deletedByConv.current[m.convId]?.has(m.convSeq)) return;
        const seen = (seenByConv.current[m.convId] ??= new Set());
        if (m.convSeq > 0) {
          if (seen.has(m.convSeq)) {
            // ACK/另一条同步路径可能先创建了同序号消息；权威重拉仍需把文件元数据补到当前屏幕。
            setMsgsByConv((prev) => {
              const list = prev[m.convId] ?? [];
              return {
                ...prev,
                [m.convId]: list.map((existing) => existing.convSeq === m.convSeq
                  ? {
                      ...existing,
                      serverMsgId: m.serverMsgId || existing.serverMsgId,
                      fileName: m.fileName || existing.fileName,
                      fileSize: m.fileSize !== undefined && m.fileSize > 0 ? m.fileSize : existing.fileSize,
                      recalledAt: m.recalledAt || existing.recalledAt,
                      recalledBy: m.recalledBy || existing.recalledBy,
                      editedAt: m.editedAt || existing.editedAt,
                      pinnedAt: m.pinnedAt || existing.pinnedAt,
                    }
                  : existing),
              };
            });
            return;
          }
          seen.add(m.convSeq);
        }
        appendMsg(m.convId, m);
        // 可见即读：不在收到时立即标已读；新消息若落在视口内（贴底）会由滚动/布局后的 markVisibleRead 读到，
        // 在上方看历史时则不读，留到滚下去再读。
        // 全量/多页同步会连续投递很多消息，只批量刷新一次；同账号另一端新建的会话也必须覆盖。
        scheduleConversationRefresh();
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
        // 走节流：连发/群发时每条 ack 不再各拉一次列表（否则叠成 GET 风暴）。
        if (ok) scheduleListRefresh();
      },
      onReceipt: (convId, from, status, upToSeq) => {
        if (status !== "read") return;
        if (from === uid) {
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
        if (from === uid) return;
        setTypingConv(convId);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setTypingConv(null), 3000);
      },
      // 好友关系实时变更：刷新通讯录（"新的朋友"红点/列表即时更新，无需切 Tab）。
      onFriend: () => { void refreshFriends(); },
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
        if ((event === "remove" && target === uid) || event === "dissolve") {
          setToast(event === "dissolve" ? "该群已被解散" : "你已被移出群聊");
          setDetail((d) => (d?.convId === cid ? null : d));
          if (currentConvRef.current === cid) {
            currentConvRef.current = "";
            setGroupConvId("");
          }
        }
      },
      // 某条消息被拒收（被拉黑）→ 标记该条发送失败 + 把原因挂到该条 note（微信式：红❗+下方居中系统行，不弹窗）。
      onMsgRejected: (clientMsgId, msg, code) => {
        setMsgsByConv((prev) => {
          const out: Record<string, ChatMessage[]> = {};
          for (const [cid, list] of Object.entries(prev)) {
            out[cid] = list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, status: "failed", note: msg, noteCode: code } : m));
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
        // 置顶态变化（G0）：重拉该会话置顶集合刷新顶部横幅（含别人置顶/取消置顶的实时同步）。
        if (patch.pinnedAt !== undefined) void refreshPinned(cid);
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
        setMsgsByConv((prev) => {
          const list = prev[cid];
          if (!list) return prev;
          const next = list.filter((m) => m.convSeq !== targetSeq);
          return next.length === list.length ? prev : { ...prev, [cid]: next };
        });
        setDetailMsgs((prev) => prev.filter((m) => !(m.convId === cid && m.convSeq === targetSeq)));
        setViewer((v) => (v && v.m.convId === cid && v.m.convSeq === targetSeq ? null : v)); // 正在查看的媒体被删 → 关查看器
        setTextReader((r) => (r && r.convId === cid && r.convSeq === targetSeq ? null : r)); // 正在全屏读的文本被删（为所有人删/仅删我）→ 关阅读器
        scheduleListRefresh(); // 会话列表末条预览可能随之变化
      },
      // 会话级设置变更（置顶/免打扰/标未读/删除会话，M4.5）：多端同步 → 重新拉取权威会话列表覆盖本地。
      onConvUpdate: () => { scheduleListRefresh(); },
      // 账号级配置变更（M4-7）：另一端改了自动下载策略 → 重拉（零新链路的多端同步）。
      onCapabilitiesUpdate: (version) => {
        logger.info(LOG_TAG.media, "capabilities_update_received", { version });
        void refreshDownloadSettings();
      },
      // 鉴权失效分两类处理：
      // ① 100101 吊销/被踢下线 → 强制退登，直接跳登录页（不给可取消弹窗——被踢是不可协商的，
      //    「边看本地边被踢」自相矛盾）；原因写到登录页顶部红字。与 iOS 握手 401 直跳登录对齐。
      // ② 其余（100102 过期等良性失效）→ 仍弹框二选一：确定重新登录 / 取消留看本地缓存聊天记录。
      onAuthError: (msg, code) => {
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
    setLogContext(uid); // 让后续每条 dev 日志带上当前账号标签，便于多标签页/多账号汇聚时 grep 分离
    try {
      if (token) await client.connectWithToken(uid, token); // 扫码登录：直接用已签发 JWT
      else await client.connect(uid, pwd); // 首次登录失败（密码错误等）会抛错
    } catch (e) {
      const code = (e as { code?: number }).code;
      const cached = client.cachedConversations();
      if (code === undefined && cached.length > 0) {
        // 服务器不可达不是登录态失效：保留 client 的后台重连，直接进入本地会话页显示“未连接”。
        clientRef.current = client;
        setConversations(cached);
        await preloadLocal(cached);
        localStorage.setItem(SESSION_KEY, JSON.stringify(token ? { uid, token } : { uid, pwd }));
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
    setMediaOptedIn(loadOptedIn(uid)); // 恢复图片/视频「已解门控」记录（方案 B）：刷新后已看过的媒体仍直显，不回退门控
    setExpiredSet(loadStrSet(expiredKey(uid))); // 恢复失效标记：已知 404 的媒体刷新后仍显失效、不再回源
    // rehydrate 已下载文件（C1）：从 Cache Storage 取回持久字节 → 重建 objectURL → dlBlobs，对齐 iOS 读盘即"就绪"。
    void (async () => {
      const keys = [...loadStrSet(downloadedFilesKey(uid))];
      const restored: Record<string, string> = {};
      for (const k of keys) {
        const blob = await cacheMatchBlob(uid, k);
        if (blob) restored[k] = URL.createObjectURL(blob);
      }
      if (Object.keys(restored).length) {
        setDlBlobs((p) => ({ ...restored, ...p })); // 已在飞/新下的优先，不覆盖
        logger.info(LOG_TAG.media, "media_cache_rehydrated", { count: Object.keys(restored).length });
      }
    })();
    // 保持登录：刷新后静默重登（Web #4）。扫码登录存 token（无密码，过期即回登录）。
    localStorage.setItem(SESSION_KEY, JSON.stringify(token ? { uid, token } : { uid, pwd }));
    setAuthBusy(false);
    setPhase("app");
  }, [uid, appendMsg, refreshConversations, preloadLocal, scheduleConversationRefresh, scheduleListRefresh, refreshFriends, loadMyInfo, refreshGroupInfo]);

  // 静默恢复登录（Web #4）：挂载后若有已存会话 → 直接用存储凭据重登（成功直达主界面；
  // 网络失败且有本地会话缓存时直接进入会话页显示“未连接”；鉴权失败或无缓存才回登录页。
  useEffect(() => {
    const r = restoreRef.current;
    if (!r || phase !== "login") return;
    restoreRef.current = null;
    if (r.token) setUid(r.uid); // 扫码会话恢复：确保处理器闭包用回该 uid
    void enterApp(r.pwd, r.token).finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 扫码登录入场：等 setUid 落地（uid===待入场 uid）后，用带正确 uid 的 enterApp 闭包连接。
  useEffect(() => {
    const p = pendingQrRef.current;
    if (!p || phase !== "login" || uid !== p.uid) return;
    pendingQrRef.current = null;
    void enterApp("", p.token);
  }, [uid, phase, qrTrigger, enterApp]);

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
    seenByConv.current = {};
    deletedByConv.current = {};
    currentConvRef.current = "";
    setConversations([]);
    setMsgsByConv({});
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
    // 下载门控缓存（M4-7）：revoke 掉应用内 blob，清空下载态，避免 objectURL 泄漏与跨账号残留。
    Object.values(dlBlobsRef.current).forEach((u) => URL.revokeObjectURL(u));
    dlAbortRef.current = {};
    setDlBlobs({});
    setDlStates({});
    setMediaOptedIn(new Set()); // 图片/视频解门控记录：换账号重新门控
    setExpiredSet(new Set());   // 失效标记内存态清空（每 uid 各自持久化，登录时按账号重载）
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
  const pendingFilesRef = useRef<Map<string, { file: File; mode: AttachmentPickMode; convId: string; groupId?: string }>>(new Map());
  // 已被用户取消的出箱件：发送流水线（sendMediaBatch/uploadAndSend）在每个边界检查它，
  // 跳过后续上传与 sendMedia——因为 cancel() 只能中断在飞的**分片**任务，小文件 XHR、排队中的
  // 相册成员、以及"上传完成→poster→sendMedia"窗口都没有可 abort 的任务，必须靠这个集合拦住。
  const cancelledSendsRef = useRef<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<Record<string, { sent: number; total: number }>>({});
  const clearUploadProgress = useCallback((key: string) => {
    setUploadProgress((prev) => { if (!(key in prev)) return prev; const nx = { ...prev }; delete nx[key]; return nx; });
  }, []);

  // 从会话列表移除一条本地行（取消/重试/删除共用）。
  const removeMsgRow = useCallback((cid: string, key: string) => {
    setMsgsByConv((prev) => {
      const list = prev[cid];
      if (!list) return prev;
      return { ...prev, [cid]: list.filter((x) => x.clientMsgId !== key) };
    });
  }, []);

  // 停掉一条出箱件的上传并清理其副作用（取消发送 / 删除发送中消息共用）：abort 分片任务、清进度、
  // 丢留存 File。**不**移除气泡（调用方按需移除），也不 revoke blobURL（由发送循环在边界统一 revoke）。
  // active=该件是否有正在跑的发送循环（媒体/文件且 sending）——只有它才需要标进取消集合让循环在边界跳过；
  // 文本行、已 failed 行没有循环消费该键，加了就成永不回收的孤儿（键是唯一 uuid，不会误伤后续上传，但会泄漏）。
  const teardownOutboxUpload = useCallback((key: string, active: boolean) => {
    if (!key) return;
    if (active) cancelledSendsRef.current.add(key);
    chunkedTaskFor(key)?.cancel();
    pendingFilesRef.current.delete(key);
    clearUploadProgress(key);
  }, [clearUploadProgress]);

  // 该消息是否有正在跑的发送流水线（据此决定是否需要取消集合拦截）。
  const hasActiveSend = (m: ChatMessage) =>
    m.status === "sending" && (m.contentType === "image" || m.contentType === "video" || m.contentType === "file");

  // 暂停 ↔ 继续（仅 ≥8MB 的分片任务可暂停；恢复以服务端 offset 为准续传）。返回是否有任务被切换。
  // 暂停态的唯一真相是 task.paused（渲染直接读 chunkedTaskFor(key)?.paused）；这里仅 bump 进度对象触发重渲染。
  const toggleUploadPause = useCallback((m: ChatMessage): boolean => {
    const key = m.clientMsgId ?? "";
    const task = chunkedTaskFor(key);
    if (!task) return false;
    if (task.paused) task.resume(); else task.pause();
    setUploadProgress((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key] } } : prev));
    return true;
  }, []);

  // 取消发送（右键菜单）：停上传 + 移除气泡。与 iOS 长按「取消发送」同语义。
  const cancelSendMessage = useCallback((m: ChatMessage) => {
    const key = m.clientMsgId ?? "";
    teardownOutboxUpload(key, hasActiveSend(m));
    removeMsgRow(m.convId, key);
    logger.info(LOG_TAG.media, "media_send_cancelled", { conv_id: m.convId, client_msg_id: key, content_type: m.contentType });
  }, [teardownOutboxUpload, removeMsgRow]);

  // 粘贴图片（Web #2）：Ctrl/Cmd+V 粘贴剪贴板中的图片 → 输入区上方预览 → 发送时作为图片上传。
  // 粘贴攒批（对齐 iOS 预览条）：图片与**任意文件**都先进预览条，发送键统一发出。
  const [pastedImages, setPastedImages] = useState<{ file: File; url: string; kind: "image" | "video" | "file" }[]>([]);
  const addPastedFiles = useCallback((files: File[]) => {
    // 走与文件选择器同一个类型闸：可发送的图片/视频进"媒体批量"通道（image/video），
    // 其余（含 svg——MIME 是 image/svg+xml，旧代码会误判成 image 送进批量→服务端拒传坏气泡）走文件通道。
    // 网页端解不了码的媒体（HEIC 等）直接丢弃：发出去自己看不了。（非媒体文件仍按文件发，行为不变。）
    // 视频保留 video 种类而非并入 image：否则预览条会拿视频 blob 塞进 <img> → 破图（见预览渲染）。
    const keep: { file: File; url: string; kind: "image" | "video" | "file" }[] = [];
    let dropped = 0;
    for (const f of files) {
      const k = mediaKindForFile(f);
      if (k !== null && !webCanRenderMedia(k, f.name)) { dropped++; continue; }
      keep.push({ file: f, url: URL.createObjectURL(f), kind: k ?? "file" });
    }
    if (dropped) setToast("为保证各端可见，已忽略 HEIC 等格式");
    if (keep.length) setPastedImages((prev) => [...prev, ...keep]);
  }, []);
  const removePastedImage = useCallback((idx: number) => {
    setPastedImages((prev) => { const nx = prev.slice(); const [rm] = nx.splice(idx, 1); if (rm) URL.revokeObjectURL(rm.url); return nx; });
  }, []);
  const onComposerPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); addPastedFiles(files); }
  }, [addPastedFiles]);

  // 按 clientMsgId 就地打补丁（相册批量发送：本地占位 → 上传完成换服务器 URL/真 ID）。
  const patchMsg = useCallback((cid: string, clientMsgId: string, patch: Partial<ChatMessage>) => {
    setMsgsByConv((prev) => {
      const list = prev[cid];
      if (!list) return prev;
      return { ...prev, [cid]: list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, ...patch } : m)) };
    });
  }, []);

  // 相册批量发送（M4+）：**选完秒上屏**——每张先用本地 blob URL 占位（≥2 张共享 group_id → 宫格聚簇），
  // 逐张上传后原地替换为服务器 URL 并走 socket 发送（带 group_id）；单张失败标该格不阻塞后续。
  const sendMediaBatch = useCallback(async (files: File[], opts?: { convId?: string; groupId?: string }) => {
    const client = clientRef.current;
    // opts 用于重试：按原会话/原相册重发（不耦合当前打开的会话）。
    const cid = opts?.convId ?? (peer ? convIdFor(uid, peer) : groupConvId);
    if (!client || !cid || files.length === 0) return;
    const groupId = opts?.groupId ?? (files.length > 1 ? `alb-${crypto.randomUUID()}` : undefined);
    // 图/视频归类走统一入口 mediaKindForFile（含扩展名回退）：MIME 缺失的 .mov 等也能判成 video，
    // 否则乐观气泡会当成 image（<img> 放视频→坏图）且跳过封面/时长探测。null（异常漏进来的）退回 MIME。
    const locals = files.map((f) => {
      const mk = mediaKindForFile(f);
      const isVideo = mk === "video" || (mk === null && f.type.startsWith("video/"));
      return { f, isVideo, localId: `outbox-${crypto.randomUUID()}`, blobUrl: URL.createObjectURL(f), posterFile: null as File | null, posterBlobUrl: undefined as string | undefined, meta: { width: 0, height: 0, durationMs: 0 } };
    });
    for (const l of locals) {
      appendMsg(cid, {
        clientMsgId: l.localId, convId: cid, from: uid, content: l.blobUrl,
        contentType: l.isVideo ? "video" : "image",
        convSeq: 0, timestamp: Date.now(), status: "sending", groupId,
      });
      setUploadProgress((prev) => ({ ...prev, [l.localId]: { sent: 0, total: l.f.size } })); // 排队中：先显“等待中”
    }
    // 视频：先在本地抓首帧 → 立刻用 blob 封面显示（发送端不必等上传就见封面）；抓到的 File 复用做上传。
    // 同时量出像素尺寸与时长 → 本地气泡立刻按原比例排版，并随消息上行给收端。
    await Promise.all(locals.map(async (l) => {
      l.meta = await probeMediaMetadata(l.f);
      if (l.meta.width > 0) { patchMsg(cid, l.localId, { mediaW: l.meta.width, mediaH: l.meta.height, duration: l.meta.durationMs, fileSize: l.f.size }); }
      if (!l.isVideo) return;
      const pf = await captureVideoPoster(l.f);
      if (pf) { l.posterFile = pf; l.posterBlobUrl = URL.createObjectURL(pf); patchMsg(cid, l.localId, { posterUrl: l.posterBlobUrl }); }
    }));
    for (let i = 0; i < locals.length; i++) {
      const l = locals[i];
      // 成功后哪些本地 blob 被服务器 URL 取代、成了可安全回收的孤儿（失败/回退仍在用的不能碰）。
      let mainOrphaned = false;   // 主体内容已切服务器 URL
      let posterOrphaned = false; // 封面已切服务器 URL（封面上传失败回退本地 blob 时为 false）
      // 取消：立即回收 blob（气泡已被移除，无需等 60s 换 URL），并从集合摘除。
      const revokeNow = () => { URL.revokeObjectURL(l.blobUrl); if (l.posterBlobUrl) URL.revokeObjectURL(l.posterBlobUrl); };
      const takeCancelled = () => { if (cancelledSendsRef.current.delete(l.localId)) { revokeNow(); return true; } return false; };
      if (takeCancelled()) continue; // 排队中就被取消：这一项根本不发起上传
      try {
        // 分母用**媒体本体字节数**：XHR 报的 total 是 multipart 整包（含 boundary/头），会比文件属性大一截。
        // key=localId：≥8MB 走分片，气泡的 ⏸/↑/右键取消经 chunkedTaskFor(localId) 定位任务。
        const { url, contentType } = await client.uploadFile(l.f, (sent, total) => {
          const ratio = total > 0 ? Math.min(sent / total, 1) : 0;
          setUploadProgress((prev) => ({ ...prev, [l.localId]: { sent: Math.round(ratio * l.f.size), total: l.f.size } }));
        }, l.localId);
        if (takeCancelled()) continue; // 小文件 XHR 无法 abort：传完了但用户已取消 → 不发消息
        // 视频封面：上传本地已抓的首帧图，随消息带 poster URL（收端直显免解码）；上传失败则保留本地 blob 封面不阻塞。
        let poster: string | undefined;
        if (l.posterFile) { try { poster = (await client.uploadFile(l.posterFile)).url; } catch { /* 封面上传失败：保留本地 blob 封面 */ } }
        if (takeCancelled()) continue; // poster 上传窗口（大视频可达数秒）内被取消 → 不发消息
        // 极小模糊预览（M4-7）：图片本体 / 视频封面首帧的缩略，随消息带 thumb；收端未下载时显模糊占位。失败不阻塞。
        let thumb: string | undefined;
        if (contentType === "image") thumb = await makeTinyThumbFromImage(l.f);
        else if (contentType === "video" && l.posterFile) thumb = await makeTinyThumbFromImage(l.posterFile);
        if (takeCancelled()) continue;
        const clientMsgId = client.sendMedia(url, contentType, peer, cid, {
          groupId, poster, thumb, mediaW: l.meta.width, mediaH: l.meta.height, duration: l.meta.durationMs, fileSize: l.f.size,
        });
        // thumb 也写回本地行：否则转发「自己发的」图片/视频时源消息无 thumb，收端只剩空占位（详见 forward 修复）。
        patchMsg(cid, l.localId, { clientMsgId, content: url, contentType, posterUrl: poster || l.posterBlobUrl, thumb });
        clearUploadProgress(l.localId); // 传完：左上角进度胶囊消失，切回时长角标
        mainOrphaned = true;      // 主体已切服务器 URL → 本地 blob 可回收
        posterOrphaned = !!poster; // 仅当封面也上到服务器才回收本地封面 blob（回退时还在显）
      } catch (e) {
        clearUploadProgress(l.localId);
        if ((e as Error).name === "UploadCancelledError") { takeCancelled(); revokeNow(); continue; } // 分片任务被 cancel()
        patchMsg(cid, l.localId, { status: "failed" });
        pendingFilesRef.current.set(l.localId, { file: l.f, mode: "media", convId: cid, groupId }); // 留住 File+分组：点失败气泡按原相册重试
        // 用户只看到一句 toast；失败的会话/消息定位靠这条（可与 HTTP 层同 request_id 的上传日志对账）。
        logger.warn(LOG_TAG.media, "media_send_failed", {
          conv_id: cid, client_msg_id: l.localId, mime: l.f.type, bytes: l.f.size,
          media_w: l.meta.width, media_h: l.meta.height, error: (e as Error).message,
        });
        setToast(`第 ${i + 1} 项发送失败：${(e as Error).message}`);
      }
      // 延迟释放**已被服务器 URL 取代**的本地 blob（等重渲染切换后再回收，避免闪图）。
      // 关键：失败气泡仍用本地 blob 当内容、封面上传失败回退本地 blob 时也仍在显——这些绝不能 revoke，
      // 否则 <img>/<video> 引用已释放的 blob → ERR_FILE_NOT_FOUND 反复重试刷屏（纯噪音但很吵）。
      // 未回收的 blob 会在页面刷新时随文档一起释放。
      window.setTimeout(() => {
        if (mainOrphaned) URL.revokeObjectURL(l.blobUrl);
        if (posterOrphaned && l.posterBlobUrl) URL.revokeObjectURL(l.posterBlobUrl);
      }, 60_000);
    }
  }, [peer, groupConvId, uid, appendMsg, patchMsg, clearUploadProgress]);

  // 注意：uploadAndSend 必须声明在 send 之前——send 的 useCallback deps 数组在组件体内即时求值，
  // 后置声明会踩 const TDZ（ReferenceError）。
  const uploadAndSend = useCallback(async (file: File, pickMode: AttachmentPickMode = "media", convIdOverride?: string) => {
    const client = clientRef.current;
    // convIdOverride 用于重试：按原会话重发（不耦合当前打开的会话）。
    const cid = convIdOverride ?? (peer ? convIdFor(uid, peer) : groupConvId);
    if (!client || !cid) return;
    // 先上屏一条占位消息再上传：大文件传几十秒，原先"传完才出现"期间界面毫无反馈，用户以为卡死。
    const localId = `outbox-${crypto.randomUUID()}`;
    appendMsg(cid, {
      clientMsgId: localId, convId: cid, from: uid, content: "", contentType: attachmentContentType(pickMode, "file"),
      fileName: file.name, fileSize: file.size, convSeq: 0, timestamp: Date.now(), status: "sending",
    });
    setUploadProgress((prev) => ({ ...prev, [localId]: { sent: 0, total: file.size } }));
    pendingFilesRef.current.set(localId, { file, mode: pickMode, convId: cid }); // 失败时据此重试
    const takeCancelled = () => cancelledSendsRef.current.delete(localId); // 取消：文件无 blobURL，无需 revoke
    try {
      const { url, contentType: uploadedContentType, size } = await client.uploadFile(file, (sent, total) => {
        const ratio = total > 0 ? Math.min(sent / total, 1) : 0;
        setUploadProgress((prev) => ({ ...prev, [localId]: { sent: Math.round(ratio * file.size), total: file.size } }));
      }, localId);
      if (takeCancelled()) return; // 小文件 XHR 无法 abort：传完了但用户已取消 → 不发消息
      const contentType = attachmentContentType(pickMode, uploadedContentType);
      let poster: string | undefined;
      let thumb: string | undefined; // 极小模糊预览（M4-7）：收端未下载时显模糊占位
      if (pickMode === "media" && contentType === "video") {
        const pf = await captureVideoPoster(file);
        if (pf) {
          thumb = await makeTinyThumbFromImage(pf); // 视频封面首帧的缩略
          try { poster = (await client.uploadFile(pf)).url; } catch { /* 封面上传失败：不阻塞 */ }
        }
      } else if (pickMode === "media" && contentType === "image") {
        thumb = await makeTinyThumbFromImage(file);
      }
      if (takeCancelled()) return; // poster 窗口内被取消 → 不发消息
      const options = contentType === "file" ? { fileName: file.name, fileSize: size } : ((poster || thumb) ? { poster, thumb } : undefined);
      const clientMsgId = client.sendMedia(url, contentType, peer, cid, options);
      // thumb 也写回本地行：否则转发「自己发的」图片/视频时源消息无 thumb，收端只剩空占位（详见 forward 修复）。
      patchMsg(cid, localId, { clientMsgId, content: url, contentType, posterUrl: poster, thumb });
      clearUploadProgress(localId);
      pendingFilesRef.current.delete(localId);
    } catch (e) {
      clearUploadProgress(localId);
      if ((e as Error).name === "UploadCancelledError") { takeCancelled(); return; } // 分片任务被 cancel()
      patchMsg(cid, localId, { status: "failed" });
      logger.warn(LOG_TAG.media, "file_send_failed", {
        conv_id: cid, client_msg_id: localId, mime: file.type, bytes: file.size, error: (e as Error).message,
      });
      setToast(`发送失败：${(e as Error).message}`);
    }
  }, [peer, groupConvId, uid, appendMsg, patchMsg, clearUploadProgress]);

  const send = useCallback(() => {
    const text = input.trim();
    const client = clientRef.current;
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    if (!client || !cid) return;
    // 先发预览条攒的粘贴件（Web #2）：图片走相册批量通道（≥2 张聚簇成宫格），
    // 文件走既有文件通道（≥8MB 自动分片可暂停续传）；文字随后补发一条文本。
    if (pastedImages.length) {
      const items = pastedImages;
      setPastedImages([]);
      const imgs = items.filter((pi) => pi.kind === "image" || pi.kind === "video");
      if (imgs.length) void sendMediaBatch(imgs.map((pi) => pi.file));
      for (const pi of items) {
        if (pi.kind === "file") void uploadAndSend(pi.file, "file");
        window.setTimeout(() => URL.revokeObjectURL(pi.url), 60_000);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentPickModeRef = useRef<AttachmentPickMode>("media");
  const attachAnchorRef = useRef<HTMLDivElement>(null);
  const attachCloseTimerRef = useRef<number | null>(null);
  const cancelAttachClose = useCallback(() => {
    if (attachCloseTimerRef.current === null) return;
    window.clearTimeout(attachCloseTimerRef.current);
    attachCloseTimerRef.current = null;
  }, []);
  const scheduleAttachClose = useCallback(() => {
    cancelAttachClose();
    attachCloseTimerRef.current = window.setTimeout(() => {
      setAttachPanel(false);
      attachCloseTimerRef.current = null;
    }, 1000);
  }, [cancelAttachClose]);
  useEffect(() => cancelAttachClose, [cancelAttachClose]);
  useEffect(() => {
    if (!attachPanel) return;
    const closeOutside = (event: PointerEvent) => {
      if (!attachAnchorRef.current?.contains(event.target as Node)) {
        cancelAttachClose();
        setAttachPanel(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [attachPanel, cancelAttachClose]);
  // （声明已前移到 uploadProgress 附近：cancelSendMessage 也要用它。）


  /// 重试失败的媒体/文件消息（图片/视频/文件通吃）：移除旧占位，用留存的 File 按**原会话/原相册**
  /// 重发（新的 localId）。媒体走批量通道（保留 groupId → 宫格成员回原格）；文件走单发通道。
  const retryUpload = useCallback((m: ChatMessage) => {
    const key = m.clientMsgId ?? "";
    const kept = pendingFilesRef.current.get(key);
    if (!kept) { setToast("原文件已失效，请重新选择"); return; }
    pendingFilesRef.current.delete(key);
    removeMsgRow(m.convId, key);
    if (kept.mode === "media") void sendMediaBatch([kept.file], { convId: kept.convId, groupId: kept.groupId });
    else void uploadAndSend(kept.file, kept.mode, kept.convId);
  }, [removeMsgRow, sendMediaBatch, uploadAndSend]);

  /// 媒体气泡点按路由（与 iOS 中心按钮状态机一致）：失败 ↻ 重试；上传中 ⏸↔↑ 暂停恢复
  /// （仅 ≥8MB 分片任务；小文件几秒传完不可暂停，点击忽略）；已发出 → 打开查看器。
  // ================= 自动下载策略 + 下载门控（M4-7，草图 §02/§03/§09）=================
  // 三条铁律：① 全程不跳页（状态就地变化）；② **完成即止，绝不自动打开/播放**；③ 手动点击永远优先。

  /** 拉账号级策略（登录后 + 收到 capabilities_update 时）。失败静默沿用默认，不打断聊天。 */
  const refreshDownloadSettings = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const res = await c.downloadSettings();
      const next = parseDownloadSettings(res?.settings);
      setDlSettings(next);
      // 策略是所有门控判定的输入；version 与服务端 download_settings_saved 对账即可确认多端同步到没到本端。
      logger.info(LOG_TAG.media, "download_settings_applied", {
        version: Number(res?.version) || 0,
        wifi_enabled: next.wifi.enabled,
        wifi_video_max_bytes: next.wifi.video.max_bytes,
        wifi_file_max_bytes: next.wifi.file.max_bytes,
      });
    } catch (e) {
      // 拉不到 → 静默沿用默认策略，门控行为会与用户设置不一致，必须留痕。
      logger.warn(LOG_TAG.media, "download_settings_unavailable", { error: (e as Error).message, fallback: "defaults" });
    }
  }, []);

  /** 保存策略（乐观应用 + PUT；失败回滚重拉，与 iOS 同口径）。 */
  const saveDownloadSettings = useCallback(async (next: DownloadSettings) => {
    const c = clientRef.current;
    setDlSettings(next);
    if (!c) return;
    try {
      const res = await c.saveDownloadSettings(next);
      setDlSettings(parseDownloadSettings(res?.settings)); // 以服务端规整后的为准
    } catch (e) {
      logger.warn(LOG_TAG.media, "download_settings_save_failed", { error: (e as Error).message, rollback: true });
      setToast(`保存失败：${(e as Error).message}`);
      void refreshDownloadSettings();
    }
  }, [refreshDownloadSettings]);

  /**
   * 这条收到的媒体/文件当前的门控态：**undefined = 就绪**（可直接显图/播放/打开）。
   * 非 undefined 时卡片显 ↓ / 进度 / ↻，点击走 `startDownload`。
   * 自己发的、上传中的、撤回的一律不门控（本地就有原件或还没有远端地址）。
   */
  const mediaGate = useCallback((m: ChatMessage): DownloadState | undefined => {
    if (!m.content || m.recalledAt) return undefined;
    const kind = m.contentType;
    if (kind !== "image" && kind !== "video" && kind !== "file") return undefined;
    // 网页端无法渲染的媒体 → 显"无法预览·点击下载"降级卡（避免破图/黑屏）。**判定靠本浏览器实测**（<img>/<video>
    // onError 落 unsupportedSet），不写死黑名单——HEIC/TIFF 等能否渲染是**浏览器相关**的（Safari 支持 HEIC、Chrome 不支持），
    // 写死会把 Safari 上本可显示的图也误降级。放在 from===uid 之前：自己从 iOS 发的 HEIC 在不支持的浏览器同样看不了。
    if ((kind === "image" || kind === "video") && unsupportedSet.has(m.content)) {
      return { phase: "unsupported", received: 0, total: m.fileSize ?? 0 };
    }
    if (m.from === uid) return undefined; // 自己发的（本浏览器可渲染）不门控
    // 持久失效标记优先（草图 §06）：已知服务端已清理 → 直接失效态、不回源（掐 404 风暴）。三类消息统一。
    if (expiredSet.has(m.content)) return { phase: "expired", received: 0, total: m.fileSize ?? 0 };
    // 群/单聊分档：渲染中的消息恒属当前打开的会话，故用 groupConvId 判定（isGroupChat 在此之后才定义）。
    const passesPolicy = shouldAutoDownload(dlSettings, kind, m.fileSize ?? 0, !!groupConvId);
    if (kind === "image" || kind === "video") {
      // 方案 B：图片/视频不落 blob，只判「要不要拉原件」。已解门控 / 策略放行 → 直显远端；否则显模糊占位 + ↓。
      if (mediaOptedIn.has(m.content) || passesPolicy) return undefined;
      return { phase: "notStarted", received: 0, total: m.fileSize ?? 0 };
    }
    // 文件：保留应用内下载状态机（进度环 / 取消 / 失效 / 就绪走 blob）。
    if (dlBlobs[m.content]) return undefined;                       // 已下到应用内缓存
    const st = dlStates[m.content];
    if (st) return st.phase === "done" ? undefined : st;            // 进行中 / 失败 / 已失效
    if (passesPolicy) return undefined;                             // 策略放行=浏览器直取
    return { phase: "notStarted", received: 0, total: m.fileSize ?? 0 };
  }, [uid, dlBlobs, dlStates, dlSettings, groupConvId, mediaOptedIn, expiredSet, unsupportedSet]);

  /** 该消息应当渲染的地址：已手动下载过用应用内 blob，否则用远端 URL。 */
  const mediaSrc = useCallback((m: ChatMessage) => dlBlobs[m.content] || m.content, [dlBlobs]);

  /**
   * 就绪文件点击路由（对齐 iOS QuickLook 的 Web 诚实映射）：可预览类型（pdf/图片/音视频/文本）在**新标签预览**，
   * 其余（zip/dmg/office…）触发**另存**——绝不静默走浏览器下载。已手动下过的走应用内 blob，否则远端 URL。
   */
  const openReadyFile = useCallback(async (m: ChatMessage) => {
    const name = m.fileName || fileNameFromContent(m.content);
    const url = dlBlobsRef.current[m.content] || m.content;
    if (isPreviewableFile(name)) {
      window.open(url, "_blank", "noopener,noreferrer"); // 预览：不 await（保用户手势，避免弹窗拦截），失效则新标签自显 404
      return;
    }
    // 另存：用远端 URL 时先验失效——避免"能看却下不了"只丢一个浏览器下载失败（见铁律 A 讨论）。
    if (url === m.content && await markExpiredIfGoneRef.current(m)) {
      setToast(m.contentType === "image" ? "图片已失效" : m.contentType === "video" ? "视频已失效" : "文件已失效");
      return;
    }
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  }, []);

  /**
   * 右键菜单「下载」：把这条图片/视频/文件**保存到本地**（浏览器下载目录，如 ~/Downloads）。复用应用内已下的 blob
   * （dlBlobs），否则拉远端 URL（同源，`download` 属性生效）——与 openReadyFile 的另存分支同一套落盘逻辑。
   */
  const saveMessageToDisk = useCallback(async (m: ChatMessage) => {
    if (!m.content) return;
    const name = m.fileName || fileNameFromContent(m.content);
    const url = dlBlobsRef.current[m.content] || m.content;
    // 用远端 URL 时先验失效：Chrome 可能靠 HTTP 缓存还显示着图，但源已删——下载会 404。先探一次，
    // 命中则 toast「已失效」+ 标记（下次渲染各面统一显失效），不再丢一个懵的浏览器下载失败（铁律 A 讨论）。
    if (url === m.content && await markExpiredIfGoneRef.current(m)) {
      setToast(m.contentType === "image" ? "图片已失效" : m.contentType === "video" ? "视频已失效" : "文件已失效");
      return;
    }
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  }, []);

  /**
   * 手动下载到应用内缓存（带真进度）。失败分因：404/410=服务端已清理 → "文件已失效"、不给重试。
   * 刷新会丢（blob URL 活在本页生命周期内），与上传的同类限制一致。
   */
  const startDownload = useCallback(async (m: ChatMessage) => {
    const key = m.content;
    if (!key || dlBlobsRef.current[key]) return;
    // 只在真正发起时记（mediaGate 每次 render 都会走，绝不能在那里打日志）。
    const startedAt = Date.now();
    logger.info(LOG_TAG.media, "download_start", {
      conv_id: m.convId, conv_seq: m.convSeq, kind: m.contentType, size_bytes: m.fileSize ?? 0,
      file_name: m.fileName,
    });
    setDlStates((p) => ({ ...p, [key]: { phase: "downloading", received: 0, total: m.fileSize ?? 0 } }));
    const ac = new AbortController();
    dlAbortRef.current[key] = ac;
    try {
      const resp = await fetch(key, { signal: ac.signal });
      if (!resp.ok) {
        const gone = resp.status === 404 || resp.status === 410;
        // status 是「文件已失效」与「可重试」分因的依据（与 iOS download_http_error 同语义）。
        logger.warn(LOG_TAG.media, "download_http_error", {
          conv_id: m.convId, conv_seq: m.convSeq, status: resp.status, expired: gone,
        });
        setDlStates((p) => ({ ...p, [key]: { phase: gone ? "expired" : "failed", received: 0, total: m.fileSize ?? 0 } }));
        if (gone) markExpired(key); // 持久失效：刷新后仍显失效、不再回源
        return;
      }
      const total = Number(resp.headers.get("Content-Length")) || m.fileSize || 0;
      let blob: Blob;
      if (resp.body) {
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        // 进度节流：App 很大，若每个数据块都 setState 会整树重渲染上千次。只在整数百分比变化
        // （总大小未知时按 256KB 步进）时才更新；最终 done 会补齐 100%。
        let lastPct = -1, lastAt = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const pct = total > 0 ? Math.floor((received / total) * 100) : -1;
          if (pct !== lastPct || received - lastAt >= 262144) {
            lastPct = pct; lastAt = received;
            setDlStates((p) => ({ ...p, [key]: { phase: "downloading", received, total } }));
          }
        }
        blob = new Blob(chunks as BlobPart[], { type: resp.headers.get("Content-Type") || "application/octet-stream" });
      } else {
        blob = await resp.blob(); // 老浏览器无流式 body：只能等整段（无中间进度）
      }
      const url = URL.createObjectURL(blob);
      setDlBlobs((p) => ({ ...p, [key]: url }));
      // C1：字节写入 Cache Storage + 记入"已下载文件"键集合 → 刷新/离线仍在、秒开（对齐 iOS 落盘）。
      void cachePutBlob(uid, key, blob);
      const dlf = loadStrSet(downloadedFilesKey(uid)); dlf.add(key); saveStrSet(downloadedFilesKey(uid), dlf);
      // 完成即止：只置"就绪"，**不**自动打开/播放（铁律②）。
      setDlStates((p) => ({ ...p, [key]: { phase: "done", received: total, total } }));
      logger.info(LOG_TAG.media, "download_completed", {
        conv_id: m.convId, conv_seq: m.convSeq, bytes: blob.size, duration_ms: Date.now() - startedAt,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // 用户按 ✕ 取消：状态已回落"未下载"，别覆盖成失败
      logger.warn(LOG_TAG.media, "download_failed", {
        conv_id: m.convId, conv_seq: m.convSeq, duration_ms: Date.now() - startedAt, error: (e as Error).message,
      });
      setDlStates((p) => ({ ...p, [key]: { phase: "failed", received: 0, total: m.fileSize ?? 0 } }));
    } finally {
      if (dlAbortRef.current[key] === ac) delete dlAbortRef.current[key];
    }
  }, [uid, markExpired]);

  /**
   * 被动展示路径（气泡/查看器的原件 <img>/<video>）加载失败时的失效复验：
   * <img onError> 分不清「404 已清理」与「解码失败/瞬时抖动」——只对前者才标失效。用一次轻量 ranged GET
   * （服务端 /uploads 支持 Range）读状态码：404/410 → 落持久失效标记（掐 404 风暴）；其余（网络错/解码）不标，
   * 保留可重试/可重载。已知失效则直接跳过，避免 onError 反复触发复验。
   */
  /** 复验 URL 是否已被服务端清理（404/410）：命中即标记并返回 true。已知失效直接 true；网络错/瞬时返回 false（不误标）。 */
  const markExpiredIfGone = useCallback(async (m: ChatMessage): Promise<boolean> => {
    const key = m.content;
    if (!key) return false;
    if (expiredRef.current.has(key)) return true; // 已知失效
    try {
      const resp = await fetch(key, { headers: { Range: "bytes=0-0" } });
      if (resp.status === 404 || resp.status === 410) {
        logger.warn(LOG_TAG.media, "media_verified_expired", {
          conv_id: m.convId, conv_seq: m.convSeq, kind: m.contentType, status: resp.status,
        });
        markExpired(key);
        return true;
      }
      return false;
    } catch {
      return false; /* 网络错/断网：不标失效（可能只是暂时坏了），保留下次重载 */
    }
  }, [markExpired]);
  // 供 openReadyFile / saveMessageToDisk（定义在前）在点击时调用，规避声明顺序；ref 恒稳、不入依赖数组。
  const markExpiredIfGoneRef = useRef(markExpiredIfGone);
  markExpiredIfGoneRef.current = markExpiredIfGone;

  /** 被动展示（气泡/宫格/资料卡的原件 <img>/<video>）加载失败统一入口：先复验 404→失效；否则=编解码失败→标"网页端无法渲染"降级卡（不再破图）。 */
  const onPassiveMediaError = useCallback(async (m: ChatMessage) => {
    const gone = await markExpiredIfGone(m);
    if (!gone) markUnsupported(m.content);
  }, [markExpiredIfGone, markUnsupported]);

  /** 门控卡片点击路由：下载中 → 取消（Web 无断点续传，只能重来）；已失效 → 不响应；其余 → 下载/重试。 */
  const onGateTap = useCallback((m: ChatMessage) => {
    // 本浏览器实测无法渲染的媒体（HEIC 于 Chrome、HEVC 视频等）：无从"解门控预览"，
    // 点击=打开查看器里的降级卡（统一"先开卡再下载"，与媒体库一致）。
    if ((m.contentType === "image" || m.contentType === "video") && unsupportedRef.current.has(m.content)) {
      setViewer({ m });
      return;
    }
    // 图片/视频（方案 B）：只「解门控」——不下 blob、不走状态机，直接用远端 URL 渲染，浏览器 HTTP 缓存兜底。
    if (m.contentType === "image" || m.contentType === "video") {
      setMediaOptedIn((s) => { const n = new Set(s); n.add(m.content); saveOptedIn(uid, n); return n; });
      return;
    }
    // 文件：应用内下载状态机（进度环 / 取消 / 重试）。
    const st = dlStates[m.content];
    if (st?.phase === "expired") return;
    if (st?.phase === "downloading") {
      logger.warn(LOG_TAG.media, "download_cancelled_by_user", {
        conv_id: m.convId, conv_seq: m.convSeq, received: st.received, total: st.total,
      });
      dlAbortRef.current[m.content]?.abort();                                     // 真中止在飞请求，别让它稍后又"完成"
      setDlStates((p) => { const n = { ...p }; delete n[m.content]; return n; }); // 回到"未下载"
      return;
    }
    void startDownload(m);
  }, [uid, dlStates, startDownload]);

  /** 清空应用内媒体缓存（设置 ▸ 数据与存储）：只删本机，云端保留可重下 → 卡片回退"未下载"。 */
  const clearMediaCache = useCallback(() => {
    logger.info(LOG_TAG.media, "media_cache_cleared", { count: Object.keys(dlBlobsRef.current).length });
    Object.values(dlBlobsRef.current).forEach((u) => URL.revokeObjectURL(u));
    setDlBlobs({});
    setDlStates({});
    setMediaOptedIn(new Set()); // 图片/视频回退模糊占位（浏览器 HTTP 缓存里的字节由浏览器自管，无法在此清除）
    void cacheClear(uid);       // C1：清空该账号 Cache Storage 里的持久文件字节
    try {
      localStorage.removeItem(optedInKey(uid));      // 持久 opt-in 一并清，刷新后也真回退
      localStorage.removeItem(downloadedFilesKey(uid)); // 已下载文件键集合
      // 失效标记**不清**：那是"服务端已删"的客观事实，清了只会刷新后再撞一次 404。
    } catch { /* ignore */ }
  }, [uid]);

  const onMediaBubbleTap = useCallback((m: ChatMessage, openViewer: () => void) => {
    const mine = m.from === uid;
    if (mine && m.status === "failed" && m.convSeq === 0 && pendingFilesRef.current.has(m.clientMsgId ?? "")) {
      retryUpload(m);
      return;
    }
    if (mine && m.status === "sending" && m.convSeq === 0 && uploadProgress[m.clientMsgId ?? ""]) {
      toggleUploadPause(m); // 无任务（小文件）时返回 false，无副作用——上传中本就不可查看
      return;
    }
    openViewer();
  }, [uid, uploadProgress, retryUpload, toggleUploadPause]);

  // 附件面板项（数据驱动，M4-6）：加入口 = 数组加一行。Web 只图片或视频 / 文件。
  const attachItems = useMemo(() => [
    { id: "media", label: "图片或视频", accept: MEDIA_PICKER_ACCEPT, icon: ImageIcon }, // 显式扩展名白名单：系统选择器从源头灰掉 HEIC 等（详见 fileTypes.MEDIA_PICKER_ACCEPT）
    { id: "file", label: "文件", accept: "*/*", icon: FileText },
  ], []);
  const pickFile = useCallback((mode: AttachmentPickMode, accept: string) => {
    cancelAttachClose();
    setAttachPanel(false);
    attachmentPickModeRef.current = mode;
    const inp = fileInputRef.current;
    if (inp) { inp.accept = accept; inp.multiple = accept !== "*/*"; inp.value = ""; inp.click(); } // 图片/视频可多选（相册）
  }, [cancelAttachClose]);
  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const mode = attachmentPickModeRef.current;
    if (shouldSendAsMediaBatch(mode)) {
      // 「图片或视频」入口两道闸：① 只收图片/视频（与 iOS 对齐，非媒体请走「文件」入口——accept 只是 UI 提示可被绕过）；
      // ② 挡跨端兼容差的格式：HEIC/MKV 等在多数网页端（Chrome/Firefox）看不了——即便本机是 Safari 能看，
      //    发出去也坑其它网页端收件人 → 拒发，请转成 JPG/PNG/MP4 再发。
      const valid: File[] = [];
      let notMedia = 0, notRenderable = 0;
      for (const f of files) {
        const k = mediaKindForFile(f);
        if (k === null) { notMedia++; continue; }
        if (!webCanRenderMedia(k, f.name)) { notRenderable++; continue; }
        valid.push(f);
      }
      if (notRenderable > 0) setToast("为保证各端可见，已忽略 HEIC 等格式；请转成 JPG/PNG 再发");
      else if (notMedia > 0) setToast(notMedia === files.length ? "只能发送图片或视频" : `已忽略 ${notMedia} 个非图片/视频文件`);
      if (valid.length) void sendMediaBatch(valid);
    } else { for (const f of files) void uploadAndSend(f, "file"); }
  }, [uploadAndSend, sendMediaBatch]);

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
  // 链接富预览抓取（供 LinkCard；稳定引用避免重复请求）。
  const fetchLinkPreview = useCallback(async (url: string): Promise<LinkPreview> => {
    const c = clientRef.current;
    if (!c) throw new Error("未连接");
    return c.linkPreview(url);
  }, []);
  const forwardMessage = useCallback((m: ChatMessage) => { setMenu(null); setForwardMode("each"); setForwarding([m]); }, []);
  // 进入多选态（M4-3）：从消息右键进入时预选当前消息；从标题栏「选择消息」进入时不预选（m 省略）。
  const enterSelectMode = useCallback((m?: ChatMessage) => {
    setMenu(null); setChatMenu(false); setSelectMode(true);
    setSelected(new Set(m && m.convSeq > 0 ? [m.convSeq] : []));
  }, []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  const toggleSelected = useCallback((seq: number) => {
    setSelected((prev) => { const n = new Set(prev); n.has(seq) ? n.delete(seq) : n.add(seq); return n; });
  }, []);
  // 关闭转发选择器并复位多选态（点蒙层 / 取消 / 发送完成统一走这里）。
  const closeForwardPicker = useCallback(() => { setForwarding(null); setForwardMulti(false); setForwardTargets([]); }, []);
  // 多选态切换某个目标会话（上限 MAX_FORWARD_TARGETS，超限吐司，对齐 iOS）。
  // 副作用（吐司）在 updater 外算，避免 StrictMode 双调用致重复吐司。
  const toggleForwardTarget = useCallback((cid: string) => {
    const { next, overflow } = toggleCapped(forwardTargets, cid, MAX_FORWARD_TARGETS);
    if (overflow) { setToast(`最多选择 ${MAX_FORWARD_TARGETS} 个会话`); return; }
    setForwardTargets(next);
  }, [forwardTargets]);
  // 向单个 target 会话发出转发（逐条保留各自类型 / 合并打包 chat_record 一条）。不负责关闭弹窗/吐司。
  const sendForwardToTarget = useCallback((target: Conversation) => {
    const client = clientRef.current;
    const msgs = forwarding;
    if (!client || !msgs) return;
    const to = target.is_group ? "" : target.peer;
    // 发送者显示名：自己→uid；否则群成员昵称（直接读 groupInfos 状态，避免依赖后声明的 memberNick）→ 回退 uid。
    const nameOf = (m: ChatMessage) => { const gm = groupInfos[m.convId]?.members.find((x) => x.user_id === m.from); return m.from === uid ? uid : (m.fromNickname || gm?.group_nickname || gm?.nickname || m.from); };
    const pushOptimistic = (clientMsgId: string, content: string, contentType: string, forwardFrom?: string, fileName?: string, fileSize?: number, posterUrl?: string, thumb?: string) =>
      appendMsg(target.conv_id, { clientMsgId, convId: target.conv_id, from: uid, content, contentType, fileName, fileSize, posterUrl, thumb, convSeq: 0, timestamp: Date.now(), status: "sending", ...(forwardFrom ? { forwardFrom } : {}) });

    if (forwardMode === "merged" && msgs.length > 0) {
      const items: RecordItem[] = msgs
        .filter((m) => m.content && !m.recalledAt && m.contentType !== "system" && m.convSeq > 0)
        .map((m) => ({
          n: nameOf(m), ct: m.contentType || "text", c: m.content,
          // 文件行随包携带原名与大小（fn/fs，与 iOS 同约定）——收端不再只显「[文件]」。
          ...(m.contentType === "file"
            ? { fn: m.fileName || fileNameFromContent(m.content), ...(m.fileSize ? { fs: m.fileSize } : {}) }
            : {}),
        }));
      const names = new Set(items.map((i) => i.n));
      const title = names.size <= 1 ? `${[...names][0] || "聊天"} 的聊天记录` : "群聊的聊天记录";
      const json = JSON.stringify({ t: title, items });
      const clientMsgId = client.sendMedia(json, "chat_record", to, target.conv_id);
      pushOptimistic(clientMsgId, json, "chat_record");
    } else {
      for (const m of msgs) {
        if (!m.content || m.recalledAt) continue;
        const origin = m.forwardFrom || m.fromNickname || m.from; // 转发链保留最初作者
        const ct = m.contentType || "text";
        // 保留原类型：图片/视频/文件按 media 转发（否则收方收到的是 URL 文本、会话预览也丢 [图片]）。
        const clientMsgId = ct === "text"
          ? client.sendText(m.content, to, target.conv_id, { forwardFrom: origin })
          // 转发也要带上媒体尺寸/时长 + **封面/缩略图**：源消息手上就有，丢了收端就只能按未知渲染
          // （视频没 poster → 资料卡宫格只能抓首帧甚至裂图；且事后补不回来）。poster/thumb 对文件为空，无害。
          : client.sendMedia(m.content, ct, to, target.conv_id, {
              forwardFrom: origin, fileName: m.fileName, fileSize: m.fileSize,
              mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration,
              poster: m.posterUrl, thumb: m.thumb,
            });
        pushOptimistic(clientMsgId, m.content, ct, origin, m.fileName, m.fileSize, m.posterUrl, m.thumb);
      }
    }
  }, [forwarding, forwardMode, groupInfos, appendMsg, uid]);
  // 执行转发到一个或多个目标：全部发出后关闭弹窗、退出多选、单条吐司汇总。
  const doForwardToTargets = useCallback((targets: Conversation[]) => {
    if (targets.length === 0) return;
    targets.forEach(sendForwardToTarget);
    closeForwardPicker();
    exitSelectMode();
    setToast(targets.length === 1
      ? `已转发到 ${targets[0].is_group ? (targets[0].name || "群聊") : (targets[0].peer_remark || targets[0].peer_nickname || targets[0].peer)}`
      : `已转发到 ${targets.length} 个会话`);
  }, [sendForwardToTarget, closeForwardPicker, exitSelectMode]);
  // 多选批量转发：收集选中的消息，打开选择器。
  const forwardSelected = useCallback(() => {
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    const list = (msgsByConv[cid] ?? []).filter((m) => m.convSeq > 0 && selected.has(m.convSeq) && !m.recalledAt);
    if (list.length > 0) { setForwardMode("each"); setForwarding(list); }
  }, [msgsByConv, peer, uid, groupConvId, selected]);
  // 多选批量删除（仅本端）。
  const deleteSelected = useCallback(() => {
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
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
    // 图片：复制真实图片字节（可粘贴回输入框直接发图）；失败或非图片：复制文本/URL。
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
  // 把一段文本渲染为高亮 @提及的节点：命中的 `@昵称` token 上色；有 uid 且非多选态时可点 → 跳该成员资料页。
  // @所有人 无 uid 只高亮不可点。无提及时直接返回字符串。
  const renderMentionText = (m: ChatMessage, text: string) => {
    const entries = mentionEntriesFor(m);
    if (entries.length === 0) return text;
    const uidByName = new Map(entries.map((e) => [e.name, e.uid]));
    return segmentMentions(text, entries.map((e) => e.name)).map((s, i) => {
      if (!s.mention) return s.text;
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
      comingSoon,
    }),
    [copyMessage, replyMessage, forwardMessage, favoriteMessage, saveMessageToDisk, editMessage, translateMessage, enterSelectMode, recallMessage, pinMessage, deleteMessage, reportMessage, cancelSendMessage, comingSoon],
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

  // 主题：真功能——写 <html data-theme> 驱动 CSS 变量切换（浅/深/跟随系统）+ 持久化。
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("im.theme", theme);
  }, [theme]);
  // 监听系统深色偏好变化（仅影响 theme==="system"）；用于自动壁纸随明暗切换。
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // 当前实际是否深色：显式 dark，或跟随系统且系统为深色。
  const isDark = theme === "dark" || (theme === "system" && systemDark);
  // 消息字体大小：真功能——写 CSS 变量 --msg-font 驱动消息气泡文本字号 + 持久化。
  useEffect(() => {
    localStorage.setItem("im.fontSize", String(fontSize));
    document.documentElement.style.setProperty("--msg-font", `${fontSize}px`);
  }, [fontSize]);
  useEffect(() => { localStorage.setItem("im.timeFormat", timeFormat); }, [timeFormat]);
  useEffect(() => { localStorage.setItem("im.sendKey", sendKey); }, [sendKey]);
  useEffect(() => {
    // 依赖 isDark：auto 壁纸在明暗切换时需重新解析（深色默认 midnight / 浅色默认 dawn）。
    document.documentElement.style.setProperty("--chat-wallpaper", wallpaperCSS(wallpaper, isDark));
    try {
      localStorage.setItem("im.wallpaper", JSON.stringify(wallpaper));
    } catch {
      setToast("图片较大，壁纸仅在本次页面有效");
    }
  }, [wallpaper, isDark]);
  useEffect(() => {
    document.documentElement.style.setProperty("--wallpaper-blur", wallpaperBlur ? "10px" : "0px");
    document.documentElement.style.setProperty("--wallpaper-scale", wallpaperBlur ? "1.06" : "1");
    localStorage.setItem("im.wallpaperBlur", wallpaperBlur ? "1" : "0");
  }, [wallpaperBlur]);

  const pickWallpaperImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("请选择图片文件");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setToast("图片不能超过 8 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setWallpaper({ kind: "image", value: reader.result });
    };
    reader.onerror = () => setToast("读取图片失败");
    reader.readAsDataURL(file);
  };

  const resetWallpaper = () => {
    setWallpaper(DEFAULT_WALLPAPER);
    setWallpaperBlur(false);
  };

  const applyWallpaperColor = (next: HSVColor) => {
    const normalized = { h: clamp(next.h, 0, 360), s: clamp(next.s), v: clamp(next.v) };
    setColorHSV(normalized);
    setWallpaper({ kind: "color", value: hsvToHex(normalized) });
  };

  const openWallpaperColor = () => {
    setColorHSV(hexToHSV(wallpaper.kind === "color" ? wallpaper.value : "#567e71"));
    setWallpaperColorOpen(true);
  };

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
    const cid = peer ? convIdFor(uid, peer) : groupConvId;
    if (val && cid && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      clientRef.current?.sendTyping(cid);
    }
  }, [peer, groupConvId, uid, mentionQuery]);

  /**
   * @面板当前候选行（渲染与键盘导航共用同一份，避免两处各算一次导致高亮与实际选中错位）。
   * 「@所有人」占首位、仅群主/管理员且无过滤词时出现（一旦开始搜人，列表就该只剩人）。
   */
  const mentionRows = useMemo(() => {
    if (mentionQuery === null || !groupConvId || peer) return [];
    const info = groupInfos[groupConvId];
    if (!info) return [];
    const others = info.members
      .filter((m) => m.user_id !== uid)
      .map((m) => ({ userId: m.user_id, displayName: m.nickname || m.user_id, role: m.role, avatarUrl: m.avatar_url }));
    // 生效过滤词：用户在面板搜索框主动打字时以搜索框为准（独立搜索）；否则跟随消息框 @后的字符（mentionQuery）。
    // 二者互不写入对方，故搜索框不会被 @文字自动回填；清空搜索框即回落到消息框驱动。
    const effQuery = mentionFilter.trim() !== "" ? mentionFilter : mentionQuery;
    const hits = filterMentionMembers(others, effQuery);
    const rows: { label: string; userId: string | null; role?: string; avatarUrl?: string; note?: string }[] =
      hits.map((m) => ({ label: m.displayName, userId: m.userId, role: m.role, avatarUrl: m.avatarUrl }));
    if (canMentionAll(info.my_role) && effQuery.trim() === "") {
      rows.unshift({ label: MENTION_ALL_LABEL, userId: null, note: `通知全部 ${others.length} 人` });
    }
    return rows;
  }, [mentionQuery, mentionFilter, groupConvId, peer, groupInfos, uid]);

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
  const onMentionNavKey = (e: React.KeyboardEvent<HTMLElement>): boolean => {
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

  const stateText = { connected: "已连接", connecting: "连接中…", disconnected: "未连接" }[state];

  const convId = peer ? convIdFor(uid, peer) : groupConvId;
  // 进会话拉一次置顶集合（G0）；切会话时把横幅索引复位到第一条。
  useEffect(() => {
    setPinnedIdx(0);
    setPinnedListOpen(false);
    if (convId) void refreshPinned(convId);
  }, [convId, refreshPinned]);

  // 切换会话时清空 @提及态（M4-8）：input 不随会话清空，候选表若留到下一个会话，
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
  // 按时间戳排序（发送中/失败的 convSeq=0 但有发送时刻，故按时间能正确落位——
  // 否则它们会被挤到末尾，导致"解除拉黑后新发的消息排在更早的失败消息之前"）。
  // conv_seq 仅作同一毫秒内的次级排序，保证已送达消息间仍按服务端顺序。
  const messages = (msgsByConv[convId] ?? [])
    .slice()
    .sort((a, b) => (a.timestamp - b.timestamp) || ((a.convSeq || Number.MAX_SAFE_INTEGER) - (b.convSeq || Number.MAX_SAFE_INTEGER)));
  messagesRef.current = messages; // 每次渲染同步镜像（jumpToSeq 等早于此处定义，经 ref 取当前值）
  // 任务3 · 查看器媒体时间线：当前会话全部图/视频按时序混排，供查看器左右翻页（Telegram 式）。
  // 口径与媒体库一致（image|video && 未撤回 && content 非空）；仅覆盖**内存中已加载**的消息——翻到头即停，
  // 不自动拉更早（第一版约定）。合成消息（收藏/记录预览：convSeq=0 且不在会话流内）mediaId 找不到 → 不显箭头、不翻页。
  //
  // 稳定标识 mediaId：**必须用 convSeq**（会话内唯一，收到/同步的消息都有）。绝不能用 clientMsgId——
  // 入站消息（别人发的 + 自己刷新后重新同步的）在 imSdk.processIncoming 里根本不写 clientMsgId（全为 undefined），
  // 一旦拿它 findIndex，会一律命中"第一条 undefined"的媒体，导致点最后一张却定位到最前、翻页错乱/卡死。
  // 仅本地待发件（convSeq=0）无 convSeq，回退用其本地生成的 clientMsgId。见 album.ts mediaIdentity。
  const viewerList = viewer
    ? messages.filter((mm) => isViewableMedia(mm) && !!mm.content)
    : [];
  const viewerIdx = viewer ? viewerList.findIndex((mm) => mediaIdentity(mm) === mediaIdentity(viewer.m)) : -1;
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

  // 层2：落地页「在网页版中打开」带 /?qr=<邀请链接> 进来——挂载时截获并从地址栏剥离（防刷新重放/泄露到历史），
  // 登录进入主界面后按扫码同款流程处理（未登录先登录再续，与扫码登录的 pending 套路同理）。
  // ⚠️ 必须放在下方 `if (phase === "login") return` 之前：hook 在提前 return 之后会随 phase 改变 hook 数量
  // → "Rendered more hooks than during the previous render" 白屏（2026-08-14 踩过）。
  // handleScanRaw 定义在提前 return 之后：仅在 phase==="app" 的渲染里才会被 effect 读到，届时已初始化，无 TDZ。
  const bootQrRef = useRef<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const q = sp.get("qr");
    if (!q) return;
    bootQrRef.current = q;
    sp.delete("qr");
    history.replaceState(null, "", location.pathname + (sp.toString() ? `?${sp.toString()}` : "") + location.hash);
  }, []);
  useEffect(() => {
    if (phase !== "app" || !bootQrRef.current) return;
    const raw = bootQrRef.current;
    bootQrRef.current = null;
    void handleScanRaw(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ---- 登录 ----
  if (phase === "login") {
    if (restoring) {
      // 恢复登录过渡态（Web #4）：有已存会话时不闪登录表单，静默重登成功直达主界面。
      return (
        <div className="login">
          <img className="login-logo" src="/im-logo.png" alt="" aria-hidden="true" />
          <h1>IM Web</h1>
          <p className="hint">正在恢复登录（{uid}）…</p>
        </div>
      );
    }
    return (
      <div className="login">
        <img className="login-logo" src="/im-logo.png" alt="" aria-hidden="true" />
        <h1>IM Web 登录</h1>
        <div className="login-tabs">
          <button className={`login-tab${loginTab === "password" ? " on" : ""}`} onClick={() => setLoginTab("password")}>密码登录</button>
          <button className={`login-tab${loginTab === "qr" ? " on" : ""}`} onClick={() => setLoginTab("qr")}>扫码登录</button>
        </div>
        {/* 鉴权失效原因（如被踢下线）在两个页签下都要可见——被踢时可能正停在扫码页。 */}
        {authErr && <p className="auth-err">{authErr}</p>}
        {loginTab === "password" ? (
          <>
            <label>用户名<input value={uid} autoFocus onChange={(e) => setUid(e.target.value.trim())} /></label>
            <label>密码<input type="password" value={password} placeholder="≥ 6 位"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void enterApp(password); }} /></label>
            <button disabled={authBusy} onClick={() => void enterApp(password)}>登录</button>
            <button className="secondary" disabled={authBusy} onClick={() => void doRegister()}>注册并登录</button>
            <p className="hint">
              真账号密码登录。先启动后端 <code>go run ./cmd/imserver</code>。<br />
              仅调试：<button className="link-inline" disabled={authBusy} onClick={() => void enterApp("")}>免密登录</button>（需后端开启 dev-login）。
            </p>
          </>
        ) : (
          <QRLoginTab onLogin={(loginUid, token) => {
            pendingQrRef.current = { uid: loginUid, token };
            setUid(loginUid);
            setQrTrigger((n) => n + 1); // uid 不变时也强制触发入场 effect
          }} />
        )}
      </div>
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
    if (!isGroupChat || !activeGroupInfo) return null;
    if ((activeGroupInfo.my_mute_until ?? 0) > Date.now()) return "你已被管理员禁言";
    if ((activeGroupInfo.mute_until ?? 0) > Date.now() && activeGroupInfo.my_role === "member") return "本群已开启全员禁言";
    return null;
  })();

  const activeGroupConv = groupConvId ? conversations.find((c) => c.conv_id === groupConvId) : undefined;
  // 群备注（G1，仅本人可见，本地存储）——定义在 chatTitle/详情用它之前，避免 TDZ。
  const groupRemarkKey = (cid: string) => `im.grpremark.${uid}.${cid}`;
  const groupRemark = (cid: string): string => localStorage.getItem(groupRemarkKey(cid)) ?? "";
  const chatTitle = isGroupChat
    ? (groupRemark(groupConvId) || activeGroupInfo?.name || activeGroupConv?.name || "群聊")
    : peerLabel;
  void groupRemarkTick; // 群备注（本地）变更后重渲染聊天标题
  const chatMemberCount = activeGroupInfo?.members.length ?? activeGroupConv?.member_count ?? 0;
  const chatAvatarURL = isGroupChat
    ? (activeGroupInfo?.avatar_url || activeGroupConv?.avatar_url)
    : (peerConv?.peer_avatar_url || peerAvatar(peer));
  const chatSubtitle = isGroupChat
    ? (chatMemberCount > 0 ? `${chatMemberCount} 位成员` : "群聊")
    // 单聊：真实在线态（原先「最近上线」是写死的假文案，对谁都显示）。取不到快照时为空串，不占位。
    : presenceText(presence[peer]);
  const visibleChatSubtitle = convId && typingConv === convId ? "正在输入" : chatSubtitle;
  // 群成员昵称（气泡回退用）：优先消息自带 from_nickname，其次成员表缓存，最后 uid。
  const memberNick = (cid: string, id: string): string => {
    const m = groupInfos[cid]?.members.find((x) => x.user_id === id);
    // 群昵称优先（G1），回退全局昵称；都无返回空串让调用方回退 uid。
    return (m?.group_nickname && m.group_nickname.trim()) || (m?.nickname && m.nickname.trim()) || "";
  };
  const senderLabel = (m: ChatMessage): string => m.fromNickname || memberNick(m.convId, m.from) || m.from;
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
  // 两条消息是否属于同一「连续段」：同发送者、非系统/撤回、同一天（跨天有日期分隔断段）。
  const sameSenderRun = (a?: ChatMessage, b?: ChatMessage): boolean =>
    !!a && !!b && a.from === b.from && a.from !== uid &&
    a.contentType !== "system" && b.contentType !== "system" &&
    !a.recalledAt && !b.recalledAt && isSameDay(a.timestamp, b.timestamp);
  // 上/下一「可见消息」（跳过相册零高从行；多选态相册展开为独立行则不跳）——用于连续段首/末判定。
  const prevVisibleMsg = (list: ChatMessage[], i: number): ChatMessage | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      if (!selectMode && isAlbumMember(list[j]) && !isAlbumLeader(list, j)) continue;
      return list[j];
    }
    return undefined;
  };
  const nextVisibleMsg = (list: ChatMessage[], i: number): ChatMessage | undefined => {
    for (let j = i + 1; j < list.length; j++) {
      if (!selectMode && isAlbumMember(list[j]) && !isAlbumLeader(list, j)) continue;
      return list[j];
    }
    return undefined;
  };
  // 会话列表项显示名/头像/预览（群聊 vs 单聊）。
  const convDisplayLabel = (c: Conversation) => (c.is_group ? (c.name || "群聊") : convLabel(c));
  const convAvatarUrl = (c: Conversation) => (c.is_group ? c.avatar_url : c.peer_avatar_url);
  const mediaPreview = (ct: string): string | null =>
    ct === "image" ? "[图片]" : ct === "video" ? "[视频]" : ct === "file" ? "[文件]" : ct === "chat_record" ? "[聊天记录]" : null;
  const convPreview = (c: Conversation): string => {
    if (!c.last_message) return "（无消息）";
    // 撤回消息预览（后端已脱敏 content）：显示"撤回了一条消息"（微信式）。
    if (c.last_message.recalled_at) {
      const who = c.last_message.from === uid ? "你" : (c.is_group ? (c.last_message.from_nickname || c.last_message.from) : "对方");
      return `${who}撤回了一条消息`;
    }
    const media = mediaPreview(c.last_message.content_type); // 图片/视频/文件 → [图片] 等
    const text = media ?? c.last_message.content;
    if (!c.is_group) return text;
    if (c.last_message.content_type === "system") return c.last_message.content; // 系统消息无发送者前缀
    const who = c.last_message.from === uid ? "我" : (c.last_message.from_nickname || c.last_message.from);
    return `${who}: ${text}`;
  };

  // 群动作统一包装：执行 → 刷新群资料 + 会话列表；失败 alert。
  const doGroupAction = async (cid: string, fn: () => Promise<void>) => {
    try {
      await fn();
      void refreshGroupInfo(cid);
      void refreshConversations();
    } catch (e) {
      setToast(`操作失败：${(e as Error).message}`);
    }
  };

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

  // 清空聊天记录（仅本机，对齐 iOS）：清 IndexedDB → 通知聊天区刷新 → 关面板。
  const doClearHistory = (cid: string) => {
    void (async () => {
      if (!(await askConfirm("清空聊天记录？将删除此会话在本机的全部消息，且无法恢复。", { okText: "清空", danger: true }))) return;
      await clearMessages(uid, cid);
      setMsgsByConv((prev) => ({ ...prev, [cid]: [] })); // 内存同步清空（当前会话/缓存）
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

  // 改群名（群主/管理员）：轻量 prompt，回车确定。
  const doRenameGroup = async (gp: GroupInfo) => {
    const name = await askPrompt("修改群名", gp.name, { placeholder: "群名（1~30 字）", okText: "保存", maxLength: 30 });
    if (name === null || !name.trim() || name.trim() === gp.name) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, name.trim(), gp.avatar_url, gp.intro ?? ""));
  };

  // 群简介（G1，群主/管理员）：整体替换，随群资料写。
  const doEditIntro = async (gp: GroupInfo) => {
    const intro = await askPrompt("群简介", gp.intro ?? "", { placeholder: "介绍这个群（≤200 字）", okText: "保存", maxLength: 200, multiline: true });
    if (intro === null || intro.trim() === (gp.intro ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.updateGroup(gp.conv_id, gp.name, gp.avatar_url, intro.trim()));
  };

  // 群公告（G1，群主/管理员）：发布走独立接口并落系统消息；清空文本=撤下。
  const doEditAnnouncement = async (gp: GroupInfo) => {
    const text = await askPrompt("群公告", gp.announcement ?? "", {
      placeholder: "发布后通知全体成员", okText: "发布", maxLength: 500, multiline: true,
      // 已有公告时提供「撤下」危险动作 = 发空串（决策 18，与「发布」区分）。
      extraAction: (gp.announcement ?? "").trim() ? { label: "撤下公告", value: "", danger: true } : undefined,
    });
    if (text === null || text.trim() === (gp.announcement ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupAnnouncement(gp.conv_id, text.trim()));
  };

  // 全员禁言开关（G1，群主/管理员）：开=永久（-1），关=解除（0）。
  const doToggleGroupMute = async (gp: GroupInfo, turnOn: boolean) => {
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupMute(gp.conv_id, turnOn ? -1 : 0));
  };

  // 群治理开关组（G2，群主/管理员）：翻转某个布尔位，整组回带当前值上报（后端整体替换）。
  const doToggleGroupSetting = async (gp: GroupInfo, key: "join_approval" | "perm_invite" | "perm_edit_info" | "perm_pin" | "history_visible") => {
    const s = {
      join_approval: !!gp.join_approval, perm_invite: !!gp.perm_invite,
      perm_edit_info: !!gp.perm_edit_info, perm_pin: !!gp.perm_pin, history_visible: !!gp.history_visible,
    };
    s[key] = !s[key];
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupSettings(gp.conv_id, s));
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

  // 扫到原文 → 服务端 resolve → 按 kind 展示分支；码失效（200110）走「已失效」分支。
  const handleScanRaw = async (raw: string) => {
    setQrScan(false);
    try {
      const data = await clientRef.current!.qrResolve(raw);
      setQrResult({ data, raw });
    } catch (e) {
      if (errorCode(e) === 200110) setQrResult({ data: { kind: "expired" }, raw });
      else setToast((e as Error).message);
    }
  };

  const openMyCard = async () => {
    try {
      const card = await clientRef.current!.qrMyCard();
      setQrCardModal({ title: "我的二维码", subtitle: "扫描二维码，加我为朋友",
        name: myInfo?.nickname || uid, avatarUrl: myInfo?.avatar_url, card, canReset: true, kind: "me" });
    } catch (e) { setToast(`获取名片码失败：${(e as Error).message}`); }
  };

  const openGroupCard = async (cid: string) => {
    const gi = groupInfos[cid];
    const canManage = gi?.my_role === "owner" || gi?.my_role === "admin";
    // perm_invite=1 时群码即邀请链接，仅群主/管理员可出示。无权限时不打开模态、直接中文吐司（对齐 iOS）。
    if (gi?.perm_invite && !canManage) {
      setToast("群主已开启「仅管理员可邀请」，你无法出示群二维码");
      return;
    }
    try {
      const card = await clientRef.current!.groupQR(cid);
      setQrCardModal({ title: "群二维码", subtitle: "扫描二维码，加入群聊",
        name: gi?.name || "群聊", avatarUrl: gi?.avatar_url, card, canReset: canManage, kind: "group", convId: cid });
    } catch (e) {
      // 服务端兜底（本地 perm_invite 可能过期）：300204 映射为中文，其余透传。
      const msg = errorCode(e) === 300204
        ? "群主已开启「仅管理员可邀请」，你无法出示群二维码"
        : `获取群二维码失败：${(e as Error).message}`;
      setToast(msg);
    }
  };

  // 名片码/群码重置：换新码（旧码立即失效），更新模态内展示。
  // 失败必须自己吞并提示——模态里的确认按钮只有 try/finally，抛出去会变成未处理的 rejection 且界面毫无反馈。
  const resetQRCard = async () => {
    const m = qrCardModal;
    if (!m) return;
    try {
      const card = m.kind === "me"
        ? await clientRef.current!.qrResetMyCard()
        : await clientRef.current!.groupQRReset(m.convId!);
      setQrCardModal({ ...m, card });
      setToast("二维码已重置，旧码已失效");
    } catch (e) {
      setToast(`重置失败：${(e as Error).message}`);
    }
  };

  // 扫码结果的动作集：加好友 / 发消息 / 看资料 / 加群 / 进群。
  const qrResultActions = {
    onAddFriend: async (peer: string) => {
      const became = await clientRef.current!.requestFriend(peer);
      setToast(became ? "已添加为好友" : "已发送好友申请");
      void refreshFriends();
    },
    onMessage: (peer: string) => openChat(peer),
    onViewProfile: (peer: string) => openPeerDetail(peer),
    onEnterGroup: (cid: string) => openGroupChat(cid),
    // 凭扫到的原始码入群：直连成功进群；需审批（300210）转"已提交"提示；已满/黑名单等透传文案。
    onJoinGroup: async (hello: string) => {
      const raw = qrResult?.raw ?? "";
      try {
        const info = await clientRef.current!.joinGroupByCode(raw, hello);
        setToast(`已加入「${info.name}」`);
        await refreshConversations();
        openGroupChat(info.conv_id);
      } catch (e) {
        if (errorCode(e) === 300210) setToast("入群申请已提交，等待管理员审批");
        else setToast((e as Error).message);
      }
    },
  };

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
  const doEditMyGroupNickname = async (gp: GroupInfo) => {
    const nick = await askPrompt("我在本群的昵称", gp.my_nickname ?? "", { placeholder: "群内可见（≤20 字，留空恢复默认）", okText: "保存", maxLength: 20 });
    if (nick === null || nick.trim() === (gp.my_nickname ?? "")) return;
    await doGroupAction(gp.conv_id, () => clientRef.current!.setGroupMyNickname(gp.conv_id, nick.trim()));
  };

  // 群备注（G1，仅本人可见）：改我看到的群名，本地存储（localStorage keyed by uid+convId）。
  // 说明：后端已有会话级 remark 字段（多端同步），Web 现用本地存储与 iOS 对齐，多端同步为后续项。
  const doEditGroupRemark = async (gp: GroupInfo) => {
    const cur = groupRemark(gp.conv_id);
    const v = await askPrompt("群备注", cur, { placeholder: `${gp.name}（仅自己可见）`, okText: "保存", maxLength: 30 });
    if (v === null || v.trim() === cur) return;
    if (v.trim()) localStorage.setItem(groupRemarkKey(gp.conv_id), v.trim());
    else localStorage.removeItem(groupRemarkKey(gp.conv_id));
    setGroupRemarkTick((n) => n + 1); // 触发标题/会话列表重渲染
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

  // 通用菜单行：图标可选、右侧值/箭头可选、danger 红色。account card / settings / contacts entries 共用。
  // iconTint：设置 iOS 风格圆角色块（对齐 IMSettingsViewController 的 systemColor 分色）；不给则渲染裸图标（账号气泡卡沿用旧样式）。
  type Row = { id: string; label: string; icon?: LucideIcon; iconTint?: string; value?: string; danger?: boolean; chevron?: boolean; onClick: () => void };

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
      { id: "privacy", label: "隐私与安全", icon: Lock, iconTint: "indigo", chevron: true, onClick: () => void openBlacklist() },
      { id: "folders", label: "聊天文件夹", icon: Folder, iconTint: "blue", chevron: true, onClick: () => comingSoon("聊天文件夹") },
      { id: "devices", label: "已登录设备", icon: MonitorSmartphone, iconTint: "teal", chevron: true, onClick: () => { setDevicesOpen(true); void loadDevices(); } },
      { id: "language", label: "语言", icon: Languages, iconTint: "purple", value: "简体中文", chevron: true, onClick: () => comingSoon("语言") },
      { id: "stickers", label: "贴纸与表情", icon: Smile, iconTint: "pink", chevron: true, onClick: () => comingSoon("贴纸与表情") },
    ],
  ];

  // 设置页顶部名片下的资料卡（手机号/用户名）。
  const settingsInfoRows: Row[] = [
    { id: "phone", label: myInfo?.phone || "未设置", icon: Phone, iconTint: "green", value: "手机号", onClick: () => void openProfile() },
    { id: "username", label: `@${uid}`, icon: AtSign, iconTint: "blue", value: "用户名", onClick: () => void openProfile() },
    { id: "qr", label: "我的二维码", icon: QrCode, iconTint: "gray", value: "", chevron: true, onClick: () => void openMyCard() },
  ];

  // 通讯录顶部入口行（数据驱动）。
  const contactEntries: Row[] = [
    { id: "groups", label: "群聊", icon: Users, iconTint: "blue", chevron: true, onClick: () => void openGroupsModal() },
    { id: "official", label: "公众号", icon: Megaphone, iconTint: "orange", chevron: true, onClick: () => comingSoon("公众号") },
    { id: "service", label: "服务号", icon: Headphones, iconTint: "teal", chevron: true, onClick: () => comingSoon("服务号") },
  ];

  // 通用行渲染（cls 区分容器样式）。
  const renderRow = (r: Row, cls: string) => (
    <button key={r.id} className={`${cls}${r.danger ? " danger" : ""}`} onClick={r.onClick}>
      {r.icon && (r.iconTint
        ? <span className={`row-icon-tile ${r.iconTint}`}><r.icon size={17} /></span>
        : <r.icon size={20} className="row-icon" />)}
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
              {/* 免打扰置灰未读数，但**被 @ 时破例回到高亮**——免打扰只压普通消息，不压 @我（M4-8）。 */}
              {c.unread > 0
                ? <span className={`badge ${c.muted && !c.mention_unread ? "muted" : ""}`}>{c.unread > 99 ? "99+" : c.unread}</span>
                : c.marked_unread ? <span className={`badge dot ${c.muted ? "muted" : ""}`} aria-label="未读" /> : null}
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
            <button className="newchat-qr" title="扫一扫 / 我的二维码" aria-label="扫一扫" onClick={() => setQrScan(true)}><QrCode size={18} /></button>
          </div>
          <div className="contact-entries">
            {contactEntries.map((r) => renderRow(r, "entry-row"))}
          </div>
          <div className="convlist" ref={contactsScrollRef}>
            {searchResults !== null && (
              <>
                <div className="section-label">搜索结果</div>
                {searchResults.length === 0 && <div className="empty">没有找到匹配的用户</div>}
                {searchResults.map((u) => {
                  const st = friendStatus.get(u.user_id);
                  return (
                    <div key={`s-${u.user_id}`} className="convitem static">
                      <Avatar url={u.avatar_url} label={labelOf(u.user_id, u.nickname)} seed={u.user_id} />
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
                    <Avatar url={f.avatar_url} label={labelOf(f.user_id, f.nickname)} seed={f.user_id} />
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

            <div className="section-label with-action">
              <span>好友（{contactFilterQ ? `${filteredAccepted.length}/${accepted.length}` : accepted.length}）</span>
              {accepted.length > 0 && (
                <input className="contact-filter-input" value={contactFilter} placeholder="搜索好友"
                  onChange={(e) => setContactFilter(e.target.value)} />
              )}
            </div>
            {accepted.length === 0 && <div className="empty">还没有好友，上面搜索用户添加吧</div>}
            {accepted.length > 0 && filteredAccepted.length === 0 && <div className="empty">没有匹配的好友</div>}
            {/* 好友列表虚拟化：只渲染视口内可见行，2000 好友首屏渲染从 ≈530ms 降到 <100ms
                （LOAD_TESTING 场景⑥）。共用 .convlist 滚动，上方搜索/新朋友/标签同处一个滚动条。 */}
            <VirtualList
              items={filteredAccepted}
              scrollElRef={contactsScrollRef}
              getKey={(f) => f.user_id}
              renderRow={(f) => (
                <div className="convitem" onClick={() => openFriendChat(f.user_id)}>
                  <Avatar url={f.avatar_url} label={friendLabel(f)} seed={f.user_id}>
                    {isOnline(presence[f.user_id]) && <span className="presence-dot" />}
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
              )}
            />
          </div>
        </div>
        )}

        {/* 设置面板：占据侧栏列（绝对定位），右侧聊天 .main 保持不动、可继续聊（对齐 Telegram Web）。 */}
        {showSettings && (
          <div className="settings-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setShowSettings(false)}><ChevronLeft size={27} /></button>
              <span className="settings-title">设置</span>
              <button className="icon-btn" title="编辑资料" onClick={() => void openProfile()}><SquarePen size={24} /></button>
            </header>
            <div className="settings-body">
              <div className="settings-profile">
                <Avatar url={myInfo?.avatar_url} label={myInfo?.nickname || uid} seed={uid} cls="settings-avatar" />
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

        {/* 数据与存储（M4-7，草图 §05/§06/§09）：Web 只呈现 **Wi-Fi / 不限流量** 这一档——
            浏览器无法可靠区分移动/Wi-Fi，桌面也没有流量焦虑；改动仍随账号同步回移动端。
            存储用量是**本页应用内缓存**（手动下载的 blob），刷新即失效，故不与移动端同步。 */}
        {dataStorageOpen && (() => {
          const st = dlSettings ?? defaultDownloadSettings();
          const wifi = st.wifi;
          const tier: SpeedTier = tierOfPolicy(wifi);
          const patchWifi = (next: typeof wifi) => void saveDownloadSettings({ ...st, wifi: next });
          // 已缓存 = 应用内 blob（文件）+ 已解门控的图片/视频（方案 B，走浏览器 HTTP 缓存）。
          const cachedCount = Object.keys(dlBlobs).length + mediaOptedIn.size;
          // 单聊/群聊自动下载开关子行（图片/视频/文件共用）。
          const scopeToggles = (kind: "image" | "video" | "file") => (
            <div className="settings-subrows media-card-toggles">
              {(["single", "group"] as const).map((who) => (
                <label className="switch-row" key={who}>
                  <span className="row-label">{who === "single" ? "单聊" : "群聊"}</span>
                  <input type="checkbox" checked={wifi[kind][who]}
                         onChange={(e) => patchWifi({ ...wifi, [kind]: { ...wifi[kind], [who]: e.target.checked } })} />
                </label>
              ))}
            </div>
          );
          // 视频 / 文件：带大小上限滑杆的独立卡片（图片体积小，无需上限，见下方单独卡片）。
          const limitCard = (kind: "video" | "file", label: string, Icon: LucideIcon) => (
            <div className="settings-group media-card" key={kind}>
              <div className="media-card-head">
                <Icon size={17} className="media-card-icon" />
                <span className="media-card-title">{label}</span>
              </div>
              <div className="range-row">
                <div className="range-top">
                  <span className="row-label">大小上限</span>
                  <span className="row-value">{wifi[kind].max_bytes > 0 ? formatFileSize(wifi[kind].max_bytes) : "手动"}</span>
                </div>
                {/* 0 = 手动（不自动下）；其余按 MB 取整，右端对齐后端 MaxAutoBytes(1.5 GiB)。 */}
                <input type="range" min={0} max={Math.round(MAX_AUTO_BYTES / (1024 * 1024))} step={1}
                       value={Math.round(wifi[kind].max_bytes / (1024 * 1024))}
                       onChange={(e) => patchWifi({ ...wifi, [kind]: { ...wifi[kind], max_bytes: Number(e.target.value) * 1024 * 1024 } })} />
                <div className="range-scale"><span>手动</span><span>1.5 GB</span></div>
              </div>
              {scopeToggles(kind)}
            </div>
          );
          return (
            <div className="settings-panel data-panel">
              <header className="settings-head">
                <button className="icon-btn" title="返回" onClick={() => setDataStorageOpen(false)}><ChevronLeft size={27} /></button>
                <span className="settings-title">数据与存储</span>
                <span className="icon-btn-spacer" />
              </header>
              <div className="settings-body">
                <div className="section-label">存储用量</div>
                <div className="settings-group">
                  <div className="settings-row static">
                    <span className="row-label">已缓存媒体</span>
                    <span className="row-value">{cachedCount} 个</span>
                  </div>
                  <button className="settings-row danger" onClick={clearMediaCache}>
                    <Trash2 size={20} className="row-icon" /><span className="row-label">清除缓存</span>
                  </button>
                </div>
                <div className="settings-foot">只删本机缓存，云端仍保留、需要时可重新下载。刷新页面也会清空（浏览器限制）。</div>

                <div className="section-label">自动下载媒体文件</div>
                <div className="settings-group">
                  <label className="switch-row">
                    <span className="row-label">自动下载</span>
                    <input type="checkbox" checked={wifi.enabled}
                           onChange={(e) => patchWifi({ ...wifi, enabled: e.target.checked })} />
                  </label>
                </div>
                <div className="settings-foot">
                  浏览器分不清移动数据与 Wi-Fi，故 Web 只使用「Wi-Fi / 不限流量」这一档；手动点击永远可下载。
                </div>

                <div className="section-label">流量档位</div>
                <div className="settings-group">
                  {/* 总开关关闭 → 全部手动、档位无意义：整排置淡且不可点（对齐 iOS 档位滑杆置灰）。 */}
                  <div className={`tier-row${wifi.enabled ? "" : " disabled"}`}>
                    {([["low", "低"], ["medium", "中"], ["high", "高"]] as const).map(([v, t]) => (
                      <button key={v} className={`tier-btn${tier === v ? " on" : ""}`} disabled={!wifi.enabled}
                              onClick={() => patchWifi(applyTier(wifi, v))}>{t}</button>
                    ))}
                    {/* 自定义为只读指示（无预设可套用）→ 仅当前处于自定义时才出现的高亮按钮、不可点，
                        与 低/中/高 同款样式（对齐 iOS「仅自定义时出现的第四档」）。 */}
                    {tier === "custom" && <button className="tier-btn on" disabled>自定义</button>}
                  </div>
                </div>
                <div className="settings-foot">档位是快捷入口——一键设好下面的大小上限；手改任一上限后回到「自定义」。图片体积小，恒自动下载。</div>

                <div className="section-label">媒体文件类型</div>
                <div className="settings-group media-card">
                  <div className="media-card-head">
                    <ImageIcon size={17} className="media-card-icon" />
                    <span className="media-card-title">图片</span>
                    <span className="media-card-hint">体积小 · 恒自动下载</span>
                  </div>
                  {scopeToggles("image")}
                </div>
                {limitCard("video", "视频", Video)}
                {limitCard("file", "文件", FileText)}

                <div className="settings-group">
                  {/* 已是出厂默认 → 无可重置：置灰不可点（对齐 iOS）。用户改动后自动恢复可点。 */}
                  <button className="settings-row danger" disabled={isDefaultDownloadSettings(st)} onClick={() => {
                    void askConfirm("恢复自动下载的出厂默认设置？", { okText: "恢复默认", danger: true }).then((ok) => {
                      if (!ok) return;
                      const c = clientRef.current;
                      if (!c) return;
                      void c.resetDownloadSettings()
                        .then((r) => setDlSettings(parseDownloadSettings(r?.settings)))
                        .catch((e: Error) => setToast(`重置失败：${e.message}`));
                    });
                  }}>
                    <span className="row-label">重置自动下载设置</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 编辑资料面板：经设置页铅笔进入，叠在设置面板之上（对齐 Telegram Web「Edit profile」）。 */}
        {profileDraft && (
          <div className="settings-panel edit-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setProfileDraft(null)}><ChevronLeft size={27} /></button>
              <span className="settings-title">编辑资料</span>
              <button className="icon-btn save" title="保存" disabled={profileBusy} onClick={() => void saveProfile()}><Check size={22} /></button>
            </header>
            <div className="settings-body">
              {/* 点头像 → 选本机图片（隐藏的 file input，浏览器自动用系统原生文件框，跨平台无需检测系统）。 */}
              <button className="edit-avatar" title="更换头像" onClick={() => avatarFileRef.current?.click()}>
                <Avatar url={profileDraft.avatar_url} label={profileDraft.nickname || uid} seed={uid} cls="edit-avatar-inner" />
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

        {/* 已登录设备子面板（多设备管理 P2，草图 DEVICE_MANAGEMENT_UX_SKETCH §3）：
            以登录设备(session)为行，本机置顶标灰不可退（想退＝退出登录），底部一键退出其他所有设备。 */}
        {devicesOpen && (
          <div className="settings-panel devices-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setDevicesOpen(false)}><ChevronLeft size={27} /></button>
              <span className="settings-title">已登录设备</span>
              <button className="icon-btn" title="刷新" disabled={devices === null} onClick={() => void loadDevices()}><RefreshCw size={20} /></button>
            </header>
            <div className="settings-body">
              {devices === null && <div className="devices-empty">加载中…</div>}
              {devices !== null && devicesErr && <div className="devices-empty devices-err">{devicesErr}</div>}
              {devices !== null && !devicesErr && devices.length === 0 && <div className="devices-empty">没有其他登录设备</div>}
              {devices !== null && devices.length > 0 && (
                <>
                  <div className="section-label">这些设备当前登录了你的账号</div>
                  <div className="settings-group devices-list">
                    {devices.map((d) => (
                      <div key={d.session_id} className="device-row">
                        <span className="device-ic">{platformIcon(d.platform)}</span>
                        <div className="device-meta">
                          <div className="device-name">
                            <span>{deviceName(d)}</span>
                            {d.current && <span className="device-cur-pill">这台设备</span>}
                          </div>
                          <div className="device-sub">
                            <span className={d.online ? "device-dot on" : "device-dot off"} />
                            {deviceSubtitle(d, Date.now())}
                          </div>
                        </div>
                        {d.current
                          ? <span className="device-btn cur">当前</span>
                          : <button className="device-btn" disabled={!!revokingSid} onClick={() => void revokeDevice(d)}>
                              {revokingSid === d.session_id ? "退出中…" : "退出"}
                            </button>}
                      </div>
                    ))}
                  </div>
                  {devices.some((d) => !d.current) && (
                    <button className="devices-revoke-all" disabled={!!revokingSid} onClick={() => void revokeOtherDevices()}>
                      {revokingSid === "__others__" ? "退出中…" : "退出其他所有设备"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* 通用设置子面板：设置 ▸ 通用设置进入，叠在设置之上。主题已接通真功能，其余先 UI。 */}
        {generalOpen && (
          <div className="settings-panel general-panel">
            <header className="settings-head">
              <button className="icon-btn" title="返回" onClick={() => setGeneralOpen(false)}><ChevronLeft size={27} /></button>
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
                <button className="settings-row" onClick={() => setWallpaperOpen(true)}>
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

        {wallpaperOpen && (
          <div className="settings-panel wallpaper-panel">
            <header className="settings-head wallpaper-head">
              <button className="icon-btn" title="返回" onClick={() => setWallpaperOpen(false)}><ChevronLeft size={27} /></button>
              <span className="settings-title">聊天壁纸</span>
              <span className="icon-btn-spacer" />
            </header>
            <div className="settings-body wallpaper-body">
              <div className="wallpaper-actions">
                <button className="wallpaper-action" onClick={() => wallpaperFileRef.current?.click()}>
                  <Camera size={24} /><span>上传图片</span>
                </button>
                <button className="wallpaper-action" onClick={openWallpaperColor}>
                  <Pipette size={24} /><span>设置颜色</span>
                </button>
                <button className="wallpaper-action" onClick={resetWallpaper}>
                  <Star size={24} /><span>恢复默认</span>
                </button>
                <button className="wallpaper-action" onClick={() => setWallpaperBlur((value) => !value)}>
                  <span className={`wallpaper-check${wallpaperBlur ? " on" : ""}`}>{wallpaperBlur && <Check size={17} />}</span>
                  <span>模糊</span>
                </button>
              </div>
              <input ref={wallpaperFileRef} type="file" accept="image/*" hidden
                onChange={(event) => {
                  pickWallpaperImage(event.target.files?.[0]);
                  event.target.value = "";
                }} />
              <p className="wallpaper-hint">
                {wallpaper.kind === "auto"
                  ? "默认壁纸会跟随浅色/深色模式自动切换，当前高亮为正在使用的一张。"
                  : "已固定壁纸，浅深模式都用它。点「恢复默认」可切回跟随模式。"}
              </p>
              <div className="wallpaper-grid">
                {WALLPAPER_PRESETS.map((item) => {
                  // 用解析后的选择比对：auto 时高亮当前明暗下正在生效的那张预设。
                  const active = resolveWallpaper(wallpaper, isDark);
                  const selected = active.kind === "preset" && active.value === item.id;
                  return (
                    <button key={item.id} className={`wallpaper-tile${selected ? " selected" : ""}`}
                      title={item.label} aria-label={`使用${item.label}壁纸`}
                      style={{ background: item.css } as CSSProperties}
                      onClick={() => setWallpaper({ kind: "preset", value: item.id })}>
                      {selected && <span className="wallpaper-selected"><Check size={18} /></span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {wallpaperColorOpen && (
          <div className="settings-panel wallpaper-color-panel">
            <header className="settings-head wallpaper-head">
              <button className="icon-btn" title="返回" onClick={() => setWallpaperColorOpen(false)}><ChevronLeft size={27} /></button>
              <span className="settings-title">设置颜色</span>
              <span className="icon-btn-spacer" />
            </header>
            <div className="settings-body wallpaper-color-body">
              <div className="color-editor-card" style={{ "--picker-hue": `${colorHSV.h}` } as CSSProperties}>
                <div className="color-spectrum"
                  role="slider" aria-label="调整颜色饱和度和亮度" aria-valuenow={Math.round(colorHSV.v)}
                  onPointerDown={updateColorFromSpectrum}
                  onPointerMove={(event) => { if (event.buttons === 1) updateColorFromSpectrum(event); }}>
                  <span className="color-cursor"
                    style={{ left: `${colorHSV.s}%`, top: `${100 - colorHSV.v}%` }} />
                </div>
                <input className="hue-slider" type="range" min="0" max="360" value={colorHSV.h}
                  aria-label="调整色相"
                  onChange={(event) => applyWallpaperColor({ ...colorHSV, h: Number(event.target.value) })} />
                <div className="color-values">
                  <label>
                    <span>HEX</span>
                    <input value={hsvToHex(colorHSV)} readOnly />
                  </label>
                  <label>
                    <span>RGB</span>
                    <input value={hexToRGB(hsvToHex(colorHSV))} readOnly />
                  </label>
                </div>
              </div>
              <div className="color-preset-grid">
                {COLOR_PRESETS.map((color) => {
                  const selected = hsvToHex(colorHSV).toLowerCase() === color;
                  return (
                    <button key={color} className={`color-preset${selected ? " selected" : ""}`}
                      title={color} aria-label={`使用颜色 ${color}`}
                      style={{ background: color }}
                      onClick={() => applyWallpaperColor(hexToHSV(color))}>
                      {selected && <Check size={20} />}
                    </button>
                  );
                })}
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
            {(isGroupChat || peer) ? (
              <button className="chat-identity"
                title={isGroupChat ? "查看群资料" : "查看资料"}
                onClick={() => isGroupChat ? openGroupPanel(groupConvId) : openPeerDetail(peer, true)}>
                <Avatar url={chatAvatarURL} label={chatTitle} seed={groupConvId || peer} cls="chat-avatar" />
                <span className="chat-identity-copy">
                  <span className="chat-title">{chatTitle}</span>
                  <span className="chat-subtitle">{visibleChatSubtitle}</span>
                </span>
              </button>
            ) : (
              <span className="muted">未选择会话</span>
            )}
            <span className="chat-head-right">
              {(peer || isGroupChat) && (
                <>
                  <button className="icon-btn" title="搜索" onClick={() => comingSoon("聊天内搜索")}><Search size={20} /></button>
                  {!isGroupChat && <button className="icon-btn" title="呼叫" onClick={() => comingSoon("语音通话")}><Phone size={20} /></button>}
                  <span className="chat-anchor">
                    <button className="icon-btn" title="更多" onClick={(e) => { e.stopPropagation(); setChatMenu((v) => !v); }}><MoreVertical size={20} /></button>
                  {chatMenu && (
                    <div className="menu-card chat-menu" onClick={(e) => e.stopPropagation()}>
                      {(isGroupChat ? [
                        { id: "info", label: "群资料", icon: Info, run: () => openGroupPanel(groupConvId) },
                        { id: "invite", label: "邀请成员", icon: UserPlus, run: () => setInviteDraft({ convId: groupConvId, selected: [] }) },
                        { id: "mute", label: groupConv?.muted ? "取消免打扰" : "免打扰", icon: BellOff, run: () => { if (groupConv) setConvMuted(groupConv, !groupConv.muted); } },
                        { id: "select", label: "选择消息", icon: CheckSquare, run: () => enterSelectMode() },
                        { id: "leave", label: "退出群聊", icon: LogOut, danger: true, run: () => void doLeaveGroup(groupConvId) },
                      ] : [
                        { id: "edit", label: "编辑联系人", icon: SquarePen, run: () => setContactDraft({ peer, remark: peerConv?.peer_remark ?? "" }) },
                        { id: "call", label: "视频通话", icon: Video, run: () => comingSoon("视频通话") },
                        { id: "mute", label: peerConv?.muted ? "取消免打扰" : "免打扰", icon: BellOff, run: () => { if (peerConv) setConvMuted(peerConv, !peerConv.muted); } },
                        { id: "select", label: "选择消息", icon: CheckSquare, run: () => enterSelectMode() },
                        { id: "block", label: peerBlocked ? "取消拉黑" : "拉黑", icon: Ban, danger: !peerBlocked, run: () => doToggleBlock(peer, !peerBlocked) },
                        { id: "del", label: "删除会话", icon: Trash2, danger: true, run: () => { if (peerConv) deleteConv(peerConv); } },
                      ]).map((r) => (
                        <button key={r.id} className={`menu-card-row${"danger" in r && r.danger ? " danger" : ""}`}
                          onClick={() => { setChatMenu(false); r.run(); }}>
                          <r.icon size={18} className="row-icon" /><span className="row-label">{r.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  </span>
                </>
              )}
            </span>
          </header>
          {/* 入群审批横幅（G3，蓝条）：仅群主/管理员且有待审申请时显示，点条开审批列表。排在最上（需处置）。 */}
          {isGroupChat && (activeGroupInfo?.my_role === "owner" || activeGroupInfo?.my_role === "admin")
            && (activeGroupInfo?.pending_count ?? 0) > 0 && (
            <div className="pin-banner approve" onClick={() => void openJoinRequests(groupConvId)} role="button">
              <span className="pin-banner-main" style={{ cursor: "pointer" }}>
                <span className="pin-banner-bar" />
                <span className="pin-banner-copy">
                  <span className="pin-banner-kicker"><UserPlus size={12} /> 入群申请</span>
                  <span className="pin-banner-text">{activeGroupInfo!.pending_count} 人申请加入本群 · 点击审批</span>
                </span>
              </span>
            </div>
          )}
          {/* 群公告横幅（G1，黄条）：排在置顶横幅之上（优先级 公告 > 置顶）。点条直接开公告全文视图（决策 16）。 */}
          {isGroupChat && activeGroupInfo?.announcement && !dismissedBanners[annDismissKey] && (
            <div className="pin-banner announce">
              <button className="pin-banner-main" onClick={() => openGroupText("announcement", groupConvId)}>
                <span className="pin-banner-bar" />
                <span className="pin-banner-copy">
                  <span className="pin-banner-kicker"><Megaphone size={12} /> 群公告</span>
                  <span className="pin-banner-text">{activeGroupInfo.announcement}</span>
                </span>
              </button>
              <button className="icon-btn pin-banner-close" title="收起公告"
                onClick={() => setDismissedBanners((d) => ({ ...d, [annDismissKey]: true }))}><X size={16} /></button>
            </div>
          )}
          {/* 置顶消息横幅（G0）：点条=跳到那条并轮转到下一条；右侧 ☰=展开全部置顶。 */}
          {pinnedShown && !dismissedBanners[pinDismissKey] && (
            <div className="pin-banner">
              <button className="pin-banner-main"
                title="跳转到该消息"
                onClick={() => { jumpToSeq(pinnedShown.convSeq); setPinnedIdx(nextPinnedIndex(pinnedShownIdx, activePinned.length)); }}>
                <span className={`pin-banner-bar${activePinned.length > 1 ? " multi" : ""}`} />
                <span className="pin-banner-copy">
                  <span className="pin-banner-kicker">
                    <Pin size={12} /> 置顶消息
                    {activePinned.length > 1 && <span className="pin-banner-count">{pinnedShownIdx + 1}/{activePinned.length}</span>}
                    {pinnedSenderLabel(pinnedShown, isGroupChat) && (
                      <span className="pin-banner-from">· {pinnedSenderLabel(pinnedShown, isGroupChat)}</span>
                    )}
                  </span>
                  <span className="pin-banner-text">{pinnedPreview(pinnedShown)}</span>
                </span>
              </button>
              {activePinned.length > 1 && (
                <button className="icon-btn pin-banner-list" title="全部置顶消息"
                  onClick={() => setPinnedListOpen(true)}><List size={18} /></button>
              )}
              <button className="icon-btn pin-banner-close" title="收起置顶"
                onClick={() => setDismissedBanners((d) => ({ ...d, [pinDismissKey]: true }))}><X size={16} /></button>
            </div>
          )}
          <div className="msgs" ref={msgsRef} onScroll={onMsgsScroll}>
            {messages.map((m, i) => {
              const mine = m.from === uid;
              const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
              const showDate = m.timestamp > 0 && (i === 0 || !isSameDay(m.timestamp, messages[i - 1].timestamp));
              // Telegram 式连续消息分组（群聊对方）：连续同发送者只首条显名、末条显头像；非首条收紧上间距。
              const grpThem = isGroupChat && !mine;
              const showSender = grpThem && !sameSenderRun(prevVisibleMsg(messages, i), m);
              const showAvatar = grpThem && !sameSenderRun(m, nextVisibleMsg(messages, i));
              const grouped = grpThem && sameSenderRun(prevVisibleMsg(messages, i), m);
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
              // 相册宫格（M4+）：同 group_id 聚簇——主行渲染整个宫格，从行跳过；多选态展开为独立行（逐条可勾选）。
              if (!selectMode && isAlbumMember(m)) {
                if (!isAlbumLeader(messages, i)) return null;
                const members = albumMembers(messages, m.groupId!);
                const last = members[members.length - 1];
                // 相册尾条的 conv_seq（供「可见即读」：主行虽只带 data-seq=主行 seq，但看到宫格=看到整组，
                // 已读须能推进到末条，否则以相册结尾的会话未读永远卡在相册首条、清不掉。乐观态 seq=0 取到者忽略）。
                const albumEndSeq = members.reduce((mx, mm) => Math.max(mx, mm.convSeq || 0), 0);
                // 整组共用一条失败/拒收表达（同批发送、同一原因被拒）：取首个带 note 的成员。
                const notedMember = members.find((mm) => mm.note);
                const albumFailed = mine && members.some((mm) => mm.status === "failed");
                const grid = (
                  <div className="bubble-line">
                    {albumFailed && <span className="fail-badge" title={notedMember?.note || "发送失败"}>!</span>}
                    <AlbumGrid members={members}
                      timeLabel={last?.timestamp ? formatTime(last.timestamp, timeFormat) : ""}
                      progress={uploadProgress}
                      gateFor={(mm) => !!mediaGate(mm)}
                      expiredFor={(mm) => mediaGate(mm)?.phase === "expired"}
                      onMediaError={onPassiveMediaError}
                      onOpen={(mm) => (mediaGate(mm) ? onGateTap(mm) : onMediaBubbleTap(mm, () => setViewer({ m: mm })))}
                      onMenu={(e, mm) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m: mm }); }} />
                  </div>
                );
                return (
                  <div className={`msg-item${grouped ? " grouped" : ""}`} data-seq={m.convSeq} data-seq-end={albumEndSeq || undefined} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                    {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                    {i === firstUnreadIdx && (
                      <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                    )}
                    <div className={`row ${mine ? "me" : "them"}`}>
                      {grpThem ? (
                        <div className="them-wrap">
                          <div className="avatar-col">
                            {showAvatar && <Avatar cls="avatar bubble-avatar" url={senderAvatar(m)} label={senderLabel(m)} seed={m.from} onClick={() => openPeerDetail(m.from)} />}
                          </div>
                          <div className="them-stack">
                            {showSender && (
                            <span className="sender-row">
                              <span className="sender-name">{senderLabel(m)}</span>
                              {senderRole(m) === "owner" && <span className="role-badge owner">群主</span>}
                              {senderRole(m) === "admin" && <span className="role-badge">管理员</span>}
                            </span>
                          )}
                            {grid}
                          </div>
                        </div>
                      ) : grid}
                    </div>
                    {/* 被拒收系统行（整组一条）：此前相册分支完全没有，图片被拒时既无文案也无恢复入口。 */}
                    {albumFailed && notedMember?.note && (
                      <div className="sys-note">
                        <span>{notedMember.note}</span>
                        {notedMember.noteCode === 200103 && peer && (
                          <button className="sys-note-action" onClick={() => void requestFriendFromNote(peer)}>发送好友申请</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              // 媒体气泡：时间/已读压在图上（右下角），故不再渲染气泡下方的 .bmeta 行。
              const isMediaBubble = m.contentType === "image" || m.contentType === "video";
              const uploading = uploadProgress[m.clientMsgId ?? ""];
              // 暂停态唯一真相=分片任务（toggleUploadPause bump 进度对象触发重渲染）；小文件无任务恒 false。
              const uploadPaused = !!chunkedTaskFor(m.clientMsgId ?? "")?.paused;
              const durationText = m.contentType === "video" ? formatMediaDuration(m.duration) : "";
              // 下载门控（M4-7）：undefined=就绪；非空=未下载/下载中/失败/已失效 → 卡片显 ↓ 或进度，不加载原件。
              const gate = mediaGate(m);
              // 右键/长按选中态（方案A）：菜单作用的目标消息稳态高亮。身份用 clientMsgId ?? serverMsgId ?? convSeq
              // （与 React key 同口径）——发送中 convSeq=0 靠 clientMsgId 区分，避免多条 sending 一起亮。
              const menuActive = !!menu && (menu.m.clientMsgId ?? menu.m.serverMsgId ?? menu.m.convSeq) === (m.clientMsgId ?? m.serverMsgId ?? m.convSeq);
              const bubbleBlock = (
                <>
                  <div className="bubble-line">
                    {mine && m.status === "failed" && (
                      <span className="fail-badge" title={m.note || "发送失败"}>!</span>
                    )}
                    <div className={`bubble${isMediaBubble ? " media" : ""}${menuActive ? " ctx-active" : ""}`}
                      onContextMenu={(e) => { if (selectMode) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }}>
                      {m.forwardFrom ? <span className="forward-from">转发自 {m.forwardFrom}</span> : null}
                      {m.replyToConvSeq ? (
                        // 引用条：媒体内嵌小缩略图；群聊两行式——被引用者昵称（accent）+ 内容预览（M4-x，单聊不显示发送者）。
                        <div className="quote-bar" onClick={() => locateInChat(m.convId, m.replyToConvSeq!)}>
                          {(() => { const q = messages.find((x) => x.convSeq === m.replyToConvSeq);
                            // 原消息在本地 → 真帧/磨砂/图标由 QuoteThumb 定；不在本地 → 从快照文本推兜底图标（与 iOS 一致，别只剩文本）。
                            return q ? <QuoteThumb m={q} gated={!!mediaGate(q)} /> : <QuoteSnapshotIcon snapshot={m.replySnapshot} />; })()}
                          <span className="quote-lines">
                            {isGroupChat && m.replyToFrom && (
                              <span className="quote-who">{m.replyToFrom === uid ? "你" : (memberNick(m.convId, m.replyToFrom) || m.replyToFrom)}</span>
                            )}
                            <span className="quote-text">{localizeSnippet(m.replySnapshot || "") || "原消息"}</span>
                          </span>
                        </div>
                      ) : null}
                      {isMediaBubble ? (
                        // 图片/视频：按 media_w/media_h 的原始比例定框（未知回退方块），
                        // 左上角时长或上传进度、右下角时间+已读态、视频居中播放角标——与 iOS 同版式。
                        // 点按走状态机（与 iOS 中心按钮一致）：失败 ↻ 重试 / 上传中 ⏸↔↑ / 其余打开查看器。
                        <span {...mediaBoxProps(m)}
                              onClick={() => (gate ? onGateTap(m) : onMediaBubbleTap(m, () => setViewer({ m })))}
                              title={gate ? downloadText(gate, formatFileSize(m.fileSize)) : undefined}>
                          {/* 门控（未下载）：不拉原图/原视频，只显 thumb 模糊占位（~200B data URI），没有就留灰底。 */}
                          {gate
                            ? (m.thumb
                                ? <img className="msg-image msg-image-blur" src={m.thumb} alt="未下载" />
                                : <span className="msg-image msg-image-empty" />)
                            : m.contentType === "video"
                              ? (m.posterUrl
                                  ? <img className="msg-image" src={m.posterUrl} alt="视频" onLoad={onMediaLoad} onError={() => void onPassiveMediaError(m)} />
                                  : <video className="msg-image" src={videoFrameSrc(mediaSrc(m))} preload="metadata" muted onLoadedData={onMediaLoad} onError={() => void onPassiveMediaError(m)} />)
                              : <img className="msg-image" src={mediaSrc(m)} alt="图片" onLoad={onMediaLoad} onError={() => void onPassiveMediaError(m)} />}
                          {gate
                            ? (gate.phase === "expired"
                                ? <span className="play-badge expired" title="已失效">⊘</span>
                                : downloadGlyph(gate) && <span className="play-badge">{downloadGlyph(gate)}</span>)
                            : uploading
                            ? (chunkedTaskFor(m.clientMsgId ?? "") && <span className="play-badge">{uploadPaused ? "↑" : "⏸"}</span>)
                            : (mine && m.status === "failed" && m.convSeq === 0 && pendingFilesRef.current.has(m.clientMsgId ?? ""))
                              ? <span className="play-badge">↻</span>
                              : m.contentType === "video" && <span className="play-badge">▶</span>}
                          {gate
                            ? <span className="media-badge media-badge-tl">
                                {downloadText(gate, formatFileSize(m.fileSize), m.contentType as MediaKind)}{durationText && gate.phase !== "expired" ? ` · ${durationText}` : ""}
                              </span>
                            : uploading
                            ? <span className="media-badge media-badge-tl">{uploadPaused ? "⏸ " : ""}{formatUploadProgress(uploading.sent, uploading.total)}</span>
                            : (durationText && <span className="media-badge media-badge-tl">{durationText}</span>)}
                          <span className="media-badge media-badge-br">
                            {mine
                              // 只有真正在传输才显「发送中…」；暂停时回落显示时间（与 iOS 一致）。
                              ? (m.status === "sending" ? (uploadPaused ? formatTime(m.timestamp, timeFormat) : "发送中…")
                                // 被拒收（有 note）时失败已由红❗+下方系统行表达，角标只显时间，不重复报错（与 iOS 一致）。
                                : m.status === "failed" ? (m.note ? formatTime(m.timestamp, timeFormat) : "未发送 ✗")
                                : <>{formatTime(m.timestamp, timeFormat)}<span className={readByPeer ? "ck read" : "ck"}>{readByPeer ? " ✓✓" : " ✓"}</span></>)
                              : formatTime(m.timestamp, timeFormat)}
                          </span>
                        </span>
                      ) : m.contentType === "chat_record" ? (
                        // 合并转发卡片（镜像 iOS）：标题 + 前几条预览 + 脚注，点击进详情。
                        (() => { const r = parseChatRecord(m.content); return (
                          <div className="record-card" onClick={() => setRecordStack([r])}>
                            <div className="record-title">{r.t}</div>
                            <div className="record-preview">{r.items.slice(0, 4).map((it, i) => (
                              <div key={i} className="record-line">{it.n}: {recordItemPreview(it)}</div>
                            ))}</div>
                            <div className="record-foot">聊天记录</div>
                          </div>
                        ); })()
                      ) : m.contentType === "file" ? (
                        // 上传中（content 还没有 URL）不渲染成可点下载的 <a>，改显进度条 + 已传/总大小。
                        uploading || !m.content ? (
                          <span className={`msg-file${m.status === "failed" ? " failed" : ""}`}
                                onClick={m.status === "failed" ? () => retryUpload(m)
                                       : uploading ? () => toggleUploadPause(m) : undefined}>
                            <FileTypeIcon name={m.fileName || ""} size={30} />
                            <span className="msg-file-body">
                              <span className="msg-file-name">{m.fileName || "文件"}</span>
                              <span className="msg-file-size">
                                {m.status === "failed"
                                  ? `${formatFileSize(m.fileSize)} · 上传失败，点击重试`
                                  : uploading
                                    ? `${formatUploadProgress(uploading.sent, uploading.total)}${
                                        chunkedTaskFor(m.clientMsgId ?? "") ? (uploadPaused ? " · 已暂停，点击继续" : " · 点击暂停") : ""}`
                                    : formatFileSize(m.fileSize)}
                              </span>
                              {/* 失败态不显进度条：0% 的空条会让人以为"还没开始传"。 */}
                              {m.status !== "failed" && (
                                <span className="file-progress">
                                  <span className="file-progress-bar"
                                        style={{ width: `${uploading && uploading.total > 0 ? Math.round((uploading.sent / uploading.total) * 100) : 0}%` }} />
                                </span>
                              )}
                            </span>
                          </span>
                        ) : gate ? (
                          // 门控（M4-7）：未下载/下载中/失败——圆形图标位即状态位（↓ / 环形进度 / ↻），点击就地下载，不跳页。
                          // 进度改由 FileGateIcon 的圆环表示（去底部线性条），图标槽位恒定 → 状态切换不撑高卡片。
                          <span className={`msg-file${gate.phase === "failed" || gate.phase === "expired" ? " failed" : ""}`}
                                onClick={() => onGateTap(m)}
                                title={gate.phase === "expired" ? "文件已失效" : "点击下载"}>
                            <FileGateIcon state={gate} />
                            <span className="msg-file-body">
                              <span className="msg-file-name">{m.fileName || fileNameFromContent(m.content)}</span>
                              <span className="msg-file-size">
                                {gate.phase === "notStarted"
                                  ? (formatFileSize(m.fileSize) ? `${formatFileSize(m.fileSize)} · 点击下载` : "点击下载")
                                  : downloadText(gate, formatFileSize(m.fileSize))}
                              </span>
                            </span>
                          </span>
                        ) : (
                          // 就绪：点击路由（可预览类型新标签预览 / 其余另存，对齐 iOS QuickLook）。已手动下过走应用内 blob。
                          <span className="msg-file clickable" onClick={() => openReadyFile(m)}
                                title={isPreviewableFile(m.fileName || fileNameFromContent(m.content)) ? "点击预览" : "点击下载"}>
                            <FileTypeIcon name={m.fileName || fileNameFromContent(m.content)} size={30} />
                            <span className="msg-file-body">
                              <span className="msg-file-name">{m.fileName || fileNameFromContent(m.content)}</span>
                              {formatFileSize(m.fileSize) && <span className="msg-file-size">{formatFileSize(m.fileSize)}</span>}
                            </span>
                          </span>
                        )
                      ) : isUrlText(m.content) ? (
                        // 纯 URL 消息：可点击 URL 文本 + 下方 OG 富预览卡片（引用/普通消息一致）。
                        <LinkCard url={m.content} fetchPreview={fetchLinkPreview} onMediaLoad={onMediaLoad}
                                  onOpenInvite={(u) => void handleScanRaw(u)} />
                      ) : (
                        renderMessageText(m)
                      )}
                      {!isMediaBubble && (
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
                      )}
                    </div>
                  </div>
                  {m.convSeq > 0 && translations[m.convSeq] && (
                    <div className="translation"><span>{translations[m.convSeq]}</span></div>
                  )}
                </>
              );
              return (
                <div className={`msg-item${grouped ? " grouped" : ""}`} data-seq={m.convSeq} key={m.clientMsgId ?? m.serverMsgId ?? i}>
                  {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
                  {i === firstUnreadIdx && (
                    <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
                  )}
                  <div className={`row ${mine ? "me" : "them"}${selectMode ? " selecting" : ""}`}
                    onClick={!selectMode ? undefined
                      : selectableInMultiSelect(m) ? () => toggleSelected(m.convSeq)
                      // 发送中/失败的本地件：无勾选圈，点按直接提示原因（系统行/撤回墓碑静默）。
                      : m.convSeq <= 0 && m.contentType !== "system" ? () => setToast("发送中/失败的消息不可选择")
                      : undefined}>
                    {selectMode && selectableInMultiSelect(m) && (
                      <span className={`sel-check${selected.has(m.convSeq) ? " on" : ""}`}>{selected.has(m.convSeq) ? "✓" : ""}</span>
                    )}
                    {grpThem ? (
                      // 群聊对方：左侧头像列（连续段末条显头像）+ 昵称（连续段首条）在气泡上方。
                      <div className="them-wrap">
                        <div className="avatar-col">
                          {showAvatar && <Avatar cls="avatar bubble-avatar" url={senderAvatar(m)} label={senderLabel(m)} seed={m.from} onClick={() => openPeerDetail(m.from)} />}
                        </div>
                        <div className="them-stack">
                          {showSender && (
                            <span className="sender-row">
                              <span className="sender-name">{senderLabel(m)}</span>
                              {senderRole(m) === "owner" && <span className="role-badge owner">群主</span>}
                              {senderRole(m) === "admin" && <span className="role-badge">管理员</span>}
                            </span>
                          )}
                          {bubbleBlock}
                        </div>
                      </div>
                    ) : bubbleBlock}
                  </div>
                  {mine && m.status === "failed" && m.note && (
                    <div className="sys-note">
                      <span>{m.note}</span>
                      {/* 恢复入口：仅非好友(200103) 给——被拉黑(200102) 刻意不给，服务端对两者回同样的
                          模糊文案以不泄露拉黑，给了入口反而会因申请被 200102 拒而暴露。 */}
                      {m.noteCode === 200103 && peer && (
                        <button className="sys-note-action" onClick={() => void requestFriendFromNote(peer)}>发送好友申请</button>
                      )}
                    </div>
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
            // 引用回复条（M4-2）：输入框上方显示被引用消息预览 + 取消；图片/视频显示小缩略图。
            <div className="reply-compose">
              <QuoteThumb m={replyTo} gated={!!mediaGate(replyTo)} />
              <div className="reply-compose-text">
                <span className="reply-who">回复 {replyTo.from === uid ? "自己" : (isGroupChat ? senderLabel(replyTo) : peerLabel)}</span>
                <span className="reply-snippet">{replyPreviewOf(replyTo)}</span>
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
            <>
              {pastedImages.length > 0 && (
                // 粘贴预览条（Web #2）：图片显缩略图、文件显类型图标+文件名；逐个 ✕ 移除，点发送统一发出。
                <div className="paste-preview">
                  {pastedImages.map((pi, i) => (
                    pi.kind === "image" ? (
                      <div key={pi.url} className="paste-thumb">
                        <img src={pi.url} alt="待发送图片" />
                        <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                      </div>
                    ) : pi.kind === "video" ? (
                      // 视频：用 <video> 显首帧（muted+metadata），角标示意可播放；发送仍与图片同批走 sendMediaBatch。
                      <div key={pi.url} className="paste-thumb paste-video">
                        <video src={pi.url} muted preload="metadata" playsInline />
                        <span className="paste-video-badge" aria-hidden>▶</span>
                        <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                      </div>
                    ) : (
                      <div key={pi.url} className="paste-thumb paste-file">
                        <FileTypeIcon name={pi.file.name} size={26} />
                        <span className="paste-file-name" title={pi.file.name}>{pi.file.name}</span>
                        <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                      </div>
                    )
                  ))}
                </div>
              )}
              <footer>
                <div className="attach-anchor" ref={attachAnchorRef}
                  onMouseEnter={() => { cancelAttachClose(); if (convId) setAttachPanel(true); }}
                  onMouseLeave={scheduleAttachClose}>
                  <button className="attach-btn" disabled={!convId} title="附件"
                    aria-expanded={attachPanel && !!convId}
                    onClick={() => setAttachPanel(true)}>＋</button>
                  {attachPanel && convId && (
                    // 毛玻璃气泡菜单：悬停或点击加号均打开，功能仍由数据数组驱动。
                    <div className="attach-popover" role="menu"
                      onMouseEnter={cancelAttachClose} onMouseLeave={scheduleAttachClose}>
                      {attachItems.map((it) => (
                        <button key={it.id} className="attach-item" role="menuitem" onClick={() => pickFile(it.id as AttachmentPickMode, it.accept)}>
                          <it.icon size={24} aria-hidden="true" />
                          <span>{it.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFilePicked} />
                {/* @提及面板（M4-8，仅群聊）：贴输入框上方的内联下拉，边打字边过滤。
                    支持 ↑/↓ 移动、Enter/Tab 选中、Esc 关闭（见 composer 的 onKeyDown）。
                    「@所有人」仅群主/管理员可见——普通成员整行不渲染（服务端另有角色校验）。 */}
                {mentionQuery !== null && (
                  <div className="mention-panel" role="listbox" aria-label="提醒谁" ref={mentionPanelRef}>
                    {/* 顶部搜索框＝独立搜索：从空开始、不被消息框 @后文字回填；在此打字则以它为准过滤（否则列表跟随 @后字符）。 */}
                    <input className="mention-search" value={mentionFilter} placeholder="搜索成员" aria-label="搜索成员"
                      onChange={(e) => setMentionFilter(e.target.value)}
                      onKeyDown={(e) => { onMentionNavKey(e); }} />
                    {mentionRows.length > 0 ? mentionRows.map((r, i) => (
                      <button
                        key={r.userId ?? "@all"}
                        role="option"
                        aria-selected={i === mentionActive}
                        ref={i === mentionActive ? mentionActiveRef : undefined}
                        className={`mention-row${i === mentionActive ? " active" : ""}`}
                        // 用 mousedown 而非 click：click 之前 textarea 已 blur，光标位置会先丢。
                        onMouseDown={(e) => { e.preventDefault(); pickMention(r.label, r.userId); }}
                        onMouseEnter={() => setMentionActive(i)}
                      >
                        {r.userId
                          ? <Avatar label={r.label} seed={r.userId} url={r.avatarUrl} cls="avatar mention-avatar" />
                          : <span className="mention-all-ic">@</span>}
                        <span className="mention-name">{r.label}</span>
                        {r.note && <span className="role-badge">{r.note}</span>}
                        {r.role === "owner" && <span className="role-badge owner">群主</span>}
                        {r.role === "admin" && <span className="role-badge">管理员</span>}
                      </button>
                    )) : <div className="mention-empty">无匹配成员</div>}
                  </div>
                )}
                <textarea ref={composerRef} value={input} rows={1} disabled={!convId || composerMuteReason !== null}
                  placeholder={composerMuteReason || (convId ? (sendKey === "cmd" ? "输入消息，Cmd+Enter 发送…" : "输入消息，回车发送…") : "先选择左侧的会话…")}
                  onChange={(e) => onInputChange(e.target.value)}
                  onPaste={onComposerPaste}
                  onKeyDown={(e) => {
                    // @面板打开时优先接管导航键：↑/↓ 移动、Enter/Tab 选中、Esc 关闭（与面板搜索框共用一套）。
                    if (onMentionNavKey(e)) return;
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // 中文输入法组词中不触发
                    // enter 模式：Enter 发送、Shift+Enter 换行；cmd 模式：Cmd/Ctrl+Enter 发送、Enter 换行。
                    const shouldSend = sendKey === "cmd" ? (e.metaKey || e.ctrlKey) : !e.shiftKey;
                    if (shouldSend) { e.preventDefault(); send(); }
                  }} />
                <button onClick={send} disabled={!convId || composerMuteReason !== null}>发送</button>
              </footer>
            </>
          )}
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

      {viewer && (
        // 媒体查看器（镜像 iOS）：图片/视频 + 右下 下载/媒体库/更多（hover 浮层 6 功能）。点击遮罩关闭。
        <div className="modal-mask viewer-mask" onClick={() => { setViewer(null); setViewerMore(false); }}>
          {viewer.m.contentType === "video" ? (
            // 浏览器解不了码（对端发来的 HEVC 等）时 <video> 只会黑屏 → 降级成明确提示 + 下载入口，
            // 而不是让用户对着黑框以为坏了。封面仍能显示（poster 是 JPEG，与视频编码无关）。
            videoUnplayable ? (
              <div className="viewer-unplayable" onClick={(e) => e.stopPropagation()}>
                {viewer.m.posterUrl && <img src={viewer.m.posterUrl} alt="" />}
                {expiredSet.has(viewer.m.content) ? (
                  // 404=服务端已清理：显失效、不给"下载后本地播放"（那个链接也会 404），别误导成编码问题（对齐 iOS 查看器）。
                  <p>视频已失效（已被服务端清理）。</p>
                ) : (
                  <>
                    <p>当前浏览器不支持该视频的编码格式（如 HEVC）。</p>
                    <a className="viewer-unplayable-btn" href={viewer.m.content} download>下载后用本地播放器打开</a>
                  </>
                )}
              </div>
            ) : !videoStarted ? (
              // 封面待点：只显封面图 + 居中 ▶，点了才挂 <video>。翻页到视频＝翻到图片一样轻，无黑色控件条/无 metadata 预拉。
              <>
                <img className="image-viewer viewer-video-cover" src={viewer.m.posterUrl || viewer.m.thumb || undefined} alt="视频封面"
                     onClick={(e) => { e.stopPropagation(); setViewerMore(false); setVideoStarted(true); }} />
                <button className="viewer-play-btn" title="播放" onClick={(e) => { e.stopPropagation(); setVideoStarted(true); }}>
                  <Play size={30} fill="currentColor" />
                </button>
              </>
            ) : (
              <video key={mediaIdentity(viewer.m) /* 翻页换视频时重挂元素，避免上一段播放状态残留 */}
                     className="image-viewer" src={viewer.m.content} controls autoPlay
                     poster={viewer.m.posterUrl}
                     onClick={(e) => { e.stopPropagation(); setViewerMore(false); }}
                     onError={() => {
                       logger.warn(LOG_TAG.media, "video_playback_unsupported", {
                         conv_id: viewer.m.convId, conv_seq: viewer.m.convSeq, has_poster: Boolean(viewer.m.posterUrl),
                       });
                       setVideoUnplayable(true);
                       void markExpiredIfGone(viewer.m); // 404=源已清理（非编码问题）→ 落持久失效标记
                     }} />
            )
          ) : mediaGate(viewer.m)?.phase === "unsupported" ? (
            // 网页端无法渲染的图片格式（HEIC 等）：不塞进 <img> 变破图，显缩略(若有)+提示+下载入口（与视频降级卡同版式）。
            <div className="viewer-unplayable" onClick={(e) => e.stopPropagation()}>
              {viewer.m.thumb && <img src={viewer.m.thumb} alt="" />}
              <p>当前浏览器无法预览该图片格式（如 HEIC）。</p>
              <a className="viewer-unplayable-btn" href={viewer.m.content} download>下载后用本地程序打开</a>
            </div>
          ) : (
            <img key={mediaIdentity(viewer.m)} className="image-viewer" src={viewer.m.content} alt="大图" onClick={(e) => { e.stopPropagation(); setViewerMore(false); }}
                 onError={() => void onPassiveMediaError(viewer.m)} />
          )}
          {/* 任务3 · 左右翻页箭头：仅当前查看项在会话媒体时间线内（viewerIdx>=0）且有相邻项时显示。翻到头即停。 */}
          {viewerIdx > 0 && (
            <button className="viewer-nav prev" title="上一张（←）"
                    onClick={(e) => { e.stopPropagation(); goViewer(-1); }}><ChevronLeft size={28} /></button>
          )}
          {viewerIdx >= 0 && viewerIdx < viewerList.length - 1 && (
            <button className="viewer-nav next" title="下一张（→）"
                    onClick={(e) => { e.stopPropagation(); goViewer(1); }}><ChevronRight size={28} /></button>
          )}
          {/* 顶部标题栏（对齐 iOS）：主标题=会话名，副标题=「第 i 张 / 共 N 张」。带渐变底、预留高度，
              取代原先浮在图上的孤立计数（与图片重叠）。仅会话媒体上下文（viewerIdx>=0）显示。 */}
          {viewerIdx >= 0 && (
            // pointer-events:none（见 .viewer-top）——点击穿透到蒙层关闭，无需 stopPropagation。
            <div className="viewer-top">
              <span className="viewer-top-title">{chatTitle}</span>
              {viewerList.length > 1 && (
                <span className="viewer-top-count">{viewerIdx + 1} / {viewerList.length}</span>
              )}
            </div>
          )}
          <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
            <a className="viewer-btn" href={viewer.m.content} download title="下载"><Download size={18} /></a>
            {!viewer.fromGallery && (
              <button className="viewer-btn" title="媒体库" onClick={() => setGalleryOpen(true)}><LayoutGrid size={18} /></button>
            )}
            <div className="viewer-more-wrap">
              {/* 点击切换（原 hover：鼠标从按钮移向弹窗时穿过间隙触发 onMouseLeave 即消失，够不到菜单项）。 */}
              <button className="viewer-btn" title="更多" onClick={(e) => { e.stopPropagation(); setViewerMore((v) => !v); }}><MoreHorizontal size={18} /></button>
              {viewerMore && (
                <div className="viewer-more-pop">
                  <button onClick={() => { const mm = viewer.m; setViewer(null); setViewerMore(false); setGalleryOpen(false); setDetail(null); locateInChat(mm.convId || currentConvRef.current, mm.convSeq); }}>定位到聊天位置</button>
                  <button onClick={() => favoriteMessage(viewer.m)}>收藏</button>
                  <a href={viewer.m.content} download>下载</a>
                  {/* 视频不提供复制：无"复制字节"语义，产品上禁止复制视频消息（与 iOS 对齐）。图片才有复制。 */}
                  {viewer.m.contentType !== "video" && (
                    <button onClick={() => {
                      // 图片：复制图片字节（可粘贴回输入框直接发图）；其余非视频：复制链接。
                      if (viewer.m.contentType === "image") {
                        copyImageToClipboard(viewer.m.content).then(() => setToast("已复制图片"))
                          .catch(() => { void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast("已复制链接"); });
                      } else {
                        void navigator.clipboard?.writeText(new URL(viewer.m.content, location.href).href); setToast("已复制链接");
                      }
                    }}>复制</button>
                  )}
                  <button onClick={() => { const mm = viewer.m; setViewer(null); setGalleryOpen(false); setForwarding([mm]); }}>转发</button>
                  <button className="danger" onClick={(e) => {
                    // 统一走两档路由（对齐详情/聊天）：可为所有人删则弹子菜单 B，否则仅删自己；删成功后查看器由 onMessageRemoved 关闭。
                    const m = viewer.m;
                    if (m.convSeq <= 0) { deleteMessage(m); setViewer(null); return; }
                    requestDelete(m, e.clientX, e.clientY);
                  }}>删除</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {textReader && (
        // 超长文本全屏阅读器：可滚动 / 选中复制 / 字号调节。点蒙层或 ✕ 关闭。
        <div className="modal-mask" onClick={() => setTextReader(null)}>
          <div className="text-reader" onClick={(e) => e.stopPropagation()}>
            <div className="tr-bar">
              <button className="tr-btn" title="关闭" onClick={() => setTextReader(null)}><X size={18} /></button>
              <span className="tr-title">全文 · {charCountLabel(textReader.content)}</span>
              <span className="tr-actions">
                <button className="tr-btn" title="缩小字号" disabled={readerFontStep <= -1}
                        onClick={() => setReaderFontStep((s) => Math.max(-1, s - 1))}>A−</button>
                <button className="tr-btn" title="放大字号" disabled={readerFontStep >= 3}
                        onClick={() => setReaderFontStep((s) => Math.min(3, s + 1))}>A+</button>
                <button className="tr-btn" title="复制全文"
                        onClick={() => { void navigator.clipboard?.writeText(textReader.content); setToast("已复制全文"); }}><Copy size={16} /></button>
              </span>
            </div>
            {/* 基准跟随用户设置的聊天正文字号 --msg-font（14~22px），再叠加档位偏移——否则读长文的界面反而无视字号偏好。 */}
            <div className="tr-body" style={{ fontSize: `calc(var(--msg-font) + ${readerFontStep}px)` }}>{renderMentionText(textReader, textReader.content)}</div>
          </div>
        </div>
      )}

      {galleryOpen && (
        // 会话媒体库：蒙层 + 时间序网格；点击复用查看器（fromGallery=不再显示媒体库按钮）。
        <div className="modal-mask" onClick={() => setGalleryOpen(false)}>
          <div className="gallery-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">图片与视频</div>
            <div className="gallery-grid">
              {messages.filter(isViewableMedia).length === 0 && (
                <div className="fwd-empty">暂无图片或视频</div>
              )}
              {/* 与资料卡片「媒体」页签**完全一致**（门控 + 右键菜单）：最新的排在最前（messages 升序 → reverse 降序）。
                  未下载格显磨砂 + ↓ + 尺寸，点=就地下载（不打开）；就绪格才进查看器（fromGallery=不再显示「媒体库」按钮，避免死循环）。
                  右键 = 转发/定位/取消下载/删除（同资料 tab 的 fileMenu）。 */}
              {[...messages]
                .filter(isViewableMedia)
                .reverse()
                .map((mm) => {
                  const gate = mediaGate(mm);
                  const sizeText = formatFileSize(mm.fileSize);
                  return (
                  <div key={mediaIdentity(mm)} className="gallery-item"
                       onClick={() => { if (gate) { onGateTap(mm); return; } setGalleryOpen(false); setViewer({ m: mm, fromGallery: true }); }}
                       onContextMenu={(e) => { e.preventDefault(); setFileMenu({ x: e.clientX, y: e.clientY, m: mm }); }}
                       title={gate ? (sizeText ? `${sizeText} · 点击下载` : "点击下载") : undefined}>
                    {gate
                      ? (mm.thumb ? <img className="gate-blur" src={mm.thumb} alt="未下载" /> : <span className="gate-empty" />)
                      : (mm.contentType === "video"
                          ? (mm.posterUrl ? <img src={mm.posterUrl} alt="" onError={() => void onPassiveMediaError(mm)} /> : <video src={videoFrameSrc(mm.content)} preload="metadata" muted onError={() => void onPassiveMediaError(mm)} />)
                          : <img src={mm.content} alt="" onError={() => void onPassiveMediaError(mm)} />)}
                    {gate
                      ? (gate.phase === "expired" ? <span className="play-badge expired" title="已失效">⊘</span> : <span className="detail-media-dl">↓</span>)
                      : mm.contentType === "video" && <span className="play-badge">▶</span>}
                    {gate && gate.phase !== "expired" && sizeText && <span className="detail-media-size">{sizeText}</span>}
                  </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {favorites && (
        // 收藏列表（M4-4）：内容快照 + 删除；原消息撤回/删除后仍在。
        <div className="modal-mask" onClick={() => setFavorites(null)}>
          <div className="modal fav-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">我的收藏（{favorites.length}）</div>
            <div className="fav-list">
              {favorites.length === 0 && <div className="fwd-empty">还没有收藏</div>}
              {favorites.map((f) => (
                <div key={f.id} className="fav-item">
                  <div className="fav-content">
                    {f.content_type === "image" ? (
                      <img className="fav-thumb" src={f.content} alt="图片" onClick={() => { setFavorites(null); setViewer({ m: { clientMsgId: `fav-${f.id}`, convId: "", from: "", content: f.content, contentType: "image", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }} />
                    ) : f.content_type === "video" ? (
                      <span className="fav-thumb-wrap" onClick={() => { setFavorites(null); setViewer({ m: { clientMsgId: `fav-${f.id}`, convId: "", from: "", content: f.content, contentType: "video", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }}>
                        <video className="fav-thumb" src={videoFrameSrc(f.content)} preload="metadata" muted /><span className="play-badge">▶</span>
                      </span>
                    ) : f.content_type === "file" ? (
                      <a className="msg-file" href={f.content} download={fileNameFromContent(f.content)} target="_blank" rel="noreferrer">
                        <FileTypeIcon name={f.content} size={30} />
                        <span>{fileNameFromContent(f.content)}</span>
                      </a>
                    ) : isUrlText(f.content) ? (
                      <a className="msg-link" href={f.content} target="_blank" rel="noreferrer">{f.content}</a>
                    ) : (
                      f.content
                    )}
                  </div>
                  <button className="fav-del" title="删除收藏" onClick={() => removeFavorite(f.id)}>✕</button>
                </div>
              ))}
            </div>
            <button className="modal-close" onClick={() => setFavorites(null)}>关闭</button>
          </div>
        </div>
      )}

      {forwarding && (
        // 转发会话选择器（M4-3）：默认单选点一下即发；「多选」切换成勾选态，底部「发送(N)」批量转发（上限 9，对齐 iOS）。
        <div className="modal-mask" onClick={closeForwardPicker}>
          <div className="modal fwd-picker" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title fwd-title">
              <span>转发到（{forwarding.length} 条）</span>
              <button className="section-action" onClick={() => { setForwardMulti((v) => !v); setForwardTargets([]); }}>
                {forwardMulti ? "取消多选" : "多选"}
              </button>
            </div>
            {forwarding.length > 1 && (
              <div className="fwd-mode">
                <button className={forwardMode === "each" ? "on" : ""} onClick={() => setForwardMode("each")}>逐条转发</button>
                <button className={forwardMode === "merged" ? "on" : ""} onClick={() => setForwardMode("merged")}>合并转发</button>
              </div>
            )}
            <div className="fwd-list">
              {conversations.length === 0 && <div className="fwd-empty">暂无会话</div>}
              {conversations.map((c) => {
                const on = forwardTargets.includes(c.conv_id);
                return (
                  <button key={c.conv_id} className="fwd-item"
                    onClick={() => forwardMulti ? toggleForwardTarget(c.conv_id) : doForwardToTargets([c])}>
                    {forwardMulti && <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>}
                    <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer} />
                    <span className="fwd-item-label">{convDisplayLabel(c)}</span>
                  </button>
                );
              })}
            </div>
            {forwardMulti ? (
              <div className="fwd-actions">
                <button className="link" onClick={closeForwardPicker}>取消</button>
                <button className="mini-btn" disabled={forwardTargets.length === 0}
                  onClick={() => doForwardToTargets(conversations.filter((c) => forwardTargets.includes(c.conv_id)))}>
                  发送{forwardTargets.length > 0 ? `(${forwardTargets.length})` : ""}
                </button>
              </div>
            ) : (
              <button className="modal-close" onClick={closeForwardPicker}>取消</button>
            )}
          </div>
        </div>
      )}

      {recordView && (
        // 合并转发详情（镜像 iOS）：列出全部消息；图片/视频点击进查看器；
        // 嵌套合并转发条目 → 套娃 mini 卡片，点击入栈下钻（栈深 >1 时显返回）。
        <div className="modal-mask" onClick={() => setRecordStack([])}>
          <div className="modal record-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title record-head">
              {recordStack.length > 1 && (
                <button className="icon-btn" title="返回" onClick={() => setRecordStack((s) => s.slice(0, -1))}>
                  <ChevronLeft size={22} />
                </button>
              )}
              <span className="record-head-title">{recordView.t}</span>
            </div>
            <div className="record-list">
              {recordView.items.map((it, i) => (
                <div key={i} className="record-item">
                  <div className="record-item-name">{it.n}</div>
                  {it.ct === "image" ? (
                    <img className="record-item-media" src={it.c} alt="图片" onClick={() => { setRecordStack([]); setViewer({ m: { clientMsgId: `rec-${i}`, convId: "", from: "", content: it.c, contentType: "image", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }} />
                  ) : it.ct === "video" ? (
                    <span className="fav-thumb-wrap" onClick={() => { setRecordStack([]); setViewer({ m: { clientMsgId: `rec-${i}`, convId: "", from: "", content: it.c, contentType: "video", convSeq: 0, timestamp: 0, status: "sent" }, fromGallery: true }); }}>
                      <video className="record-item-media" src={videoFrameSrc(it.c)} preload="metadata" muted /><span className="play-badge">▶</span>
                    </span>
                  ) : it.ct === "file" ? (
                    <a className="msg-file" href={it.c} download={it.fn || fileNameFromContent(it.c)} target="_blank" rel="noreferrer">
                      <FileTypeIcon name={it.fn || it.c} size={30} />
                      <span>{it.fn || fileNameFromContent(it.c)}</span>
                      {it.fs ? <span className="msg-file-size">{formatFileSize(it.fs)}</span> : null}
                    </a>
                  ) : it.ct === "chat_record" ? (
                    // 套娃 mini 卡片：标题 + 前 2 行预览 + 脚注；点击入栈进子记录（任意深度）。sub 走 recordNested 缓存。
                    (() => { const sub = recordNested.get(i) ?? parseChatRecord(it.c); return (
                      <div className="record-card record-card-nested" onClick={() => setRecordStack((s) => [...s, sub])}>
                        <div className="record-title">{sub.t}</div>
                        <div className="record-preview">{sub.items.slice(0, 2).map((si, k) => (
                          <div key={k} className="record-line">{si.n}: {recordItemPreview(si)}</div>
                        ))}</div>
                        <div className="record-foot">聊天记录 ›</div>
                      </div>
                    ); })()
                  ) : (
                    <div className="record-item-text">{it.c}</div>
                  )}
                </div>
              ))}
            </div>
            <button className="modal-close" onClick={() => setRecordStack([])}>关闭</button>
          </div>
        </div>
      )}

      {readReceipts && (
        // 已读名单（M4-8）：已读/未读两栏切换，**不显读取时刻**（位点语义给不出可靠单条时间）。
        <div className="modal-mask" onClick={() => setReadReceipts(null)}>
          <div className="modal readby-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">已读详情</div>
            <div className="readby-tabs">
              <button className={readReceipts.tab === "read" ? "on" : ""}
                onClick={() => setReadReceipts((r) => (r ? { ...r, tab: "read" } : r))}>
                已读 {readReceipts.read.length}
              </button>
              <button className={readReceipts.tab === "unread" ? "on" : ""}
                onClick={() => setReadReceipts((r) => (r ? { ...r, tab: "unread" } : r))}>
                未读 {readReceipts.unread.length}
              </button>
            </div>
            <div className="readby-list">
              {(readReceipts.tab === "read" ? readReceipts.read : readReceipts.unread).map((memberId) => {
                const gm = groupConvId ? groupInfos[groupConvId]?.members.find((x) => x.user_id === memberId) : undefined;
                const label = gm?.nickname || memberId;
                return (
                  <div key={memberId} className="readby-row">
                    <Avatar label={label} seed={memberId} url={gm?.avatar_url} cls="avatar mention-avatar" />
                    <span className="mention-name">{label}</span>
                    {gm?.role === "owner" && <span className="role-badge owner">群主</span>}
                    {gm?.role === "admin" && <span className="role-badge">管理员</span>}
                  </div>
                );
              })}
              {(readReceipts.tab === "read" ? readReceipts.read : readReceipts.unread).length === 0 && (
                <div className="readby-empty">
                  {readReceipts.tab === "read" ? "还没有人读过这条消息" : "所有人都已读"}
                </div>
              )}
            </div>
            <button className="modal-close" onClick={() => setReadReceipts(null)}>关闭</button>
          </div>
        </div>
      )}

      {/* 全部置顶消息（G0）：横幅右侧 ☰ 打开。点行跳转；有权限者可就地取消置顶。 */}
      {pinnedListOpen && (
        <div className="modal-mask" onClick={() => setPinnedListOpen(false)}>
          <div className="modal pinned-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">置顶消息（{activePinned.length}）</div>
            <div className="pinned-list">
              {activePinned.map((pm) => (
                <div className="pinned-row" key={pm.convSeq}>
                  <button className="pinned-row-main"
                    onClick={() => { setPinnedListOpen(false); jumpToSeq(pm.convSeq); }}>
                    <span className="pinned-row-from">{pinnedSenderLabel(pm, isGroupChat) || formatTime(pm.timestamp, timeFormat)}</span>
                    <span className="pinned-row-text">{pinnedPreview(pm)}</span>
                  </button>
                  {canPinHere && (
                    <button className="icon-btn" title="取消置顶"
                      onClick={() => clientRef.current?.pinMessage(convId, pm.convSeq, false)}><PinOff size={16} /></button>
                  )}
                </div>
              ))}
            </div>
            <button className="modal-close" onClick={() => setPinnedListOpen(false)}>关闭</button>
          </div>
        </div>
      )}

      {menu && (
        <AnchoredMenu x={menu.x} y={menu.y} className="ctx-menu">
          {messageActions
            .filter((a) => a.visible({ m: menu.m, uid, isGroup: !!groupConvId && !peer, canPin: canPinHere }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => {
                  // 删除走统一两档路由（弹子菜单 B / 直接仅删自己 / 本地删），对齐详情页；其余动作照常。
                  if (a.id === "delete") { const mm = menu.m, x = menu.x, y = menu.y; setMenu(null); requestDelete(mm, x, y); return; }
                  a.run({ m: menu.m, uid, isGroup: !!groupConvId && !peer, canPin: canPinHere }); setMenu(null);
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
            <button onClick={() => { setFileMenu(null); setForwardMode("each"); setForwarding([m]); }}>
              <Forward size={16} className="menu-icon" />转发</button>
            {/* 定位=回到聊天：关掉所有可能盖住聊天区的宿主（详情面板 / 会话媒体库蒙层 / 查看器），否则定位发生在蒙层背后。 */}
            <button onClick={() => { setFileMenu(null); setDetail(null); setGalleryOpen(false); setViewer(null); locateInChat(m.convId, m.convSeq); }}>
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

      {blockedList !== null && (
        <div className="modal-mask" onClick={() => setBlockedList(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>黑名单（{blockedList.length}）</h3>
            {blockedList.length === 0 && <div className="empty">没有拉黑的用户</div>}
            {blockedList.map((f) => (
              <div key={f.user_id} className="convitem static">
                <Avatar url={f.avatar_url} label={friendLabel(f)} seed={f.user_id} />
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
                  <Avatar url={g.avatar_url} label={g.name} seed={g.conv_id} />
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
            <div className="section-label with-action">
              <span>选择好友（已选 {createDraft.selected.length}）</span>
              {accepted.length > 0 && (() => {
                // 可选好友上限 = MAX_INITIAL_MEMBERS（群主占 1 席）；全选时截断到上限。
                const selectable = accepted.slice(0, MAX_INITIAL_MEMBERS).map((f) => f.user_id);
                const allOn = selectable.length > 0 && selectable.every((id) => createDraft.selected.includes(id));
                return (
                  <button type="button" className="section-action"
                    onClick={() => setCreateDraft({ ...createDraft, selected: allOn ? [] : selectable })}>
                    {allOn ? "取消全选" : "全选"}
                  </button>
                );
              })()}
            </div>
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
                    <Avatar url={f.avatar_url} label={friendLabel(f)} seed={f.user_id} />
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

      {/* 会话详情抽屉（对齐 iOS IMChatDetailViewController）：单聊/群聊共用——头部 + 操作排 + 设置 + 页签。 */}
      {detail && (() => {
        const d = detail;
        const conv = conversations.find((c) => c.conv_id === d.convId);
        const gp = d.isGroup ? groupInfos[d.convId] : undefined;
        const canManage = !!gp && gp.my_role !== "member";
        const isOwner = !!gp && gp.my_role === "owner";
        const title = d.isGroup ? (groupRemark(d.convId) || gp?.name || conv?.name || "群聊")
          : (conv?.peer_remark || conv?.peer_nickname || (d.peer ? peerNick(d.peer) : "") || d.peer || "");
        void groupRemarkTick; // 群备注变更后重渲染标题
        // 单聊资料卡：无会话行时（从群成员点进的未聊过对端）从群成员表/好友/搜索兜底取头像，
        // 否则只回退首字母圈（bug：群里头像正常、点进资料卡却回退）。
        const avatarUrl = d.isGroup ? (gp?.avatar_url ?? conv?.avatar_url)
          : (conv?.peer_avatar_url || (d.peer ? peerAvatar(d.peer) : undefined));
        const subtitle = d.isGroup ? `${gp?.members.length ?? conv?.member_count ?? 0} 位成员` : (d.peer ?? "");
        const pinned = (conv?.pinned_at ?? 0) > 0;
        const muted = !!conv?.muted;
        const peerBlocked = !d.isGroup && !!friends.find((f) => f.user_id === d.peer)?.blocked;
        // 好友准入（微信式，任务一 P0）：非好友不显示「消息/呼叫/视频」，改显「加好友」。
        // 拉黑的好友 status 仍 accepted（仍算好友，可发消息），故只看 status 不看 blocked。
        const detailPeerIsFriend = !d.isGroup && !!d.peer && friends.some((f) => f.user_id === d.peer && f.status === "accepted");
        // 非好友（单聊）只保留头像 + 操作排（加好友/更多），隐藏设置·备注名·页签——尚未建立关系时这些设置无意义。
        // 仅隐藏，数据加载逻辑不动（加为好友后重新渲染即恢复）。与 iOS sectionLayout 同语义。
        const showDetailBody = d.isGroup || detailPeerIsFriend;
        // 页签数据（本地历史）
        const media = detailMsgs.filter((m) => m.contentType === "image" || m.contentType === "video")
          .sort((a, b) => b.convSeq - a.convSeq);
        const files = detailMsgs.filter((m) => m.contentType === "file").sort((a, b) => b.convSeq - a.convSeq);
        const links = detailMsgs.filter((m) => isUrlText(m.content)).sort((a, b) => b.convSeq - a.convSeq);
        const tabs: Array<{ k: typeof detailTab; label: string }> = d.isGroup
          ? [{ k: "members", label: "成员" }, { k: "media", label: "媒体" }, { k: "files", label: "文件" }, { k: "links", label: "链接" }]
          : [{ k: "media", label: "媒体" }, { k: "files", label: "文件" }, { k: "links", label: "链接" }];
        const activeTab = tabs.some((t) => t.k === detailTab) ? detailTab : tabs[0].k;
        const close = () => { setDetail(null); setDetailMore(false); setManageOpen(false); };

        return (
          <div className="detail-mask" onClick={close}>
            <aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
              {!manageOpen && (
                // 标题栏随面板滚动固定在顶部（对齐 iOS 大标题折叠为常驻导航栏）：关闭按钮一并锁在标题栏内。
                <div className="detail-sticky-head">
                  <button className="detail-close" title="关闭" onClick={close}><X size={20} /></button>
                  <div className="detail-topbar">{d.isGroup ? "群组信息" : "用户信息"}</div>
                </div>
              )}

              {manageOpen && gp ? (
                /* ---- 群管理二级视图（改名 / 群头像 / 占位项） ---- */
                <div className="detail-manage">
                  <div className="detail-manage-head">
                    <button className="icon-btn" onClick={() => setManageOpen(false)}><ChevronLeft size={20} /></button>
                    <span>群管理</span>
                  </div>
                  <div className="detail-manage-avatar">
                    <button className="detail-manage-avatar-btn" onClick={() => pickGroupAvatar(gp)}>
                      <Avatar url={gp.avatar_url} label={gp.name} seed={gp.conv_id} cls="detail-avatar" />
                      <span className="detail-manage-cam"><Camera size={18} /></span>
                    </button>
                    <div className="detail-manage-caption">设置新头像</div>
                  </div>
                  <div className="detail-card">
                    <button className="detail-row" onClick={() => void doRenameGroup(gp)}>
                      <span className="detail-row-ic"><SquarePen size={18} /></span><span>群名称</span>
                      <span className="detail-row-val">{gp.name}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                    <button className="detail-row" onClick={() => void doEditIntro(gp)}>
                      <span className="detail-row-ic"><Info size={18} /></span><span>简介</span>
                      <span className="detail-row-val">{gp.intro || "未填写"}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                    <button className="detail-row" onClick={() => void doEditAnnouncement(gp)}>
                      <span className="detail-row-ic"><Megaphone size={18} /></span><span>群公告</span>
                      <span className="detail-row-val">{gp.announcement ? "已发布" : "未发布"}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                  </div>
                  <div className="detail-card-title">加入与发言</div>
                  <div className="detail-card">
                    <div className="detail-row"><span className="detail-row-ic"><Lock size={18} /></span><span>进群确认</span>
                      <button className={`switch ${gp.join_approval ? "on" : ""}`}
                        onClick={() => void doToggleGroupSetting(gp, "join_approval")} /></div>
                    <div className="detail-row"><span className="detail-row-ic"><BellOff size={18} /></span><span>全员禁言</span>
                      <button className={`switch ${(gp.mute_until ?? 0) > Date.now() ? "on" : ""}`}
                        onClick={() => void doToggleGroupMute(gp, !((gp.mute_until ?? 0) > Date.now()))} /></div>
                  </div>
                  <div className="detail-card-title">成员权限</div>
                  <div className="detail-card">
                    <div className="detail-row"><span className="detail-row-ic"><UserPlus size={18} /></span><span>仅管理员可邀请</span>
                      <button className={`switch ${gp.perm_invite ? "on" : ""}`}
                        onClick={() => void doToggleGroupSetting(gp, "perm_invite")} /></div>
                    <div className="detail-row"><span className="detail-row-ic"><SquarePen size={18} /></span><span>仅管理员可改群资料</span>
                      <button className={`switch ${gp.perm_edit_info ? "on" : ""}`}
                        onClick={() => void doToggleGroupSetting(gp, "perm_edit_info")} /></div>
                    <div className="detail-row"><span className="detail-row-ic"><Pin size={18} /></span><span>仅管理员可置顶消息</span>
                      <button className={`switch ${gp.perm_pin ? "on" : ""}`}
                        onClick={() => void doToggleGroupSetting(gp, "perm_pin")} /></div>
                    <div className="detail-row"><span className="detail-row-ic"><Eye size={18} /></span><span>新成员仅可见入群后历史</span>
                      <button className={`switch ${gp.history_visible ? "on" : ""}`}
                        onClick={() => void doToggleGroupSetting(gp, "history_visible")} /></div>
                  </div>
                  <div className="detail-card-title">治理</div>
                  <div className="detail-card">
                    <button className="detail-row" onClick={() => void openJoinRequests(gp.conv_id)}>
                      <span className="detail-row-ic"><UserPlus size={18} /></span><span>待审入群申请</span>
                      <span className="detail-row-val">{gp.pending_count ? `${gp.pending_count} 待处理` : "无"}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                    <button className="detail-row" onClick={() => void openGroupBans(gp.conv_id)}>
                      <span className="detail-row-ic"><Ban size={18} /></span><span>黑名单</span>
                      <span className="detail-row-val">{groupBans ? `${groupBans.length} 人` : ""}</span><ChevronRight size={16} className="detail-row-chev" />
                    </button>
                  </div>
                  <div className="detail-foot-note">「新成员仅可见入群后历史」开启后，新成员看不到加入前的聊天记录。</div>
                </div>
              ) : (
                <>
                  {/* ---- 头部：头像 + 名 + 副标题 ---- */}
                  <div className="detail-header">
                    <div className="detail-avatar-wrap">
                      <Avatar url={avatarUrl} label={title} seed={d.isGroup ? d.convId : (d.peer ?? "")} cls="detail-avatar" />
                      {canManage && (
                        <button className="detail-cam" title="设置群头像" onClick={() => pickGroupAvatar(gp!)}><Camera size={15} /></button>
                      )}
                    </div>
                    <div className="detail-name">{title}</div>
                    <div className="detail-sub">{subtitle}</div>
                  </div>

                  {/* ---- 操作排 pills ---- */}
                  <div className="detail-pills">
                    {!d.isGroup && !detailPeerIsFriend && (
                      <button className="detail-pill" onClick={() => void doFriendAction(d.peer!, async () => {
                        // 已直接成为好友（我曾单向删除对方而对方仍视我为好友）→ 不吐司，doFriendAction 的
                        // refreshFriends 会让操作排/卡片立即恢复；说「已发送申请」反而误导要等对方通过。
                        const becameFriend = await clientRef.current!.requestFriend(d.peer!);
                        if (!becameFriend) { setToast("已发送好友申请"); }
                      })}><UserPlus size={20} /><span>加好友</span></button>
                    )}
                    {!d.isGroup && detailPeerIsFriend && !d.fromOwnChat && (
                      <button className="detail-pill" onClick={() => { close(); openChat(d.peer!); }}><MessageCircle size={20} /><span>消息</span></button>
                    )}
                    {!d.isGroup && detailPeerIsFriend && <button className="detail-pill" onClick={() => comingSoon("语音通话")}><Phone size={20} /><span>呼叫</span></button>}
                    {!d.isGroup && detailPeerIsFriend && <button className="detail-pill" onClick={() => comingSoon("视频通话")}><Video size={20} /><span>视频</span></button>}
                    {showDetailBody && <button className="detail-pill" onClick={() => comingSoon("聊天内搜索")}><Search size={20} /><span>搜索</span></button>}
                    <div className="detail-pill-anchor">
                      <button className="detail-pill" onClick={() => setDetailMore((v) => !v)}><MoreHorizontal size={20} /><span>更多</span></button>
                      {detailMore && (
                        <div className="menu-card detail-more" onClick={(e) => e.stopPropagation()}>
                          <button className="menu-item" onClick={() => { setDetailMore(false); doClearHistory(d.convId); }}><Trash2 size={16} className="menu-icon" />清空聊天记录</button>
                          {!d.isGroup && (
                            <button className={`menu-item ${peerBlocked ? "" : "danger"}`} onClick={() => { setDetailMore(false); doToggleBlock(d.peer!, !peerBlocked); }}><Ban size={16} className="menu-icon" />{peerBlocked ? "取消拉黑" : "拉黑"}</button>
                          )}
                          {d.isGroup && (
                            <button className="menu-item danger" onClick={() => { setDetailMore(false); void doLeaveGroup(d.convId); }}><LogOut size={16} className="menu-icon" />退出群组</button>
                          )}
                          {isOwner && (
                            <button className="menu-item danger" onClick={() => { setDetailMore(false); doDissolveGroup(d.convId); }}><Trash2 size={16} className="menu-icon" />删除群组</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {showDetailBody && (<>
                  {/* ---- 群公告 / 群简介卡（决策 17，Pills 下第一卡，全员只读；一行预览 + 点开全文视图） ---- */}
                  {d.isGroup && gp && (gp.announcement || gp.intro) && (
                    <div className="detail-card">
                      {gp.announcement && (
                        <button className="detail-row" onClick={() => openGroupText("announcement", d.convId)}>
                          <span className="detail-row-ic"><Megaphone size={18} /></span><span>群公告</span>
                          <span className="detail-row-val">{gp.announcement}</span><ChevronRight size={16} className="detail-row-chev" />
                        </button>
                      )}
                      {gp.intro && (
                        <button className="detail-row" onClick={() => openGroupText("intro", d.convId)}>
                          <span className="detail-row-ic"><Info size={18} /></span><span>群简介</span>
                          <span className="detail-row-val">{gp.intro}</span><ChevronRight size={16} className="detail-row-chev" />
                        </button>
                      )}
                    </div>
                  )}
                  {/* ---- 设置：置顶 / 免打扰 (+群管理) ---- */}
                  <div className="detail-card">
                    <div className="detail-row"><span className="detail-row-ic"><Pin size={18} /></span><span>置顶聊天</span>
                      <button className={`switch ${pinned ? "on" : ""}`} disabled={!conv} onClick={() => conv && setConvPinned(conv, !pinned)} /></div>
                    <div className="detail-row"><span className="detail-row-ic"><BellOff size={18} /></span><span>消息免打扰</span>
                      <button className={`switch ${muted ? "on" : ""}`} disabled={!conv} onClick={() => conv && setConvMuted(conv, !muted)} /></div>
                    {canManage && (
                      <button className="detail-row" onClick={() => setManageOpen(true)}>
                        <span className="detail-row-ic"><Settings2 size={18} /></span><span>群管理</span>
                        {(gp?.pending_count ?? 0) > 0
                          ? <span className="detail-badge">{gp!.pending_count}</span>
                          : <span className="detail-row-val muted">仅群主/管理员</span>}
                        <ChevronRight size={16} className="detail-row-chev" />
                      </button>
                    )}
                    {d.isGroup && (
                      <button className="detail-row" onClick={() => void openGroupCard(d.convId)}>
                        <span className="detail-row-ic"><QrCode size={18} /></span><span>群二维码</span>
                        <ChevronRight size={16} className="detail-row-chev end" />
                      </button>
                    )}
                  </div>

                  {/* ---- 群：我在本群的昵称 / 群备注（任意成员，G1） ---- */}
                  {d.isGroup && gp && (
                    <div className="detail-card">
                      <button className="detail-row" onClick={() => void doEditMyGroupNickname(gp)}>
                        <span className="detail-row-ic"><SquarePen size={18} /></span><span>我在本群的昵称</span>
                        <span className="detail-row-val">{gp.my_nickname || "未设置"}</span><ChevronRight size={16} className="detail-row-chev" />
                      </button>
                      <button className="detail-row" onClick={() => void doEditGroupRemark(gp)}>
                        <span className="detail-row-ic"><Bookmark size={18} /></span><span>群备注</span>
                        <span className="detail-row-val">{groupRemark(gp.conv_id) || "未设置"}</span><ChevronRight size={16} className="detail-row-chev" />
                      </button>
                    </div>
                  )}

                  {/* ---- 单聊：备注名 / 用户名 ---- */}
                  {!d.isGroup && (
                    <div className="detail-card">
                      <button className="detail-row" onClick={() => setContactDraft({ peer: d.peer!, remark: conv?.peer_remark ?? "" })}>
                        <span className="detail-row-ic"><SquarePen size={18} /></span><span>备注名</span>
                        <span className="detail-row-val">{conv?.peer_remark || "点击设置"}</span><ChevronRight size={16} className="detail-row-chev" />
                      </button>
                      <div className="detail-row"><span className="detail-row-ic"><AtSign size={18} /></span><span>用户名</span><span className="detail-row-val accent">{d.peer}</span></div>
                    </div>
                  )}

                  {/* ---- 页签 ---- */}
                  <div className="detail-tabs">
                    {tabs.map((t) => (
                      <button key={t.k} className={`detail-tab ${activeTab === t.k ? "active" : ""}`} onClick={() => setDetailTab(t.k)}>{t.label}</button>
                    ))}
                  </div>
                  <div className="detail-tabbody">
                    {activeTab === "members" && gp && (
                      <div className="detail-members">
                        <button className="detail-row accent" onClick={() => setInviteDraft({ convId: gp.conv_id, selected: [] })}>
                          <span className="detail-row-ic"><UserPlus size={18} /></span><span>添加成员</span>
                        </button>
                        {gp.members.map((m) => (
                          <div key={m.user_id} className="detail-member"
                            onClick={() => m.user_id !== uid && openPeerDetail(m.user_id)} role="button">
                            <Avatar url={m.avatar_url} label={m.group_nickname || m.nickname || m.user_id} seed={m.user_id} />
                            <div className="detail-member-body">
                              <div className="detail-member-name">{m.group_nickname || m.nickname || m.user_id}{m.user_id === uid && <span className="me-tag">我</span>}</div>
                              <div className="detail-member-sub">{m.user_id}</div>
                            </div>
                            {m.role === "owner" && <span className="role-badge owner">群主</span>}
                            {m.role === "admin" && <span className="role-badge">管理员</span>}
                            {canManageMember(gp, m) && (
                              <button className="mini-btn ghost" title="管理"
                                onClick={(e) => { e.stopPropagation(); setMemberMenu({ x: e.clientX, y: e.clientY, convId: gp.conv_id, m }); }}>⋯</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {activeTab === "media" && (
                      media.length === 0 ? <div className="detail-empty">暂无媒体</div> : (
                        <div className="detail-media-grid">
                          {media.map((m) => {
                            // 与聊天气泡共用门控（对齐 iOS 详情宫格 = 档 A，但 autoPrefetch=NO：浏览历史不顺手全拉）：
                            // 未下载格**只显 thumb 磨砂 + ↓ + 尺寸，不拉原件**；点门控格=就地解门控（不进查看器），就绪格才打开。
                            const gate = mediaGate(m);
                            const sizeText = formatFileSize(m.fileSize);
                            return (
                            <button key={m.serverMsgId || m.convSeq} className="detail-media-tile"
                                    onClick={() => (gate ? onGateTap(m) : setViewer({ m, fromGallery: true }))}
                                    onContextMenu={(e) => { e.preventDefault(); setFileMenu({ x: e.clientX, y: e.clientY, m }); }}
                                    title={gate ? (sizeText ? `${sizeText} · 点击下载` : "点击下载") : undefined}>
                              {gate
                                ? (m.thumb ? <img className="gate-blur" src={m.thumb} alt="未下载" /> : <span className="gate-empty" />)
                                : (m.contentType === "video"
                                    // 无 poster 的视频**不能**把视频 URL 塞进 <img>（渲染成裂图封面）；
                                    // 回退 <video> 抓首帧当封面（对齐气泡/引用/合并转发详情的统一兜底）。
                                    ? (m.posterUrl
                                        ? <img src={m.posterUrl} alt="" onError={() => void onPassiveMediaError(m)} />
                                        : <video src={videoFrameSrc(m.content)} muted preload="metadata" onError={() => void onPassiveMediaError(m)} />)
                                    : <img src={m.content} alt="" onError={() => void onPassiveMediaError(m)} />)}
                              {gate
                                ? (gate.phase === "expired" ? null : <span className="detail-media-dl">↓</span>) // 失效格不给 ↓，只留磨砂 dim
                                : m.contentType === "video" && <span className="detail-media-play">▶</span>}
                              {gate && sizeText && <span className="detail-media-size">{sizeText}</span>}
                            </button>
                            );
                          })}
                        </div>
                      )
                    )}
                    {activeTab === "files" && (
                      files.length === 0 ? <div className="detail-empty">暂无文件</div> : (
                        <div className="detail-filelist">
                          {files.map((m) => {
                            // 与聊天气泡共用门控/下载缓存（对齐 iOS 详情与聊天共享 IMMediaDownloadCoordinator）：
                            // 未下载→点击就地下载（圆形图标+环形进度）；就绪→预览/另存。右键=转发/定位/取消下载/删除。
                            const gate = mediaGate(m);
                            const name = m.fileName || fileNameFromContent(m.content);
                            return (
                              <div key={m.serverMsgId || m.convSeq}
                                   className={`detail-fileitem${gate && (gate.phase === "failed" || gate.phase === "expired") ? " failed" : ""}`}
                                   onClick={() => (gate ? onGateTap(m) : openReadyFile(m))}
                                   onContextMenu={(e) => { e.preventDefault(); setFileMenu({ x: e.clientX, y: e.clientY, m }); }}
                                   title={gate ? (gate.phase === "expired" ? "文件已失效" : "点击下载")
                                              : (isPreviewableFile(name) ? "点击预览" : "点击下载")}>
                                {gate ? <FileGateIcon state={gate} /> : <FileTypeIcon name={name} size={34} />}
                                <span className="detail-file-body">
                                  <span className="detail-file-name">{name}</span>
                                  <span className="detail-file-size">
                                    {gate
                                      ? (gate.phase === "notStarted"
                                          ? (formatFileSize(m.fileSize) ? `${formatFileSize(m.fileSize)} · 未下载` : "未下载")
                                          : downloadText(gate, formatFileSize(m.fileSize)))
                                      : (formatFileSize(m.fileSize) || "")}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )
                    )}
                    {activeTab === "links" && (
                      links.length === 0 ? <div className="detail-empty">暂无链接</div> : (
                        <div className="detail-filelist">
                          {links.map((m) => (
                            <a key={m.serverMsgId || m.convSeq} className="detail-linkitem" href={m.content} target="_blank" rel="noreferrer"
                               onContextMenu={(e) => { e.preventDefault(); setFileMenu({ x: e.clientX, y: e.clientY, m }); }}>
                              <Link2 size={16} /><span className="detail-file-name">{m.content}</span>
                            </a>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                  </>)}
                </>
              )}
            </aside>
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
                      <Avatar url={f.avatar_url} label={friendLabel(f)} seed={f.user_id} />
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
        // 好友准入（微信式，任务一 P0）：好友 → 「发送消息」；非好友 → 「添加好友」（非好友发消息会被 200103 拒收）。
        const isSelf = m.user_id === uid;
        const isMemberFriend = friends.some((f) => f.user_id === m.user_id && f.status === "accepted");
        return (
          // 锚定在点击点的左上方（right/bottom 定位，菜单向左上展开）：⋯ 按钮贴屏幕右缘、成员行偏下，
          // 原 left/top 向右下展开会把菜单推出视口（选项被截断看不到）。
          <div ref={memberMenuRef} className="ctx-menu" style={{ right: window.innerWidth - memberMenu.x, bottom: window.innerHeight - memberMenu.y }} onClick={(e) => e.stopPropagation()}>
            {!isSelf && isMemberFriend && (
              <button onClick={() => { setMemberMenu(null); openChat(m.user_id); }}>发送消息</button>
            )}
            {!isSelf && !isMemberFriend && (
              <button onClick={() => { setMemberMenu(null); void doFriendAction(m.user_id, async () => {
                const becameFriend = await clientRef.current!.requestFriend(m.user_id);
                if (!becameFriend) { setToast("已发送好友申请"); } // 直接成为好友时不吐司（见 requestFriend 注释）
              }); }}>添加好友</button>
            )}
            {gp.my_role === "owner" && m.role === "member" && (
              <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "admin"))}>设为管理员</button>
            )}
            {gp.my_role === "owner" && m.role === "admin" && (
              <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "member"))}>撤销管理员</button>
            )}
            {gp.my_role === "owner" && (
              <button onClick={() => {
                setMemberMenu(null);
                void askConfirm(`确定把群主转让给 ${m.nickname || m.user_id}？你将变为普通成员。`, { okText: "转让", danger: true }).then((ok) => {
                  if (ok) void doGroupAction(cid, () => clientRef.current!.transferGroup(cid, m.user_id));
                });
              }}>转让群主</button>
            )}
            {/* 禁言 / 解禁（G2）：已禁言显解除，否则弹时长选择。 */}
            {(m.mute_until ?? 0) > Date.now() ? (
              <button onClick={() => run(() => clientRef.current!.muteGroupMember(cid, m.user_id, 0))}>解除禁言</button>
            ) : (
              <button onClick={() => { setMemberMenu(null); setMuteDurationFor({ convId: cid, m }); }}>禁言…</button>
            )}
            <button className="danger" onClick={() => {
              setMemberMenu(null);
              void askConfirm(`确定把 ${m.nickname || m.user_id} 移出群聊？24 小时内不可再被邀请。`, { okText: "移出", danger: true }).then((ok) => {
                if (ok) void doGroupAction(cid, () => clientRef.current!.removeGroupMemberWithBan(cid, m.user_id, "cooldown"));
              });
            }}>移出群聊</button>
            <button className="danger" onClick={() => {
              setMemberMenu(null);
              void askConfirm(`确定把 ${m.nickname || m.user_id} 移出并不再允许加入？`, { okText: "移出并拉黑", danger: true }).then((ok) => {
                if (ok) void doGroupAction(cid, () => clientRef.current!.removeGroupMemberWithBan(cid, m.user_id, "forever"));
              });
            }}>移出并不再允许加入</button>
          </div>
        );
      })()}

      {/* 禁言时长选择（G2）：10 分钟 / 1 小时 / 1 天 / 永久。 */}
      {muteDurationFor && (
        <div className="modal-mask" onClick={() => setMuteDurationFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">禁言时长</div>
            <div className="mute-durations">
              {([["10 分钟", 10 * 60_000], ["1 小时", 60 * 60_000], ["1 天", 24 * 60 * 60_000], ["永久", -1]] as [string, number][]).map(([label, ms]) => (
                <button key={label} className="mini-btn" onClick={() => {
                  const { convId, m } = muteDurationFor;
                  const until = ms < 0 ? -1 : Date.now() + ms;
                  setMuteDurationFor(null);
                  void doGroupAction(convId, () => clientRef.current!.muteGroupMember(convId, m.user_id, until));
                }}>{label}</button>
              ))}
            </div>
            <button className="modal-close" onClick={() => setMuteDurationFor(null)}>取消</button>
          </div>
        </div>
      )}

      {/* 群黑名单弹窗（G2）：解除拉黑。 */}
      {groupBansModal && (
        <div className="modal-mask" onClick={() => setGroupBansModal(null)}>
          <div className="modal pinned-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">黑名单（{groupBansModal.bans.length}）</div>
            <div className="pinned-list">
              {groupBansModal.bans.length === 0 ? (
                <div className="detail-empty">暂无被拉黑成员</div>
              ) : groupBansModal.bans.map((b) => (
                <div className="pinned-row" key={b.user_id}>
                  <div className="pinned-row-main" style={{ cursor: "default" }}>
                    <span className="pinned-row-from">{b.user_id}</span>
                    <span className="pinned-row-text">{b.expires_at === 0 ? "永久" : "冷却中"}</span>
                  </div>
                  <button className="mini-btn danger" onClick={() => void doUnban(groupBansModal.convId, b.user_id)}>解除</button>
                </div>
              ))}
            </div>
            <button className="modal-close" onClick={() => setGroupBansModal(null)}>关闭</button>
          </div>
        </div>
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

      {/* 群公告 / 群简介全文视图（决策 16/17）：三入口共用；只读全文 + 复制 +（管理员，仅公告）编辑。 */}
      {fullTextModal && (() => {
        const gp = groupInfos[fullTextModal.convId];
        if (!gp) return null;
        const isAnn = fullTextModal.kind === "announcement";
        const text = (isAnn ? gp.announcement : gp.intro) ?? "";
        const canEdit = isAnn && gp.my_role !== "member";
        const byName = isAnn && gp.announcement_by ? (memberNick(gp.conv_id, gp.announcement_by) || gp.announcement_by) : "";
        const at = isAnn ? (gp.announcement_at ?? 0) : 0;
        const close = () => setFullTextModal(null);
        const copy = () => {
          navigator.clipboard?.writeText(text).then(() => setToast("已复制"), () => setToast("复制失败"));
        };
        return (
          <div className="modal-mask" onClick={close}>
            <div className="modal grouptext-modal" onClick={(e) => e.stopPropagation()}>
              <button className="qr-close" onClick={close} aria-label="关闭"><X size={18} /></button>
              <h3 className="modal-title">{isAnn ? <Megaphone size={18} /> : <Info size={18} />} {isAnn ? "群公告" : "群简介"}</h3>
              {isAnn && (byName || at > 0) && (
                <div className="grouptext-meta">{byName}{byName && at > 0 ? " · " : ""}{at > 0 ? `${fmtDateTime(at)} 发布` : ""}</div>
              )}
              <div className="grouptext-body">{text || (isAnn ? "暂无公告" : "暂无简介")}</div>
              <div className="modal-actions">
                <button className="mini-btn ghost" onClick={copy}><Copy size={15} /> 复制</button>
                {canEdit && (
                  <button className="mini-btn" onClick={() => { close(); void doEditAnnouncement(gp); }}><SquarePen size={15} /> 编辑</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 应用内确认框（替代 window.confirm，统一 .modal 风格）。点遮罩 = 取消。 */}
      {confirmDlg && (
        <div className="modal-mask" onClick={() => { confirmDlg.resolve(false); setConfirmDlg(null); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-msg">{confirmDlg.message}</div>
            <div className="modal-actions">
              <button className="link" onClick={() => { confirmDlg.resolve(false); setConfirmDlg(null); }}>
                {confirmDlg.cancelText}
              </button>
              <button className={`mini-btn${confirmDlg.danger ? " danger" : ""}`} autoFocus
                      onClick={() => { confirmDlg.resolve(true); setConfirmDlg(null); }}>
                {confirmDlg.okText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 应用内输入框（替代 window.prompt）。单行=回车确定；多行=textarea + 字数计数（决策 18）。Esc/遮罩取消。 */}
      {promptDlg && (
        <div className="modal-mask" onClick={() => { promptDlg.resolve(null); setPromptDlg(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{promptDlg.title}</h3>
            {promptDlg.multiline ? (
              <textarea autoFocus className="modal-textarea" value={promptDlg.value} placeholder={promptDlg.placeholder} maxLength={promptDlg.maxLength}
                        onChange={(e) => setPromptDlg({ ...promptDlg, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Escape") { promptDlg.resolve(null); setPromptDlg(null); } }} />
            ) : (
              <input autoFocus value={promptDlg.value} placeholder={promptDlg.placeholder} maxLength={promptDlg.maxLength}
                     onChange={(e) => setPromptDlg({ ...promptDlg, value: e.target.value })}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") { promptDlg.resolve(promptDlg.value); setPromptDlg(null); }
                       else if (e.key === "Escape") { promptDlg.resolve(null); setPromptDlg(null); }
                     }} />
            )}
            {promptDlg.maxLength && (
              <div className="modal-counter">{promptDlg.value.length}/{promptDlg.maxLength}</div>
            )}
            <div className="modal-actions">
              <button className="link" onClick={() => { promptDlg.resolve(null); setPromptDlg(null); }}>取消</button>
              {promptDlg.extraAction && (
                <button className={`mini-btn${promptDlg.extraAction.danger ? " danger" : " ghost"}`}
                        onClick={() => { promptDlg.resolve(promptDlg.extraAction!.value); setPromptDlg(null); }}>
                  {promptDlg.extraAction.label}
                </button>
              )}
              <button className="mini-btn" onClick={() => { promptDlg.resolve(promptDlg.value); setPromptDlg(null); }}>
                {promptDlg.okText}
              </button>
            </div>
          </div>
        </div>
      )}

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

// 消息列表里的最小 conv_seq（发送中的 0 不计；空列表返回 0）。
function minSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > 0 && (m === 0 || x.convSeq < m)) m = x.convSeq;
  return m;
}
