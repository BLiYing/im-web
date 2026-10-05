// 页面从不可见回到可见（切回标签页 / 还原窗口）时回调一次。
// 可见即读用它补报：页面 hidden 期间到达的消息不算读过（markVisibleRead 里挡掉），
// 回到前台时它们若正在视口里，得在这里补一次扫描，否则要等用户滚一下才上报。
import { useEffect, useRef } from "react";

export function usePageVisibleAgain(cb: () => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const onChange = () => { if (!document.hidden) ref.current(); };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
}
