// 聊天文件夹管理 / 创建 / 编辑 / 选择聊天（设计 CHAT_FOLDERS_DESIGN §4.5–§4.6）。设置面板体系里的一个子面板
// （占据左栏、右侧聊天保持不动），内部自管四个视图：list（管理）/ edit（创建 · 编辑）/ pick（选择聊天）。
// - 创建：名称 + 待添加聊天先留本地，右上「创建」一次提交。
// - 编辑：名称失焦即存；增删成员立即提交；别的设备把它删了 → 自动退回管理页。
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Briefcase, Check, Folder, GripVertical, Smile, Trash2, Users } from "lucide-react";
import type { Conversation } from "../../sdk/protocol";
import { runeLength, type ChatFolder } from "../../chatFolders";
import { clampOffset, dragTarget, moveItem, shiftFor } from "../../dragReorder";
import { useChatFoldersCtx } from "../../ChatFoldersContext";
import { useAppServices } from "../../AppServicesContext";
import { useT } from "../../i18n";
import { Avatar } from "../Avatar";
import { SubPanel } from "./SubPanel";

// pick 带着它所属编辑页的 id（null = 创建模式）：选择聊天是编辑页的子视图，不带 id 就分不清在改哪个文件夹。
type View = { kind: "list" } | { kind: "edit"; id: string | null; name?: string } | { kind: "pick"; id: string | null };

