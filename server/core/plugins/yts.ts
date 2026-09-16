/**
 * YTS (YIFY) 电影 BT 磁力插件
 * 官方开放 REST API，提供 720p/1080p/2160p(4K) 高清蓝光电影种子与磁力
 * 特点：极速（JSON 响应 ~200ms）、带真实做种数(Seeds)与文件体积
 * 增强：支持 yts.lt 镜像容灾与中文片名智能元数据映射
 */

import { BaseAsyncPlugin, registerGlobalPlugin } from "./manager";
import type { SearchResult } from "../types/models";
import { ofetch } from "ofetch";
import { resolveEnglishTitle } from "../utils/queryExpansion";

const TRACKERS = [
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.openbittorrent.com:80",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.coppersurfer.tk:6969",
  "udp://explodie.org:6969",
].map((t) => `&tr=${encodeURIComponent(t)}`).join("");

const YTS_ENDPOINTS = [
  "https://yts.mx/api/v2/list_movies.json",
  "https://yts.lt/api/v2/list_movies.json",
];

interface YtsTorrent {
  url: string;
  hash: string;
  quality: string;
  type: string;
  seeds: number;
  peers: number;
  size: string;
  size_bytes?: number;
  date_uploaded?: string;
}

interface YtsMovie {
  id: number;
  title: string;
  title_english?: string;
  title_long?: string;
  year: number;
  rating: number;
  summary?: string;
  torrents?: YtsTorrent[];
}

interface YtsResponse {
  status: string;
  data?: {
    movie_count?: number;
    movies?: YtsMovie[];
  };
}

export function buildYtsMagnet(hash: string, title: string): string {
  const cleanHash = (hash || "").trim().toLowerCase();
  return `magnet:?xt=urn:btih:${cleanHash}&dn=${encodeURIComponent(title)}${TRACKERS}`;
}

export class YtsPlugin extends BaseAsyncPlugin {
  constructor() {
    super("yts", 5); // 优先级 5 (高优先级极速 JSON 源)
  }

  override async search(
    keyword: string,
    ext?: Record<string, any>
  ): Promise<SearchResult[]> {
    const rawKw = (keyword || "").trim();
    if (!rawKw || rawKw.length < 2) return [];

    const timeoutMs = Math.min(2500, ext?.__plugin_timeout_ms || 2500);

    // 智能元数据对齐：若为中文片名，优先自动解析出原版英文名称检索 YTS
    let queryTerm = rawKw;
    if (/[\u4e00-\u9fa5]/.test(rawKw)) {
      const meta = await resolveEnglishTitle(rawKw);
      if (meta?.originalTitle) {
        queryTerm = meta.originalTitle;
      }
    }

    let resp: YtsResponse | null = null;
    const fetchPromises = YTS_ENDPOINTS.map(async (endpoint) => {
      const url = `${endpoint}?query_term=${encodeURIComponent(
        queryTerm
      )}&sort_by=seeds&limit=20`;
      const data = await ofetch<YtsResponse>(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        timeout: timeoutMs,
        retry: 0,
      });
      if (data?.status === "ok" && Array.isArray(data?.data?.movies)) {
        return data;
      }
      throw new Error("Invalid YTS response format");
    });

    try {
      resp = await Promise.any(fetchPromises);
    } catch {
      resp = null;
    }

    if (resp?.status !== "ok" || !Array.isArray(resp?.data?.movies)) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const movie of resp.data.movies) {
      if (!Array.isArray(movie.torrents) || movie.torrents.length === 0) continue;

      const baseTitle = movie.title_english || movie.title;
      const year = movie.year ? ` (${movie.year})` : "";

      for (const t of movie.torrents) {
        if (!t.hash) continue;
        // 过滤零做种死种
        if (typeof t.seeds === "number" && t.seeds <= 0) continue;

        const zhPrefix = /[\u4e00-\u9fa5]/.test(rawKw) ? `【${rawKw}】` : "";
        const releaseTitle = `${zhPrefix}${baseTitle}${year} [${t.quality.toUpperCase()}] [${(t.type || "BluRay").toUpperCase()}] [YTS]`;
        const magnetUrl = buildYtsMagnet(t.hash, releaseTitle);

        const tags: string[] = ["YTS", t.quality.toUpperCase(), "BT磁力"];
        if (t.seeds > 0) {
          tags.push(`做种:${t.seeds}`);
        }
        if (t.size) {
          tags.push(t.size);
        }

        results.push({
          message_id: `yts-${movie.id}-${t.quality}-${t.hash.slice(0, 8)}`,
          unique_id: `yts-${t.hash.toLowerCase()}`,
          channel: "YTS",
          datetime: t.date_uploaded || (movie.year ? `${movie.year}-01-01 00:00:00` : undefined),
          title: releaseTitle,
          content: `【YTS 蓝光高清】${rawKw ? `关联影视: ${rawKw} | ` : ""}做种健康度: ${t.seeds} Seeds / ${t.peers} Peers | 文件体积: ${t.size} | IMDb评分: ${movie.rating || "N/A"}`,
          links: [
            {
              type: "magnet",
              url: magnetUrl,
            },
          ],
          tags,
        });
      }
    }

    return results;
  }
}

registerGlobalPlugin(new YtsPlugin());
