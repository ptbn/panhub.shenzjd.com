import { ofetch } from "ofetch";
import { loggers } from "./logger";

export interface ExpandedMeta {
  chineseTitle: string;
  originalTitle: string;
  year?: string;
  type?: string;
}

interface CacheEntry {
  meta: ExpandedMeta | null;
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时缓存
const MAX_CACHE_SIZE = 500;
const memoryCache = new Map<string, CacheEntry>();

/**
 * 经典高频影视及动漫典藏字典 (Top 60)
 * 具备 0ms 瞬间直出能力，确保无外网/CI/反爬阻断时绝对可靠确定性命中
 */
export const STATIC_MEDIA_FALLBACKS: Record<string, ExpandedMeta> = {
  // 经典大片与奥斯卡常青树
  "星际穿越": { chineseTitle: "星际穿越", originalTitle: "Interstellar", year: "2014", type: "movie" },
  "奥本海默": { chineseTitle: "奥本海默", originalTitle: "Oppenheimer", year: "2023", type: "movie" },
  "盗梦空间": { chineseTitle: "盗梦空间", originalTitle: "Inception", year: "2010", type: "movie" },
  "黑客帝国": { chineseTitle: "黑客帝国", originalTitle: "The Matrix", year: "1999", type: "movie" },
  "阿凡达": { chineseTitle: "阿凡达", originalTitle: "Avatar", year: "2009", type: "movie" },
  "肖申克的救赎": { chineseTitle: "肖申克的救赎", originalTitle: "The Shawshank Redemption", year: "1994", type: "movie" },
  "霸王别姬": { chineseTitle: "霸王别姬", originalTitle: "Farewell My Concubine", year: "1993", type: "movie" },
  "泰坦尼克号": { chineseTitle: "泰坦尼克号", originalTitle: "Titanic", year: "1997", type: "movie" },
  "千与千寻": { chineseTitle: "千与千寻", originalTitle: "Spirited Away", year: "2001", type: "movie" },
  "这个杀手不太冷": { chineseTitle: "这个杀手不太冷", originalTitle: "Léon", year: "1994", type: "movie" },
  "楚门的世界": { chineseTitle: "楚门的世界", originalTitle: "The Truman Show", year: "1998", type: "movie" },
  "蝙蝠侠": { chineseTitle: "蝙蝠侠", originalTitle: "The Dark Knight", year: "2008", type: "movie" },
  "黑暗骑士": { chineseTitle: "黑暗骑士", originalTitle: "The Dark Knight", year: "2008", type: "movie" },
  "教父": { chineseTitle: "教父", originalTitle: "The Godfather", year: "1972", type: "movie" },
  "指环王": { chineseTitle: "指环王", originalTitle: "The Lord of the Rings", year: "2001", type: "movie" },
  "魔戒": { chineseTitle: "魔戒", originalTitle: "The Lord of the Rings", year: "2001", type: "movie" },
  "辛德勒的名单": { chineseTitle: "辛德勒的名单", originalTitle: "Schindler's List", year: "1993", type: "movie" },
  "机器人总动员": { chineseTitle: "机器人总动员", originalTitle: "WALL-E", year: "2008", type: "movie" },
  "疯狂动物城": { chineseTitle: "疯狂动物城", originalTitle: "Zootopia", year: "2016", type: "movie" },
  "寻梦环游记": { chineseTitle: "寻梦环游记", originalTitle: "Coco", year: "2017", type: "movie" },
  "沙丘": { chineseTitle: "沙丘", originalTitle: "Dune", year: "2021", type: "movie" },
  "沙丘2": { chineseTitle: "沙丘2", originalTitle: "Dune: Part Two", year: "2024", type: "movie" },
  "瞬息全宇宙": { chineseTitle: "瞬息全宇宙", originalTitle: "Everything Everywhere All at Once", year: "2022", type: "movie" },
  "蜘蛛侠": { chineseTitle: "蜘蛛侠", originalTitle: "Spider-Man", year: "2002", type: "movie" },
  "钢铁侠": { chineseTitle: "钢铁侠", originalTitle: "Iron Man", year: "2008", type: "movie" },
  "复仇者联盟": { chineseTitle: "复仇者联盟", originalTitle: "The Avengers", year: "2012", type: "movie" },
  "寄生虫": { chineseTitle: "寄生虫", originalTitle: "Parasite", year: "2019", type: "movie" },
  "绿皮书": { chineseTitle: "绿皮书", originalTitle: "Green Book", year: "2018", type: "movie" },
  "少年派的奇幻漂流": { chineseTitle: "少年派的奇幻漂流", originalTitle: "Life of Pi", year: "2012", type: "movie" },
  "搏击俱乐部": { chineseTitle: "搏击俱乐部", originalTitle: "Fight Club", year: "1999", type: "movie" },
  "飞越疯人院": { chineseTitle: "飞越疯人院", originalTitle: "One Flew Over the Cuckoo's Nest", year: "1975", type: "movie" },
  "星球大战": { chineseTitle: "星球大战", originalTitle: "Star Wars", year: "1977", type: "movie" },
  "乱世佳人": { chineseTitle: "乱世佳人", originalTitle: "Gone with the Wind", year: "1939", type: "movie" },
  "罗马假日": { chineseTitle: "罗马假日", originalTitle: "Roman Holiday", year: "1953", type: "movie" },
  "角斗士": { chineseTitle: "角斗士", originalTitle: "Gladiator", year: "2000", type: "movie" },
  "狮子王": { chineseTitle: "狮子王", originalTitle: "The Lion King", year: "1994", type: "movie" },
  "拯救大兵瑞恩": { chineseTitle: "拯救大兵瑞恩", originalTitle: "Saving Private Ryan", year: "1998", type: "movie" },
  "闻香识女人": { chineseTitle: "闻香识女人", originalTitle: "Scent of a Woman", year: "1992", type: "movie" },
  "致命魔术": { chineseTitle: "致命魔术", originalTitle: "The Prestige", year: "2006", type: "movie" },
  "沉默的羔羊": { chineseTitle: "沉默的羔羊", originalTitle: "The Silence of the Lambs", year: "1991", type: "movie" },
  "禁闭岛": { chineseTitle: "禁闭岛", originalTitle: "Shutter Island", year: "2010", type: "movie" },
  "蝴蝶效应": { chineseTitle: "蝴蝶效应", originalTitle: "The Butterfly Effect", year: "2004", type: "movie" },
  "剪刀手爱德华": { chineseTitle: "剪刀手爱德华", originalTitle: "Edward Scissorhands", year: "1990", type: "movie" },

  // 经典热门剧集与全球现象级番剧
  "权力的游戏": { chineseTitle: "权力的游戏", originalTitle: "Game of Thrones", year: "2011", type: "tv" },
  "绝命毒师": { chineseTitle: "绝命毒师", originalTitle: "Breaking Bad", year: "2008", type: "tv" },
  "风骚律师": { chineseTitle: "风骚律师", originalTitle: "Better Call Saul", year: "2015", type: "tv" },
  "纸牌屋": { chineseTitle: "纸牌屋", originalTitle: "House of Cards", year: "2013", type: "tv" },
  "怪奇物语": { chineseTitle: "怪奇物语", originalTitle: "Stranger Things", year: "2016", type: "tv" },
  "老友记": { chineseTitle: "老友记", originalTitle: "Friends", year: "1994", type: "tv" },
  "进击的巨人": { chineseTitle: "进击的巨人", originalTitle: "Attack on Titan", year: "2013", type: "tv" },
  "鬼灭之刃": { chineseTitle: "鬼灭之刃", originalTitle: "Demon Slayer", year: "2019", type: "tv" },
  "咒术回战": { chineseTitle: "咒术回战", originalTitle: "Jujutsu Kaisen", year: "2020", type: "tv" },
  "间谍过家家": { chineseTitle: "间谍过家家", originalTitle: "SPY×FAMILY", year: "2022", type: "tv" },
  "链锯人": { chineseTitle: "链锯人", originalTitle: "Chainsaw Man", year: "2022", type: "tv" },
  "死亡笔记": { chineseTitle: "死亡笔记", originalTitle: "Death Note", year: "2006", type: "tv" },
  "钢之炼金术师": { chineseTitle: "钢之炼金术师", originalTitle: "Fullmetal Alchemist", year: "2009", type: "tv" },
  "火影忍者": { chineseTitle: "火影忍者", originalTitle: "Naruto", year: "2002", type: "tv" },
  "海贼王": { chineseTitle: "海贼王", originalTitle: "One Piece", year: "1999", type: "tv" },
  "名侦探柯南": { chineseTitle: "名侦探柯南", originalTitle: "Detective Conan", year: "1996", type: "tv" },
  "灌篮高手": { chineseTitle: "灌篮高手", originalTitle: "Slam Dunk", year: "1993", type: "tv" },
};

/**
 * 尝试从 TMDB 官方 API 获取影视英文名称（若配置 TMDB_API_KEY）
 */
async function fetchFromTmdb(keyword: string): Promise<ExpandedMeta | null> {
  const apiKey = process.env.TMDB_API_KEY || (globalThis as any)?.__ENV__?.TMDB_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(keyword)}&language=zh-CN`;
    const data = await ofetch<any>(url, {
      timeout: 1200,
      retry: 0,
      headers: { accept: "application/json" },
    });

    if (Array.isArray(data?.results) && data.results.length > 0) {
      for (const item of data.results.slice(0, 3)) {
        if (item.media_type !== "movie" && item.media_type !== "tv") continue;
        const orig = item.original_title || item.original_name;
        if (orig && /[a-zA-Z]{2,}/.test(orig)) {
          const releaseDate = item.release_date || item.first_air_date || "";
          const year = releaseDate ? releaseDate.split("-")[0] : undefined;
          return {
            chineseTitle: item.title || item.name || keyword,
            originalTitle: orig,
            year,
            type: item.media_type,
          };
        }
      }
    }
  } catch (err: any) {
    loggers.plugin.debug("TMDB 元数据对齐查询跳过", { keyword, error: err?.message });
  }

  return null;
}

/**
 * 优化版豆瓣 Suggest API（带防反爬 Referer 与快速超时熔断）
 */
async function fetchFromDouban(keyword: string): Promise<ExpandedMeta | null> {
  try {
    const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;
    const data = await ofetch<any[]>(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        referer: "https://movie.douban.com/",
        accept: "application/json, text/plain, */*",
      },
      timeout: 1500,
      retry: 0,
    });

    if (Array.isArray(data) && data.length > 0) {
      for (const item of data.slice(0, 3)) {
        const subTitle = typeof item.sub_title === "string" ? item.sub_title.trim() : "";
        if (subTitle && /[a-zA-Z]{2,}/.test(subTitle)) {
          return {
            chineseTitle: String(item.title || keyword),
            originalTitle: subTitle,
            year: item.year ? String(item.year) : undefined,
            type: item.type ? String(item.type) : undefined,
          };
        }
      }
    }
  } catch (err: any) {
    loggers.plugin.debug("豆瓣元数据对齐查询跳过", { keyword, error: err?.message });
  }

  return null;
}

/**
 * 智能元数据对齐（参考 Torrentio 核心机制）：
 * 若搜索词包含中文，且属于影视作品，自动利用轻量元数据接口提取其对应的原版英文名与年份
 *
 * 弹性对齐流程：
 * 1. 检查内存缓存 (24h)
 * 2. 命中高频典藏字典 (0ms，瞬间直出)
 * 3. TMDB 官方 API（若存在 TMDB_API_KEY，1200ms 快速熔断）
 * 4. 防反爬优化版 Douban Suggest（带 Referer 头，1500ms 快速熔断）
 * 5. 记录 null 缓存保底并返回 null
 */
export async function resolveEnglishTitle(keyword: string): Promise<ExpandedMeta | null> {
  const trimmed = keyword.trim();
  if (!trimmed) return null;

  // 仅在包含中文字符时尝试映射（纯英文/拼音无需映射）
  if (!/[\u4e00-\u9fa5]/.test(trimmed)) {
    return null;
  }

  const cacheKey = trimmed.toLowerCase();

  // 1. 检查内存缓存
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.meta;
  }

  // 2. 命中高频典藏字典（0ms 瞬间直出，离线网络/CI/反爬绝对可靠）
  const fallback = STATIC_MEDIA_FALLBACKS[trimmed];
  if (fallback) {
    if (memoryCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = memoryCache.keys().next().value;
      if (oldestKey) memoryCache.delete(oldestKey);
    }
    memoryCache.set(cacheKey, { meta: fallback, timestamp: Date.now() });
    return fallback;
  }

  // 3. 尝试 TMDB 官方 API
  const tmdbRes = await fetchFromTmdb(trimmed);
  if (tmdbRes) {
    if (memoryCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = memoryCache.keys().next().value;
      if (oldestKey) memoryCache.delete(oldestKey);
    }
    memoryCache.set(cacheKey, { meta: tmdbRes, timestamp: Date.now() });
    return tmdbRes;
  }

  // 4. 尝试优化版豆瓣 Suggest
  const doubanRes = await fetchFromDouban(trimmed);
  if (doubanRes) {
    if (memoryCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = memoryCache.keys().next().value;
      if (oldestKey) memoryCache.delete(oldestKey);
    }
    memoryCache.set(cacheKey, { meta: doubanRes, timestamp: Date.now() });
    return doubanRes;
  }

  // 5. 记录空结果缓存，防止对同一冷门词重复发起外部请求
  if (memoryCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(cacheKey, { meta: null, timestamp: Date.now() });
  return null;
}

