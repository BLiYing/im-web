// useEvent：把「身份会变」的回调包成**身份恒定**的回调（调用时总走最新实现）。用于把 send/onGateTap 这类依赖高频
// state 的 useCallback 放进 Context 而不让 Context 值每次按键重建（CODING_STYLE §七「Context 不放高频变化」）。
// 写 ref.current 发生在渲染期——与本仓既有 `messagesRef.current = messages` 镜像同款；仅供事件回调用，勿在渲染期调用返回值。
import { useCallback, useRef } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useEvent<F extends (...args: any[]) => any>(fn: F): F {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: Parameters<F>) => ref.current(...args)) as F, []);
}
