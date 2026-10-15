// 置顶消息面板（G0 v3，PINNED_PANEL_DESIGN §2 + 草图 ④）：沿用居中 Modal（宽 480，列表 max-height 60vh），
// 面板里就是一段只读「聊天」——壁纸底 + 与聊天页同源的真气泡（MessageBubble readOnly）+ 紧挨气泡的定位图标
// （别人的在气泡右、我发的在气泡左，底边对齐）；长按/右键 = 过滤后的 .ctx-menu（取消置顶 / 复制 / 定位）；
// 底栏「取消所有置顶」（仅有权限者，二次确认后一次批量请求）。无底部「关闭」按钮：左上 ✕ / Esc / 点遮罩关闭。
import { useEffect, useState, type MouseEvent } from "react";
import { Copy, PinOff } from "lucide-react";
import type { ChatMessage, PinnedMessage } from "../../sdk/protocol";
import { pinnedBubbleMessage, pinnedMenuIds, type PinnedMenuId } from "../../pinned";
import { dayHeader, isSameDay, type TimeFormat } from "../../time";
import { Modal } from "../Modal";
import { ModalHead } from "../ModalHead";
import { AnchoredMenu } from "../AnchoredMenu";
import { MessageBubble, SenderColumn, type BubbleEnv } from "../MessageBubble";
import { LocateInChatIcon } from "../icons/LocateInChatIcon";
import { useAppServices } from "../../AppServicesContext";
import { useT } from "../../i18n";
import { LOG_TAG, logger } from "../../logging/logger";

export interface PinnedListModalProps {
  pinned: PinnedMessage[];
  /** 本会话本地已加载的消息（兜底顺序 ① 本地行；也供引用条找原消息）。 */
  local: readonly ChatMessage[] | undefined;
  convId: string;
  uid: string;
  peer: string;
  isGroupChat: boolean;
  timeFormat: TimeFormat;
  /** 能否取消置顶（= 置顶权限：群内 perm_pin，单聊双方）。无权限：无长按「取消置顶」、无底栏、无副标题。 */
  canPin: boolean;
  env: BubbleEnv;
  /** 定位到聊天里那条（App 的 jumpToPinned，已含「目标已撤回 → toast + 重拉」）。面板会先关再调。 */
  onLocate: (convSeq: number) => void;
  /** 重拉置顶集合（一键取消成功/失败后对齐）。 */
  onRefresh: () => void;
  onClose: () => void;
}

type Menu = { x: number; y: number; m: ChatMessage; seq: number };

