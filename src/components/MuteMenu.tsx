import { useT } from "../i18n";
import { MUTE_DURATION_OPTIONS, muteUntilForDuration } from "../muteState";

/**
 * 免打扰时长选择列表（共用结构，NOTIFICATIONS_P1_DESIGN §4.1/§4.2，UX 稿 04）：
 * 1 小时 / 8 小时 / 1 天 / 7 天 / 永久，不做「自定义到某天」（已拍板③④）。
 * 只出选项，不带容器——外层按场景自己套壳：
 *  - 会话列表右键二级菜单 / ChatHeader「⋯」下拉：套 `AnchoredMenu`/`menu-card`，`itemClassName` 传
 *    `undefined`（吃容器 `.ctx-menu button` 的默认样式）或 `"menu-card-row"`。
 *  - 聊天信息页免打扰行：套一个锚定的小 `menu-card`，`itemClassName="menu-item"`。
 *  - 「添加例外」选完会话后：套 `Modal` + `.mute-durations`（对齐既有 `MuteDurationModal` 的壳），
 *    `itemClassName="mini-btn"`。
 * `onUnmute` 传入时在最上面加一项红色「取消免打扰」——仅聊天信息页用（选完时长后可再点回来调整，
 * 即「把 8 小时改成永久」这类场景，NOTIFICATIONS_P1_DESIGN §4.1）；会话列表/ChatHeader 已免打扰时
 * 直接执行取消，不会走到这里，不传本参数。
 */
export function MuteMenu({ onPick, onUnmute, itemClassName }: {
  onPick: (muteUntil: number) => void;
  onUnmute?: () => void;
  itemClassName?: string;
}) {
  const t = useT();
  return (
    <>
      {onUnmute && (
        <button className={`danger ${itemClassName ?? ""}`.trim()} onClick={onUnmute}>
          {t("web.conv.menu.unmute")}
        </button>
      )}
      {MUTE_DURATION_OPTIONS.map((o) => (
        <button key={o.id} className={itemClassName} onClick={() => onPick(muteUntilForDuration(o.id, Date.now()))}>
          {t(o.labelKey)}
        </button>
      ))}
    </>
  );
}
