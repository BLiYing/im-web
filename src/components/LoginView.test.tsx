// @vitest-environment jsdom
/**
 * 登录页三个入口的「请求在途」反馈：点哪个哪个转菊花 + 三个一起禁用。
 * 回归目标：曾经点了登录只是静静地什么都不显示（authBusy 只禁用按钮、没有任何可见的进行中态），
 * 弱网/连不上后端时看起来像"点了没反应"。
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LoginView } from "./LoginView";

const noop = () => {};

function renderLogin(props: Partial<Parameters<typeof LoginView>[0]> = {}) {
  return render(
    <LoginView
      restoring={false} uid="user1001" nickname="小明" password="secret123" authErr="" authBusy={false} loginTab="password"
      onUid={noop} onNickname={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      {...props}
    />,
  );
}

/** 菊花以 .btn-spinner 呈现（CSS 动画），断言它挂在哪个按钮里。 */
const spinnerIn = (button: HTMLElement) => button.querySelector(".btn-spinner");

describe("LoginView 登录中转圈", () => {
  afterEach(cleanup);

  it("空闲时登录/免密入口无菊花且可点；注册入口只在注册页签", () => {
    renderLogin();
    for (const name of ["登录", "免密登录（开发）"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeEnabled();
      expect(spinnerIn(button)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "注册并登录" })).toBeNull();
    cleanup();
    renderLogin({ loginTab: "register" });
    const register = screen.getByRole("button", { name: "注册并登录" });
    expect(register).toBeEnabled();
    expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
    expect(screen.queryByRole("button", { name: "免密登录（开发）" })).toBeNull();
  });

  it("三个页签：密码登录 / 注册 / 扫码登录，点击回调页签值", () => {
    const seen: string[] = [];
    renderLogin({ onLoginTab: (t) => seen.push(t) });
    for (const name of ["密码登录", "注册", "扫码登录"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(seen).toEqual(["password", "register", "qr"]);
  });

  it("点「登录」→ 该按钮转菊花并改文案，另外两个禁用但不转", () => {
    const { rerender } = renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    rerender(
      <LoginView
        restoring={false} uid="1001" nickname="小明" password="secret123" authErr="" authBusy={true} loginTab="password"
        onUid={noop} onNickname={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      />,
    );
    const busy = screen.getByRole("button", { name: "登录中…" });
    expect(spinnerIn(busy)).not.toBeNull();
    expect(screen.getByRole("button", { name: "免密登录（开发）" })).toBeDisabled();
  });

  it("点「免密登录」→ 菊花落在免密入口，不落在「登录」按钮上", () => {
    const { rerender } = renderLogin({ password: "" });
    fireEvent.click(screen.getByRole("button", { name: "免密登录（开发）" }));
    rerender(
      <LoginView
        restoring={false} uid="1001" nickname="小明" password="" authErr="" authBusy={true} loginTab="password"
        onUid={noop} onNickname={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      />,
    );
    expect(spinnerIn(screen.getByRole("button", { name: "登录中…" }))).not.toBeNull();
    expect(spinnerIn(screen.getByRole("button", { name: "登录" }))).toBeNull();
  });

  it("请求结束（authBusy 落回 false）后菊花收掉，按钮恢复可点", () => {
    const { rerender } = renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    rerender(
      <LoginView
        restoring={false} uid="1001" nickname="小明" password="secret123" authErr="" authBusy={true} loginTab="password"
        onUid={noop} onNickname={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      />,
    );
    rerender(
      <LoginView
        restoring={false} uid="1001" nickname="小明" password="secret123" authErr="连接失败" authBusy={false} loginTab="password"
        onUid={noop} onNickname={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      />,
    );
    const button = screen.getByRole("button", { name: "登录" });
    expect(button).toBeEnabled();
    expect(spinnerIn(button)).toBeNull();
  });
});

describe("LoginView 非红通知（authNotice）", () => {
  it("通知存 i18n 键：用 auth-info 渲染、不是 auth-err；切语言后仍非红且重译", async () => {
    const { setPref } = await import("../i18n");
    const { container } = renderLogin({ authNotice: "delete_account.done_hint" });
    expect(container.querySelector(".auth-info")).not.toBeNull();
    expect(container.querySelector(".auth-err")).toBeNull();
    const zh = container.querySelector(".auth-info")!.textContent;
    setPref("en");
    cleanup();
    const r2 = renderLogin({ authNotice: "delete_account.done_hint" });
    expect(r2.container.querySelector(".auth-info")).not.toBeNull();
    expect(r2.container.querySelector(".auth-err")).toBeNull();
    expect(r2.container.querySelector(".auth-info")!.textContent).not.toBe(zh);
    setPref("zh-Hans");
  });
  it("有错误时错误优先；改动输入框触发 onInput", () => {
    let n = 0;
    const { container } = renderLogin({ authErr: "boom", authNotice: "delete_account.done_hint", onInput: () => { n++; } });
    expect(container.querySelector(".auth-err")).not.toBeNull();
    expect(container.querySelector(".auth-info")).toBeNull();
    fireEvent.change(container.querySelector("input")!, { target: { value: "abc" } });
    expect(n).toBe(1);
  });
});
