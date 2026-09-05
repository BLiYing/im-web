import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Modal } from "../Modal";

/** 好友申请上限（rune）。与后端 `friend.MaxHelloRunes` 一致——服务端超长会**截断**而不是报错，
 *  端上先拦一道只是为了让用户当场知道写不下了，而不是发完才发现被剪掉半句。 */
export const MAX_FRIEND_HELLO = 50;

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
  const [hello, setHello] = useState(defaultHello);
  return (
    <Modal className="modal friendreq-modal" onClose={onClose}>
      <h3 className="modal-title"><UserPlus size={18} /> 添加好友</h3>
      <div className="friendreq-target">发送给 <b>{name}</b></div>
      <label className="friendreq-label" htmlFor="friendreq-hello">验证消息（选填，对方会看到）</label>
      <textarea id="friendreq-hello" className="friendreq-input" rows={3} maxLength={MAX_FRIEND_HELLO}
        value={hello} autoFocus placeholder="说一句，让对方知道你是谁"
        onChange={(e) => setHello(e.target.value)} />
      <div className="friendreq-count">{hello.length}/{MAX_FRIEND_HELLO}</div>
      <div className="modal-actions">
        <button className="link" onClick={onClose}>取消</button>
        <button className="mini-btn" disabled={busy} onClick={() => onSend(hello.trim())}>
          {busy ? "发送中…" : "发送申请"}
        </button>
      </div>
    </Modal>
  );
}
