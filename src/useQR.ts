// useQR：二维码簇（阶段 7c，CODING_STYLE §7）——扫一扫浮层/名片·群码模态/扫码结果 3 state + 落地页 ?qr= 截获回放（bootQr）+
// 解析 handleScanRaw / 我的名片 openMyCard / 群码·群邀请链接 openGroupCard / 重置 resetQRCard / 结果动作集 qrResultActions。
// 函数体逐字平移。原函数定义在 App 的 login 早退之后，而 Hook 须在早退之前调用：其依赖中 openPeerDetail 也定义在早退后
// → 经 ref 注入（App 在定义 openPeerDetail 后回写 openPeerDetailRef.current），其余（openChat/openGroupChat/refresh*/
// clientRef/setToast/myInfo/groupInfos/uid/phase）均定义在早退前、直接注入。
import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { GroupInfo, QRCard, QRResolved, UserCard } from "./sdk/protocol";
import { errorCode } from "./qr";

export interface QRDeps {
  phase: "login" | "app";
  uid: string;
  myInfo: Pick<UserCard, "nickname" | "avatar_url"> | null;
  groupInfos: Record<string, GroupInfo>;
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  openChat: (peer: string) => void;
  openGroupChat: (cid: string) => void;
  refreshFriends: () => Promise<void>;
  refreshConversations: () => Promise<unknown>;
  openPeerDetailRef: MutableRefObject<(peer: string) => void>;
}

export function useQR(d: QRDeps) {
  const { phase, uid, myInfo, groupInfos, clientRef, setToast, openChat, openGroupChat, refreshFriends, refreshConversations, openPeerDetailRef } = d;
  void (null as QRCard | QRResolved | null);
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

  // 群二维码 / 群邀请链接同源（码即邀请链接）：asLink 仅改标题与文案，复用同一张卡片模态（内含二维码图 + 复制链接）。
  const openGroupCard = async (cid: string, asLink = false) => {
    const gi = groupInfos[cid];
    const canManage = gi?.my_role === "owner" || gi?.my_role === "admin";
    const noun = asLink ? "群邀请链接" : "群二维码";
    const denyVerb = asLink ? "获取群邀请链接" : "出示群二维码";
    // perm_invite=1 时群码即邀请链接，仅群主/管理员可出示。无权限时不打开模态、直接中文吐司（对齐 iOS）。
    if (gi?.perm_invite && !canManage) {
      setToast(`群主已开启「仅管理员可邀请」，你无法${denyVerb}`);
      return;
    }
    try {
      const card = await clientRef.current!.groupQR(cid);
      setQrCardModal({ title: noun, subtitle: asLink ? "复制或分享链接，邀请好友加入群聊" : "扫描二维码，加入群聊",
        name: gi?.name || "群聊", avatarUrl: gi?.avatar_url, card, canReset: canManage, kind: "group", convId: cid });
    } catch (e) {
      // 服务端兜底（本地 perm_invite 可能过期）：300204 映射为中文，其余透传。
      const msg = errorCode(e) === 300204
        ? `群主已开启「仅管理员可邀请」，你无法${denyVerb}`
        : `获取${noun}失败：${(e as Error).message}`;
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
    onViewProfile: (peer: string) => openPeerDetailRef.current(peer),
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

  return { qrScan, setQrScan, qrCardModal, setQrCardModal, qrResult, setQrResult, handleScanRaw, openMyCard, openGroupCard, resetQRCard, qrResultActions };
}