export function ChatFoldersPanel({ conversations, convDisplayLabel, convAvatarUrl, initialEditId, onBack }: {
  conversations: Conversation[];
  convDisplayLabel: (c: Conversation) => string;
  convAvatarUrl: (c: Conversation) => string | undefined;
  /** 从会话列表 Tab 右键「编辑」直达：非 null = 直接进该文件夹的编辑页（返回即离开面板）。 */
  initialEditId?: string | null;
  onBack: () => void;
}) {
  const t = useT();
  const folders = useChatFoldersCtx();
  const { setToast, askConfirm } = useAppServices();
  const snap = folders.snapshot;
  const [view, setView] = useState<View>(initialEditId ? { kind: "edit", id: initialEditId } : { kind: "list" });
  const direct = !!initialEditId; // 直达进来的：返回 = 关闭面板
  const [name, setName] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // 管理页排序（对齐 iOS / Android）：右上「编辑」进入，长按（或按住 ≡ 手柄）拖动；拖动期间不改顺序，松手一次提交
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<ChatFolder[]>(snap.folders);
  const [drag, setDrag] = useState<{ id: string; offset: number } | null>(null);
  const press = useRef<{ id: string; startY: number; rowH: number; el: HTMLElement; timer: number | null; active: boolean } | null>(null);
  useEffect(() => { setOrder(snap.folders); }, [snap.folders]);
  useEffect(() => { if (snap.folders.length === 0) setSorting(false); }, [snap.folders.length]);

  useEffect(() => { void folders.refresh(); }, [folders.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const inEdit = view.kind === "edit" || view.kind === "pick"; // pick 是编辑页的子视图，沿用同一个目标
  const editId = inEdit ? view.id : null;
  const editing = editId ? snap.folders.find((f) => f.id === editId) ?? null : null;
  const creating = inEdit && view.id === null;
  // 进入编辑页 / 切换目标时初始化名称与待提交集合（edit ↔ pick 往返目标不变，不重置）
  useEffect(() => {
    if (view.kind !== "edit") return;
    setName(editing?.name ?? view.name ?? "");
    setDraftIds([]);
  }, [inEdit ? view.id : "-"]); // eslint-disable-line react-hooks/exhaustive-deps
  // 别的设备把它删了：退回
  useEffect(() => {
    if (view.kind === "edit" && view.id && !editing) (direct ? onBack : () => setView({ kind: "list" }))();
  }, [editing, view, direct, onBack]);

  const byId = useMemo(() => new Map(conversations.map((c) => [c.conv_id, c])), [conversations]);
  const memberIds = creating ? draftIds : editing?.conv_ids ?? [];
  const members = memberIds.map((id) => byId.get(id)).filter((c): c is Conversation => !!c);
  const fail = (e: unknown) => setToast(e instanceof Error && e.message ? e.message : t("folder.toast.failed"));

  const commitName = async () => {
    if (!editing) return;
    const n = name.trim();
    if (!n) { setName(editing.name); return; }
    if (n === editing.name) return;
    try { await folders.rename(editing.id, n); } catch (e) { setName(editing.name); fail(e); }
  };
  const leaveEdit = async () => {
    if (!creating) await commitName();
    if (direct) onBack(); else setView({ kind: "list" });
  };

  /* ── 选择聊天 ── */
  if (view.kind === "pick") {
    const q = query.trim().toLowerCase();
    const shown = conversations.filter((c) => !q || convDisplayLabel(c).toLowerCase().includes(q) || (c.peer ?? "").toLowerCase().includes(q));
    const done = async () => {
      const before = memberIds;
      const ordered = conversations.map((c) => c.conv_id).filter((id) => picked.has(id))
        .concat(before.filter((id) => picked.has(id) && !byId.has(id))); // 保留解析不到的既有成员
      setView({ kind: "edit", id: editId });
      setQuery("");
      if (creating) { setDraftIds(ordered); return; }
      const add = ordered.filter((id) => !before.includes(id));
      const rm = before.filter((id) => !picked.has(id));
      if (!editing || (add.length === 0 && rm.length === 0)) return;
      try { await folders.changeConvs(editing.id, add, rm); } catch (e) { fail(e); }
    };
    return (
      <SubPanel title={t("folder.picker.title")} onBack={() => { setView({ kind: "edit", id: editId }); setQuery(""); }}
        right={<button className="mini-btn" onClick={() => void done()}>{t("common.done")}</button>}>
        <div className="home-search">
          <input className="home-search-input" value={query} placeholder={t("common.search")} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="settings-group">
          {shown.map((c) => (
            <div key={c.conv_id} className="convitem" onClick={() => {
              const next = new Set(picked);
              if (next.has(c.conv_id)) next.delete(c.conv_id);
              else if (next.size >= snap.limits.max_convs) { setToast(t("err.300302")); return; }
              else next.add(c.conv_id);
              setPicked(next);
            }}>
              <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer} />
              <div className="convbody"><div className="convpeer">{convDisplayLabel(c)}</div></div>
              {picked.has(c.conv_id) && <Check size={18} style={{ color: "var(--accent)" }} />}
            </div>
          ))}
        </div>
      </SubPanel>
    );
  }

  /* ── 创建 / 编辑 ── */
  if (view.kind === "edit") {
    const create = async () => {
      const n = name.trim();
      if (!n) { setToast(t("err.300303")); return; }
      setBusy(true);
      try { await folders.create(n, draftIds); setBusy(false); if (direct) onBack(); else setView({ kind: "list" }); }
      catch (e) { setBusy(false); fail(e); }
    };
    return (
      <SubPanel title={t(creating ? "folder.edit.title_create" : "folder.edit.title_edit")} onBack={() => void leaveEdit()}
        right={creating ? <button className="mini-btn" disabled={busy || !name.trim()} onClick={() => void create()}>{t("common.create")}</button> : undefined}>
        <div className="section-label">{t("folder.edit.name")}</div>
        <div className="settings-group">
          <div className="folder-edit-name">
            <input value={name} placeholder={t("folder.edit.name_placeholder")}
              onChange={(e) => { if (runeLength(e.target.value) <= snap.limits.max_name) setName(e.target.value); }}
              onBlur={() => void commitName()}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            <span className="count">{runeLength(name)} / {snap.limits.max_name}</span>
          </div>
        </div>
        <div className="section-label">{t("folder.edit.chats_section", { count: members.length })}</div>
        <div className="settings-group">
          {members.map((c) => (
            <div key={c.conv_id} className="convitem static">
              <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer} />
              <div className="convbody"><div className="convpeer">{convDisplayLabel(c)}</div></div>
              <div className="row-actions">
                <button className="mini-btn ghost" onClick={() => {
                  if (creating) { setDraftIds(draftIds.filter((id) => id !== c.conv_id)); return; }
                  void folders.changeConvs(editing!.id, [], [c.conv_id]).catch(fail);
                }}>{t("folder.edit.remove")}</button>
              </div>
            </div>
          ))}
          <div className="convitem static" style={{ cursor: "pointer", color: "var(--accent)" }}
            onClick={() => { setPicked(new Set(memberIds)); setQuery(""); setView({ kind: "pick", id: editId }); }}>
            {t("folder.edit.add_chats")}
          </div>
        </div>
        <div className="section-label">{t("folder.edit.remove_hint")}</div>
        {!creating && editing && (
          <div className="settings-group">
            <div className="convitem static" style={{ cursor: "pointer", color: "var(--danger)", justifyContent: "center" }}
              onClick={async () => {
                if (!(await askConfirm(t("folder.edit.delete_confirm", { name: editing.name }), { okText: t("common.delete"), danger: true }))) return;
                try { await folders.remove(editing.id); } catch (e) { fail(e); }
              }}>
              <Trash2 size={16} style={{ marginRight: 6 }} />{t("folder.edit.delete")}
            </div>
          </div>
        )}
      </SubPanel>
    );
  }

  /* ── 管理页 ── */
  const maxed = snap.folders.length >= snap.limits.max_folders;
  const recommend = [
    { name: t("folder.recommend.work"), Icon: Briefcase }, { name: t("folder.recommend.personal"), Icon: Smile },
    { name: t("folder.recommend.groups"), Icon: Users },
  ];
  const LONG_PRESS_MS = 350;
  const endDrag = (commit: boolean) => {
    const p = press.current;
    if (p?.timer) window.clearTimeout(p.timer);
    press.current = null;
    if (!p || !p.active) return;
    const d = drag;
    setDrag(null);
    if (!commit || !d) return;
    const from = order.findIndex((x) => x.id === d.id);
    const to = dragTarget(from, d.offset, p.rowH, order.length);
    if (from < 0 || to === from) return;
    const moved = moveItem(order, from, to);
    setOrder(moved); // 先本地换序，服务端回包后快照一变自然重置
    void folders.reorder(moved.map((x) => x.id)).catch((e) => { setOrder(snap.folders); fail(e); });
  };
  const onRowPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!sorting || press.current) return;
    const el = e.currentTarget;
    const onHandle = !!(e.target as HTMLElement).closest("[data-drag-handle]");
    press.current = { id, startY: e.clientY, rowH: el.getBoundingClientRect().height, el, timer: null, active: false };
    const begin = () => {
      const p = press.current;
      if (!p) return;
      p.active = true;
      try { p.el.setPointerCapture(e.pointerId); } catch { /* 合成事件 / 已释放：忽略 */ }
      setDrag({ id, offset: 0 });
    };
    if (onHandle) begin(); else press.current.timer = window.setTimeout(begin, LONG_PRESS_MS);
  };
  const onRowPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    const dy = e.clientY - p.startY;
    if (!p.active) {
      if (Math.abs(dy) > 6 && p.timer) { window.clearTimeout(p.timer); press.current = null; } // 还没长按就动了 = 滚动意图
      return;
    }
    const from = order.findIndex((x) => x.id === p.id);
    setDrag({ id: p.id, offset: clampOffset(dy, from, p.rowH, order.length) });
  };
  return (
    <SubPanel title={t("settings.row.folders")} onBack={onBack}
      right={snap.folders.length > 0
        ? <button className="mini-btn ghost" onClick={() => { setSorting((v) => !v); endDrag(false); }}>{t(sorting ? "common.done" : "common.edit")}</button>
        : undefined}>
      {snap.folders.length === 0 ? (
        <>
          <div className="folder-empty-hero">
            <Folder size={44} />
            <b>{t("folder.manage.empty_title")}</b>
            {t("folder.manage.empty_desc")}
          </div>
          <div className="settings-group">
            <div className="convitem static" style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => setView({ kind: "edit", id: null })}>
              {t("folder.manage.create")}
            </div>
          </div>
          <div className="section-label">{t("folder.manage.recommended")}</div>
          <div className="settings-group">
            {recommend.map(({ name: n, Icon }) => (
              <div key={n} className="convitem static" style={{ cursor: "pointer" }} onClick={() => setView({ kind: "edit", id: null, name: n })}>
                <Icon size={18} style={{ marginRight: 10 }} /><div className="convbody"><div className="convpeer">{n}</div></div>
                <span style={{ color: "var(--accent)" }}>{t("folder.manage.recommended_add")}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="section-label">{t("folder.manage.section_mine", { count: snap.folders.length, max: snap.limits.max_folders })}</div>
          <div className="settings-group">
            {(sorting ? order : snap.folders).map((f, i) => {
              const from = drag ? order.findIndex((x) => x.id === drag.id) : -1;
              const target = drag ? dragTarget(from, drag.offset, press.current?.rowH ?? 0, order.length) : from;
              const dragging = drag?.id === f.id;
              const shift = dragging ? drag!.offset : drag ? shiftFor(i, from, target, press.current?.rowH ?? 0) : 0;
              return (
              <div key={f.id} className="convitem static"
                style={{
                  cursor: sorting ? "grab" : "pointer", position: "relative", zIndex: dragging ? 2 : 0,
                  transform: shift ? `translateY(${shift}px)` : undefined,
                  transition: dragging ? "none" : "transform .15s", touchAction: sorting ? "none" : undefined,
                  boxShadow: dragging ? "0 4px 14px rgba(0,0,0,.18)" : undefined, userSelect: sorting ? "none" : undefined,
                }}
                onClick={() => { if (!sorting) setView({ kind: "edit", id: f.id }); }}
                onPointerDown={(e) => onRowPointerDown(e, f.id)} onPointerMove={onRowPointerMove}
                onPointerUp={() => endDrag(true)} onPointerCancel={() => endDrag(false)}>
                <Folder size={18} style={{ marginRight: 10, color: "var(--accent)" }} />
                <div className="convbody">
                  <div className="convpeer">{f.name}</div>
                  <div className="convlast">{t("folder.manage.chats_count", { count: f.conv_ids.length })}</div>
                </div>
                {sorting ? (
                  <span data-drag-handle style={{ marginLeft: "auto", color: "var(--text-secondary)", display: "flex", padding: 6 }}><GripVertical size={18} /></span>
                ) : (
                  <div className="folder-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" onClick={async () => {
                      if (!(await askConfirm(t("folder.edit.delete_confirm", { name: f.name }), { okText: t("common.delete"), danger: true }))) return;
                      try { await folders.remove(f.id); } catch (e) { fail(e); }
                    }}><Trash2 size={16} /></button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
          <div className="settings-group">
            <div className="convitem static" style={{ cursor: maxed ? "default" : "pointer", color: maxed ? "var(--text-secondary)" : "var(--accent)" }}
              onClick={() => (maxed ? setToast(t("err.300301")) : setView({ kind: "edit", id: null }))}>
              {t("folder.manage.create")}
            </div>
          </div>
          <div className="section-label">{maxed ? t("folder.manage.max_reached", { max: snap.limits.max_folders }) : t("folder.manage.footer")}</div>
        </>
      )}
    </SubPanel>
  );
}
