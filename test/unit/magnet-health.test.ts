import { describe, it, expect } from "vitest";
import { calculateMagnetMeta } from "../../server/core/utils/magnetHealth";
import { mergeMergedByType } from "../../utils/mergeMergedByType";
import type { MergedLinks } from "../../types/search";

describe("磁力健康度雷达 (Magnet Health Radar) 核心能力测试", () => {
  describe("calculateMagnetMeta 健康度评级断言", () => {
    it("做种数 >= 30 应当评为 hot (极速高速)", () => {
      const meta = calculateMagnetMeta(50, 10);
      expect(meta.healthLevel).toBe("hot");
      expect(meta.seeders).toBe(50);
      expect(meta.leechers).toBe(10);

      const meta30 = calculateMagnetMeta(30, 0);
      expect(meta30.healthLevel).toBe("hot");
    });

    it("做种数 5~29 应当评为 warm (良好顺畅)", () => {
      const meta = calculateMagnetMeta(15, 2);
      expect(meta.healthLevel).toBe("warm");
      expect(meta.seeders).toBe(15);

      const meta5 = calculateMagnetMeta(5, 5);
      expect(meta5.healthLevel).toBe("warm");
    });

    it("做种数 1~4 应当评为 cold (稀少冷门)", () => {
      const meta = calculateMagnetMeta(1, 0);
      expect(meta.healthLevel).toBe("cold");
      expect(meta.seeders).toBe(1);

      const meta4 = calculateMagnetMeta(4, 2);
      expect(meta4.healthLevel).toBe("cold");
    });

    it("做种数 === 0 应当评为 dead (失效死种)", () => {
      const meta = calculateMagnetMeta(0, 5);
      expect(meta.healthLevel).toBe("dead");
      expect(meta.seeders).toBe(0);
      expect(meta.leechers).toBe(5);
    });

    it("容错能力：支持字符串格式的数值解析并优雅处理非法值", () => {
      const metaStr = calculateMagnetMeta("120", "30");
      expect(metaStr.healthLevel).toBe("hot");
      expect(metaStr.seeders).toBe(120);

      const metaZeroStr = calculateMagnetMeta("0", "0");
      expect(metaZeroStr.healthLevel).toBe("dead");

      const metaInvalid = calculateMagnetMeta("invalid", null);
      expect(metaInvalid.seeders).toBeUndefined();
      expect(metaInvalid.healthLevel).toBe("cold");
    });
  });

  describe("mergeMergedByType 磁力元数据透传与择优合并", () => {
    it("新条目包含 magnetMeta 时应当完整保留到合并结果中", () => {
      const target: MergedLinks = {};
      const incoming: MergedLinks = {
        magnet: [
          {
            url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
            password: "",
            note: "星际穿越 4K REMUX",
            datetime: "2026-09-16T12:00:00Z",
            magnetMeta: {
              seeders: 88,
              leechers: 12,
              healthLevel: "hot",
            },
          },
        ],
      };

      const res = mergeMergedByType(target, incoming);
      expect(res.magnet).toHaveLength(1);
      expect(res.magnet[0].magnetMeta).toBeDefined();
      expect(res.magnet[0].magnetMeta?.healthLevel).toBe("hot");
      expect(res.magnet[0].magnetMeta?.seeders).toBe(88);
    });

    it("当遇到相同资源但新条目做种数更高时，应择优更新为更高健康度", () => {
      const target: MergedLinks = {
        magnet: [
          {
            url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
            password: "",
            note: "星际穿越 4K REMUX",
            datetime: "2026-09-16T12:00:00Z",
            magnetMeta: {
              seeders: 3,
              leechers: 1,
              healthLevel: "cold",
            },
          },
        ],
      };

      const incoming: MergedLinks = {
        magnet: [
          {
            url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
            password: "",
            note: "星际穿越 4K REMUX (新节点)",
            datetime: "2026-09-16T12:05:00Z",
            magnetMeta: {
              seeders: 66,
              leechers: 20,
              healthLevel: "hot",
            },
          },
        ],
      };

      const res = mergeMergedByType(target, incoming);
      expect(res.magnet).toHaveLength(1);
      expect(res.magnet[0].magnetMeta?.seeders).toBe(66);
    });
  });
});
