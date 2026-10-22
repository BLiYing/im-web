import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { Conversation } from "../sdk/protocol";
import { AutoDeleteTiers } from "./AutoDeleteTiers";
import { useT } from "../i18n";

/** 会话详情抽屉内的「自动删除消息」二级页（沿用 AdminListPanel 的抽屉内二级页范式）：本会话档位单选（v2 共享档位，页脚单聊 / 群两套）。
 *  开启 / 改档位的说明性确认框由 `onPick`（useAutoDelete.setConvAutoDelete）负责；返回 false = 取消或失败 → 选中态回滚，
 *  成功 → 回上一页。 */
export function AutoDeleteConvPage({ conv, onPick, onBack, readOnly, onReadOnlyTap }: {
  conv: Conversation;
  onPick: (sec: number) => Promise<boolean>;
  onBack: () => void;
  /** 群聊非群主 / 管理员：整页只读，点击 toast（onReadOnlyTap），不发 PUT。 */
  readOnly?: boolean;
  onReadOnlyTap?: () => void;
}) {
  const t = useT();
  const [sel, setSel] = useState(conv.auto_delete_sec ?? 0);
  const [busy, setBusy] = useState(false);
  const pick = async (sec: number) => {
    if (busy || sec === sel) return;
    const prev = sel;
    setSel(sec); setBusy(true);
    const ok = await onPick(sec).catch(() => false);
    setBusy(false);
    if (ok) onBack(); else setSel(prev);
  };
  return (
    <div className="detail-manage">
      <div className="detail-manage-head">
        <button className="icon-btn" title={t("common.back")} onClick={onBack}><ChevronLeft size={20} /></button>
        <span>{t("ps.row.auto_delete_messages")}</span>
      </div>
      <AutoDeleteTiers className="detail-card" value={sel} disabled={busy} onPick={(s) => void pick(s)} readOnly={readOnly} onReadOnlyTap={onReadOnlyTap} />
      <div className="detail-foot-note">{t(conv.is_group ? "autodel.conv.footer_group" : "autodel.conv.footer")}</div>
    </div>
  );
}
