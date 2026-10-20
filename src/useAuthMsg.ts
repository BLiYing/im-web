// 登录页提示状态：错误（红）与通知（非红，如注销成功）互斥。通知存 i18n 键而非译文，
// 登录页切语言后随之重译，且样式不靠文案比较判定。
import { useCallback, useState } from "react";

export function useAuthMsg() {
  const [msg, setMsg] = useState<{ err: string; notice: string }>({ err: "", notice: "" });
  const setAuthErr = useCallback((err: string) => setMsg({ err, notice: "" }), []);
  const setAuthNotice = useCallback((noticeKey: string) => setMsg({ err: "", notice: noticeKey }), []);
  const clearAuthNotice = useCallback(() => setMsg((m) => (m.notice ? { err: m.err, notice: "" } : m)), []);
  return { authErr: msg.err, authNotice: msg.notice, setAuthErr, setAuthNotice, clearAuthNotice };
}
