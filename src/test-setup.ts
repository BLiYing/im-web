import "fake-indexeddb/auto"; // polyfill 全局 indexedDB

// Node 26 暴露了实验性的 localStorage（未带 --localstorage-file 时取值 undefined），会盖过
// DOM 环境注入的 localStorage。这里强制注入一个内存版，保证 localStore 的会话缓存可测。
const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
