// server/core/nas/alistClient.ts
// AList 官方 REST API 驱动客户端 (纯 JS/TS，兼容 CF Workers)

import { validateNasTargetUrl } from "./ssrfGuard";
import type { ShareMountResult, MountedMediaFile } from "./types";

export interface AListTestResult {
  success: boolean;
  message: string;
  username?: string;
  role?: number;
}

export interface AListPushResult {
  success: boolean;
  taskId?: string;
  message: string;
  /**
   * 是否已从 AList 任务对象中读到真实状态。
   * false 表示该 AList 版本未回传可核对的任务信息，success 仅代表「已入队」，
   * 不代表可落盘 —— 调用方必须把它当作「待确认」而非「已完成」。
   */
  verifiable?: boolean;
  /** AList 回传的任务状态原文（state），用于把真实失败原因暴露给用户 */
  taskState?: string;
  /** AList 回传的任务错误原文（error），失败时的根因文本 */
  taskError?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** AList 离线下载任务对象（结构见官方 internal/offline_download/tool/download.go） */
export interface AListDownloadTask {
  id?: string;
  name?: string;
  url?: string;
  dst_dir_path?: string;
  temp_dir?: string;
  toolname?: string;
  state?: string;
  status?: string;
  progress?: number;
  error?: string;
}

/**
 * 判定 AList 任务状态是否代表「已失败」
 * state 取值参考 AList tache 状态机：pending / running / succeeded / errored / canceled
 */
export function isFailedTaskState(state?: string): boolean {
  if (!state) return false;
  const s = String(state).toLowerCase();
  return (
    s === "errored" ||
    s === "error" ||
    s === "failed" ||
    s === "canceled" ||
    s === "cancelled"
  );
}

export async function testAListConnection(
  url: string,
  token: string,
  allowPrivateIp = false
): Promise<AListTestResult> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "PanHub-NAS-Client/2.0",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/me`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP 响应异常 (${res.status} ${res.statusText})`,
      };
    }

    const json = (await res.json()) as any;
    if (json.code === 200) {
      return {
        success: true,
        message: "AList 连接成功，凭据有效",
        username: json.data?.username || "admin",
        role: json.data?.role,
      };
    } else {
      return {
        success: false,
        message: json.message || `AList 接口返回错误码 ${json.code}`,
      };
    }
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "连接超时 (超过 8 秒未响应)" : `请求失败: ${e.message}`,
    };
  }
}

/**
 * 拉取 AList 离线下载任务列表
 * @param which undone = 进行中/失败任务；done = 已完成任务
 */
