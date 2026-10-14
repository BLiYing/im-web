// 会话文件夹的共享入口：App 持有 useChatFolders，右键菜单 / 设置面板 / Tab 条经它取（免得给 ContextMenusHost、
// SettingsPanelsHost 逐层加 props——这两个组件已经是 40+ props 的巨型接口）。
import { createContext, useContext } from "react";
import type { UseChatFolders } from "./useChatFolders";

const Ctx = createContext<UseChatFolders | null>(null);

export const ChatFoldersProvider = Ctx.Provider;

/** 在 Provider 内取；漏包 Provider 直接抛错（而非静默拿到 null）。 */
export function useChatFoldersCtx(): UseChatFolders {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChatFoldersCtx 必须在 <ChatFoldersProvider> 内使用");
  return v;
}
