// App 级测试（smoke / messageList / pinnedBanner）的公共引导。
//
// 这三个文件都要「装 jsdom 缺的浏览器 API → 渲染 <App/> → 免密登录 → 点会话行 → 等 composer」，
// 曾各抄一份：登录按钮文案、`.convitem` 类名、输入框 placeholder 一改就同时崩三个文件。
// 集中在这里后，UI 结构变动只需改一处。FakeIMClient 仍由各测试自己 vi.mock（工厂必须文件内提升）。
import { expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Conversation } from "../sdk/protocol";
import App from "../App";

export const UID = "1001";
export const PEER = "2002";
export const CID = `u_${UID}_u_${PEER}`; // convIdFor(1001,2002)

/** 与小明的单聊会话行；传 over 覆盖任意字段。 */
export const makeConv = (over: Partial<Conversation> = {}): Conversation => ({
  conv_id: CID, peer: PEER, peer_nickname: "小明",
  last_message: { server_msg_id: "s1", from: PEER, content_type: "text", content: "在吗", conv_seq: 0, timestamp: Date.now() },
  latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0,
  ...over,
});

/** jsdom 缺失的浏览器 API（App 的滚动定位 / objectURL 用到）。放 beforeEach 里调。 */
export function installJsdomShims(): void {
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  URL.createObjectURL ??= (() => "blob:fake") as typeof URL.createObjectURL;
  URL.revokeObjectURL ??= () => {};
  // VoiceBubble 用 ResizeObserver 按气泡实宽定波形柱数；jsdom 没有这个 API，缺了会让整棵树抛。
  // 空实现即可：jsdom 无真实布局，柱数走组件的默认值。
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;
}

export function renderApp() { return render(<App />); }

/** 免密登录进入主界面，等会话列表出现（「小明」同时出现在头像回退字与昵称里，故用 AllByText）。 */
export async function loginAndWait(): Promise<void> {
  renderApp();
  fireEvent.click(screen.getByText("免密登录"));
  await waitFor(() => expect(screen.getAllByText("小明").length).toBeGreaterThan(0));
}

/** 进入与小明的单聊（点会话行），等 composer 出现。 */
export async function openChatWithPeer(): Promise<void> {
  fireEvent.click(document.querySelector(".convitem")!);
  await waitFor(() => expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument());
}

/** 登录 + 进单聊的常用组合。 */
export async function enterChat(): Promise<void> {
  await loginAndWait();
  await openChatWithPeer();
}
