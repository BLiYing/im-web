// dist/ 新鲜度检查。
//
// 起因是一次真实的浪费：`IM_FORCE_LOCAL_SERVER=1 npm run e2e` 加载的是仓库根的 `dist/`，
// 而那是**上一次 `npm run build` 的产物**。改完 src/ 忘了重新 build，自检就在对着旧代码跑——
// 它红了，我却照着新代码找原因，猜了两轮（还错误地归因成 IPC 死锁）。
//
// **这是最坏的一类 fail-open：门禁不是漏判，是判了错的东西。** 所以宁可让它硬失败，
// 也不要让一次「绿」建立在旧产物上。dev 模式（加载 :5173）不受影响——那边是实时源码。
import { statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export interface DistFreshness {
  stale: boolean;
  /** dist/index.html 的 mtime；取不到为 0（dist 不存在）。 */
  distMs: number;
  newestSrcMs: number;
  newestSrcFile: string;
}

/** 递归取目录下最新的 mtime。只看会进 bundle 的源码后缀，避免被编辑器临时文件干扰。 */
function newestIn(dir: string): { ms: number; file: string } {
  let best = { ms: 0, file: "" };
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as import("node:fs").Dirent[];
  } catch {
    return best;   // 目录不在（例如别的 clone 布局）：不做判断，别把不相干的错报成 stale
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = newestIn(full);
      if (sub.ms > best.ms) best = sub;
      continue;
    }
    if (!/\.(ts|tsx|css|html)$/.test(e.name)) continue;
    try {
      const ms = statSync(full).mtimeMs;
      if (ms > best.ms) best = { ms, file: full };
    } catch { /* 文件刚被删：跳过 */ }
  }
  return best;
}

/** `dist/` 是不是比 `src/` 旧。dist 不存在也算 stale（那时压根没得测）。 */
export function checkDistFreshness(distDir: string, srcDir: string): DistFreshness {
  let distMs = 0;
  try {
    distMs = statSync(join(distDir, "index.html")).mtimeMs;
  } catch { /* dist 不存在 */ }
  const newest = newestIn(srcDir);
  // 源码目录读不到时不判 stale——宁可漏报，也别对着一个不相干的布局硬失败。
  const stale = newest.ms === 0 ? distMs === 0 : distMs < newest.ms;
  return { stale, distMs, newestSrcMs: newest.ms, newestSrcFile: newest.file };
}

/** 给自检用的一行人话。 */
export function freshnessMessage(f: DistFreshness): string {
  if (f.distMs === 0) return "dist/ 不存在——先在仓库根跑 `npm run build`";
  const ageSec = Math.round((f.newestSrcMs - f.distMs) / 1000);
  return `dist/ 比源码旧 ${ageSec}s（最新改动 ${f.newestSrcFile}）——先在仓库根跑 \`npm run build\`，`
    + "否则自检跑的是上一次构建的代码";
}
