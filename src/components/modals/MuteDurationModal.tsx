import { Modal } from "../Modal";

/** 禁言时长选择（G2）：10 分钟 / 1 小时 / 1 天 / 永久。
 *  onPick 回传 until 毫秒时间戳；永久传 -1，其余为 Date.now()+时长（时间戳在 App 侧算，保持纯展示）。 */
export function MuteDurationModal({ onPick, onCancel }: {
  onPick: (ms: number) => void; // ms<0 表示永久
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel}>
        <div className="modal-title">禁言时长</div>
        <div className="mute-durations">
          {([["10 分钟", 10 * 60_000], ["1 小时", 60 * 60_000], ["1 天", 24 * 60 * 60_000], ["永久", -1]] as [string, number][]).map(([label, ms]) => (
            <button key={label} className="mini-btn" onClick={() => onPick(ms)}>{label}</button>
          ))}
        </div>
        <button className="modal-close" onClick={onCancel}>取消</button>
    </Modal>
  );
}
