// 会话右键菜单里的**文件夹项**（设计 CHAT_FOLDERS_DESIGN §4.4），放在菜单**第一位**：
//   未入夹 → 「添加到文件夹 ›」；已入夹 → 「从「X」移出」排第一（多夹时「从文件夹移出 ›」），其后仍有「添加到文件夹 ›」。
// 二级在**菜单内就地折叠展开**（Web 菜单没有原生子菜单）：已在夹内的打勾，点一下切换归属并收起菜单；
// 底部「新建文件夹…」→ 输入名称，创建后直接把该会话放进去。还没有文件夹时不展开，直接弹输入框。
import { useState } from "react";
import { Check, ChevronRight, FolderMinus, FolderPlus, Plus } from "lucide-react";
import type { Conversation } from "../sdk/protocol";
import { foldersContaining, runeLength, type ChatFolder } from "../chatFolders";
import { useChatFoldersCtx } from "../ChatFoldersContext";
import { useAppServices } from "../AppServicesContext";
import { useT } from "../i18n";

export function ChatFolderMenuItems({ conv, onDone }: { conv: Conversation; onDone: () => void }) {
  const t = useT();
  const folders = useChatFoldersCtx();
  const { setToast, askPrompt } = useAppServices();
  const [open, setOpen] = useState<"add" | "remove" | null>(null);
  const snap = folders.snapshot;
  const containing = foldersContaining(snap.folders, conv.conv_id);
  const current = folders.selectedFolder;

  const fail = (e: unknown) => setToast(e instanceof Error && e.message ? e.message : t("folder.toast.failed"));

  const toggle = async (f: ChatFolder, member: boolean) => {
    onDone();
    try {
      await folders.changeConvs(f.id, member ? [conv.conv_id] : [], member ? [] : [conv.conv_id]);
      setToast(t(member ? "folder.toast.added" : "folder.toast.removed", { name: f.name }));
    } catch (e) { fail(e); }
  };

  const createNew = async () => {
    onDone();
    const name = await askPrompt(t("folder.edit.title_create"), "", {
      placeholder: t("folder.edit.name_placeholder"), okText: t("common.create"),
      // 不传 maxLength：输入框按 UTF-16 计，emoji 名会被误截成一半；长度按码点在下面校验（与服务端 rune 口径一致）
      hint: t("folder.new.message", { name: conv.name ?? conv.peer ?? "" }),
    });
    const n = name?.trim();
    if (!n) return;
    if (runeLength(n) > snap.limits.max_name) { setToast(t("err.300303")); return; }
    try {
      await folders.create(n, [conv.conv_id]);
      setToast(t("folder.toast.created", { name: n }));
    } catch (e) { fail(e); }
  };

  // 一步移出的目标：当前所在的文件夹 Tab 优先，其次「恰在 1 个夹内」
  const removeTarget: ChatFolder | null =
    current && current.conv_ids.includes(conv.conv_id) ? current : containing.length === 1 ? containing[0] : null;
  const maxed = snap.folders.length >= snap.limits.max_folders;

  return (
    <>
      {removeTarget && (
        <button onClick={() => void toggle(removeTarget, false)}>
          <FolderMinus size={16} className="menu-icon" />{t("folder.menu.remove_from", { name: removeTarget.name })}
        </button>
      )}
      {!removeTarget && containing.length > 1 && (
        <>
          <button onClick={() => setOpen(open === "remove" ? null : "remove")}>
            <FolderMinus size={16} className="menu-icon" />{t("folder.menu.remove_from_multi")}
            <ChevronRight size={14} className="ctx-check" />
          </button>
          {open === "remove" && (
            <div className="ctx-folder-sub">
              {containing.map((f) => <button key={f.id} onClick={() => void toggle(f, false)}>{f.name}</button>)}
            </div>
          )}
        </>
      )}
      {snap.folders.length === 0 ? (
        <button onClick={() => void createNew()}>
          <FolderPlus size={16} className="menu-icon" />{t("folder.menu.add")}
        </button>
      ) : (
        <>
          <button onClick={() => setOpen(open === "add" ? null : "add")}>
            <FolderPlus size={16} className="menu-icon" />{t("folder.menu.add")}
            <ChevronRight size={14} className="ctx-check" />
          </button>
          {open === "add" && (
            <div className="ctx-folder-sub">
              {snap.folders.map((f) => {
                const has = f.conv_ids.includes(conv.conv_id);
                const full = !has && f.conv_ids.length >= snap.limits.max_convs;
                return (
                  <button key={f.id} onClick={() => (full ? setToast(t("err.300302")) : void toggle(f, !has))}>
                    {f.name}
                    {has && <Check size={14} className="ctx-check" />}
                    {full && <span className="ctx-hint">{t("folder.menu.full", { max: snap.limits.max_convs })}</span>}
                  </button>
                );
              })}
              <button onClick={() => (maxed ? setToast(t("err.300301")) : void createNew())}>
                <Plus size={14} className="menu-icon" />{t("folder.menu.new")}
                {maxed && <span className="ctx-hint">{t("folder.menu.max_reached", { max: snap.limits.max_folders })}</span>}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
