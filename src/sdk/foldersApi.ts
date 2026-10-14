// 会话文件夹 REST（PROTOCOL §6.15 / §11）。所有写接口成功后回的都是整表 `{version, folders[], limits}`
// （与 folder_update 帧同形），由 useChatFolders 整表替换。无状态一次性请求，不碰 socket / 本地库
// （同 notifySettingsApi：别往已超预算的 imSdk.ts 里堆）。
import { callJson } from "./http";

const PATH = "/api/v1/folders";

function init(token: string, method: string, body?: unknown): RequestInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
}

/** 整表（无则 `version:0, folders:[]`）。返回原始 JSON，由调用方 `parseFolderSnapshot` 规整。 */
export const fetchFolders = (token: string): Promise<unknown> => callJson(PATH, init(token, "GET"));

/** 新建（可带初始会话）。`clientId` 相同的重发服务端回既存结果而非报重名。 */
export const createFolder = (token: string, name: string, convIds: string[], clientId: string): Promise<unknown> =>
  callJson(PATH, init(token, "POST", { name, conv_ids: convIds, client_id: clientId }));

export const renameFolder = (token: string, id: string, name: string): Promise<unknown> =>
  callJson(`${PATH}/${encodeURIComponent(id)}`, init(token, "PATCH", { name }));

export const deleteFolder = (token: string, id: string): Promise<unknown> =>
  callJson(`${PATH}/${encodeURIComponent(id)}`, init(token, "DELETE"));

/** 排序：`ids` 须恰为当前全部文件夹 id 的排列。 */
export const reorderFolders = (token: string, ids: string[]): Promise<unknown> =>
  callJson(`${PATH}/order`, init(token, "PUT", { ids }));

/** 成员增删（集合运算，幂等）：先移除再加入。 */
export const changeFolderConvs = (token: string, id: string, add: string[], remove: string[]): Promise<unknown> =>
  callJson(`${PATH}/${encodeURIComponent(id)}/convs`, init(token, "POST", { add, remove }));
