/**
 * 按 key 合并的尾沿防抖：delayMs 内同一个 key 连续触发只在最后一次之后跑一次 fn(key)。
 * 置顶横幅重拉用（见 useBatchDelete.ts）：批量删除会带来上百次「消息被移除」，逐条重拉就是上百个请求；
 * 而只在命中横幅时才拉，又会在置顶列表还没加载完时漏掉——合并之后就可以无条件拉了。
 * `cancelAll()` 撤掉全部挂着的触发（退出登录时调：否则计时器会在登出后 / 换号登录后替旧会话去拉）。
 */
export type KeyedDebounced = ((key: string) => void) & { cancelAll: () => void };

export function keyedDebounce(delayMs: number, fn: (key: string) => void): KeyedDebounced {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const kick = (key: string) => {
    const prev = timers.get(key);
    if (prev !== undefined) clearTimeout(prev);
    timers.set(key, setTimeout(() => { timers.delete(key); fn(key); }, delayMs));
  };
  return Object.assign(kick, {
    cancelAll: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  });
}