export async function listAListOfflineTasks(
  url: string,
  token: string,
  which: "undone" | "done" = "undone",
  allowPrivateIp = false
): Promise<{ success: boolean; message: string; tasks: AListDownloadTask[] }> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error!, tasks: [] };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "PanHub-NAS-Client/2.0",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/task/offline_download/${which}`, {
      method: "POST",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { success: false, message: `HTTP 响应异常 (${res.status})`, tasks: [] };
    }

    const json = (await res.json()) as any;
    if (json.code !== 200) {
      return {
        success: false,
        message: json.message || `AList 任务列表读取失败 (code: ${json.code})`,
        tasks: [],
      };
    }

    return {
      success: true,
      message: "任务列表读取成功",
      tasks: Array.isArray(json.data) ? (json.data as AListDownloadTask[]) : [],
    };
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "任务列表读取超时" : `任务列表读取失败: ${e.message}`,
      tasks: [],
    };
  }
}

/**
 * 提交 AList 离线下载任务
 *
 * ⚠️ 关键语义契约（不可回退）：
 * AList 的 /api/fs/add_offline_download 只要**入队成功**即返回 HTTP 200 + code 200，
 * 与任务最终能否下载、能否落盘**完全无关**。真实失败（qBittorrent 拒绝 savepath、
 * 临时目录未在两容器间共享、transfer 失败）只体现在任务对象的 state/error 上。
 *
 * 因此本函数必须完成三级真伪校验，绝不允许把「已入队」谎报为「已成功落盘」：
 *   ① 响应内直接带任务对象 → 立即检查 state
 *   ② 响应内无任务对象（老版本返回 data:null）→ 回查任务列表按 url/name/dst_dir_path 匹配
 *   ③ 回查也找不到任务 → 判定为失败（任务被静默丢弃）
 */
export async function addAListOfflineDownload(
  url: string,
  token: string,
  downloadUrl: string,
  targetPath: string,
  tool = "aria2",
  allowPrivateIp = false
): Promise<AListPushResult> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const cleanPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "PanHub-NAS-Client/2.0",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/fs/add_offline_download`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: cleanPath,
        urls: [downloadUrl],
        tool,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP 响应异常 (${res.status} ${res.statusText})`,
      };
    }

    const json = (await res.json()) as any;
    if (json.code !== 200) {
      return {
        success: false,
        message: json.message || `AList 离线下载添加失败 (code: ${json.code})`,
      };
    }

    // ── 校验 ①：AList 直接在响应里回传了任务对象 ──────────────────────────
    const task: AListDownloadTask | undefined = json.data?.tasks?.[0];
    if (task) {
      if (isFailedTaskState(task.state)) {
        const detail = task.error || `任务状态为 ${task.state}`;
        return {
          success: false,
          taskId: task.id ? String(task.id) : undefined,
          verifiable: true,
          taskState: task.state,
          taskError: task.error,
          message: `AList 已接受任务但立即失败：${detail}`,
        };
      }
      return {
        success: true,
        taskId: task.id ? String(task.id) : undefined,
        verifiable: true,
        taskState: task.state,
        message: "离线下载任务已提交至 AList 队列，且任务状态正常",
      };
    }

    // ── 校验 ②：响应未带任务对象，回查任务列表确认真伪 ────────────────────
    const probe = await listAListOfflineTasks(url, token, "undone", allowPrivateIp);
    if (probe.success) {
      const byUrl = probe.tasks.find((t) => t.url && t.url === downloadUrl);
      const byName = probe.tasks.find((t) => !!t.name && t.name.includes(downloadUrl));
      const byPath = probe.tasks.find((t) => (t.dst_dir_path || "") === cleanPath);
      const matched = byUrl || byName || byPath;

      if (matched) {
        if (isFailedTaskState(matched.state)) {
          const detail = matched.error || `任务状态为 ${matched.state}`;
          return {
            success: false,
            taskId: matched.id ? String(matched.id) : undefined,
            verifiable: true,
            taskState: matched.state,
            taskError: matched.error,
            message: `AList 已接受任务但下载失败：${detail}`,
          };
        }
        return {
          success: true,
          taskId: matched.id ? String(matched.id) : undefined,
          verifiable: true,
          taskState: matched.state,
          message: `离线下载任务已进入 AList 队列（状态：${matched.state || "pending"}）`,
        };
      }

      // 入队成功却查不到任务 → 被静默丢弃，必须判定失败
      return {
        success: false,
        verifiable: true,
        message:
          "AList 返回入队成功，但任务列表中查不到该任务，任务疑似被静默丢弃。请检查 AList 的 qBittorrent 工具是否就绪、临时文件夹是否已配置。",
      };
    }

    // ── 校验 ③：无法回查（权限/版本差异），如实告知而非谎报成功 ────────────
    return {
      success: true,
      verifiable: false,
      message: `AList 已接受任务入队，但当前无法回查任务状态（${probe.message}）。请前往 AList 任务列表确认是否真正开始下载。`,
    };
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "离线推送超时" : `AList 推送失败: ${e.message}`,
    };
  }
}

export interface AListStorageItem {
  id: number;
  mountPath: string;
  driver: string;
  status: string;
  remark?: string;
  webdavPolicy?: string;
}

export interface AListStoragesResult {
  success: boolean;
  message: string;
  storages?: AListStorageItem[];
}

export interface AListRefreshResult {
  success: boolean;
  message: string;
  total?: number;
}

/**
 * 获取当前 AList 中已挂载的全部云存储驱动及其健康状态
 */
export async function getAListStorages(
  url: string,
  token: string,
  allowPrivateIp = false
): Promise<AListStoragesResult> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "PanHub-NAS-Client/2.0",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/admin/storage/list`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP 响应异常 (${res.status} ${res.statusText})`,
      };
    }

    const json = (await res.json()) as any;
    if (json.code === 200) {
      const content = json.data?.content || [];
      const storages: AListStorageItem[] = content.map((s: any) => ({
        id: s.id,
        mountPath: s.mount_path,
        driver: s.driver,
        status: s.status,
        remark: s.remark || "",
        webdavPolicy: s.webdav_policy || "",
      }));
      return {
        success: true,
        message: "获取 AList 存储列表成功",
        storages,
      };
    } else {
      return {
        success: false,
        message: json.message || `AList 接口返回错误码 ${json.code}`,
      };
    }
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "请求 AList 存储列表超时" : `获取 AList 存储列表失败: ${e.message}`,
    };
  }
}

/**
 * 删除 AList 中的指定存储挂载项 (用于清理失效或初始化失败的挂载点)
 */
export async function deleteAListStorage(
  url: string,
  token: string,
  storageId: number,
  allowPrivateIp = false
): Promise<{ success: boolean; message: string }> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/admin/storage/delete?id=${storageId}`, {
      method: "POST",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { success: false, message: `删除存储接口异常 (${res.status})` };
    }

    const json = (await res.json()) as any;
    return {
      success: json.code === 200,
      message: json.message || (json.code === 200 ? "删除存储成功" : `删除失败: ${json.code}`),
    };
  } catch (e: any) {
    return { success: false, message: `删除存储请求失败: ${e.message}` };
  }
}

