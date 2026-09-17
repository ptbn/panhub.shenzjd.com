import { describe, it, expect, vi, beforeEach } from "vitest";
import { moveAListFiles, copyAListFiles } from "../../server/core/nas/alistClient";

describe("阶段 P2：多网盘与本地存储冷热分层调度引擎测试 (Storage Tiering)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("moveAListFiles 跨存储异步移动调度", () => {
    it("空文件名列表应当直接拦截并返回友好错误", async () => {
      const res = await moveAListFiles(
        "https://alist.taogehome.cloud",
        "mock-token",
        "/NAS存储/影音资源/电影",
        "/115网盘/归档/电影",
        []
      );
      expect(res.success).toBe(false);
      expect(res.message).toContain("不能为空");
    });

    it("SSRF 安全拦截：拒绝非法协议与内网敏感地址（默认安全关闭）", async () => {
      const res = await moveAListFiles(
        "http://192.168.1.1:5244",
        "mock-token",
        "/NAS存储/电影",
        "/115网盘/电影",
        ["sample.mkv"],
        false // 不允许私有 IP
      );
      expect(res.success).toBe(false);
      expect(res.message).toContain("SSRF 防御拦截");
    });

    it("成功调用 AList /api/fs/move 并返回异步任务 ID", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 200,
          message: "success",
          data: {
            task_id: "task_move_abc123",
          },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const res = await moveAListFiles(
        "https://alist.taogehome.cloud",
        "alist-token-xyz",
        "/NAS存储/影音资源/电影",
        "/115网盘/归档/电影",
        ["Oppenheimer.2023.2160p.mkv"]
      );

      expect(res.success).toBe(true);
      expect(res.taskId).toBe("task_move_abc123");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe("https://alist.taogehome.cloud/api/fs/move");
      expect(calledInit.headers["Authorization"]).toBe("alist-token-xyz");
      const body = JSON.parse(calledInit.body);
      expect(body.src_dir).toBe("/NAS存储/影音资源/电影");
      expect(body.dst_dir).toBe("/115网盘/归档/电影");
      expect(body.names).toEqual(["Oppenheimer.2023.2160p.mkv"]);
    });

    it("当 AList 服务端返回错误码时正确暴露失败原因", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            code: 500,
            message: "目标网盘空间不足 (115 Disk Full)",
            data: null,
          }),
        })
      );

      const res = await moveAListFiles(
        "https://alist.taogehome.cloud",
        "alist-token-xyz",
        "/NAS存储/影音资源/电影",
        "/115网盘/归档/电影",
        ["Oppenheimer.2023.2160p.mkv"]
      );

      expect(res.success).toBe(false);
      expect(res.message).toContain("目标网盘空间不足");
    });
  });

  describe("copyAListFiles 跨存储复制调度", () => {
    it("成功调用 AList /api/fs/copy 并提交异步备份任务", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 200,
          message: "success",
          data: {
            task_id: "task_copy_def456",
          },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const res = await copyAListFiles(
        "https://alist.taogehome.cloud",
        "alist-token-xyz",
        "/NAS存储/影音资源/电视剧/Rick and Morty.S09",
        "/夸克网盘/影视备份/电视剧",
        ["Rick.and.Morty.S09E01.mkv"]
      );

      expect(res.success).toBe(true);
      expect(res.taskId).toBe("task_copy_def456");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe("https://alist.taogehome.cloud/api/fs/copy");
      const body = JSON.parse(calledInit.body);
      expect(body.src_dir).toBe("/NAS存储/影音资源/电视剧/Rick and Morty.S09");
      expect(body.dst_dir).toBe("/夸克网盘/影视备份/电视剧");
      expect(body.names).toEqual(["Rick.and.Morty.S09E01.mkv"]);
    });
  });
});
