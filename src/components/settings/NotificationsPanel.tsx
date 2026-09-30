import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { SubPanel } from "./SubPanel";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";
import { MuteMenu } from "../MuteMenu";
import { renderRow } from "../rows";
import { ForwardPicker } from "../modals/ForwardPicker";
import { useT, type Args } from "../../i18n";
import { previewAlertSound } from "../../alertPlayer";
import { isExceptionPickable } from "../../notifExceptions";
import { isMutedNow, muteUntilPhrase } from "../../muteState";
import { NOTIFY_SOUND_IDS, type NotifySettings, type NotifySoundId, type NotifyTypeSettings } from "../../notifySettings";
import type { Conversation } from "../../sdk/protocol";

/** 例外行右值：永久 → 平铺 muted/muted_mention；有到期时间 → muted_until/muted_until_mention 带 `{until}`
 *  片段（如「至今天 18:30」，见 muteState.ts#muteUntilPhrase）。 */
function exceptionValueLabel(t: (key: string, args?: Args) => string, c: Conversation, nowMs: number): string {
  const until = c.mute_until ?? 0;
  if (until === 0) return t(c.mention_unread ? "notif.exceptions.muted_mention" : "notif.exceptions.muted");
  return t(c.mention_unread ? "notif.exceptions.muted_until_mention" : "notif.exceptions.muted_until", { until: muteUntilPhrase(until, nowMs) });
}

/** 把弹窗挂到 `.app` 根下（与 App.tsx 里其它弹窗同一层），而不是留在本面板的 DOM 位置。
 *
 *  本面板渲染在 `.sidebar` 里，而 `.app > .sidebar, .app > .main { z-index: 1 }` 让侧栏自成一个层叠上下文、
 *  且 DOM 顺序排在 `.main` 之前——弹窗的 `.modal-mask` 虽是 `position: fixed; z-index: 50`，那个 50 只在
 *  侧栏自己的上下文里算数，整层仍被后面的 `.main` 压住：聊天气泡/系统条会直接画在弹窗之上、点击也落到
 *  聊天区（2026-09-30 浏览器实测）。App.tsx 里的弹窗是 `.app` 的直接子节点所以没这个问题；
 *  **今后在侧栏面板里再开弹窗，同样要走这里**。取不到 `.app`（单测只渲染面板）时退回 `document.body`。 */
function overSidebar(node: ReactNode) {
  return createPortal(node, document.querySelector(".app") ?? document.body);
}

/** 设置 ▸ 通知（NOTIFICATIONS_DESIGN §2.5）：Web / 桌面版，一页平铺不分子页（对齐 Telegram Web A）。
 *  纯展示：设置读写全经 props 注入的 setter；`previewAlertSound` 是无状态的浏览器播放工具函数，
 *  与试听/选提示音这类纯 UI 反馈耦合，直接调用（不算业务动作，不需要经 App 注入）。
 *
 *  **`isDesktop=false`（浏览器构建）时「桌面通知」整行降级为占位**：标题不变，右值显示
 *  「在桌面客户端中可用」，开关不可点；「播放提示音」「音量」两行仍然生效——它们实际控制的是
 *  `settings.desktop.{sound,volume}`，在浏览器构建下驱动的是「应用内提示音」这条行为
 *  （页面打开时响一声），只是文案按 UX 稿换成「应用内提示音」，字段不另开一套。 */
