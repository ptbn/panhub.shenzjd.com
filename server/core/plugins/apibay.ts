import { BaseAsyncPlugin } from "./manager";
import type { SearchResult } from "../types/models";
import { ofetch } from "ofetch";
import { loggers } from "../utils/logger";
import { resolveEnglishTitle } from "../utils/queryExpansion";

interface ApiBayItem {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  size: string;
  status: string; // "vip" | "trusted" | "member"
  category: string;
  imdb?: string;
}

const APIBAY_BASE = "https://apibay.org/q.php";
const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce",
]
  .map((tr) => `tr=${encodeURIComponent(tr)}`)
  .join("&");

function formatBytes(bytesStr: string): string {
  const bytes = Number(bytesStr);
  if (!bytes || isNaN(bytes)) return "";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class ApiBayPlugin extends BaseAsyncPlugin {
  constructor() {
    super("apibay", 4);
  }

  override async search(
    keyword: string,
    ext?: Record<string, any>
  ): Promise<SearchResult[]> {
    const rawKw = (keyword || "").trim();
    if (!rawKw) return [];

    const timeout = Math.min(
      2500,
      Math.max(1000, Number((ext as any)?.__plugin_timeout_ms) || 2500)
    );

    // 1. 智能元数据扩展：若是中文片名，优先转为原版英文名称检索以命中全球资源
    let searchTerms = [rawKw];
    if (/[\u4e00-\u9fa5]/.test(rawKw)) {
      const meta = await resolveEnglishTitle(rawKw);
      if (meta?.originalTitle) {
        searchTerms = [meta.originalTitle, rawKw];
      }
    }

    const out: SearchResult[] = [];
    const seenHashes = new Set<string>();

    for (const term of searchTerms) {
      if (out.length >= 15) break;

      try {
        const url = `${APIBAY_BASE}?q=${encodeURIComponent(term)}`;
        const list = await ofetch<ApiBayItem[]>(url, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          timeout,
        });

        if (!Array.isArray(list)) continue;

        // 过滤无结果标记与 0 做种死种
        const validItems = list.filter(
          (item) =>
            item &&
            item.id !== "0" &&
            item.info_hash &&
            Number(item.seeders) > 0 &&
            !seenHashes.has(item.info_hash.toLowerCase())
        );

        // 优先收录 VIP/Trusted 认证发布者，按做种数倒序
        validItems.sort((a, b) => {
          const scoreA =
            (a.status === "vip" ? 2000 : a.status === "trusted" ? 1000 : 0) +
            (Number(a.seeders) || 0);
          const scoreB =
            (b.status === "vip" ? 2000 : b.status === "trusted" ? 1000 : 0) +
            (Number(b.seeders) || 0);
          return scoreB - scoreA;
        });

        for (const item of validItems.slice(0, 15)) {
          seenHashes.add(item.info_hash.toLowerCase());
          const sizeText = formatBytes(item.size);
          const seedText = `🔥 做种: ${item.seeders} | 下载: ${item.leechers}`;
          const badge =
            item.status === "vip"
              ? "[VIP认证] "
              : item.status === "trusted"
              ? "[信任认证] "
              : "";

          const zhPrefix = /[\u4e00-\u9fa5]/.test(rawKw) ? `【${rawKw}】` : "";
          const magnet = `magnet:?xt=urn:btih:${item.info_hash.toLowerCase()}&dn=${encodeURIComponent(
            item.name
          )}&${DEFAULT_TRACKERS}`;

          out.push({
            message_id: "",
            unique_id: `apibay-${item.info_hash.toLowerCase()}`,
            channel: "ApiBay (海盗湾开源)",
            datetime: new Date().toISOString(),
            title: `${zhPrefix}${badge}${item.name}${sizeText ? ` [${sizeText}]` : ""}`,
            content: `${seedText}${rawKw ? ` | 关联影视: ${rawKw}` : ""}${item.imdb ? ` | IMDb: ${item.imdb}` : ""}`,
            links: [{ type: "magnet", url: magnet, password: "" }],
          });
        }
      } catch (err: any) {
        loggers.plugin.debug("ApiBay 检索跳过或超时", {
          term,
          error: err?.message,
        });
      }
    }

    return out;
  }
}
