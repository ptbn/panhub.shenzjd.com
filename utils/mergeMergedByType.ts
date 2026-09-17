import type { MergedLinks, MergedLink } from "~/types/search";
import { getCanonicalDriveInfo, extractPassword } from "./canonicalUrl";

/**
 * 按类型合并搜索结果，使用 Canonical Share ID 智能去重
 * 解决 b.quark.cn vs pan.quark.cn、带不同参数或口令导致的假不同链接问题
 */
export function mergeMergedByType(
  target: MergedLinks,
  incoming?: MergedLinks
): MergedLinks {
  if (!incoming) return target;
  const out: MergedLinks = { ...target };

  for (const type of Object.keys(incoming)) {
    const existed = out[type] || [];
    const next = incoming[type] || [];

    // 建立基于 canonicalKey 和 raw url 的双重去重映射
    const canonicalMap = new Map<string, number>();
    const seenRawUrls = new Set<string>();
    const mergedArr: MergedLink[] = [];

    for (const item of existed) {
      if (!item || !item.url) continue;
      const pwd = extractPassword(item.url, item.password);
      const normalizedItem = { ...item, password: pwd };
      const cInfo = getCanonicalDriveInfo(item.url);

      const idx = mergedArr.length;
      mergedArr.push(normalizedItem);
      seenRawUrls.add(item.url);
      if (cInfo.canonicalKey) {
        canonicalMap.set(cInfo.canonicalKey, idx);
      }
    }

    for (const item of next) {
      if (!item || !item.url) continue;
      const pwd = extractPassword(item.url, item.password);
      const cInfo = getCanonicalDriveInfo(item.url);
      const key = cInfo.canonicalKey;

      if (key && canonicalMap.has(key)) {
        // 已有该资源：如果新条目带提取码而旧条目没有，则补充更新
        const existingIdx = canonicalMap.get(key)!;
        const existing = mergedArr[existingIdx];
        if (!existing.password && pwd) {
          existing.password = pwd;
        }
        if (!existing.description && item.description) {
          existing.description = item.description;
        }
        if (!existing.magnetMeta && item.magnetMeta) {
          existing.magnetMeta = item.magnetMeta;
        } else if (
          existing.magnetMeta &&
          item.magnetMeta &&
          typeof item.magnetMeta.seeders === "number" &&
          (existing.magnetMeta.seeders === undefined ||
            item.magnetMeta.seeders > existing.magnetMeta.seeders)
        ) {
          existing.magnetMeta = item.magnetMeta;
        }
        continue;
      }

      if (seenRawUrls.has(item.url)) {
        continue;
      }

      const normalizedItem: MergedLink = { ...item, password: pwd };
      const newIdx = mergedArr.length;
      mergedArr.push(normalizedItem);
      seenRawUrls.add(item.url);
      if (key) {
        canonicalMap.set(key, newIdx);
      }
    }

    out[type] = mergedArr;
  }

  return out;
}