/**
 * 主动穿透刷新 AList 指定目录的缓存 (refresh: true)
 */
export async function refreshAListPath(
  url: string,
  token: string,
  targetPath: string,
  allowPrivateIp = false
): Promise<AListRefreshResult> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const cleanPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "PanHub-NAS-Client/2.0",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/fs/list`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: cleanPath,
        refresh: true,
        page: 1,
        per_page: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP 响应异常 (${res.status} ${res.statusText})`,
      };
    }

    const json = (await res.json()) as any;
    if (json.code === 200) {
      return {
        success: true,
        message: `目录 [${cleanPath}] 缓存已成功穿透刷新`,
        total: json.data?.total || 0,
      };
    } else {
      let friendlyMsg = json.message || `刷新失败 (code: ${json.code})`;
      if (typeof json.message === "string" && json.message.includes("storage not found")) {
        friendlyMsg = `未在 AList 中检测到挂载目录 [${cleanPath}]，请确认该网盘驱动已在 AList 中添加挂载`;
      }
      return {
        success: false,
        message: friendlyMsg,
      };
    }
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "刷新 AList 目录超时" : `刷新 AList 目录失败: ${e.message}`,
    };
  }
}

export interface ParsedShareInfo {
  supported: boolean;
  driverName: string;
  shareCode: string;
  receiveCode: string;
  addition: Record<string, any>;
  reason?: string;
}

export function parseShareInfo(url: string, password = ""): ParsedShareInfo {
  const u = (url || "").trim();

  // 115
  const m115 = u.match(/115\.com\/s\/([a-zA-Z0-9]+)/i);
  if (m115) {
    const code = m115[1];
    let pwd = password;
    const pwdMatch = u.match(/[?&](?:password|pwd)=([a-zA-Z0-9]+)/i);
    if (pwdMatch) pwd = pwdMatch[1];
    return {
      supported: true,
      driverName: "115 Share",
      shareCode: code,
      receiveCode: pwd,
      addition: {
        share_code: code,
        receive_code: pwd,
        cookie: "",
        root_folder_id: "0",
      },
    };
  }

  // Baidu
  const mBaidu = u.match(/pan\.baidu\.com\/s\/(?:1)?([a-zA-Z0-9_-]+)/i);
  if (mBaidu) {
    const raw = u.match(/pan\.baidu\.com\/s\/([a-zA-Z0-9_-]+)/i)?.[1] || "";
    const code = raw.startsWith("1") && raw.length > 5 ? raw.slice(1) : raw;
    let pwd = password;
    const pwdMatch = u.match(/[?&](?:pwd|password)=([a-zA-Z0-9]+)/i);
    if (pwdMatch) pwd = pwdMatch[1];
    return {
      supported: true,
      driverName: "BaiduShare",
      shareCode: raw,
      receiveCode: pwd,
      addition: {
        surl: code,
        pwd: pwd,
        root_folder_path: "/",
      },
    };
  }

  // Alipan
  const mAli = u.match(/(?:alipan\.com|aliyundrive\.com)\/s\/([a-zA-Z0-9_-]+)/i);
  if (mAli) {
    const code = mAli[1];
    let pwd = password;
    const pwdMatch = u.match(/[?&](?:pwd|password)=([a-zA-Z0-9]+)/i);
    if (pwdMatch) pwd = pwdMatch[1];
    return {
      supported: true,
      driverName: "AliyundriveShare",
      shareCode: code,
      receiveCode: pwd,
      addition: {
        share_id: code,
        share_pwd: pwd,
        refresh_token: "",
        root_folder_id: "root",
      },
    };
  }

  // 123Pan
  const m123 = u.match(/123pan\.com\/s\/([a-zA-Z0-9_-]+)/i);
  if (m123) {
    const code = m123[1];
    let pwd = password;
    const pwdMatch = u.match(/[?&](?:pwd|password)=([a-zA-Z0-9]+)/i);
    if (pwdMatch) pwd = pwdMatch[1];
    return {
      supported: true,
      driverName: "123PanShare",
      shareCode: code,
      receiveCode: pwd,
      addition: {
        sharekey: code,
        sharepassword: pwd,
        root_folder_id: "0",
      },
    };
  }

  // Quark
  if (u.includes("quark.cn")) {
    return {
      supported: false,
      driverName: "Quark",
      shareCode: "",
      receiveCode: password,
      addition: {},
      reason: "夸克网盘官方接口未开放免密只读挂载驱动，需转存至个人网盘",
    };
  }

  return {
    supported: false,
    driverName: "Unknown",
    shareCode: "",
    receiveCode: password,
    addition: {},
    reason: "暂不支持该网盘的免密自动挂载驱动",
  };
}

