// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Avatar, avatarColor } from "./Avatar";

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

  it("无 url 回退首字母圈（label 末两字）+ 底色", () => {
    const { container } = render(<Avatar label="张三" seed="1001" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("张三")).toBeInTheDocument(); // "张三".slice(-2)
    expect((container.firstChild as HTMLElement).style.background).not.toBe("");
  });

  it("img onError 后回退首字母，不再渲染 <img>", () => {
    const { container } = render(<Avatar url="http://x/broken.png" label="李四" seed="1002" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("李四")).toBeInTheDocument();
  });

  it("传 onClick 时可点（role=button）", () => {
    render(<Avatar label="王五" onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
