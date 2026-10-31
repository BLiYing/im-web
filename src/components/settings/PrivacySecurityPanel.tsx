import { Ban, Key, ShieldCheck, KeyRound, Mail, Timer, Phone, Eye, CircleUserRound, AlignLeft, Trash2, FileUp } from "lucide-react";
import { renderRow, type Row } from "../rows";
import { SubPanel } from "./SubPanel";
import { tierLabel } from "../../autoDelete";
import { visibilityKey, type VisibilityKind } from "./VisibilityPanel";
import type { Visibility } from "../../sdk/privacyApi";
import { useT } from "../../i18n";

/** 隐私与安全容器页（拉齐 iOS IMPrivacySecurityViewController，设计 docs/design/PRIVACY_SECURITY_DESIGN.md）：
 *  五组 A~E：A 组两项、C 自动删除、D「谁能看到」四行、E 数据为活行，B 组为灰置 comingSoon 占位（生日不做，已删）。
 *  「已登录设备」按设计不进本页（是设置页独立入口）。纯展示：动作与黑名单计数由 App 传入。 */
export function PrivacySecurityPanel({ blockedCount, autoDeleteSec, visibility, onOpenVisibility, onOpenBlocked, onOpenChangePwd, onOpenAutoDelete, onOpenExport, onOpenClearAll, twoStepValue, onOpenTwoStep, emailValue, onOpenEmail, onComingSoon, onBack }: {
  blockedCount: number | null; // null=未加载/加载中 → 右值留空
  onOpenBlocked: () => void;
  onOpenChangePwd: () => void;
  autoDeleteSec: number | null; // 账号默认档位；null=未加载 → 右值留空
  onOpenAutoDelete: () => void;
  onOpenExport: () => void; // 数据 ▸ 导出我的数据（活行）
  twoStepValue?: string; // 账号保护 ▸ 两步验证右值（开启 / 关闭）；未加载 → 留空
  onOpenTwoStep: () => void;
  emailValue?: string; // 账号保护 ▸ 邮箱登录右值（未绑定 / 邮箱地址）；未加载 → 留空
  onOpenEmail: () => void;
  onOpenClearAll: () => void; // 数据 ▸ 清除所有对话（活行，破坏性：不登记设置搜索）
  visibility: Record<VisibilityKind, Visibility> | null; // 「谁能看到」当前档位；null=未加载 → 右值留空
  onOpenVisibility: (kind: VisibilityKind) => void;
  onComingSoon: (title: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  // 占位行：muted 灰置 + 点击提示即将上线；icon 保留全彩（与 iOS §2.5 一致）。
  const ph = (id: string, label: string, icon: Row["icon"], iconTint: string, value?: string): Row =>
    ({ id, label, icon, iconTint, value, chevron: true, muted: true, onClick: () => onComingSoon(label) });

  // 活行（PRIVACY_VISIBILITY_DESIGN §4）：右值=当前档位名，点进三档单选页。
  const live = (id: VisibilityKind, label: string, icon: Row["icon"], iconTint: string, v?: Visibility): Row =>
    ({ id, label, icon, iconTint, value: v ? t(visibilityKey(v)) : undefined, chevron: true, onClick: () => onOpenVisibility(id) });

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
        { id: "2fa", label: t("ps.row.two_factor"), icon: ShieldCheck, iconTint: "gray", value: twoStepValue, chevron: true, onClick: onOpenTwoStep },
        ph("passkey", "通行密钥", KeyRound, "purple", "关闭"),
        { id: "emailLogin", label: t("ps.row.email_login"), icon: Mail, iconTint: "teal", value: emailValue, chevron: true, onClick: onOpenEmail },
      ],
    },
    {
      header: t("ps.section.chat_privacy"),
      footer: t("ps.chat_privacy_footer"),
      // 活行（AUTO_DELETE_DESIGN §3.3 A）：右值=账号默认档位，点进档位选择面板。
      rows: [{ id: "autoDelete", label: t("ps.row.auto_delete_messages"), icon: Timer, iconTint: "orange", value: autoDeleteSec === null ? undefined : tierLabel(t, autoDeleteSec), chevron: true, onClick: onOpenAutoDelete }],
    },
    {
      header: "谁能看到",
      footer: "这些设置决定他人在你的资料页看到多少。",
      rows: [
        live("phone", t("ps.row.phone_number"), Phone, "green", visibility?.phone),
        live("lastSeen", t("ps.row.last_seen"), Eye, "blue", visibility?.lastSeen),
        live("avatar", t("ps.row.avatar"), CircleUserRound, "purple", visibility?.avatar),
        live("bio", t("ps.row.bio"), AlignLeft, "yellow", visibility?.bio),
      ],
    },
    {
      header: "数据",
      rows: [
        { id: "clearAll", label: t("privacy.clear_all.row"), icon: Trash2, iconTint: "danger", chevron: true, onClick: onOpenClearAll },
        { id: "export", label: t("ps.row.export_data"), icon: FileUp, iconTint: "blue", chevron: true, onClick: onOpenExport },
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
