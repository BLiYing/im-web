// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Avatar, avatarColor, avatarInitial } from "./Avatar";

afterEach(cleanup);

describe("avatarColor", () => {
  it("同一 seed 稳定同色，空 seed 回落首色", () => {
    expect(avatarColor("1001")).toBe(avatarColor("1001"));
    expect(avatarColor("")).toBe("#3399F5");
  });
  it("落在 6 色板内", () => {
    const palette = ["#3399F5", "#4FC778", "#F59E33", "#E65C6B", "#9473E6", "#2EB8BD"];
    for (const seed of ["a", "1002", "群123", "zzz"]) expect(palette).toContain(avatarColor(seed));
  });
});

// 头像 <img> 带 alt=""（装饰图，可访问角色为 presentation），用 querySelector 查。
describe("<Avatar>", () => {
  it("有 url 渲染 <img>", () => {
    const { container } = render(<Avatar url="http://x/a.png" label="张三" seed="1001" />);
    expect(container.querySelector("img.avatar-img")).toHaveAttribute("src", "http://x/a.png");
  });

  it("无 url 回退首字母圈（中文名取末字）+ 底色", () => {
    const { container } = render(<Avatar label="张三" seed="1001" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("三")).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.background).not.toBe("");
  });

  it("img onError 后回退首字母，不再渲染 <img>", () => {
    const { container } = render(<Avatar url="http://x/broken.png" label="李四" seed="1002" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("四")).toBeInTheDocument();
  });

  it("传 onClick 时可点（role=button）", () => {
    render(<Avatar label="王五" onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

describe("avatarInitial", () => {
  it("中文名取末字", () => {
    expect(avatarInitial("张三丰")).toBe("丰");
    expect(avatarInitial("甲")).toBe("甲");
  });

  it("英文名或用户名取首字母并转大写", () => {
    expect(avatarInitial("bob")).toBe("B");
    expect(avatarInitial("libeyond")).toBe("L");
  });

  it("中文开头数字结尾：末字不是汉字，退回取首字母", () => {
    expect(avatarInitial("用户1001")).toBe("用");
  });

  it("空白与空字符串安全", () => {
    expect(avatarInitial("")).toBe("");
    expect(avatarInitial("   ")).toBe("");
  });

  // 结尾是 emoji（辅助平面字符，UTF-16 用一对代理对表示，不是汉字）：退回取首字母，
  // 且取字形簇时不会把代理对拆成半个（拆了会是无效字符甚至抛异常）。
  it("结尾 emoji 安全退回取首字母", () => {
    expect(avatarInitial("小😀")).toBe("小");
  });

  // 扩展区汉字（辅助平面，代理对表示）同样要识别成汉字、取末字整体。
  it("扩展区汉字识别为汉字", () => {
    expect(avatarInitial("小𠀀")).toBe("𠀀"); // U+20000，CJK 扩展 B 第一个字
  });

  // 扩展 C 起更冷门的辅助平面汉字同样要识别——范围覆盖到整个辅助表意平面，不只 B。
  it("扩展C汉字识别为汉字", () => {
    expect(avatarInitial("小𪜀")).toBe("𪜀"); // U+2A700，CJK 扩展 C 第一个字
  });
});
