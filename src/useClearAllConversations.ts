// 「清除所有对话」二级页的状态簇：二次确认 → 请求 → 成功后本机清除 → 回隐私页 + toast。
// 失败（网络 / 限流 / 服务端错误）：按钮恢复，红字原因，**本机不做任何变更**（apply 只在请求成功后调用）。
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import type { ClearAllResult } from "./sdk/clearAllApi";

type AskConfirm = (message: string, opts?: { title?: string; okText?: string; danger?: boolean }) => Promise<boolean>;

export interface ClearAllState { busy: boolean; error: string; count: number; submit: () => Promise<void> }

export function useClearAllConversations(deps: {
  count: number;                                      // 页面打开时本机会话列表可见会话数（只用于确认弹窗文案）
  run: () => Promise<ClearAllResult>;                 // 调后端；抛错=失败
  apply: (res: ClearAllResult) => Promise<void>;      // 成功后的本机清除（不抛：失败自行记日志）
  askConfirm: AskConfirm;
  onDone: (cleared: number) => void;                  // 仍停留在本页时：回隐私页 + toast（用户已返回则不调）
}): ClearAllState {
  const { run, apply, askConfirm, onDone } = deps;
  const [count] = useState(deps.count);               // 打开时快照，之后列表变化不改弹窗文案
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);                     // 确认弹窗打开期间 busy 还没置位：连点会叠弹窗
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const ok = await askConfirm(t("privacy.clear_all.confirm_body", { n: count }), {
        title: t("privacy.clear_all.confirm_title"), okText: t("privacy.clear_all.confirm_ok"), danger: true,
      });
      if (!ok) return;
      setBusy(true); setError("");
      let res: ClearAllResult;
      try {
        res = await run();
      } catch (e) {
        if (alive.current) setError((e as Error).message || t("net.error.cannot_connect"));
        return;
      } finally {
        if (alive.current) setBusy(false);
      }
      await apply(res);
      if (alive.current) onDone(res.cleared);
    } finally {
      inFlight.current = false;
    }
  }, [askConfirm, count, run, apply, onDone]);

  return { busy, error, count, submit };
}
