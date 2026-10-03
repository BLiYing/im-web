import { useCallback, useState } from "react";

// 应用内确认/输入弹窗（替代原生 window.confirm/prompt，统一 .modal 风格）。
// 从 App.tsx 抽出：自持 confirmDlg/promptDlg 两态，askConfirm/askPrompt 返回 Promise；
// 弹窗 JSX 仍由 App 渲染（读 confirmDlg/promptDlg 与对应 setter）。无外部依赖。

export type ConfirmDlg = { message: string; okText: string; cancelText: string; danger: boolean; resolve: (ok: boolean) => void };
export type PromptDlg = {
  title: string; value: string; placeholder: string; okText: string; maxLength?: number;
  /** 标题下面单独一行的说明（对齐 iOS/Android 弹窗：群备注「仅你自己可见…」）。 */
  hint?: string;
  multiline?: boolean; extraAction?: { label: string; value: string; danger?: boolean };
  resolve: (v: string | null) => void;
};

export function useDialogs() {
  const [confirmDlg, setConfirmDlg] = useState<ConfirmDlg | null>(null);
  const [promptDlg, setPromptDlg] = useState<PromptDlg | null>(null);

  // 应用内确认框：返回 Promise<boolean>，替代 window.confirm。danger=true 时确认按钮为危险色。
  const askConfirm = useCallback(
    (message: string, opts?: { okText?: string; cancelText?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setConfirmDlg({
        message,
        okText: opts?.okText ?? "确定",
        cancelText: opts?.cancelText ?? "取消",
        danger: opts?.danger ?? false,
        resolve,
      })),
    []);

  // 应用内输入框：返回 Promise<string | null>（取消为 null），替代 window.prompt。
  const askPrompt = useCallback(
    (title: string, defaultValue = "", opts?: {
      placeholder?: string; okText?: string; maxLength?: number; hint?: string;
      multiline?: boolean; extraAction?: { label: string; value: string; danger?: boolean };
    }) =>
      new Promise<string | null>((resolve) => setPromptDlg({
        title,
        value: defaultValue,
        placeholder: opts?.placeholder ?? "",
        okText: opts?.okText ?? "确定",
        maxLength: opts?.maxLength,
        hint: opts?.hint,
        multiline: opts?.multiline,
        extraAction: opts?.extraAction,
        resolve,
      })),
    []);

  return { confirmDlg, setConfirmDlg, promptDlg, setPromptDlg, askConfirm, askPrompt };
}
