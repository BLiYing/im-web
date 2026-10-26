import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { SubPanel } from "./SubPanel";
import { getPrivacy, putPrivacy, VISIBILITY_LEVELS, type PrivacyPatch, type PrivacySettings, type Visibility } from "../../sdk/privacyApi";
import { useT } from "../../i18n";

/** 「谁能看到」可配置项：行名 / 页脚 / 取值字段（PRIVACY_VISIBILITY_DESIGN §4）。 */
export type VisibilityKind = "lastSeen" | "avatar";
export const VISIBILITY_META: Record<VisibilityKind, { titleKey: string; footerKey: string }> = {
  lastSeen: { titleKey: "ps.row.last_seen", footerKey: "ps.visibility.last_seen.footer" },
  avatar: { titleKey: "ps.row.avatar", footerKey: "ps.visibility.avatar.footer" },
};

/** 档位 → i18n 键（行右值与单选项共用）。 */
export const visibilityKey = (v: Visibility) => `ps.visibility.${v}`;

/** 只带被改那一项的 PUT 入参（避免覆盖其它隐私项，如自动删除默认档位）。 */
export const visibilityPatch = (kind: VisibilityKind, v: Visibility): PrivacyPatch => (kind === "lastSeen" ? { lastSeen: v } : { avatar: v });

/** 隐私与安全 ▸ 谁能看到 ▸ 上次上线 / 头像：三档单选页。进页 GET 取最新值；选中即保存（不弹确认），
 *  成功返回上一页并回传新值，失败 toast `ps.visibility.save_failed` 且选中态回滚。复用 `.radio-row` 单选组。 */
export function VisibilityPanel({ kind, token, initial, setToast, onSaved, onBack }: {
  kind: VisibilityKind;
  token: () => string;
  initial: Visibility;
  setToast: (msg: string) => void;
  onSaved: (v: Visibility) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [sel, setSel] = useState<Visibility>(initial);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // 同步守卫：state 要等重渲染才生效，同一帧内连点会发两次 PUT
  const touched = useRef(false);
  const tokenRef = useRef(token); // 同 AutoDeleteDefaultPanel：token 每次渲染新建，只在进页时取一次
  tokenRef.current = token;
  useEffect(() => {
    let alive = true;
    getPrivacy(tokenRef.current())
      .then((p: PrivacySettings) => { if (alive && !touched.current) setSel(p[kind]); })
      .catch(() => { /* 取不到就沿用已知值 */ });
    return () => { alive = false; };
  }, [kind]);

  const pick = async (v: Visibility) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const prev = sel;
    touched.current = true; setSel(v); setBusy(true);
    try { await putPrivacy(token(), visibilityPatch(kind, v)); onSaved(v); onBack(); }
    catch { setSel(prev); setToast(t("ps.visibility.save_failed")); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const meta = VISIBILITY_META[kind];
  return (
    <SubPanel className="visibility-panel" title={t(meta.titleKey)} onBack={onBack}>
      <div className="settings-group" role="radiogroup">
        {VISIBILITY_LEVELS.map((v) => (
          <button key={v} className="radio-row autodel-row" role="radio" aria-checked={sel === v} disabled={busy} onClick={() => void pick(v)}>
            <span className="row-label">{t(visibilityKey(v))}</span>
            {sel === v && <Check size={18} className="autodel-check" />}
          </button>
        ))}
      </div>
      <div className="settings-foot">{t(meta.footerKey)}</div>
    </SubPanel>
  );
}
