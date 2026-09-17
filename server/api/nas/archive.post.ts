// server/api/nas/archive.post.ts
// PanHub 阶段 P2：多网盘与本地存储的冷热分层调度引擎 API
// 将本地已完结影视一键归档至 115 / 夸克等网盘，释放 NAS 本地存储空间

import { defineEventHandler, readBody, createError } from "h3";
import { requireAuthUser } from "../../utils/authSession";
import { getDatabase } from "../../core/db/index";
import { decryptCredential } from "../../core/db/crypto";
import { moveAListFiles, copyAListFiles } from "../../core/nas/alistClient";

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event);
  const body = await readBody(event);

  if (!body || !body.srcDir || !body.dstDir || !Array.isArray(body.names) || body.names.length === 0) {
    throw createError({
      statusCode: 400,
      message: "归档请求参数不完整：必须包含 srcDir、dstDir 和至少一个 names 待归档条目",
    });
  }

  const db = await getDatabase(event);
  const profile = await db.getNasProfile(user.id);

  if (!profile || !profile.alistUrl) {
    throw createError({
      statusCode: 400,
      message: "尚未在【我的 NAS】中配置 AList 访问地址与凭证，请先完成绑定",
    });
  }

  const masterSecret =
    process.env.APP_ENCRYPTION_SECRET ||
    (event.context?.cloudflare?.env as any)?.APP_ENCRYPTION_SECRET ||
    "panhub-taoge-nas-secret-key-2026";

  let token = "";
  if (profile.alistTokenEncrypted) {
    try {
      token = await decryptCredential(profile.alistTokenEncrypted, masterSecret);
    } catch (e) {
      console.warn("[AList Archive] 解密 token 警告:", e);
    }
  }

  const action = body.action === "copy" ? "copy" : "move";
  const result =
    action === "copy"
      ? await copyAListFiles(profile.alistUrl, token, body.srcDir, body.dstDir, body.names)
      : await moveAListFiles(profile.alistUrl, token, body.srcDir, body.dstDir, body.names);

  if (!result.success) {
    throw createError({
      statusCode: 502,
      message: result.message,
    });
  }

  return {
    code: 200,
    message: result.message,
    data: {
      action,
      srcDir: body.srcDir,
      dstDir: body.dstDir,
      names: body.names,
      taskId: result.taskId,
    },
  };
});