/**
 * 在用户 AList 中动态创建或更新分享挂载点
 */
export async function mountAListShare(
  url: string,
  token: string,
  shareUrl: string,
  password: string,
  targetMountPath: string,
  allowPrivateIp = false
): Promise<ShareMountResult> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  const parsed = parseShareInfo(shareUrl, password);
  if (!parsed.supported) {
    return {
      success: false,
      message: parsed.reason || "暂不支持该网盘的免转存挂载",
      driver: parsed.driverName,
    };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const cleanPath = targetMountPath.startsWith("/") ? targetMountPath : `/${targetMountPath}`;

  // 检查是否已存在相同路径的挂载
  const storagesRes = await getAListStorages(url, token, allowPrivateIp);
  let existingId: number | undefined;
  if (storagesRes.success && storagesRes.storages) {
    const found = storagesRes.storages.find((s) => s.mountPath === cleanPath);
    if (found) {
      existingId = found.id;
    }
  }

  const endpoint = existingId
    ? `${cleanUrl}/api/admin/storage/update`
    : `${cleanUrl}/api/admin/storage/create`;

  const payload: Record<string, any> = {
    mount_path: cleanPath,
    order: 0,
    remark: `PanHub 动态挂载: ${new Date().toISOString().slice(0, 10)}`,
    cache_expiration: 30,
    web_proxy: false,
    webdav_policy: "302_redirect",
    down_proxy_url: "",
    down_proxy_sign: true,
    driver: parsed.driverName,
    addition: JSON.stringify(parsed.addition),
  };
  if (existingId) {
    payload.id = existingId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `AList 接口异常 (${res.status} ${res.statusText})`,
      };
    }

    const json = (await res.json()) as any;
    if (json.code !== 200) {
      const rawMsg = String(json.message || "");

      // 若初始化驱动失败但存储已被 AList 建立 (storage is already created)，立即自动回收删除该僵尸存储
      if (rawMsg.includes("storage is already created") || rawMsg.includes("failed init storage")) {
        try {
          const checkList = await getAListStorages(url, token, allowPrivateIp);
          const zombie = checkList.storages?.find((s) => s.mountPath === cleanPath);
          if (zombie && zombie.id) {
            await deleteAListStorage(url, token, zombie.id, allowPrivateIp);
            console.info(`[AList Mount] 已自动清理初始化失败的僵尸挂载点: [${cleanPath}] (ID: ${zombie.id})`);
          }
        } catch (cleanErr) {
          console.warn("[AList Mount] 自动清理僵尸挂载点失败:", cleanErr);
        }
      }

      // 针对网盘特有的常见错误进行中文语义降级转化
      let friendlyMsg = rawMsg || `挂载失败 (错误码: ${json.code})`;
      if (rawMsg.includes('"errno":2') || rawMsg.includes('"errno": 2')) {
        friendlyMsg = "百度网盘接口提示【errno: 2 参数错误/资源失效】。可能原因：该分享已取消或失效、提取码错误，或触发了百度官方反爬风控（要求登录个人账号）。已自动为您清理失败的挂载点。";
      } else if (rawMsg.includes('"errno":9019') || rawMsg.includes("need verify")) {
        friendlyMsg = "百度网盘接口触发官方安全验证（need verify），官方禁止免密解析。已自动为您清理失败的挂载点。";
      } else if (rawMsg.includes("failed init storage")) {
        friendlyMsg = "网盘分享驱动初始化失败，该分享可能已被取消或受官方防盗链限制。已自动为您清理失败的挂载点。";
      }

      return {
        success: false,
        message: friendlyMsg,
      };
    }

    // 穿透刷新该目录
    await refreshAListPath(url, token, cleanPath, allowPrivateIp).catch(() => {});

    // 列出挂载目录下的媒体文件
    let files: MountedMediaFile[] = [];
    try {
      const listHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (token) {
        listHeaders["Authorization"] = token;
      }
      const listRes = await fetch(`${cleanUrl}/api/fs/list`, {
        method: "POST",
        headers: listHeaders,
        body: JSON.stringify({
          path: cleanPath,
          page: 1,
          per_page: 50,
        }),
      });
      if (listRes.ok) {
        const listJson = (await listRes.json()) as any;
        if (listJson.code === 200 && listJson.data?.content) {
          files = listJson.data.content.map((f: any) => ({
            name: f.name,
            size: f.size || 0,
            isDir: Boolean(f.is_dir),
          }));
        }
      }
    } catch (err) {
      // 忽略文件列表获取错误
    }

    return {
      success: true,
      message: "成功动态挂载至 AList 专属影视目录",
      driver: parsed.driverName,
      mountPath: cleanPath,
      webdavUrl: `${cleanUrl}/dav${cleanPath}`,
      alistPlayUrl: `${cleanUrl}${cleanPath}`,
      files,
    };
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "AList 挂载操作超时" : `挂载请求失败: ${e.message}`,
    };
  }
}

