import { useEffect, useRef, useState } from "react";
import { SubPanel } from "./SubPanel";
import { AutoDeleteTiers } from "../AutoDeleteTiers";
import { getAutoDeleteDefault, putAutoDeleteDefault } from "../../sdk/privacyApi";
import { useT } from "../../i18n";

/** 隐私与安全 ▸ 自动删除消息：账号「新会话默认」档位选择页（AUTO_DELETE_DESIGN §3.3 A/B）。
 *  进页 GET 取最新值；选中即保存（不弹确认——它只影响之后新建的会话），成功返回上一页并回传新值，
 *  失败 toast `autodel.save_failed` 且选中态回滚。 */
export function AutoDeleteDefaultPanel({ token, initial, setToast, onSaved, onBack }: {
  token: () => string;
  initial: number | null;
  setToast: (msg: string) => void;
  onSaved: (sec: number) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [sel, setSel] = useState(initial ?? 0);
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  // token 由父级每次渲染新建（内联箭头）：放进 effect 依赖会让父级每次重渲染都重新 GET，故用 ref 只在进页时取一次。
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    let alive = true;
    getAutoDeleteDefault(tokenRef.current()).then((v) => { if (alive && !touched.current) setSel(v); }).catch(() => { /* 取不到就沿用已知值 */ });
    return () => { alive = false; };
  }, []);

  const pick = async (sec: number) => {
    if (busy) return;
    const prev = sel;
    touched.current = true; setSel(sec); setBusy(true);
    try { await putAutoDeleteDefault(token(), sec); onSaved(sec); onBack(); }
    catch { setSel(prev); setToast(t("autodel.save_failed")); }
    finally { setBusy(false); }
  };

  return (
    <SubPanel className="autodel-panel" title={t("ps.row.auto_delete_messages")} onBack={onBack}>
      <AutoDeleteTiers value={sel} disabled={busy} onPick={(s) => void pick(s)} />
      <div className="settings-foot">{t("autodel.default.footer")}</div>
    </SubPanel>
  );
}
