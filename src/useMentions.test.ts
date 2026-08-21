// @vitest-environment jsdom
import { describe, it, expect, vi , afterEach } from "vitest";
import { renderHook, act , cleanup } from "@testing-library/react";
import { createRef } from "react";
import { useMentions, type MentionsDeps } from "./useMentions";
import type { GroupInfo } from "./sdk/protocol";
import { MENTION_ALL_LABEL } from "./mention";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）

const gi = (role = "owner"): GroupInfo => ({ conv_id: "g1", name: "群", my_role: role, members: [
  { user_id: "u1", role: "owner", nickname: "我" }, { user_id: "u2", role: "member", nickname: "小明" }, { user_id: "u3", role: "admin", nickname: "小红" }] } as unknown as GroupInfo);
function mount(over: Partial<MentionsDeps> = {}) {
  const deps: MentionsDeps = { convId: "g1", groupConvId: "g1", peer: "", uid: "u1", groupInfos: { g1: gi() }, input: "hi @", setInput: vi.fn(), composerRef: createRef<HTMLTextAreaElement>(), ...over };
  return { ...renderHook((p: MentionsDeps) => useMentions(p), { initialProps: deps }), deps };
}
describe("useMentions", () => {
  it("面板关闭时无候选；打开（query=\"\"）→ 列出他人（排除自己）+ 群主可见 @所有人 置顶", () => {
    const { result } = mount();
    expect(result.current.mentionRows).toEqual([]);
    act(() => result.current.setMentionQuery(""));
    expect(result.current.mentionRows[0].label).toBe(MENTION_ALL_LABEL);
    expect(result.current.mentionRows.map((r) => r.userId)).toEqual([null, "u2", "u3"]);
  });
  it("普通成员看不到 @所有人；过滤词收窄候选；过滤变化高亮回首项", () => {
    const { result } = mount({ groupInfos: { g1: gi("member") } });
    act(() => result.current.setMentionQuery(""));
    expect(result.current.mentionRows.map((r) => r.userId)).toEqual(["u2", "u3"]);
    act(() => result.current.setMentionActive(1));
    act(() => result.current.setMentionFilter("红"));
    expect(result.current.mentionRows.map((r) => r.label)).toEqual(["小红"]);
    expect(result.current.mentionActive).toBe(0);
  });
  it("pickMention：回填 token、记候选表（按 uid）、关面板；@所有人 置 pending", () => {
    const { result, deps } = mount();
    act(() => result.current.setMentionQuery(""));
    act(() => result.current.pickMention("小明", "u2"));
    expect(deps.setInput).toHaveBeenCalledWith(expect.stringContaining("@小明"));
    expect(result.current.mentionCandidates.current.u2).toBe("小明");
    expect(result.current.mentionQuery).toBeNull();
    act(() => result.current.pickMention(MENTION_ALL_LABEL, null));
    expect(result.current.mentionAllPending.current).toBe(true);
  });
  it("onMentionNavKey：↓/↑ 循环高亮，Enter 选中当前项，Esc 关面板", () => {
    const { result, deps } = mount();
    act(() => result.current.setMentionQuery(""));
    const ev = (key: string) => ({ key, preventDefault: vi.fn(), nativeEvent: { isComposing: false } } as unknown as React.KeyboardEvent<HTMLElement>);
    act(() => { result.current.onMentionNavKey(ev("ArrowDown")); });
    expect(result.current.mentionActive).toBe(1);
    act(() => { result.current.onMentionNavKey(ev("ArrowUp")); result.current.onMentionNavKey(ev("ArrowUp")); });
    expect(result.current.mentionActive).toBe(2); // 循环到末项
    act(() => { result.current.onMentionNavKey(ev("Enter")); });
    expect(deps.setInput).toHaveBeenCalled();
    expect(result.current.mentionQuery).toBeNull();
    act(() => result.current.setMentionQuery("x"));
    act(() => { result.current.onMentionNavKey(ev("Escape")); });
    expect(result.current.mentionQuery).toBeNull();
  });
});
