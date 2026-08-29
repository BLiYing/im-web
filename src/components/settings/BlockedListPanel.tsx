import type { FriendEntry } from "../../sdk/protocol";
import { Avatar } from "../Avatar";
import { SubPanel } from "./SubPanel";

/** 已屏蔽的用户子面板（拉齐 iOS IMBlockedListViewController）：从隐私与安全页进入。
 *  纯展示：列表与解除动作来自 useFriendOps（经 App 传入）。null=加载中。 */
export function BlockedListPanel({ list, busyUser, friendLabel, onUnblock, onBack }: {
  list: FriendEntry[] | null; // null=加载中；[]=空
  busyUser: string | null; // 正在解除的 user_id
  friendLabel: (f: FriendEntry) => string;
  onUnblock: (userId: string) => void;
  onBack: () => void;
}) {
  return (
    <SubPanel className="blocked-panel" title="已屏蔽的用户" onBack={onBack}>
      {list === null && <div className="devices-empty">加载中…</div>}
      {list !== null && list.length === 0 && <div className="devices-empty">没有拉黑的用户</div>}
      {list !== null && list.length > 0 && (
        <>
          <div className="section-label">已屏蔽的用户不能给你发消息，也看不到你的资料</div>
          <div className="settings-group">
            {list.map((f) => (
              <div key={f.user_id} className="convitem static">
                <Avatar url={f.avatar_url} label={friendLabel(f)} seed={f.user_id} />
                <div className="convbody">
                  <div className="convpeer">{friendLabel(f)}</div>
                  {/* @句柄而非内部 ID；没有就留空。 */}
                  <div className="convlast">{f.username ? `@${f.username}` : ""}</div>
                </div>
                <div className="row-actions">
                  <button className="mini-btn ghost" disabled={busyUser === f.user_id} onClick={() => onUnblock(f.user_id)}>解除</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SubPanel>
  );
}
