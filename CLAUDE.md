# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PanHub-Home 是基于 Nuxt 4 + TypeScript 构建的高性能边缘影音中枢与网盘/磁力搜索调度系统。深度联动家庭私有云（绿联 DX4600 NAS、AList、qBittorrent v5.x 与芝杜 Z9X 播放器），支持 Cloudflare Workers 边缘轻量部署并由 Cloudflare D1 数据库提供底层持久化支撑。

**核心定位**：具备生产级 D1 数据库、多租户安全隔离、NAS 三大推送协议、qB 实时遥测 SSOT 看板、磁力健康度雷达与冷热存储分层调度能力。不再依赖任何外部微信验证码或广告解锁服务。

## Package Manager

`npm` (lockfile: `package-lock.json`). Always use `npm install`.

## Development Commands

```bash
npm run dev             # Start dev server
npm run build           # Production build
npm run preview         # Preview production build
npm test                # Run all unit tests (Vitest)
npm run test:watch      # Tests in watch mode
npm run test:coverage   # Coverage reports (V8)
npm run test:api        # API integration tests
vitest run test/unit/memoryCache.test.ts   # Run a single test file
vitest run -t "test name pattern"          # Run tests matching a name
npm run deploy:cf       # Deploy to Cloudflare Workers
```

## Architecture

### Search Flow (Two-Tier)

1. **Client** (`composables/useSearch.ts`): Manages search state, batching, pause/continue, fast/deep phases. Calls `/api/search` and `/api/search.post`.
2. **Server** (`server/core/services/searchService.ts`): Orchestrates concurrent searches across TG channels and plugins with priority batching, caching, timeout control, and plugin health checking.

**Fast Search**: First batch of priority TG channels + plugins returns immediately.
**Deep Search**: Remaining channels/plugins continue loading in batches.

**主搜索入口是 SSE 流式接口** `server/api/search.stream.get.ts`：1 个 SSE 连接承载整次搜索，后端把频道按批切片受控并发抓取，逐批 push chunk 事件，前端边收边渲染。

### Server Core (`server/core/`)

- **`services/searchService.ts`**: Main orchestrator. Uses `p-limit` for concurrency, `UnifiedCache` for caching, `PluginHealthChecker` to skip unhealthy plugins.
- **`services/tg.ts`**: Telegram channel post fetching with Cheerio HTML parsing.
- **`services/channelConfigService.ts`**: 频道配置服务，加载后缓存在内存。频道知识只存在于后端，前端零落地。
- **`services/searchQuotaService.ts`**: 页面端搜索配额（免费 3 次，按 openid 内存计数；超限 402 → 前端 floating-unlock 看广告解锁，`utils/unlockVerify.ts` 验票核销）。纯内存，不落数据库。
- **`services/doubanHotService.ts`**: Douban hot list fetching（内存缓存，24h TTL）。
- **`cache/unifiedCache.ts`**: Namespaced cache wrapper around `MemoryCache`. Namespaces: `TG_SEARCH`, `PLUGIN_SEARCH`. Cache keys: `tg:${keyword}:${channels}`, `plugin:${keyword}:${plugins}`.
- **`cache/memoryCache.ts`**: LRU cache with TTL expiration and memory monitoring.
- **`plugins/manager.ts`**: Plugin registry (`BaseAsyncPlugin` base class, global registry pattern via `registerGlobalPlugin()`). Each plugin implements `AsyncSearchPlugin` interface with `name()`, `priority()`, `search()` methods.
- **`plugins/*.ts`**: ~20 search plugins (pansearch, qupansou, panta, etc.).
- **`plugins/pluginHealth.ts`**: Circuit breaker pattern — tracks plugin failure rates, auto-skips unhealthy plugins for 5 minutes.
- **`utils/fetch.ts`**: Network wrapper with retry/timeout (via `fetchWithRetry`). **`utils/searchKeyword.ts`**: Builds keyword variants for deep search (CJK-aware splitting, noise filtering). **`utils/errors.ts`**: Error classification and `ErrorCollector`. **`utils/logger.ts`**: Logging.
- **`types/models.ts`**: Core interfaces — `SearchResult`, `MergedLink`, `MergedLinks`, `SearchResponse`, `SearchRequest`.

### Authentication & Multi-Tenancy

