// 设置页顶部名片下的资料卡行（手机号 / 用户名 / 我的二维码 / 分享我的名片）。
// 从 App.tsx 抽出：那里有行数硬预算（check-file-size.sh），且这是纯映射，抽出来就能单测。
import { AtSign, IdCard, Phone, QrCode } from "lucide-react";
import type { Row } from "./components/rows";

export interface SettingsInfoSource {
  phone?: string;
  username?: string;
  nickname?: string;
  avatar_url?: string;
}

export function buildSettingsInfoRows(a: {
  t: (key: string) => string;
  myInfo: SettingsInfoSource | null | undefined;
  uid: string;
  openProfile: () => void | Promise<void>;
  openMyCard: () => void | Promise<void>;
  shareContactCard: (c: { userId: string; username?: string; nickname?: string; avatarUrl?: string }) => void;
}): Row[] {
  const { t, myInfo } = a;
  return [
    { id: "phone", label: myInfo?.phone || t("settings.info.not_set"), icon: Phone, iconTint: "green", value: t("settings.info.phone"), onClick: () => void a.openProfile() },
    // 显示的是**公开句柄**而非 uid——后者是 10 位随机内部 ID，`@4820571639` 对用户毫无意义。
    { id: "username", label: myInfo?.username ? `@${myInfo.username}` : t("settings.info.not_set"), icon: AtSign, iconTint: "blue", value: t("settings.info.username"), onClick: () => void a.openProfile() },
    { id: "qr", label: t("settings.info.my_qr"), icon: QrCode, iconTint: "gray", value: "", chevron: true, onClick: () => void a.openMyCard() },
    // 入口 ③（CONTACT_CARD_DESIGN §8.1）：与「我的二维码」并列——二维码给**面对面**，名片消息给**线上**。
    { id: "shareMyCard", label: t("settings.info.share_card"), icon: IdCard, iconTint: "teal", value: "", chevron: true,
      // username 必须一起带：它是名片副标题 @xxx 的唯一来源，也是收方无昵称时预览的回退值
      // （contactCardPreview）。漏了它，「分享我的名片」发出去的卡永远没有句柄行。
      onClick: () => a.shareContactCard({ userId: a.uid, username: myInfo?.username, nickname: myInfo?.nickname, avatarUrl: myInfo?.avatar_url }) },
  ];
}
