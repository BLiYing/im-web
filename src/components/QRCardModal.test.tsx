// @vitest-environment jsdom
// 名片码 / 群二维码 / 群邀请链接 展示模态：居中头部（名字+meta）、链接模式不画码、「查看二维码」接线。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { QRCardModal } from "./QRCardModal";
import type { QRCard } from "../sdk/protocol";

afterEach(cleanup);

const card = { url: "http://x/q/g/abc", token: "abc" } as unknown as QRCard;
const base = { title: "T", subtitle: "S", name: "群名", card, canReset: false, onReset: vi.fn(async () => {}), onClose: vi.fn() };

describe("QRCardModal", () => {
  it("头部：名字 + meta（成员数/句柄）竖排在码之前", () => {
    const { container, getByText } = render(<QRCardModal {...base} meta="3 名成员" />);
    expect(getByText("3 名成员")).toBeTruthy();
    const head = container.querySelector(".qr-card-head")!;
    expect(head.textContent).toContain("群名");
    expect(head.textContent).toContain("3 名成员");
  });

  it("码模式：不出链接框，出码图占位", () => {
    const { container } = render(<QRCardModal {...base} />);
    expect(container.querySelector(".qr-link-box")).toBeNull();
    expect(container.querySelector(".qr-img")).not.toBeNull();
  });

  it("链接模式：显示完整链接，不画码；有 onViewCode 才出「查看二维码」并接线", () => {
    const onViewCode = vi.fn();
    const { container, getByText, queryByText, rerender } = render(<QRCardModal {...base} mode="link" />);
    expect(container.querySelector(".qr-link-box")!.textContent).toBe("http://x/q/g/abc");
    expect(container.querySelector(".qr-img")).toBeNull();
    expect(queryByText("查看二维码")).toBeNull();
    rerender(<QRCardModal {...base} mode="link" onViewCode={onViewCode} />);
    fireEvent.click(getByText("查看二维码"));
    expect(onViewCode).toHaveBeenCalledTimes(1);
  });

  it("重置入口：码模式（canReset）显示；链接模式不显示", () => {
    const { queryByText, rerender } = render(<QRCardModal {...base} canReset />);
    expect(queryByText("重置二维码")).not.toBeNull();
    rerender(<QRCardModal {...base} canReset mode="link" />);
    expect(queryByText("重置二维码")).toBeNull();
  });
});
