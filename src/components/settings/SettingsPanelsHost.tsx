// SettingsPanelsHost：设置页体系的 12 个子面板路由（从 App.tsx 抽出，CODING_STYLE §7 决策树②
// 「一整块 UI（面板/弹窗/查看器）→ 独立展示组件」）。App 仍是唯一状态源——每个面板的 open 开关、
// 数据都经 props 传入；本组件只做「按开关渲染对应面板 + 把简单的 onBack/onXxx 胶水就地拼好」，
// 不持有业务状态。经 useAppServices()/useT() 直接取 clientRef/setToast/comingSoon/askConfirm/t，
// 免得 App 侧再显式传一遍（这四个已经是 AppServicesContext 收拢的稳定服务）。
// 纯搬移，DOM/行为逐字不变：Fragment 不引入包裹节点，各面板 JSX 与原 App.tsx 内联时完全一致。
import type { Dispatch, SetStateAction } from "react";
import { useAppServices } from "../../AppServicesContext";
import { useT } from "../../i18n";
import { clamp, type HSVColor } from "../../color";
import { parseDownloadSettings, type DownloadSettings } from "../../download";
import type { Conversation, DeviceView, FriendEntry } from "../../sdk/protocol";
import type { WallpaperChoice } from "../../wallpaper";
import type { DesktopIntegration } from "../../useDesktopIntegration";
import type { UseNotifySettings } from "../../notifySettings";
import type { Row } from "../rows";
import { SettingsPanel } from "./SettingsPanel";
import { DataStoragePanel } from "./DataStoragePanel";
import { EditProfilePanel, type ProfileDraft } from "./EditProfilePanel";
import { DevicesPanel } from "./DevicesPanel";
import { PrivacySecurityPanel } from "./PrivacySecurityPanel";
import { BlockedListPanel } from "./BlockedListPanel";
import { ChangePasswordPanel } from "./ChangePasswordPanel";
import { GeneralPanel } from "./GeneralPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { LanguageSettings } from "./LanguagePanel";
import { WallpaperPanel } from "./WallpaperPanel";
import { WallpaperColorPanel } from "./WallpaperColorPanel";

export interface SettingsPanelsHostProps {
  // 设置主页
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  myInfo: { nickname: string; username: string; phone: string; avatar_url: string } | null;
  uid: string;
  stateText: string;
  infoRows: Row[];
  groups: Row[][];
  openProfile: () => Promise<void> | void;
  logout: () => void;

  // 数据与存储
  dataStorageOpen: boolean;
  setDataStorageOpen: Dispatch<SetStateAction<boolean>>;
  dlSettings: DownloadSettings | null;
  setDlSettings: Dispatch<SetStateAction<DownloadSettings | null>>;
  dlBlobs: Record<string, string>;
  mediaOptedIn: Set<string>;
  saveDownloadSettings: (next: DownloadSettings) => Promise<void> | void;
  clearMediaCache: () => void;

  // 编辑资料
  profileDraft: ProfileDraft | null;
  setProfileDraft: Dispatch<SetStateAction<ProfileDraft | null>>;
  profileBusy: boolean;
  profileEditing: boolean;
  enterProfileEditing: () => void;
  cancelProfileEditing: () => void;
  saveProfile: () => Promise<void> | void;
  onPickAvatar: (file?: File) => void;

  // 已登录设备
  devicesOpen: boolean;
  setDevicesOpen: Dispatch<SetStateAction<boolean>>;
  devices: DeviceView[] | null;
  devicesErr: string;
  revokingSid: string;
  loadDevices: () => Promise<void> | void;
  revokeDevice: (d: DeviceView) => Promise<void> | void;
  revokeOtherDevices: () => Promise<void> | void;

  // 隐私与安全 / 已屏蔽的用户 / 修改密码
  privacyOpen: boolean;
  setPrivacyOpen: Dispatch<SetStateAction<boolean>>;
  blockedOpen: boolean;
  setBlockedOpen: Dispatch<SetStateAction<boolean>>;
  blockedList: FriendEntry[] | null;
  busyUser: string | null;
  friendLabel: (f: FriendEntry) => string;
  unblock: (userId: string) => Promise<void> | void;
  changePwdOpen: boolean;
  setChangePwdOpen: Dispatch<SetStateAction<boolean>>;

  // 通用设置
  generalOpen: boolean;
  setGeneralOpen: Dispatch<SetStateAction<boolean>>;
  fontSize: number;
  setFontSize: Dispatch<SetStateAction<number>>;
  theme: "light" | "dark" | "system";
  setTheme: Dispatch<SetStateAction<"light" | "dark" | "system">>;
  timeFormat: "12" | "24";
  setTimeFormat: Dispatch<SetStateAction<"12" | "24">>;
  sendKey: "enter" | "cmd";
  setSendKey: Dispatch<SetStateAction<"enter" | "cmd">>;
  desktop: DesktopIntegration;
  setWallpaperOpen: Dispatch<SetStateAction<boolean>>;

