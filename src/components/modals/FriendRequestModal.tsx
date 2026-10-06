import { useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { Modal } from "../Modal";
import { useT } from "../../i18n";

/** 好友申请上限（rune）。与后端 `friend.MaxHelloRunes` 一致——服务端超长会**截断**而不是报错，
 *  端上先拦一道只是为了让用户当场知道写不下了，而不是发完才发现被剪掉半句。 */
export const MAX_FRIEND_HELLO = 50;

/** 按 Unicode 码点（rune）截断，与服务端口径一致；不按 UTF-16 切，避免劈开 emoji 代理对。 */
export function clipRunes(s: string, max: number): string {
  const cps = [...s];
  return cps.length > max ? cps.slice(0, max).join("") : s;
}

/** 「发好友申请」弹窗：填验证消息（申请理由）后发出。
 *
 *  全站五个加好友入口（通讯录搜索结果 / 资料页 / 群成员菜单 / 扫码结果 / 被拒收系统行）
 *  **都走这一个弹窗**——直接调接口的话，加一个入口就漏一次理由，收件人那边就又变回"只有一个名字"。
 *
 *  默认填「我是<我的昵称>」（微信同款）：多数人不会自己想措辞，给个能直接发的默认值，
 *  比留空更可能真的带上信息。用户当然可以改或清空（理由本身是选填）。 */
export function FriendRequestModal({ name, defaultHello, busy, onSend, onClose }: {
  name: string;          // 对方显示名（备注 → 昵称 → @句柄 → 占位，由调用方算好）
  defaultHello: string;  // 预填的验证消息
  busy: boolean;
  onSend: (hello: string) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const [hello, setHello] = useState(clipRunes(defaultHello, MAX_FRIEND_HELLO));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 光标落到**末尾**再聚焦。`autoFocus` 单用会把光标停在预填文案的最前面，
  // 于是想改成「我是×××，同事」的人只能先按一下 End——预填值越有用，这个别扭就越常撞上。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <Modal className="modal friendreq-modal" onClose={onClose}>
      <h3 className="modal-title"><UserPlus size={18} /> {tr("friend.request.title")}</h3>
      <div id="friendreq-tip" className="friendreq-target">{tr("friend.request.alert_message", { name })}</div>
      <textarea id="friendreq-hello" ref={inputRef} className="friendreq-input" rows={3} aria-labelledby="friendreq-tip"
        value={hello} placeholder={tr("friend.request.placeholder")}
        onChange={(e) => {
          const raw = e.target.value;
          const clipped = clipRunes(raw, MAX_FRIEND_HELLO);
          setHello(clipped);
          if (clipped !== raw) {
            // 截断后受控值回写会把光标顶到末尾（在中间编辑时尤其突兀）；React 回写在事件结束时同步完成，微任务里还原。
            const el = e.target, caret = Math.min(el.selectionStart, clipped.length);
            queueMicrotask(() => el.setSelectionRange(caret, caret));
          }
        }} />
      <div className="friendreq-count">{[...hello].length}/{MAX_FRIEND_HELLO}</div>
      <div className="modal-actions">
        <button className="link" onClick={onClose}>{tr("common.cancel")}</button>
        <button className="mini-btn" disabled={busy} onClick={() => onSend(hello.trim())}>
          {busy ? tr("friend.request.sending") : tr("common.send")}
        </button>
      </div>
    </Modal>
  );
}
