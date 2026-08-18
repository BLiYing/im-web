import { useCallback, useEffect, useState } from "react";

// 轻量浮层提示（如「xx（开发中）」）：约 1.8s 自动消失。从 App.tsx 抽出，自持状态 + 自动消失副作用。
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);

  // 未接后端的功能统一用它提示「开发中」。
  const comingSoon = useCallback((label: string) => setToast(`${label}（开发中）`), []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  return { toast, setToast, comingSoon };
}
