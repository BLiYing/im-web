// 修改密码的本地前置校验（纯函数，供 ChangePasswordPanel 使用 + 单测）。
// 能在提交前挡下的都挡下（空/长度/两次一致/新旧相同），只把「旧密码是否正确」留给服务端（200002）。
// 返回空串=校验通过；否则返回给用户看的中文错误文案。与 iOS IMChangePasswordViewController 本地校验同口径。
export function validateChangePassword(oldPwd: string, newPwd: string, confirm: string): string {
  if (!oldPwd) return "请输入当前密码";
  if (newPwd.length < 6) return "新密码至少 6 位";
  if (newPwd === oldPwd) return "新密码不能与当前密码相同";
  if (confirm !== newPwd) return "两次输入的新密码不一致";
  return "";
}
