// 会话文件夹的客户端状态（按账号隔离）：整表快照 + 单调版本。REST 写入回包与 folder_update 帧都走 apply，
// 版本 ≤ 本地的丢弃；写操作服务端权威（成功后用回包整表替换，不做本地乐观写）。
// 落盘 localStorage `im.chatFolders.v1.<uid>`：冷启动先画 Tab 条，随后被 GET 覆盖。
// 与 iOS IMChatFolderStore / Android ChatFolderStore 同职责（设计 CHAT_FOLDERS_DESIGN.md §3）。
import { useCallback, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import {
  EMPTY_FOLDER_SNAPSHOT, parseFolderSnapshot, shouldApplySnapshot,
  type ChatFolder, type FolderLimits, type FolderSnapshot,
} from "./chatFolders";
import { changeFolderConvs, createFolder, deleteFolder, fetchFolders, renameFolder, reorderFolders } from "./sdk/foldersApi";
import { LOG_TAG, logger } from "./logging/logger";

const STORAGE_PREFIX = "im.chatFolders.v1.";

function load(uid: string): FolderSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + uid);
    return raw ? parseFolderSnapshot(JSON.parse(raw)) : null;
  } catch { return null; }
}

function save(uid: string, s: FolderSnapshot): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + uid, JSON.stringify({ version: s.version, folders: s.folders }));
  } catch (error) {
    logger.warn(LOG_TAG.app, "chat_folders_save_failed", { error: String(error) });
  }
}

export interface UseChatFolders {
  snapshot: FolderSnapshot;
  /** 当前选中的文件夹 id；null = 「全部」。选中的被删（别的设备删了）时 [selectedFolder] 回落 null。 */
  selectedId: string | null;
  selectedFolder: ChatFolder | null;
  setSelectedId: (id: string | null) => void;
  /** 切到账号 uid（幂等）：与当前不同则清内存、读该账号落盘。 */
  adopt: (uid: string) => void;
  /** GET 整表（连上 / 进页时）；失败保留本地缓存。 */
  refresh: () => Promise<void>;
  /** 应用一份整表（帧 / 回包）；返回是否真的替换了。 */
  applyRaw: (raw: unknown, opts?: { fromFrame?: boolean }) => boolean;
  /** 清空内存（退出登录 / 被踢）；落盘保留。 */
  forget: () => void;
  create: (name: string, convIds: string[]) => Promise<ChatFolder | null>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  changeConvs: (id: string, add: string[], remove: string[]) => Promise<void>;
}

export function useChatFolders(deps: { clientRef: MutableRefObject<IMClient | null> }): UseChatFolders {
  const { clientRef } = deps;
  const [snapshot, setSnapshot] = useState<FolderSnapshot>(EMPTY_FOLDER_SNAPSHOT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapRef = useRef(snapshot);
  const uidRef = useRef<string>("");

  const commit = useCallback((s: FolderSnapshot) => {
    snapRef.current = s;
    setSnapshot(s);
  }, []);

  const adopt = useCallback((uid: string) => {
    if (!uid || uid === uidRef.current) return;
    uidRef.current = uid;
    commit(load(uid) ?? EMPTY_FOLDER_SNAPSHOT);
  }, [commit]);

  const forget = useCallback(() => {
    uidRef.current = "";
    setSelectedId(null);
    commit(EMPTY_FOLDER_SNAPSHOT);
  }, [commit]);

  const applyRaw = useCallback((raw: unknown, opts?: { fromFrame?: boolean }): boolean => {
    const cur = snapRef.current;
    // 帧不带 limits：沿用本地已知上限，别被默认值冲掉
    const incoming = parseFolderSnapshot(raw, cur.limits);
    if (!incoming) return false;
    const limitsChanged = (Object.keys(incoming.limits) as Array<keyof FolderLimits>).some((k) => incoming.limits[k] !== cur.limits[k]);
    if (!opts?.fromFrame && limitsChanged && !shouldApplySnapshot(cur.version, incoming.version)) {
      commit({ ...cur, limits: incoming.limits }); // 回包版本没推进也要吃下 limits（GET 回 version 0 的空表带着 limits）
      return false;
    }
    if (!shouldApplySnapshot(cur.version, incoming.version)) return false;
    commit(incoming);
    if (uidRef.current) save(uidRef.current, incoming);
    return true;
  }, [commit]);

  const token = useCallback((): string => clientRef.current?.authToken ?? "", [clientRef]);

  const refresh = useCallback(async () => {
    const tk = token();
    if (!tk) return;
    const uid = uidRef.current; // 请求发出时的账号：回包时已换号则丢弃，别把上一个账号的整表写进新账号
    try {
      const raw = await fetchFolders(tk);
      if (uidRef.current !== uid) return;
      applyRaw(raw);
    } catch (error) {
      logger.warn(LOG_TAG.app, "chat_folders_fetch_failed", { error: String(error) });
    }
  }, [token, applyRaw]);

  /** 写操作公共骨架：成功后整表替换；失败原样抛（业务码在 error.code，文案已友好化）。 */
  const write = useCallback(async (call: (tk: string) => Promise<unknown>): Promise<void> => {
    const tk = token();
    if (!tk) throw new Error("not logged in");
    applyRaw(await call(tk));
  }, [token, applyRaw]);

  const create = useCallback(async (name: string, convIds: string[]): Promise<ChatFolder | null> => {
    const clientId = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    await write((tk) => createFolder(tk, name, convIds, clientId));
    const s = snapRef.current;
    return s.folders.find((f) => f.id === `f_${clientId}`)
      ?? s.folders.find((f) => f.name.toLowerCase() === name.toLowerCase()) ?? null;
  }, [write]);

  const rename = useCallback((id: string, name: string) => write((tk) => renameFolder(tk, id, name)), [write]);
  const remove = useCallback((id: string) => write((tk) => deleteFolder(tk, id)), [write]);
  const reorder = useCallback((ids: string[]) => write((tk) => reorderFolders(tk, ids)), [write]);
  const changeConvs = useCallback(
    (id: string, add: string[], rm: string[]) => write((tk) => changeFolderConvs(tk, id, add, rm)), [write]);

  const selectedFolder = useMemo(
    () => snapshot.folders.find((f) => f.id === selectedId) ?? null, [snapshot.folders, selectedId]);

  return useMemo(() => ({
    snapshot, selectedId: selectedFolder ? selectedId : null, selectedFolder, setSelectedId,
    adopt, refresh, applyRaw, forget, create, rename, remove, reorder, changeConvs,
  }), [snapshot, selectedId, selectedFolder, adopt, refresh, applyRaw, forget, create, rename, remove, reorder, changeConvs]);
}