  // 通知
  notificationsOpen: boolean;
  setNotificationsOpen: Dispatch<SetStateAction<boolean>>;
  notif: UseNotifySettings;
  conversations: readonly Conversation[];
  convDisplayLabel: (c: Conversation) => string;
  convAvatarUrl: (c: Conversation) => string | undefined;
  setConvMuted: (c: Conversation, muted: boolean) => void;
  openConvById: (cid: string) => void;

  // 语言
  languageOpen: boolean;
  setLanguageOpen: Dispatch<SetStateAction<boolean>>;

  // 聊天壁纸 / 纯色编辑
  wallpaperOpen: boolean;
  wallpaper: WallpaperChoice;
  isDark: boolean;
  wallpaperBlur: boolean;
  setWallpaperBlur: Dispatch<SetStateAction<boolean>>;
  setWallpaper: Dispatch<SetStateAction<WallpaperChoice>>;
  pickWallpaperImage: (file?: File) => void;
  openWallpaperColor: () => void;
  resetWallpaper: () => void;
  wallpaperColorOpen: boolean;
  setWallpaperColorOpen: Dispatch<SetStateAction<boolean>>;
  colorHSV: HSVColor;
  applyWallpaperColor: (next: HSVColor) => void;
}

export function SettingsPanelsHost(p: SettingsPanelsHostProps) {
  const t = useT();
  const { clientRef, setToast, comingSoon, askConfirm } = useAppServices();

  // 取色板拖拽 → HSV（原 App.tsx#updateColorFromSpectrum 逐字平移，只是依赖改走 props）。
  const onSpectrum = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    p.applyWallpaperColor({
      h: p.colorHSV.h,
      s: clamp(((event.clientX - rect.left) / rect.width) * 100),
      v: clamp(100 - ((event.clientY - rect.top) / rect.height) * 100),
    });
  };

  return (
    <>
      {/* 设置面板：见 components/settings/SettingsPanel（行数据与动作在 App 上方组装）。 */}
      {p.showSettings && (
        <SettingsPanel
          avatarUrl={p.myInfo?.avatar_url}
          name={p.myInfo?.nickname || (p.myInfo?.username ? `@${p.myInfo.username}` : t("common.unnamed_user"))}
          seed={p.uid}
          stateText={p.stateText}
          infoRows={p.infoRows}
          groups={p.groups}
          onBack={() => p.setShowSettings(false)}
          onEditProfile={() => void p.openProfile()}
          onLogout={p.logout}
        />
      )}

      {/* 数据与存储：见 components/settings/DataStoragePanel（Web 只呈现 Wi-Fi 档，注释在组件内）。 */}
      {p.dataStorageOpen && (
        <DataStoragePanel
          settings={p.dlSettings}
          cachedCount={Object.keys(p.dlBlobs).length + p.mediaOptedIn.size /* 已缓存 = 应用内 blob（文件）+ 已解门控图片/视频 */}
          onSave={p.saveDownloadSettings}
          onClearCache={p.clearMediaCache}
          onReset={() => {
            void askConfirm(t("settings.download.reset_confirm"), { okText: t("settings.download.reset_ok"), danger: true }).then((ok) => {
              if (!ok) return;
              const c = clientRef.current;
              if (!c) return;
              void c.resetDownloadSettings()
                .then((r) => p.setDlSettings(parseDownloadSettings(r?.settings)))
                .catch((e: Error) => setToast(t("settings.download.reset_failed", { detail: e.message })));
            });
          }}
          onBack={() => p.setDataStorageOpen(false)}
        />
      )}

      {/* 编辑资料面板：见 components/settings/EditProfilePanel。 */}
      {p.profileDraft && (
        <EditProfilePanel
          draft={p.profileDraft}
          uid={p.uid}
          busy={p.profileBusy}
          editing={p.profileEditing} onEnterEditing={p.enterProfileEditing} onCancelEditing={p.cancelProfileEditing}
          onChange={p.setProfileDraft}
          onSave={() => void p.saveProfile()}
          onPickAvatar={p.onPickAvatar}
          onBack={() => p.setProfileDraft(null)}
        />
      )}

      {/* 已登录设备子面板：见 components/settings/DevicesPanel（状态与操作来自 useDevices）。 */}
      {p.devicesOpen && (
        <DevicesPanel
          devices={p.devices}
          err={p.devicesErr}
          revokingSid={p.revokingSid}
          onRefresh={() => void p.loadDevices()}
          onRevoke={(d) => void p.revokeDevice(d)}
          onRevokeOthers={() => void p.revokeOtherDevices()}
          onBack={() => p.setDevicesOpen(false)}
        />
      )}

      {/* 隐私与安全容器页（拉齐 iOS）：黑名单 / 修改密码 + B~E 灰置占位。 */}
      {p.privacyOpen && (
        <PrivacySecurityPanel
          blockedCount={p.blockedList ? p.blockedList.length : null}
          onOpenBlocked={() => p.setBlockedOpen(true)}
          onOpenChangePwd={() => p.setChangePwdOpen(true)}
          onComingSoon={comingSoon}
          onBack={() => p.setPrivacyOpen(false)}
        />
      )}

      {/* 已屏蔽的用户子面板（从隐私页进入；数据/解除来自 useFriendOps）。 */}
      {p.blockedOpen && (
        <BlockedListPanel
          list={p.blockedList}
          busyUser={p.busyUser}
          friendLabel={p.friendLabel}
          onUnblock={(id) => void p.unblock(id)}
          onBack={() => p.setBlockedOpen(false)}
        />
      )}

      {/* 修改密码子面板（从隐私页进入）：成功后服务端自动下线其它设备。 */}
      {p.changePwdOpen && (
        <ChangePasswordPanel
          onSubmit={async (o, n) => { const c = clientRef.current; if (!c) throw new Error(t("conn.state.disconnected")); await c.changePassword(o, n); }}
          onDone={() => { p.setChangePwdOpen(false); setToast(t("settings.password.changed_toast")); void p.loadDevices(); }}
          onBack={() => p.setChangePwdOpen(false)}
        />
      )}

      {/* 通用设置子面板：见 components/settings/GeneralPanel。 */}
      {p.generalOpen && (
        <GeneralPanel
          fontSize={p.fontSize} theme={p.theme} timeFormat={p.timeFormat} sendKey={p.sendKey}
          autoStart={p.desktop.autoStart} autoStartSupported={p.desktop.autoStartSupported} onAutoStart={p.desktop.setAutoStart}
          globalShortcut={p.desktop.globalShortcut} globalShortcutSupported={p.desktop.globalShortcutSupported} onGlobalShortcut={p.desktop.setGlobalShortcut}
          onFontSize={p.setFontSize} onTheme={p.setTheme} onTimeFormat={p.setTimeFormat} onSendKey={p.setSendKey}
          onOpenWallpaper={() => p.setWallpaperOpen(true)}
          onBack={() => p.setGeneralOpen(false)}
        />
      )}

      {/* 通知设置子面板：见 components/settings/NotificationsPanel（NOTIFICATIONS_DESIGN §2.5）。 */}
      {p.notificationsOpen && (
        <NotificationsPanel
          settings={p.notif.settings} isDesktop={p.desktop.isDesktop} conversations={p.conversations}
          convDisplayLabel={p.convDisplayLabel} convAvatarUrl={p.convAvatarUrl}
          onSetPrivate={p.notif.setPrivate} onSetGroup={p.notif.setGroup} onSetBadge={p.notif.setBadge} onSetDesktop={p.notif.setDesktop}
          onUnmute={(c) => p.setConvMuted(c, false)} onMuteConv={(c) => p.setConvMuted(c, true)} onBack={() => p.setNotificationsOpen(false)}
          onOpenConv={(cid) => { p.setNotificationsOpen(false); p.setShowSettings(false); p.openConvById(cid); }}
          onReset={() => void askConfirm(t("notif.reset.confirm_message"), { okText: t("common.reset"), danger: true }).then((ok) => ok && p.notif.reset())}
        />
      )}

      {p.languageOpen && <LanguageSettings onBack={() => p.setLanguageOpen(false)} />}{/* 语言选择：偏好存 localStorage（每设备）、切换即刻生效 */}

      {/* 聊天壁纸 / 纯色编辑：见 components/settings/WallpaperPanel · WallpaperColorPanel。 */}
      {p.wallpaperOpen && (
        <WallpaperPanel
          wallpaper={p.wallpaper} isDark={p.isDark} blur={p.wallpaperBlur}
          onSelectPreset={(id) => p.setWallpaper({ kind: "preset", value: id })}
          onPickImage={p.pickWallpaperImage}
          onOpenColor={p.openWallpaperColor}
          onReset={p.resetWallpaper}
          onToggleBlur={() => p.setWallpaperBlur((value) => !value)}
          onBack={() => p.setWallpaperOpen(false)}
        />
      )}

      {p.wallpaperColorOpen && (
        <WallpaperColorPanel
          colorHSV={p.colorHSV}
          onApply={p.applyWallpaperColor}
          onSpectrum={onSpectrum}
          onBack={() => p.setWallpaperColorOpen(false)}
        />
      )}
    </>
  );
}
