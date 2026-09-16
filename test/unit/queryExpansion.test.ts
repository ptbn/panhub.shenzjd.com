import { describe, it, expect } from "vitest";
import { resolveEnglishTitle } from "../../server/core/utils/queryExpansion";

describe("元数据智能对齐引擎 - queryExpansion", () => {
  it("纯英文或数字应当直接跳过（返回 null），无需多余解析", async () => {
    expect(await resolveEnglishTitle("Interstellar")).toBeNull();
    expect(await resolveEnglishTitle("2024")).toBeNull();
    expect(await resolveEnglishTitle("   ")).toBeNull();
  });

  it("常见中文热门电影应能正确解析出对应的原版英文名与年份", async () => {
    const meta = await resolveEnglishTitle("星际穿越");
    expect(meta).not.toBeNull();
    expect(meta?.originalTitle?.toLowerCase()).toContain("interstellar");
    expect(meta?.year).toBe("2014");
  });

  it("多次查询相同词应当命中内存缓存", async () => {
    const start = Date.now();
    const meta1 = await resolveEnglishTitle("奥本海默");
    const mid = Date.now();
    const meta2 = await resolveEnglishTitle("奥本海默");
    const end = Date.now();

    expect(meta1).not.toBeNull();
    expect(meta2).toEqual(meta1);
    // 第二次缓存命中耗时应当极短 (< 5ms)
    expect(end - mid).toBeLessThan(10);
  });

  it("典藏高频大片与动漫番剧应能快速命中并精准返回原版标题与年份", async () => {
    const shawshank = await resolveEnglishTitle("肖申克的救赎");
    expect(shawshank).not.toBeNull();
    expect(shawshank?.originalTitle).toBe("The Shawshank Redemption");
    expect(shawshank?.year).toBe("1994");

    const demonSlayer = await resolveEnglishTitle("鬼灭之刃");
    expect(demonSlayer).not.toBeNull();
    expect(demonSlayer?.originalTitle).toBe("Demon Slayer");
    expect(demonSlayer?.type).toBe("tv");

    const spyFamily = await resolveEnglishTitle("间谍过家家");
    expect(spyFamily).not.toBeNull();
    expect(spyFamily?.originalTitle).toBe("SPY×FAMILY");

    const titan = await resolveEnglishTitle("进击的巨人");
    expect(titan).not.toBeNull();
    expect(titan?.originalTitle).toBe("Attack on Titan");
  });

  it("未知或生僻中文输入应优雅降级返回 null 并记录空缓存", async () => {
    const unknown = await resolveEnglishTitle("某某完全不存在的生僻长篇小说电影版9999");
    expect(unknown).toBeNull();

    // 再次查询立即从空缓存返回
    const start = Date.now();
    const cachedUnknown = await resolveEnglishTitle("某某完全不存在的生僻长篇小说电影版9999");
    const end = Date.now();
    expect(cachedUnknown).toBeNull();
    expect(end - start).toBeLessThan(10);
  });
});

