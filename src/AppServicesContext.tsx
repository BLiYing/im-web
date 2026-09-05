// 应用级「稳定服务」Context（prop-drilling 墙的解法，见 CODING_STYLE §七）。
//
// 只收拢**稳定**依赖：IM 客户端 ref、吐司、应用内确认/输入弹窗、四个 refresh*。这些的身份恒定
// （ref / useState setter / 空依赖 useCallback），故 App 侧 `useMemo` 包一次即永不重建，消费组件不会
// 因 context 额外重渲染。**严禁**放高频 state（input / msgsByConv / conversations…）——那会让所有消费者
// 随每条消息/输入重渲染（§七 明令）。
//
// 消费者是**组件**（如抽出的会话详情抽屉），从 `useAppServices()` 取；**hook**（如 useDevices）仍按
// 参数注入依赖，不从 context 取——那才是可测的注入写法。

import { createContext, useContext, type MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { Conversation, GroupInfo } from "./sdk/protocol";
import type { useDialogs } from "./useDialogs";

type DialogsApi = ReturnType<typeof useDialogs>;

export interface AppServices {
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  comingSoon: (label: string) => void;
  askConfirm: DialogsApi["askConfirm"];
  askPrompt: DialogsApi["askPrompt"];
  refreshConversations: () => Promise<Conversation[]>;
  refreshFriends: () => Promise<void>;
  refreshGroupInfo: (cid: string) => Promise<GroupInfo | null>;
  refreshDownloadSettings: () => Promise<void>;
  /** 打开「发好友申请」弹窗（填验证消息后发出）。全站加好友入口都走它，**别直接调 requestFriend**——
   *  少走一次就少一次理由，收件人那边又变回"只有一个名字"。name 是对方显示名，由调用方按各自的
   *  备注/昵称口径算好（这里拿不到 remarks 表）。 */
  askFriendRequest: (userId: string, name: string) => void;
}

const AppServicesContext = createContext<AppServices | null>(null);

/** 应用级服务的 Provider。value 必须来自 App 的 `useMemo`（稳定身份），别传内联新对象。 */
export const AppServicesProvider = AppServicesContext.Provider;

/** 在 Provider 内取应用级服务；漏包 Provider 直接抛错（而非静默拿到 null）。 */
export function useAppServices(): AppServices {
  const ctx = useContext(AppServicesContext);
  if (!ctx) throw new Error("useAppServices 必须在 <AppServicesProvider> 内使用");
  return ctx;
}
