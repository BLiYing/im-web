// useQR：二维码簇（阶段 7c，CODING_STYLE §7）——扫一扫浮层/名片·群码模态/扫码结果 3 state + 落地页 ?qr= 截获回放（bootQr）+
// 解析 handleScanRaw / 我的名片 openMyCard / 群码·群邀请链接 openGroupCard / 重置 resetQRCard / 结果动作集 qrResultActions。
// 函数体逐字平移。原函数定义在 App 的 login 早退之后，而 Hook 须在早退之前调用：其依赖中 openPeerDetail 也定义在早退后
// → 经 ref 注入（App 在定义 openPeerDetail 后回写 openPeerDetailRef.current），其余（openChat/openGroupChat/refresh*/
// clientRef/setToast/myInfo/groupInfos/uid/phase）均定义在早退前、直接注入。
import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { GroupInfo, QRCard, QRResolved, UserCard } from "./sdk/protocol";
import { describeRaw, errorCode } from "./qr";
import { platform } from "./platform";
import { LOG_TAG, logger } from "./logging/logger";
import { t } from "./i18n";

export interface QRDeps {
  phase: "login" | "app";
  uid: string;
  myInfo: Pick<UserCard, "nickname" | "avatar_url"> | null;
  groupInfos: Record<string, GroupInfo>;
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  openChat: (peer: string) => void;
  openGroupChat: (cid: string) => void;
  refreshConversations: () => Promise<unknown>;
  openPeerDetailRef: MutableRefObject<(peer: string) => void>;
  /** 打开「发好友申请」弹窗（扫码结果的加好友按钮走它）。 */
  askFriendRequest: (userId: string, name: string) => void;
}

export function useQR(d: QRDeps) {
  const { phase, uid, myInfo, groupInfos, clientRef, setToast, openChat, openGroupChat, refreshConversations, openPeerDetailRef, askFriendRequest } = d;
  const [qrScan, setQrScan] = useState(false); // 扫一扫浮层
  const [qrCardModal, setQrCardModal] = useState<{ title: string; subtitle: string; name: string; avatarUrl?: string; card: QRCard; canReset: boolean; kind: "me" | "group"; convId?: string } | null>(null);
  const [qrResult, setQrResult] = useState<{ data: QRResolved | { kind: "expired" }; raw: string } | null>(null);
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

  // 深链（桌面端 imdesktop://q/u|g/<token>）：与上面的落地页回放同一条路——交给 handleScanRaw，
  // 走服务端 resolve → 结果卡片，要用户再点一次才生效。**登录后才订阅、换号重订**：宿主把登录前
  // 到的链接攒着，订阅那一刻一并交出；换号不重订的话，旧订阅会拿已作废的会话去 resolve。
  // 经 ref 调：handleScanRaw 每次渲染都是新函数，放进依赖会让订阅随每次渲染重装一遍。
  const handleScanRawRef = useRef<(raw: string) => Promise<void>>(async () => {});
  useEffect(() => {
    if (phase !== "app") return;
    return platform().subscribeDeepLink((raw) => {
      logger.info(LOG_TAG.app, "deep_link_received", { kind: describeRaw(raw).kind });   // 不记 token
      void handleScanRawRef.current(raw);
    });
  }, [phase, uid]);

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
  handleScanRawRef.current = handleScanRaw;

  const openMyCard = async () => {
    try {
      const card = await clientRef.current!.qrMyCard();
      setQrCardModal({ title: t("qr.scan.my_code"), subtitle: t("qr.card.my_subtitle"),
        name: myInfo?.nickname || uid, avatarUrl: myInfo?.avatar_url, card, canReset: true, kind: "me" });
    } catch (e) { setToast(t("qr.toast.my_card_failed", { error: (e as Error).message })); }
  };

  // 群二维码 / 群邀请链接同源（码即邀请链接）：asLink 仅改标题与文案，复用同一张卡片模态（内含二维码图 + 复制链接）。
  const openGroupCard = async (cid: string, asLink = false) => {
    const gi = groupInfos[cid];
    const canManage = gi?.my_role === "owner" || gi?.my_role === "admin";
    const denyMsg = t(asLink ? "qr.toast.admin_only_link" : "qr.toast.admin_only_code");
    // perm_invite=1 时群码即邀请链接，仅群主/管理员可出示。无权限时不打开模态、直接中文吐司（对齐 iOS）。
    if (gi?.perm_invite && !canManage) {
      setToast(denyMsg);
      return;
    }
    try {
      const card = await clientRef.current!.groupQR(cid);
      setQrCardModal({ title: t(asLink ? "qr.card.group_title_link" : "qr.card.group_title_code"), subtitle: t(asLink ? "qr.card.group_subtitle_link" : "qr.card.group_subtitle_code"),
        name: gi?.name || t("qr.card.group_default_name"), avatarUrl: gi?.avatar_url, card, canReset: canManage, kind: "group", convId: cid });
    } catch (e) {
      // 服务端兜底（本地 perm_invite 可能过期）：300204 映射为中文，其余透传。
      const msg = errorCode(e) === 300204
        ? denyMsg
        : t(asLink ? "qr.toast.group_link_failed" : "qr.toast.group_code_failed", { error: (e as Error).message });
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
      setToast(t("qr.toast.reset_ok"));
    } catch (e) {
      setToast(t("qr.toast.reset_failed", { error: (e as Error).message }));
    }
  };

  // 扫码结果的动作集：加好友 / 发消息 / 看资料 / 加群 / 进群。
  const qrResultActions = {
    // 只开弹窗：填完验证消息由 App 的统一路径发出（吐司/刷新也在那边，见 FriendRequestModal 的渲染点）。
    onAddFriend: (peer: string, name: string) => askFriendRequest(peer, name),
    onMessage: (peer: string) => openChat(peer),
    onViewProfile: (peer: string) => openPeerDetailRef.current(peer),
    onEnterGroup: (cid: string) => openGroupChat(cid),
    // 凭扫到的原始码入群：直连成功进群；需审批（300210）转"已提交"提示；已满/黑名单等透传文案。
    onJoinGroup: async (hello: string) => {
      const raw = qrResult?.raw ?? "";
      try {
        const info = await clientRef.current!.joinGroupByCode(raw, hello);
        setToast(t("qr.toast.joined", { name: info.name }));
        await refreshConversations();
        openGroupChat(info.conv_id);
      } catch (e) {
        if (errorCode(e) === 300210) setToast(t("qr.toast.join_requested"));
        else setToast((e as Error).message);
      }
    },
  };

  return { qrScan, setQrScan, qrCardModal, setQrCardModal, qrResult, setQrResult, handleScanRaw, openMyCard, openGroupCard, resetQRCard, qrResultActions };
}
