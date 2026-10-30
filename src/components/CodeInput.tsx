import { useEffect, useRef } from "react";
import { sanitizeCode6, extractRecoveryCode, CODE_LEN } from "../twoStepRules";
import "./twoStep.css";

/** 6 位动态码输入框（设置页绑定 / 关闭 / 重新生成与登录二步页共用）。
 *  - `inputmode=numeric` + `autocomplete=one-time-code`；不设 `maxlength` 属性：浏览器会在 onChange 之前就把粘贴的「123 456」截成 6 个字符，
 *    清洗不到后面的数字，所以改在 onChange 里「滤非数字 + 截 6 位」。
 *  - 输入法组词期间（compositionstart~end）不改写文本，结束后再清洗。
 *  - `onComplete` 只在非组词的清洗结果刚好满 6 位时触发（登录页自动提交）。
 *  - `focusKey` 变化（如错码清空后）重新聚焦；请求中用 readOnly 而不是 disabled，焦点不丢。 */
export function CodeInput({ value, onChange, onComplete, readOnly, invalid, autoFocus, focusKey, label }: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  readOnly?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  focusKey?: number;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useEffect(() => { if (focusKey !== undefined && !readOnly) ref.current?.focus(); }, [focusKey, readOnly]);
  const apply = (raw: string) => {
    const v = sanitizeCode6(raw);
    onChange(v);
    if (v.length === CODE_LEN) onComplete?.(v);
  };
  return (
    <input ref={ref} className={`ts-code6${invalid ? " invalid" : ""}`} type="text" inputMode="numeric" autoComplete="one-time-code"
      aria-label={label} placeholder="······" autoFocus={autoFocus} readOnly={readOnly} value={value}
      onChange={(e) => { if (composing.current) onChange(e.target.value); else apply(e.target.value); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => { composing.current = false; apply(e.currentTarget.value); }}
      onPaste={(e) => { e.preventDefault(); apply(e.clipboardData.getData("text")); }} />
  );
}

/** 恢复码输入框：关闭自动大写 / 纠正 / 拼写检查；输入中不改写文本（大小写 / 连字符 / 空格由提交时归一）。 */
export function RecoveryInput({ value, onChange, onSubmit, readOnly, invalid, autoFocus, focusKey, label }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  readOnly?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  focusKey?: number;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusKey !== undefined && !readOnly) ref.current?.focus(); }, [focusKey, readOnly]);
  return (
    <input ref={ref} className={`ts-recovery${invalid ? " invalid" : ""}`} type="text" autoComplete="off" autoCapitalize="off" autoCorrect="off"
      spellCheck={false} aria-label={label} placeholder="xxxxx-xxxxx" autoFocus={autoFocus} readOnly={readOnly} value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => { // 粘贴整份清单 / 带前缀或换行的文本：只取第一个恢复码；取不到就走浏览器默认粘贴
        const code = extractRecoveryCode(e.clipboardData.getData("text"));
        if (code) { e.preventDefault(); onChange(code); }
      }}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit?.(); } }} /* preventDefault：提交可能弹确认框并把焦点移到确认钮，同一次回车的 keypress 会落在确认钮上直接点掉（破坏性确认被一键越过） */ />
  );
}
