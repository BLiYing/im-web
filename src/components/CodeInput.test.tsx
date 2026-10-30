// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CodeInput, RecoveryInput } from "./CodeInput";

function Harness({ onComplete }: { onComplete?: (v: string) => void }) {
  const [v, setV] = useState("");
  return <CodeInput value={v} onChange={setV} onComplete={onComplete} label="code" />;
}
const input = (c: HTMLElement) => c.querySelector("input") as HTMLInputElement;

describe("CodeInput", () => {
  it("滤非数字并截 6 位；数字键盘 + one-time-code", () => {
    const { container } = render(<Harness />);
    const el = input(container);
    expect(el.getAttribute("inputmode")).toBe("numeric");
    expect(el.getAttribute("autocomplete")).toBe("one-time-code");
    fireEvent.change(el, { target: { value: "12ab34567890" } });
    expect(el.value).toBe("123456");
  });
  it("粘贴「123 456」清洗为 123456 并触发 onComplete 一次", () => {
    const done = vi.fn();
    const { container } = render(<Harness onComplete={done} />);
    fireEvent.paste(input(container), { clipboardData: { getData: () => "123 456" } });
    expect(input(container).value).toBe("123456");
    expect(done).toHaveBeenCalledWith("123456");
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("输入法组词期间不改写文本、不触发完成；compositionend 后再清洗", () => {
    const done = vi.fn();
    const { container } = render(<Harness onComplete={done} />);
    const el = input(container);
    fireEvent.compositionStart(el);
    fireEvent.change(el, { target: { value: "ni hao" } });
    expect(el.value).toBe("ni hao");
    expect(done).not.toHaveBeenCalled();
    fireEvent.compositionEnd(el, { target: { value: "123456" } });
    expect(el.value).toBe("123456");
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("请求中 readOnly（焦点不丢）", () => {
    const { container } = render(<CodeInput value="" onChange={() => {}} readOnly label="c" />);
    expect(input(container).readOnly).toBe(true);
    expect(input(container).disabled).toBe(false);
  });
});

describe("RecoveryInput", () => {
  it("关闭自动大写 / 纠正 / 拼写检查；输入原样保留（不改写大小写和连字符）", () => {
    const Rec = () => { const [v, setV] = useState(""); return <RecoveryInput value={v} onChange={setV} label="r" />; };
    const { container } = render(<Rec />);
    const el = input(container);
    expect(el.getAttribute("autocapitalize")).toBe("off");
    expect(el.getAttribute("autocorrect")).toBe("off");
    expect(el.getAttribute("spellcheck")).toBe("false");
    fireEvent.change(el, { target: { value: "K7M2Q-9xw3p" } });
    expect(el.value).toBe("K7M2Q-9xw3p");
  });
  it("粘贴整份清单 / 带前缀换行的文本：只取第一个恢复码并规整成 xxxxx-xxxxx", () => {
    const Rec = () => { const [v, setV] = useState(""); return <RecoveryInput value={v} onChange={setV} label="r" />; };
    const { container } = render(<Rec />);
    const el = input(container);
    fireEvent.paste(el, { clipboardData: { getData: () => "1. K7M2Q-9XW3P\n2. n4r8t-5hj6c\n" } });
    expect(el.value).toBe("k7m2q-9xw3p");
  });
  it("粘贴里没有合法恢复码时不拦截（走浏览器默认粘贴）", () => {
    const Rec = () => { const [v, setV] = useState(""); return <RecoveryInput value={v} onChange={setV} label="r" />; };
    const { container } = render(<Rec />);
    const notPrevented = fireEvent.paste(input(container), { clipboardData: { getData: () => "abc" } });
    expect(notPrevented).toBe(true);
  });
  it("回车提交并 preventDefault（提交弹确认框时，同一次回车不能落到确认钮上把破坏性确认越过）", () => {
    const submit = vi.fn();
    const { container } = render(<RecoveryInput value="x" onChange={() => {}} onSubmit={submit} label="r" />);
    const notPrevented = fireEvent.keyDown(input(container), { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });
});
