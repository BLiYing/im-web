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
      restoring={false} uid="1001" password="secret123" authErr="" authBusy={false} loginTab="password"
      onUid={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      {...props}
    />,
  );
}

/** 菊花以 .btn-spinner 呈现（CSS 动画），断言它挂在哪个按钮里。 */
const spinnerIn = (button: HTMLElement) => button.querySelector(".btn-spinner");

describe("LoginView 登录中转圈", () => {
  afterEach(cleanup);

  it("空闲时三个入口都无菊花且可点", () => {
    renderLogin();
    for (const name of ["登录", "注册并登录", "免密登录"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeEnabled();
      expect(spinnerIn(button)).toBeNull();
    }
  });

  it("点「登录」→ 该按钮转菊花并改文案，另外两个禁用但不转", () => {
    const { rerender } = renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    rerender(
      <LoginView
        restoring={false} uid="1001" password="secret123" authErr="" authBusy={true} loginTab="password"
        onUid={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      />,
    );
    const busy = screen.getByRole("button", { name: "登录中…" });
    expect(spinnerIn(busy)).not.toBeNull();
    const register = screen.getByRole("button", { name: "注册并登录" });
    expect(register).toBeDisabled();
    expect(spinnerIn(register)).toBeNull();
  });

  it("点「免密登录」→ 菊花落在免密入口，不落在「登录」按钮上", () => {
    const { rerender } = renderLogin({ password: "" });
    fireEvent.click(screen.getByRole("button", { name: "免密登录" }));
    rerender(
      <LoginView
        restoring={false} uid="1001" password="" authErr="" authBusy={true} loginTab="password"
        onUid={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
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
        restoring={false} uid="1001" password="secret123" authErr="" authBusy={true} loginTab="password"
        onUid={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      />,
    );
    rerender(
      <LoginView
        restoring={false} uid="1001" password="secret123" authErr="连接失败" authBusy={false} loginTab="password"
        onUid={noop} onPassword={noop} onLoginTab={noop} onLogin={noop} onRegister={noop} onQRLogin={noop}
      />,
    );
    const button = screen.getByRole("button", { name: "登录" });
    expect(button).toBeEnabled();
    expect(spinnerIn(button)).toBeNull();
  });
});