系统采用自研 SaaS 级用户认证与凭证管理体系（`server/utils/authSession.ts` + Cloudflare D1）：
- 注册与邀请码：支持一次性注册邀请码机制与超级管理员自举（`/admin` 界面全生命周期管理）；
- 凭证加密：用户配置的 NAS、AList、qBittorrent 访问 Token 与密码通过 Web Crypto API (AES-GCM) 硬件级加密入库；
- 多租户严格隔离：所有接口基于 `user_id` 强校验，无专属配置严禁越权降级，前端在登录和会话激活时主动静默回水同步；
- 公共搜索放行：常规网盘与磁力搜索纯净放行，爬虫 UA 拦截 403，全局内存固定窗口限流保护。

### Client-Side

- **`pages/index/index.vue`**: 首页视图，整合智能紧凑吸顶搜索栏、多维过滤、7:3 资源与字幕流光排版、豆瓣热榜。
- **`components/PushDrawer.vue`**: NAS 推送抽屉，支持方案 A (AList 动态免转存挂载)、方案 B (网盘转存穿透刷新)、方案 C (qB 原生满速离线下载)。
- **`components/NasTasksDrawer.vue`**: qBittorrent 原生 SSOT 实时下载监控抽屉（速率/做种/ETA/控制）。
- **`components/NasSettingsModal.vue`**: 【我的 NAS】私有化节点配置弹窗，支持 D1 持久化。
- **`composables/useSearch.ts`**: SSE 流式搜索状态机、分页加载、多源合并。
- **`composables/useNasProfile.ts`**: 用户专属 NAS 配置状态管理、D1 自动回水同步。
- **`utils/extractMergedFromResponse.ts`** + **`utils/mergeMergedByType.ts`**: 结果解析与健康度择优合并。

### Configuration (`config/`)

- **`channels.json`**: 运行参数模板（concurrency, timeouts, cache TTL）。
- **`plugins.ts`**: Platform info (`PLATFORM_INFO` with colors/icons) used by the frontend to render source icons; `DEFAULT_USER_SETTINGS` (concurrency/timeout defaults). Plugin names are owned by the backend `PluginManager` (frontend holds no plugin list).
- **`doubanHot.ts`**: Douban API configuration.

## API Routes (`server/api/`)

All routes use the `name.method.ts` convention (e.g., `search.get.ts`).

Key routes: `search.stream.get.ts`（SSE 流式搜索，前端主用）、`nas/push.post.ts`（统一推送调度）、`nas/mount-share.post.ts`（方案 A 动态只读挂载）、`nas/tasks.get.ts`（qB 实时监控）、`nas/archive.post.ts`（冷热存储分层移动）、`auth/login.post.ts`（多租户会话）。

Route rules in `nuxt.config.ts` disable caching for auth/search/nas API routes.

## Deployment

- **Cloudflare Workers** (default): `wrangler.toml` with `nodejs_compat` flag. `npm run build:cf` then `npm run deploy:cf`.
- **Nitro preset**: `$env:NITRO_PRESET="cloudflare_module"; npx nuxt build` 构建打包，确保 ESM 自包含。

## CI/CD (`.github/workflows/`)

- **`ci.yml`**: GitHub Actions 自动化质检门禁。在 push / PR 到 `main` 时自动执行 48 套离线回归测试断言与 Cloudflare Workers Module 生产级预编译，100% 绿灯方可合并。
- **独立演进**：已彻底解耦上游 upstream，不再运行任何上游同步任务，保持代码库纯净自主。

## Testing

- Framework: Vitest with Node environment, globals enabled.
- Config: `vitest.config.ts` — includes `test/unit/**/*.test.ts`, alias `#internal` → `.nuxt`.
- Coverage: V8 provider, excludes `node_modules/`, `test/`, `*.d.ts`, config/index files.
- Run `npm test` before committing changes to `server/core/`.

## Conventions

- Vue composables: `use` prefix (`useSearch`, `useSettings`).
- Server routes: `name.get.ts` / `name.post.ts` under `server/api/`.
- Unit tests: `test/unit/*.test.ts`.
- Integration tests: `test/*.mjs`.
- Code style: 2-space indent, semicolons, double quotes.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `refactor:`, `delete:`). Keep subjects short and imperative, one logical change per commit.

## Environment Variables

- `LOG_LEVEL`: Logging level (default: `info`).
- `WX_AUTH_API_BASE`: wx-auth 认证服务地址（默认 `https://wx-auth.shenzjd.com`）。
- `TRUST_PROXY`: 设为 `1` 时信任 CF-Connecting-IP / X-Forwarded-For 解析客户端 IP（限流用；默认不信任）。
- `NITRO_PRESET`: Deployment preset (auto-detect if unset).
- `PORT`: Server port (default: `4000`).
- `VERCEL`: Auto-detected for Vercel deployment.