export function NotificationsPanel({
  settings, isDesktop, conversations, convDisplayLabel, convAvatarUrl,
  onSetPrivate, onSetGroup, onSetBadge, onSetDesktop,
  onUnmute, onMuteConv, onOpenConv, onReset, onBack,
}: {
  settings: NotifySettings;
  isDesktop: boolean;
  conversations: readonly Conversation[];
  convDisplayLabel: (c: Conversation) => string;
  convAvatarUrl: (c: Conversation) => string | undefined;
  onSetPrivate: (patch: Partial<NotifyTypeSettings>) => void;
  onSetGroup: (patch: Partial<NotifyTypeSettings>) => void;
  onSetBadge: (patch: Partial<NotifySettings["badge"]>) => void;
  onSetDesktop: (patch: Partial<NotifySettings["desktop"]>) => void;
  onUnmute: (c: Conversation) => void;
  /** 「添加例外」选完会话再选时长后设免打扰（NOTIFICATIONS_P1_DESIGN §2/§4.1），
   *  经 App 的唯一写路径 `setConvMuted` 落地（原样带回 pinned_at/marked_unread）。 */
  onMuteConv: (c: Conversation, muteUntil: number) => void;
  onOpenConv: (convId: string) => void;
  /** 重置确认由 App 侧 askConfirm 包好，这里只负责触发。 */
  onReset: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const [showExceptions, setShowExceptions] = useState(false);
  const [pickingException, setPickingException] = useState(false);
  // 「添加例外」选完会话后再选时长（NOTIFICATIONS_P1_DESIGN §2/§4.1）：非 null 时弹时长选择 Modal。
  const [pendingMuteConv, setPendingMuteConv] = useState<Conversation | null>(null);

  // 免打扰的会话（私聊+群聊合并，按最后消息时间倒序）——§3.5：数据取本机会话表，按 isMutedNow
  // 判定（NOTIFICATIONS_P1_DESIGN §4.3：定时免打扰到期后视同未免打扰，从例外列表自动消失）。
  const now = Date.now();
  const muted = conversations
    .filter((c) => isMutedNow(!!c.muted, c.mute_until, now))
    .slice()
    .sort((a, b) => (b.last_message?.timestamp ?? 0) - (a.last_message?.timestamp ?? 0));

  if (showExceptions) {
    // 已拍板②（P1 §2）：例外组常驻「添加例外」，没有免打扰会话时这一组只剩这一行（同 iOS/Android），
    // 不再像第一期那样整组隐藏。不另显空态说明：`notif.exceptions.empty_private/_group` 是按手机端
    // 私聊/群聊分页写的（「私聊」「左滑」），本页私聊群聊合并、也没有左滑，手机端自己也没用这两条。
    return (
      <SubPanel className="notif-panel" title={t("notif.section.exceptions")} onBack={() => setShowExceptions(false)}>
        <div className="settings-group">
          {renderRow({ id: "add", label: t("notif.exceptions.add"), icon: Plus, iconTint: "green", onClick: () => setPickingException(true) }, "settings-row")}
          {muted.map((c) => (
            <div key={c.conv_id} className="settings-row notif-exceptions-row" onClick={() => onOpenConv(c.conv_id)}>
              <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer} />
              <span className="row-label">
                {convDisplayLabel(c)}
                <span className="row-sub"> · {c.is_group ? t("notif.row.group") : t("notif.row.private")}</span>
              </span>
              <span className="row-value">{exceptionValueLabel(t, c, now)}</span>
              <button
                type="button"
                className="notif-unmute-btn"
                onClick={(e) => { e.stopPropagation(); onUnmute(c); }}
              >
                {t("web.conv.menu.unmute")}
              </button>
            </div>
          ))}
        </div>

        {/* 添加例外（P1 §2）：复用转发选择页 ForwardPicker（单选、无多选切换）。
            选完会话不直接永久免打扰——弹时长选择 Modal（§4.1，与列表/ChatHeader/详情页同一套选项）。 */}
        {pickingException && overSidebar(
          <ForwardPicker
            count={1}
            conversations={conversations as Conversation[]}
            multi={false}
            mode="each"
            targets={[]}
            convAvatarUrl={convAvatarUrl}
            convDisplayLabel={convDisplayLabel}
            onToggleMulti={() => {}}
            onSetMode={() => {}}
            onToggleTarget={() => {}}
            filter={isExceptionPickable}
            title={t("notif.exceptions.add")}
            hideMultiToggle
            footer={t("notif.exceptions.pick_footer_all")}
            emptyText={t("notif.exceptions.pick_empty")}
            onForward={(picked) => { const c = picked[0]; setPickingException(false); if (c) setPendingMuteConv(c); }}
            onClose={() => setPickingException(false)}
          />,
        )}

        {pendingMuteConv && overSidebar(
          <Modal onClose={() => setPendingMuteConv(null)}>
            <div className="modal-title">{t("notif.mute.sheet_title", { name: convDisplayLabel(pendingMuteConv) })}</div>
            <div className="mute-durations">
              <MuteMenu itemClassName="mini-btn"
                onPick={(until) => { const c = pendingMuteConv; setPendingMuteConv(null); onMuteConv(c, until); }} />
            </div>
            <button className="modal-close" onClick={() => setPendingMuteConv(null)}>{t("common.cancel")}</button>
          </Modal>,
        )}
      </SubPanel>
    );
  }

  const soundRow = (type: NotifyTypeSettings, onSet: (patch: Partial<NotifyTypeSettings>) => void) => (
    <div className={`settings-row static${type.enabled ? "" : " dim"}`}>
      <span className="row-label">{t("notif.type.sound")}</span>
      <select
        className="notif-sound-select"
        value={type.sound}
        onChange={(e) => {
          const id = e.target.value as NotifySoundId;
          onSet({ sound: id });
          previewAlertSound(id, settings.desktop.volume);
        }}
      >
        {NOTIFY_SOUND_IDS.map((id) => (
          <option key={id} value={id}>{t(`notif.sound.${id}`)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <SubPanel className="notif-panel" title={t("settings.row.notifications")} onBack={onBack}>
      <div className="section-label">{t("notif.desktop.section")}</div>
      <div className="settings-group">
        {isDesktop ? (
          <label className="switch-row">
            <span className="row-label">{t("notif.desktop.enabled")}</span>
            <input type="checkbox" checked={settings.desktop.enabled} onChange={(e) => onSetDesktop({ enabled: e.target.checked })} />
          </label>
        ) : (
          <div className="settings-row static muted">
            <span className="row-label">{t("notif.desktop.enabled")}</span>
            <span className="row-value">{t("notif.desktop.browser_only")}</span>
          </div>
        )}
        <label className="switch-row">
          {/* 浏览器构建没有系统通知能力：这一行实际驱动「应用内提示音」（页面打开时响），文案照 UX 稿换掉。 */}
          <span className="row-label">{t(isDesktop ? "notif.desktop.sound" : "notif.in_app.sound")}</span>
          <input type="checkbox" checked={settings.desktop.sound} onChange={(e) => onSetDesktop({ sound: e.target.checked })} />
        </label>
        <VolumeRow volume={settings.desktop.volume} onCommit={(v) => { onSetDesktop({ volume: v }); previewAlertSound("default", v); }} />
      </div>

      <div className="section-label">{t("notif.section.message")}</div>
      <div className="settings-group">
        <label className="switch-row">
          <span className="row-label">{t("notif.row.private")}</span>
          <input type="checkbox" checked={settings.private.enabled} onChange={(e) => onSetPrivate({ enabled: e.target.checked })} />
        </label>
        <label className={`switch-row${settings.private.enabled ? "" : " dim"}`}>
          <span className="row-label">{t("notif.type.preview")}</span>
          <input type="checkbox" checked={settings.private.preview} onChange={(e) => onSetPrivate({ preview: e.target.checked })} />
        </label>
        {soundRow(settings.private, onSetPrivate)}
      </div>

      <div className="settings-group">
        <label className="switch-row">
          <span className="row-label">{t("notif.row.group")}</span>
          <input type="checkbox" checked={settings.group.enabled} onChange={(e) => onSetGroup({ enabled: e.target.checked })} />
        </label>
        <label className={`switch-row${settings.group.enabled ? "" : " dim"}`}>
          <span className="row-label">{t("notif.type.preview")}</span>
          <input type="checkbox" checked={settings.group.preview} onChange={(e) => onSetGroup({ preview: e.target.checked })} />
        </label>
        {soundRow(settings.group, onSetGroup)}
      </div>
      <div className="settings-foot">{t("notif.message.footer")}</div>

      <div className="section-label">{t("notif.section.badge")}</div>
      <div className="settings-group">
        <label className="switch-row">
          <span className="row-label">{t("notif.badge.include_muted")}</span>
          <input type="checkbox" checked={settings.badge.includeMuted} onChange={(e) => onSetBadge({ includeMuted: e.target.checked })} />
        </label>
      </div>
      <div className="settings-foot">{t("notif.badge.footer")}</div>

      <div className="settings-group">
        <button className="settings-row" onClick={() => setShowExceptions(true)}>
          <span className="row-label">{t("notif.exceptions.web_row")}</span>
          <span className="row-value">{muted.length}</span>
        </button>
      </div>

      <div className="settings-group">
        <button className="settings-row danger" onClick={onReset}>
          <span className="row-label">{t("notif.reset")}</span>
        </button>
      </div>
      <div className="settings-foot">{t("notif.reset.footer")}</div>
    </SubPanel>
  );
}

/** 音量滑杆：拖动时本地即时刷新数字，**松手才提交 + 试听一次**（§2.5：「拖动松手试听一次」）。
 *
 * ⚠️ **React 的 `onChange` 在 `<input type="range">` 上绑定的是原生 `input` 事件，不是原生
 * `change` 事件**（React 历史遗留行为，`onInput`/`onChange` 对这个控件其实是同一件事）——
 * 拖动过程中每一帧都会触发。真正的「松手」只能靠 `onMouseUp`/`onTouchEnd`（拖动结束）与
 * `onKeyUp`（键盘方向键调整）。这里用 `onChange` 做连续刷新数字显示，用那三个事件做提交 + 试听，
 * 两者必须分开，写成一个 `onChange` 会变成「拖一下响一路」（组件测试曾在此踩过、已改对）。 */
function VolumeRow({ volume, onCommit }: { volume: number; onCommit: (v: number) => void }) {
  const t = useT();
  const [drag, setDrag] = useState(volume);
  useEffect(() => setDrag(volume), [volume]);
  const commit = (e: { currentTarget: HTMLInputElement }) => onCommit(Number(e.currentTarget.value));
  return (
    <div className="range-row">
      <div className="range-top">
        <span className="row-label">{t("notif.desktop.volume")}</span>
        <span className="row-value">{drag}</span>
      </div>
      <input
        type="range" min={0} max={10} value={drag}
        onChange={(e) => setDrag(Number(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
      />
    </div>
  );
}
