// utils/magnetHealth.ts
import type { MagnetMeta } from "~/types/search";

/**
 * 依据做种数 (seeders) 与下载数 (leechers) 计算磁力健康度雷达等级
 * - hot: 做种数 >= 30 (🔥 极速高速)
 * - warm: 做种数 >= 5 (🟡 良好顺畅)
 * - cold: 做种数 > 0 (❄️ 稀少冷门)
 * - dead: 做种数 === 0 (⚠️ 失效死种)
 */
export function calculateMagnetMeta(
  seeders?: number | string | null,
  leechers?: number | string | null
): MagnetMeta {
  const s =
    seeders !== undefined && seeders !== null && seeders !== ""
      ? Number(seeders)
      : undefined;
  const l =
    leechers !== undefined && leechers !== null && leechers !== ""
      ? Number(leechers)
      : undefined;

  const validS = typeof s === "number" && !isNaN(s) ? Math.max(0, Math.floor(s)) : undefined;
  const validL = typeof l === "number" && !isNaN(l) ? Math.max(0, Math.floor(l)) : undefined;

  let healthLevel: MagnetMeta["healthLevel"] = "cold";

  if (validS !== undefined) {
    if (validS >= 30) {
      healthLevel = "hot";
    } else if (validS >= 5) {
      healthLevel = "warm";
    } else if (validS > 0) {
      healthLevel = "cold";
    } else {
      healthLevel = "dead";
    }
  }

  return {
    seeders: validS,
    leechers: validL,
    healthLevel,
  };
}
