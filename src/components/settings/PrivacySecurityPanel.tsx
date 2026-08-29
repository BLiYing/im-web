import { Ban, Key, ShieldCheck, KeyRound, Mail, Timer, Phone, Eye, CircleUserRound, AlignLeft, Gift, Trash2, FileUp } from "lucide-react";
import { renderRow, type Row } from "../rows";
import { SubPanel } from "./SubPanel";

/** 隐私与安全容器页（拉齐 iOS IMPrivacySecurityViewController，设计 docs/design/PRIVACY_SECURITY_DESIGN.md）：
 *  五组 A~E，仅 A 组两项（已屏蔽的用户 / 修改密码）为 P0 活行，B~E 为灰置 comingSoon 占位。
 *  「已登录设备」按设计不进本页（是设置页独立入口）。纯展示：动作与黑名单计数由 App 传入。 */
export function PrivacySecurityPanel({ blockedCount, onOpenBlocked, onOpenChangePwd, onComingSoon, onBack }: {
  blockedCount: number | null; // null=未加载/加载中 → 右值留空
  onOpenBlocked: () => void;
  onOpenChangePwd: () => void;
  onComingSoon: (title: string) => void;
  onBack: () => void;
}) {
  // 占位行：muted 灰置 + 点击提示即将上线；icon 保留全彩（与 iOS §2.5 一致）。
  const ph = (id: string, label: string, icon: Row["icon"], iconTint: string, value?: string): Row =>
    ({ id, label, icon, iconTint, value, chevron: true, muted: true, onClick: () => onComingSoon(label) });

  const groups: { header?: string; footer?: string; rows: Row[] }[] = [
    {
      footer: "已屏蔽的用户不能给你发消息，也看不到你的资料。",
      rows: [
        { id: "blocked", label: "已屏蔽的用户", icon: Ban, iconTint: "red", value: blockedCount && blockedCount > 0 ? String(blockedCount) : undefined, chevron: true, onClick: onOpenBlocked },
        { id: "changePwd", label: "修改密码", icon: Key, iconTint: "blue", chevron: true, onClick: onOpenChangePwd },
      ],
    },
    {
      header: "账号保护",
      footer: "绑定第二因子后，即使密码泄露也无法登录你的账号。",
      rows: [
        ph("2fa", "两步验证", ShieldCheck, "gray", "关闭"),
        ph("passkey", "通行密钥", KeyRound, "purple", "关闭"),
        ph("emailLogin", "邮箱登录", Mail, "teal"),
      ],
    },
    {
      header: "会话隐私",
      footer: "为你开始的每个新会话默认开启阅后自删。",
      rows: [ph("autoDelete", "自动删除消息", Timer, "orange", "关闭")],
    },
    {
      header: "谁能看到",
      footer: "这些设置决定他人在你的资料页看到多少。",
      rows: [
        ph("phone", "手机号码", Phone, "green", "我的联系人"),
        ph("lastSeen", "上次上线", Eye, "blue", "我的联系人"),
        ph("avatar", "头像", CircleUserRound, "purple", "所有人"),
        ph("bio", "个人简介", AlignLeft, "yellow", "所有人"),
        ph("birthday", "生日", Gift, "pink", "我的联系人"),
      ],
    },
    {
      header: "数据",
      rows: [
        ph("clearAll", "清除所有对话", Trash2, "gray"),
        ph("export", "导出我的数据", FileUp, "blue"),
      ],
    },
  ];

  return (
    <SubPanel className="privacy-panel" title="隐私与安全" onBack={onBack}>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.header && <div className="section-label">{g.header}</div>}
          <div className="settings-group">
            {g.rows.map((r) => renderRow(r, "settings-row"))}
          </div>
          {g.footer && <div className="settings-foot">{g.footer}</div>}
        </div>
      ))}
    </SubPanel>
  );
}
