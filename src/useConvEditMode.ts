// 会话列表「编辑模式」：状态（是否编辑 / 选择集）+ 批量已读 / 批量删除（设计 CONV_LIST_EDIT_MODE_DESIGN.md）。
// CODING_STYLE §7 决策树①：自己有状态 + 一组操作 → 抽 Hook，别往 App.tsx 堆。副作用依赖全部注入。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { Conversation } from "./sdk/protocol";
import type { ChatFolder } from "./chatFolders";
import { filterConversations } from "./chatFolders";
import {
  EMPTY_SELECTION, convHasUnread, isAllSelectedIn, pruneTo, runBounded, selectAllIn, selectRangeIn,
  selectedIn, toggleSel, type ConvSelection,
} from "./convSelection";
import { t } from "./i18n";

/** 批量请求同时在途的上限（设计 §4）。 */
const BATCH_CONCURRENCY = 4;

export interface UseConvEditModeOptions {
  clientRef: React.MutableRefObject<IMClient | null>;
  conversations: Conversation[];
  /** 当前文件夹 Tab（null = 「全部」）。 */
  selectedFolder: ChatFolder | null;
  /** 侧栏页签：只在「消息」页签有编辑入口；切到「通讯录」先退出编辑。 */
  tab: "chats" | "contacts";
  refreshConversations: () => Promise<Conversation[]>;
  setToast: (msg: string | null) => void;
  askConfirm: (message: string, opts?: { title?: string; okText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>;
  /** 当前打开的会话 id：被批量删掉时要退出该会话。 */
  currentConvRef: React.MutableRefObject<string | null>;
  deselect: () => void;
}

export function useConvEditMode(o: UseConvEditModeOptions) {
  const { clientRef, conversations, selectedFolder, tab, refreshConversations, setToast, askConfirm, currentConvRef, deselect } = o;
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<ConvSelection>(EMPTY_SELECTION);
  const [busy, setBusy] = useState(false);
  const lastClicked = useRef<string | null>(null);
  const confirming = useRef(false); // 删除确认框打开期间挡掉重复点击（busy 要等确认后才置位）

  /** 当前 Tab 的会话列表（与表格渲染同一份）。 */
  const shown = useMemo(() => filterConversations(conversations, selectedFolder), [conversations, selectedFolder]);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const exit = useCallback(() => { setEditing(false); setSelection(EMPTY_SELECTION); lastClicked.current = null; }, []);
  const enter = useCallback(() => { setEditing(true); setSelection(EMPTY_SELECTION); lastClicked.current = null; }, []);

  // 列表换新（新消息重排 / 他端删除 / 退群）：剔除已不存在的已选项，不退出编辑
  useEffect(() => { if (editing) setSelection((s) => pruneTo(s, shown)); }, [shown, editing]);
  // 切 Tab（含当前文件夹被他端删而回落「全部」）：清空选择、保持编辑
  const folderId = selectedFolder?.id ?? null;
  const prevFolder = useRef(folderId);
  useEffect(() => {
    if (prevFolder.current === folderId) return;
    prevFolder.current = folderId;
    setSelection(EMPTY_SELECTION);
    lastClicked.current = null;
  }, [folderId]);
  // 切到「通讯录」：先退出编辑并清空选择
  useEffect(() => { if (tab !== "chats" && editing) exit(); }, [tab, editing, exit]);

  const toggle = useCallback((id: string, shiftKey = false) => {
    // 先取走上一次点击的锚点：updater 在渲染期才执行，那时 lastClicked 已被改成本次，直接读会让连选退化成单选。
    const anchor = lastClicked.current;
    lastClicked.current = id;
    // 锚点所在会话已不在当前列表（他端删除 / 切 Tab）时退化成单选，别让这次点击毫无反应。
    setSelection((s) => {
      const list = shownRef.current;
      const rangeOk = shiftKey && anchor && anchor !== id && list.some((c) => c.conv_id === anchor);
      return rangeOk ? selectRangeIn(s, list, anchor, id) : toggleSel(s, id);
    });
  }, []);

  const allSelected = isAllSelectedIn(selection, shown);
  const selectAll = useCallback(() => {
    setSelection((s) => (isAllSelectedIn(s, shownRef.current) ? EMPTY_SELECTION : selectAllIn(s, shownRef.current)));
  }, []);

  // 键盘：Esc 退出、Cmd/Ctrl+A 全选（Web 独有；输入框里不抢）
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (document.querySelector(".modal-mask")) return; // 确认框 / 其他弹层在最上层时，Esc / Cmd+A 归它，不动背后的编辑态
      if (e.key === "Escape") exit();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, exit, selectAll]);

  const selectedConvs = useMemo(() => selectedIn(selection, shown), [selection, shown]);
  const readable = useMemo(() => selectedConvs.filter(convHasUnread), [selectedConvs]);

  /** 批量已读：与单条「设为已读」同一路径；结束后只重拉一次会话列表。 */
  const markRead = useCallback(async () => {
    if (busy || readable.length === 0) return;
    setBusy(true);
    try {
      const r = await runBounded(readable, BATCH_CONCURRENCY, async (c) => {
        if (c.unread > 0) clientRef.current?.markRead(c.conv_id, c.latest_conv_seq);
        if (c.marked_unread) {
          await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: false });
        }
      });
      await refreshConversations();
      if (r.failed.length > 0) {
        setToast(t("conv.error.mark_failed"));
        const done = new Set(r.succeeded.map((c) => c.conv_id));
        setSelection((s) => new Set([...s].filter((id) => !done.has(id))));
      } else {
        exit();
      }
    } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    finally { setBusy(false); }
  }, [busy, readable, clientRef, refreshConversations, setToast, exit]);

  /** 批量删除（仅为我删除，同单条）：先确认；失败项保留勾选、留在编辑模式。 */
  const removeSelected = useCallback(async () => {
    const targets = selectedConvs;
    if (busy || confirming.current || targets.length === 0) return;
    const n = targets.length;
    const body = t("conv.edit.delete_body");
    confirming.current = true;
    let ok = false;
    try { ok = await askConfirm(body, { title: t("conv.edit.delete_title", { count: n }), okText: t("common.delete"), danger: true }); }
    finally { confirming.current = false; }
    if (!ok) return;
    setBusy(true);
    try {
      const r = await runBounded(targets, BATCH_CONCURRENCY, async (c) => { await clientRef.current?.deleteConversation(c.conv_id); });
      if (currentConvRef.current && r.succeeded.some((c) => c.conv_id === currentConvRef.current)) deselect(); // deselect 内部会刷新列表
      else await refreshConversations();
      if (r.failed.length > 0) {
        setToast(t("conv.edit.delete_failed", { count: r.failed.length }));
        const done = new Set(r.succeeded.map((c) => c.conv_id));
        setSelection((s) => new Set([...s].filter((id) => !done.has(id))));
      } else {
        exit();
      }
    } catch (e) { setToast(t("conv.error.delete_failed_detail", { detail: (e as Error).message })); }
    finally { setBusy(false); }
  }, [selectedConvs, busy, askConfirm, clientRef, currentConvRef, deselect, refreshConversations, setToast, exit]);

  return {
    editing, enter, exit, selection, shown, busy, count: selection.size, allSelected,
    canRead: readable.length > 0 && !busy, canDelete: selectedConvs.length > 0 && !busy, canSelectAll: shown.length > 0 && !busy,
    toggle, selectAll, markRead, removeSelected,
  };
}

export type ConvEditMode = ReturnType<typeof useConvEditMode>;
