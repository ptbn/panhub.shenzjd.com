/**
 * 豆瓣影视多维探索服务 (Douban Explore Service)
 * 采用豆瓣官方探索 API (/j/new_search_subjects)，支持按大类、题材、年份区间、评分区间、排序规则进行多维检索
 */

import { ofetch } from "ofetch";
import { MemoryCache } from "../cache/memoryCache";

export interface DoubanExploreQuery {
  type?: string; // 电影 | 电视剧 | 动漫 | 纪录片 | 综艺 | all
  genre?: string; // 科幻 | 悬疑 | 动作 | 喜剧 | 爱情 | 犯罪 | 惊悚 | 恐怖 | 战争 | 动画 | 奇幻 | 冒险 | 灾难 | all
  yearRange?: string; // 2024-2025 | 2020-2023 | 2010-2019 | 2000-2009 | before-2000 | all
  scoreRange?: string; // 9-10 | 8-10 | 7-10 | all
  sort?: string; // U (近期热门) | S (评分最高) | R (最新上映) | T (标记最多)
  page?: number;
  limit?: number;
}

export interface DoubanExploreItem {
  id: string;
  title: string;
  rate: string;
  cover: string;
  url: string;
  directors: string[];
  casts: string[];
  star?: string;
}

export interface DoubanExploreResult {
  items: DoubanExploreItem[];
  hasMore: boolean;
  page: number;
  limit: number;
  query: DoubanExploreQuery;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时内存缓存
const DOUBAN_EXPLORE_BASE = "https://movie.douban.com/j/new_search_subjects";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// 初始化探索缓存（最多缓存 200 组筛选结果）
export const exploreCache = new MemoryCache<DoubanExploreResult>({
  maxSize: 200,
  maxMemoryBytes: 32 * 1024 * 1024,
});

/**
 * 解析各种格式的年代字符串为 { startYear, endYear }
 */
export function parseYearRange(rangeKey?: string): { startYear: number; endYear: number } | null {
  if (!rangeKey || rangeKey === "all") return null;
  if (rangeKey === "before-2000") return { startYear: 1920, endYear: 1999 };
  if (/^\d{4}$/.test(rangeKey)) {
    const y = parseInt(rangeKey, 10);
    return { startYear: y, endYear: y };
  }
  const match = rangeKey.match(/^(\d{4})-(\d{4})$/);
  if (match) {
    return { startYear: parseInt(match[1], 10), endYear: parseInt(match[2], 10) };
  }
  return null;
}

export interface FallbackSeedItem extends DoubanExploreItem {
  category: "电影" | "电视剧" | "动画" | "纪录片" | "综艺";
  genres: string[];
  year: number;
  score: number;
}

/**
 * 生产级保底影视种子片库 (覆盖全类别、全年代、高分口碑，杜绝上游限流或网络抖动时页面空白)
 */
export const FALLBACK_EXPLORE_SEEDS: FallbackSeedItem[] = [
  // 电影
  {
    id: "35811064",
    title: "欢迎来龙餐馆",
    rate: "8.7",
    score: 8.7,
    year: 2026,
    category: "电影",
    genres: ["喜剧", "剧情"],
    directors: ["文牧野"],
    casts: ["沈腾", "蒋奇明", "奥马尔·谢里夫", "李治廷"],
    cover: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2935109312.jpg",
    url: "https://movie.douban.com/subject/35811064/",
    star: "45",
  },
  {
    id: "36808876",
    title: "奥德赛",
    rate: "8.6",
    score: 8.6,
    year: 2026,
    category: "电影",
    genres: ["科幻", "冒险"],
    directors: ["克里斯托弗·诺兰"],
    casts: ["马特·达蒙", "汤姆·霍兰德", "安妮·海瑟薇", "罗伯特·帕丁森"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2933569626.jpg",
    url: "https://movie.douban.com/subject/36808876/",
    star: "45",
  },
  {
    id: "1889243",
    title: "星际穿越",
    rate: "9.4",
    score: 9.4,
    year: 2014,
    category: "电影",
    genres: ["科幻", "冒险"],
    directors: ["克里斯托弗·诺兰"],
    casts: ["马修·麦康纳", "安妮·海瑟薇", "杰西卡·查斯坦"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2614988097.jpg",
    url: "https://movie.douban.com/subject/1889243/",
    star: "50",
  },
  {
    id: "3541415",
    title: "盗梦空间",
    rate: "9.4",
    score: 9.4,
    year: 2010,
    category: "电影",
    genres: ["科幻", "悬疑", "动作"],
    directors: ["克里斯托弗·诺兰"],
    casts: ["莱昂纳多·迪卡普里奥", "约瑟夫·高登-莱维特", "艾利奥特·佩吉"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2616355133.jpg",
    url: "https://movie.douban.com/subject/3541415/",
    star: "50",
  },
  {
    id: "1292052",
    title: "肖申克的救赎",
    rate: "9.7",
    score: 9.7,
    year: 1994,
    category: "电影",
    genres: ["剧情", "犯罪"],
    directors: ["弗兰克·德拉邦特"],
    casts: ["蒂姆·罗宾斯", "摩根·弗里曼", "鲍勃·冈顿"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg",
    url: "https://movie.douban.com/subject/1292052/",
    star: "50",
  },
  {
    id: "1292722",
    title: "泰坦尼克号",
    rate: "9.5",
    score: 9.5,
    year: 1997,
    category: "电影",
    genres: ["爱情", "灾难"],
    directors: ["詹姆斯·卡梅隆"],
    casts: ["莱昂纳多·迪卡普里奥", "凯特·温丝莱特", "比利·赞恩"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2889314814.jpg",
    url: "https://movie.douban.com/subject/1292722/",
    star: "50",
  },
  {
    id: "1291546",
    title: "霸王别姬",
    rate: "9.6",
    score: 9.6,
    year: 1993,
    category: "电影",
    genres: ["剧情", "爱情"],
    directors: ["陈凯歌"],
    casts: ["张国荣", "张丰毅", "巩俐", "葛优"],
    cover: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2561716440.jpg",
    url: "https://movie.douban.com/subject/1291546/",
    star: "50",
  },
  {
    id: "1292064",
    title: "楚门的世界",
    rate: "9.4",
    score: 9.4,
    year: 1998,
    category: "电影",
    genres: ["剧情", "科幻"],
    directors: ["彼得·威尔"],
    casts: ["金·凯瑞", "劳拉·琳妮", "艾德·哈里斯"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p479682972.jpg",
    url: "https://movie.douban.com/subject/1292064/",
    star: "50",
  },
  {
    id: "1851857",
    title: "蝙蝠侠：黑暗骑士",
    rate: "9.2",
    score: 9.2,
    year: 2008,
    category: "电影",
    genres: ["动作", "犯罪", "惊悚"],
    directors: ["克里斯托弗·诺兰"],
    casts: ["克里斯蒂安·贝尔", "希斯·莱杰", "阿伦·艾克哈特"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2898797305.jpg",
    url: "https://movie.douban.com/subject/1851857/",
    star: "45",
  },
  {
    id: "35267208",
    title: "流浪地球2",
    rate: "8.3",
    score: 8.3,
    year: 2023,
    category: "电影",
    genres: ["科幻", "冒险", "灾难"],
    directors: ["郭帆"],
    casts: ["吴京", "刘德华", "李雪健", "沙溢"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2886400685.jpg",
    url: "https://movie.douban.com/subject/35267208/",
    star: "40",
  },
  {
    id: "26340419",
    title: "封神第一部：朝歌风云",
    rate: "7.8",
    score: 7.8,
    year: 2023,
    category: "电影",
    genres: ["动作", "战争", "奇幻"],
    directors: ["乌尔善"],
    casts: ["费翔", "李雪健", "黄渤", "于适"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2895690920.jpg",
    url: "https://movie.douban.com/subject/26340419/",
    star: "40",
  },
  {
    id: "3742360",
    title: "让子弹飞",
    rate: "9.0",
    score: 9.0,
    year: 2010,
    category: "电影",
    genres: ["剧情", "喜剧", "动作"],
    directors: ["姜文"],
    casts: ["姜文", "葛优", "周润发", "刘嘉玲"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p1512562287.jpg",
    url: "https://movie.douban.com/subject/3742360/",
    star: "45",
  },
  {
    id: "1307914",
    title: "无间道",
    rate: "9.3",
    score: 9.3,
    year: 2002,
    category: "电影",
    genres: ["剧情", "惊悚", "犯罪"],
    directors: ["刘伟强", "麦兆辉"],
    casts: ["刘德华", "梁朝伟", "黄秋生", "曾志伟"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2564556863.jpg",
    url: "https://movie.douban.com/subject/1307914/",
    star: "45",
  },
  // 电视剧
  {
    id: "35465271",
    title: "狂飙",
    rate: "8.5",
    score: 8.5,
    year: 2023,
    category: "电视剧",
    genres: ["剧情", "犯罪", "悬疑"],
    directors: ["徐纪周"],
    casts: ["张译", "张颂文", "李一桐", "张志坚"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2886470381.jpg",
    url: "https://movie.douban.com/subject/35465271/",
    star: "45",
  },
  {
    id: "35051512",
    title: "繁花",
    rate: "8.7",
    score: 8.7,
    year: 2023,
    category: "电视剧",
    genres: ["剧情", "爱情"],
    directors: ["王家卫"],
    casts: ["胡歌", "马伊琍", "唐嫣", "辛芷蕾"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2901968858.jpg",
    url: "https://movie.douban.com/subject/35051512/",
    star: "45",
  },
  {
    id: "35699104",
    title: "漫长的季节",
    rate: "9.4",
    score: 9.4,
    year: 2023,
    category: "电视剧",
    genres: ["剧情", "悬疑", "犯罪"],
    directors: ["辛爽"],
    casts: ["范伟", "秦昊", "陈明昊", "李庚希"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2890691500.jpg",
    url: "https://movie.douban.com/subject/35699104/",
    star: "50",
  },
  {
    id: "26647087",
    title: "三体",
    rate: "8.7",
    score: 8.7,
    year: 2023,
    category: "电视剧",
    genres: ["剧情", "科幻", "悬疑"],
    directors: ["杨磊"],
    casts: ["张鲁一", "于和伟", "陈瑾", "王子文"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2886483582.jpg",
    url: "https://movie.douban.com/subject/26647087/",
    star: "45",
  },
  {
    id: "34937650",
    title: "庆余年 第二季",
    rate: "7.3",
    score: 7.3,
    year: 2024,
    category: "电视剧",
    genres: ["剧情", "喜剧"],
    directors: ["孙皓"],
    casts: ["张若昀", "李沁", "陈道明", "吴刚"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2908129854.jpg",
    url: "https://movie.douban.com/subject/34937650/",
    star: "40",
  },
  {
    id: "26244438",
    title: "庆余年",
    rate: "7.9",
    score: 7.9,
    year: 2019,
    category: "电视剧",
    genres: ["剧情", "喜剧"],
    directors: ["孙皓"],
    casts: ["张若昀", "李沁", "陈道明", "吴刚"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2574972583.jpg",
    url: "https://movie.douban.com/subject/26244438/",
    star: "40",
  },
  {
    id: "30228394",
    title: "觉醒年代",
    rate: "9.3",
    score: 9.3,
    year: 2021,
    category: "电视剧",
    genres: ["剧情", "历史"],
    directors: ["张永新"],
    casts: ["于和伟", "张桐", "侯京健", "马少骅"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2632264843.jpg",
    url: "https://movie.douban.com/subject/30228394/",
    star: "45",
  },
  {
    id: "2210001",
    title: "大明王朝1566",
    rate: "9.8",
    score: 9.8,
    year: 2007,
    category: "电视剧",
    genres: ["剧情", "历史"],
    directors: ["张黎"],
    casts: ["陈宝国", "黄志忠", "倪大红", "王庆祥"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2449542273.jpg",
    url: "https://movie.douban.com/subject/2210001/",
    star: "50",
  },
  // 动画 / 动漫
  {
    id: "1291560",
    title: "千与千寻",
    rate: "9.4",
    score: 9.4,
    year: 2001,
    category: "动画",
    genres: ["动画", "奇幻", "冒险"],
    directors: ["宫崎骏"],
    casts: ["柊瑠美", "入野自由", "夏木真理"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2557573348.jpg",
    url: "https://movie.douban.com/subject/1291560/",
    star: "50",
  },
  {
    id: "30211551",
    title: "鬼灭之刃",
    rate: "9.1",
    score: 9.1,
    year: 2019,
    category: "动画",
    genres: ["动画", "动作", "奇幻"],
    directors: ["外崎春雄"],
    casts: ["花江夏树", "鬼头明里", "下野纮"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2551061989.jpg",
    url: "https://movie.douban.com/subject/30211551/",
    star: "45",
  },
  {
    id: "20427187",
    title: "进击的巨人 第一季",
    rate: "9.6",
    score: 9.6,
    year: 2013,
    category: "动画",
    genres: ["动画", "动作", "科幻"],
    directors: ["荒木哲郎"],
    casts: ["梶裕贵", "石川由依", "井上麻里奈"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2570078026.jpg",
    url: "https://movie.douban.com/subject/20427187/",
    star: "50",
  },
  {
    id: "35653765",
    title: "间谍过家家",
    rate: "8.9",
    score: 8.9,
    year: 2022,
    category: "动画",
    genres: ["动画", "喜剧", "动作"],
    directors: ["古桥一浩"],
    casts: ["江口拓也", "早见沙织", "种崎敦美"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2870420790.jpg",
    url: "https://movie.douban.com/subject/35653765/",
    star: "45",
  },
  {
    id: "1424406",
    title: "星际牛仔",
    rate: "9.6",
    score: 9.6,
    year: 1998,
    category: "动画",
    genres: ["动画", "动作", "科幻"],
    directors: ["渡边信一郎"],
    casts: ["山寺宏一", "石冢运升", "林原惠美"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2546419747.jpg",
    url: "https://movie.douban.com/subject/1424406/",
    star: "50",
  },
  {
    id: "1291561",
    title: "龙猫",
    rate: "9.2",
    score: 9.2,
    year: 1988,
    category: "动画",
    genres: ["动画", "奇幻", "冒险"],
    directors: ["宫崎骏"],
    casts: ["日高法子", "坂本千夏", "糸井重里"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2540924496.jpg",
    url: "https://movie.douban.com/subject/1291561/",
    star: "45",
  },
  // 纪录片
  {
    id: "26743369",
    title: "地球脉动 第二季",
    rate: "9.8",
    score: 9.8,
    year: 2016,
    category: "纪录片",
    genres: ["纪录片"],
    directors: ["贾斯汀·安德森"],
    casts: ["大卫·爱登堡"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2397446545.jpg",
    url: "https://movie.douban.com/subject/26743369/",
    star: "50",
  },
  {
    id: "26979545",
    title: "蓝色星球 第二季",
    rate: "9.8",
    score: 9.8,
    year: 2017,
    category: "纪录片",
    genres: ["纪录片"],
    directors: ["詹姆斯·霍尼伯内"],
    casts: ["大卫·爱登堡"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2503259900.jpg",
    url: "https://movie.douban.com/subject/26979545/",
    star: "50",
  },
  {
    id: "26338006",
    title: "河西走廊",
    rate: "9.7",
    score: 9.7,
    year: 2015,
    category: "纪录片",
    genres: ["纪录片", "历史"],
    directors: ["王鹏"],
    casts: ["吕树延"],
    cover: "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2231922971.jpg",
    url: "https://movie.douban.com/subject/26338006/",
    star: "50",
  },
  // 综艺
  {
    id: "35581176",
    title: "一年一度喜剧大赛",
    rate: "8.5",
    score: 8.5,
    year: 2021,
    category: "综艺",
    genres: ["喜剧", "真人秀"],
    directors: ["李睿"],
    casts: ["马东", "黄渤", "李诞", "徐峥"],
    cover: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2707246286.jpg",
    url: "https://movie.douban.com/subject/35581176/",
    star: "45",
  },
  {
    id: "30458632",
    title: "乐队的夏天 第一季",
    rate: "8.7",
    score: 8.7,
    year: 2019,
    category: "综艺",
    genres: ["音乐", "真人秀"],
    directors: ["李睿"],
    casts: ["吴青峰", "欧阳娜娜", "张亚东", "高晓松"],
    cover: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2557343717.jpg",
    url: "https://movie.douban.com/subject/30458632/",
    star: "45",
  },
];

/**
 * 当豆瓣上游因限流/网络阻断或分类召回为空时，进行多维保底种子片库的内存过滤与分页
 */
export function filterFallbackSeeds(query: DoubanExploreQuery): DoubanExploreResult {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(5, query.limit || 20));
  const start = (page - 1) * limit;

  // 1. 类型过滤（支持 "动漫" 映射到 "动画"）
  const queryType =
    query.type && query.type !== "all"
      ? query.type === "动漫"
        ? "动画"
        : query.type
      : null;

  // 2. 题材过滤
  const queryGenre = query.genre && query.genre !== "all" ? query.genre : null;

  // 3. 年代过滤
  const parsedYear = parseYearRange(query.yearRange);

  // 4. 评分过滤
  let minScore = 0;
  let maxScore = 10;
  if (query.scoreRange === "9-10") minScore = 9.0;
  else if (query.scoreRange === "8-10") minScore = 8.0;
  else if (query.scoreRange === "7-10") minScore = 7.0;

  let filtered = FALLBACK_EXPLORE_SEEDS.filter((item) => {
    if (queryType && item.category !== queryType) return false;
    if (queryGenre && !item.genres.includes(queryGenre)) return false;
    if (parsedYear && (item.year < parsedYear.startYear || item.year > parsedYear.endYear)) {
      return false;
    }
    if (item.score < minScore || item.score > maxScore) return false;
    return true;
  });

  // 5. 排序映射
  const sort = query.sort || "U";
  if (sort === "S") {
    filtered.sort((a, b) => b.score - a.score);
  } else if (sort === "R") {
    filtered.sort((a, b) => b.year - a.year);
  }

  const items: DoubanExploreItem[] = filtered.slice(start, start + limit).map((s) => ({
    id: s.id,
    title: s.title,
    rate: s.rate,
    cover: s.cover,
    url: s.url,
    directors: s.directors,
    casts: s.casts,
    star: s.star,
  }));

  return {
    items,
    hasMore: start + limit < filtered.length,
    page,
    limit,
    query: {
      type: query.type || "all",
      genre: query.genre || "all",
      yearRange: query.yearRange || "all",
      scoreRange: query.scoreRange || "all",
      sort,
    },
  };
}

/**
 * 构建向豆瓣发起请求的 URL 与参数
 */
export function buildDoubanExploreUrl(query: DoubanExploreQuery): string {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(5, query.limit || 20));
  const start = (page - 1) * limit;

  // 1. 组装 tags（自动适配豆瓣动画规范）
  const tags: string[] = [];
  if (query.type && query.type !== "all") {
    const mappedType = query.type === "动漫" ? "动画" : query.type;
    tags.push(mappedType);
  }
  if (query.genre && query.genre !== "all") {
    tags.push(query.genre);
  }

  // 2. 映射评分区间
  let range = "0,10";
  if (query.scoreRange === "9-10") range = "9,10";
  else if (query.scoreRange === "8-10") range = "8,10";
  else if (query.scoreRange === "7-10") range = "7,10";

  // 3. 映射年份区间
  let yearRangeParam = "";
  if (query.yearRange && query.yearRange !== "all") {
    const parsedYear = parseYearRange(query.yearRange);
    if (parsedYear) {
      yearRangeParam = `${parsedYear.startYear},${parsedYear.endYear}`;
    }
  }

  // 4. 排序模式
  const sort = query.sort && ["U", "S", "R", "T"].includes(query.sort) ? query.sort : "U";

  const params = new URLSearchParams();
  params.set("sort", sort);
  params.set("range", range);
  if (tags.length > 0) {
    params.set("tags", tags.join(","));
  }
  if (yearRangeParam) {
    params.set("year_range", yearRangeParam);
  }
  params.set("start", String(start));
  params.set("limit", String(limit));

  return `${DOUBAN_EXPLORE_BASE}?${params.toString()}`;
}

/**
 * 执行豆瓣影视多维检索
 */
export async function fetchDoubanExplore(
  query: DoubanExploreQuery = {}
): Promise<DoubanExploreResult> {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(5, query.limit || 20));

  const normalizedQuery: DoubanExploreQuery = {
    type: query.type || "all",
    genre: query.genre || "all",
    yearRange: query.yearRange || "all",
    scoreRange: query.scoreRange || "all",
    sort: query.sort || "U",
    page,
    limit,
  };

  const cacheKey = `douban-explore:${normalizedQuery.type}:${normalizedQuery.genre}:${normalizedQuery.yearRange}:${normalizedQuery.scoreRange}:${normalizedQuery.sort}:${page}:${limit}`;

  // 检查内存缓存
  const cached = exploreCache.get(cacheKey);
  if (cached.hit && cached.value && cached.value.items && cached.value.items.length > 0) {
    return cached.value;
  }

  const url = buildDoubanExploreUrl(normalizedQuery);

  try {
    const rawData = await ofetch<{ data?: any[] }>(url, {
      headers: {
        "User-Agent": UA,
        Referer: "https://movie.douban.com/explore",
      },
      timeout: 8000,
    });

    const rawItems = Array.isArray(rawData?.data) ? rawData.data : [];
    const items: DoubanExploreItem[] = rawItems.map((item: any) => ({
      id: String(item.id || ""),
      title: String(item.title || "").trim(),
      rate: String(item.rate || "0.0"),
      cover: String(item.cover || ""),
      url: String(item.url || (item.id ? `https://movie.douban.com/subject/${item.id}/` : "")),
      directors: Array.isArray(item.directors) ? item.directors : [],
      casts: Array.isArray(item.casts) ? item.casts : [],
      star: String(item.star || ""),
    }));

    if (items.length === 0) {
      // 若豆瓣上游返回空结果，激活保底种子片库
      const fallbackResult = filterFallbackSeeds(normalizedQuery);
      if (fallbackResult.items.length > 0) {
        return fallbackResult;
      }
    }

    const result: DoubanExploreResult = {
      items,
      hasMore: items.length >= limit,
      page,
      limit,
      query: normalizedQuery,
    };

    if (items.length > 0) {
      exploreCache.set(cacheKey, result, CACHE_TTL_MS);
    }

    return result;
  } catch (err: any) {
    console.warn(`[DoubanExplore] 请求失败 (${url}):`, err?.message || err);
    // 优雅降级返回保底种子片库，杜绝页面一片空白
    return filterFallbackSeeds(normalizedQuery);
  }
}