export function PinnedListModal(p: PinnedListModalProps) {
  const tr = useT();
  const { clientRef, setToast } = useAppServices();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const { onClose } = p;

  // Esc 由内向外逐层收：确认框 → 长按菜单 → 面板。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmAll) setConfirmAll(false); else if (menu) setMenu(null); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmAll, menu, onClose]);

  const locate = (seq: number) => { setMenu(null); onClose(); p.onLocate(seq); };
  const runMenu = (id: PinnedMenuId, mm: Menu) => {
    setMenu(null);
    if (id === "locate") return locate(mm.seq);
    if (id === "copy") { void navigator.clipboard?.writeText(mm.m.content); setToast(tr("common.copied")); return; }
    // 取消置顶：只作用于所长按那条，不确认（可逆）；走既有 pin op(pinned=false)，帧回来后本地摘除 + 合并重拉对齐。
    clientRef.current?.pinMessage(p.convId, mm.seq, false);
  };
  const clearAll = async () => {
    setConfirmAll(false);
    try {
      await clientRef.current?.clearPinned(p.convId);
      onClose();
    } catch (e) {
      logger.warn(LOG_TAG.ui, "clear_pinned_failed", { conv_id: p.convId, message: (e as Error).message });
      setToast((e as Error).message || tr("common.action_failed"));
    }
    p.onRefresh(); // 成功：横幅立即收敛（不等广播帧）；失败：与服务端对齐
  };

  const rows = p.pinned.map((pm) => ({ pm, m: pinnedBubbleMessage(pm, p.local, p.convId, tr) }));
  return (
    <Modal className="modal pinned-modal" onClose={onClose}>
      <div className="pinned-panel" onClick={() => setMenu(null)}>
        <ModalHead title={tr("pinned.title", { count: p.pinned.length })}
          subtitle={p.canPin ? tr("pinned.long_press_hint") : tr("pinned.long_press_hint_readonly")} onClose={onClose} />
        <div className="pinned-list" onScroll={() => setMenu(null)}>
          {rows.map(({ pm, m }, i) => (
            <PinnedRow key={pm.convSeq} {...p} m={m} seq={pm.convSeq} menuActive={menu?.seq === pm.convSeq}
              showDate={m.timestamp > 0 && (i === 0 || !isSameDay(m.timestamp, rows[i - 1].m.timestamp))}
              onLocate={locate}
              onMenu={(e, mm) => { e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, m: mm, seq: pm.convSeq }); }} />
          ))}
        </div>
        {p.canPin && (
          <div className="pinned-foot">
            <button className="pinned-unpin-all" onClick={() => setConfirmAll(true)}>{tr("pinned.unpin_all")}</button>
          </div>
        )}
        {/* 菜单渲染在 Modal 面板内部：.ctx-menu 与 .modal-mask 同为 z-index 50，若作为遮罩的兄弟渲染，谁在上取决于 DOM 先后
            （文件夹 Tab 菜单就栽在这）；放进遮罩自己的层叠上下文里，恒在面板之上。 */}
        {menu && (
          <AnchoredMenu x={menu.x} y={menu.y} className="ctx-menu pinned-ctx-menu">
            {pinnedMenuIds(menu.m, p.canPin).map((id) => (
              <button key={id} className={id === "unpin" ? "danger" : undefined} onClick={() => runMenu(id, menu)}>
                {id === "unpin" ? <PinOff size={16} className="menu-icon" /> : id === "copy" ? <Copy size={16} className="menu-icon" /> : <LocateInChatIcon size={16} className="menu-icon" />}
                {id === "unpin" ? tr("pinned.unpin") : id === "copy" ? tr("common.copy") : tr("chat.menu.locate")}
              </button>
            ))}
          </AnchoredMenu>
        )}
        {confirmAll && (
          <Modal className="modal confirm-modal pinned-confirm" onClose={() => setConfirmAll(false)}>
            <h3>{tr("pinned.unpin_all_title")}</h3>
            <div className="confirm-msg">{tr("pinned.unpin_all_message", { count: p.pinned.length })}</div>
            <div className="modal-actions">
              <button className="link" onClick={() => setConfirmAll(false)}>{tr("common.cancel")}</button>
              <button className="mini-btn danger" autoFocus onClick={() => void clearAll()}>{tr("pinned.unpin_all_confirm")}</button>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}

/** 一条置顶 = 一个只读「聊天行」：日期胶囊（与上一条不同日才显）+ 群聊对方头像·昵称 + 真气泡 + 定位图标。
 *  图标与气泡在同一 flex 行、底边对齐、间距 8：我发的图标在**左**（DOM 在气泡前），别人的在**右**（DOM 在气泡后）。 */
function PinnedRow(p: PinnedListModalProps & {
  m: ChatMessage; seq: number; showDate: boolean; menuActive: boolean;
  onLocate: (seq: number) => void; onMenu: (e: MouseEvent, m: ChatMessage) => void;
}) {
  const tr = useT();
  const { m, seq } = p;
  const mine = m.from === p.uid;
  const bubble = (
    <MessageBubble {...p.env} m={m} messages={p.local ?? []} peer={p.peer} isGroupChat={p.isGroupChat} uid={p.uid}
      readSeq={0} timeFormat={p.timeFormat} selectMode={false} menuActive={p.menuActive} uploadProgress={{}}
      readOnly onMenu={p.onMenu} />
  );
  const locateBtn = (
    <button className="pinned-locate" title={tr("pinned.locate")} aria-label={tr("pinned.locate")}
      onClick={(e) => { e.stopPropagation(); p.onLocate(seq); }}><LocateInChatIcon size={18} /></button>
  );
  return (
    <div className={`msg-item pinned-item ${mine ? "me" : "them"}`} data-pinned-seq={seq}>
      {p.showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
      <div className="pinned-line">
        {mine && locateBtn}
        {/* 整条气泡点击 = 定位：捕获阶段吞掉点击，气泡内图片/语音/链接/名片/文件的处理器一律收不到（只读）。 */}
        <div className={`row ${mine ? "me" : "them"}`}
          onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); p.onLocate(seq); }}>
          {p.isGroupChat && !mine
            ? <SenderColumn m={m} showAvatar showSender env={p.env} readOnly>{bubble}</SenderColumn>
            : bubble}
        </div>
        {!mine && locateBtn}
      </div>
    </div>
  );
}