export interface AListFileOperationResult {
  success: boolean;
  message: string;
  taskId?: string;
}

/**
 * 调用 AList 官方 /api/fs/move 实现跨存储（本地 NAS 与 各大网盘）文件移动
 * 支持异步任务队列调度，实现冷热分层归档
 */
export async function moveAListFiles(
  url: string,
  token: string,
  srcDir: string,
  dstDir: string,
  names: string[],
  allowPrivateIp = false
): Promise<AListFileOperationResult> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  if (!names || names.length === 0) {
    return { success: false, message: "移动目标文件名列表不能为空" };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "PanHub-NAS-Client/2.0",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/fs/move`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        src_dir: srcDir.startsWith("/") ? srcDir : `/${srcDir}`,
        dst_dir: dstDir.startsWith("/") ? dstDir : `/${dstDir}`,
        names,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP 响应异常 (${res.status} ${res.statusText})`,
      };
    }

    const json = (await res.json()) as any;
    if (json.code === 200) {
      return {
        success: true,
        message: json.message || "文件移动任务已成功提交至 AList 传输队列",
        taskId: json.data?.task_id || json.data?.id,
      };
    }

    return {
      success: false,
      message: json.message || `AList 移动文件失败 (错误码: ${json.code})`,
    };
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "AList 文件操作超时" : `网络请求失败: ${e.message}`,
    };
  }
}

/**
 * 调用 AList 官方 /api/fs/copy 实现跨存储文件复制
 */
export async function copyAListFiles(
  url: string,
  token: string,
  srcDir: string,
  dstDir: string,
  names: string[],
  allowPrivateIp = false
): Promise<AListFileOperationResult> {
  const check = validateNasTargetUrl(url, allowPrivateIp);
  if (!check.valid) {
    return { success: false, message: check.error! };
  }

  if (!names || names.length === 0) {
    return { success: false, message: "复制目标文件名列表不能为空" };
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "PanHub-NAS-Client/2.0",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const res = await fetch(`${cleanUrl}/api/fs/copy`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        src_dir: srcDir.startsWith("/") ? srcDir : `/${srcDir}`,
        dst_dir: dstDir.startsWith("/") ? dstDir : `/${dstDir}`,
        names,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP 响应异常 (${res.status} ${res.statusText})`,
      };
    }

    const json = (await res.json()) as any;
    if (json.code === 200) {
      return {
        success: true,
        message: json.message || "文件复制任务已成功提交至 AList 传输队列",
        taskId: json.data?.task_id || json.data?.id,
      };
    }

    return {
      success: false,
      message: json.message || `AList 复制文件失败 (错误码: ${json.code})`,
    };
  } catch (e: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: e.name === "AbortError" ? "AList 文件操作超时" : `网络请求失败: ${e.message}`,
    };
  }
}
