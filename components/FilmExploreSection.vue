<template>
  <div class="film-explore-section" data-theme-part="film-explore">
    <!-- 顶部控制与多维筛选栏 -->
    <div class="explore-toolbar">
      <div class="toolbar-header">
        <div class="header-left">
          <span class="header-icon">🎬</span>
          <div class="header-text">
            <h2 class="section-title">影视片库多维探索</h2>
            <p class="section-subtitle">
              自由组合大类、题材、年份与豆瓣评分，点击海报秒搜全网网盘资源
            </p>
          </div>
        </div>

        <div class="header-actions">
          <!-- 排序方式选择 -->
          <div class="sort-wrapper">
            <span class="sort-label">排序:</span>
            <select
              class="sort-select"
              v-model="activeSort"
              @change="onFilterChange">
              <option value="U">近期热门</option>
              <option value="S">豆瓣评分最高</option>
              <option value="R">最新上映</option>
              <option value="T">评价最多</option>
            </select>
          </div>

          <!-- 折叠/展开更多条件 -->
          <button
            type="button"
            class="action-btn toggle-btn"
            :class="{ active: isFilterExpanded }"
            @click="isFilterExpanded = !isFilterExpanded">
            <span>{{ isFilterExpanded ? "收起筛选" : "展开高级筛选" }}</span>
            <svg
              class="chevron"
              :class="{ 'chevron--open': isFilterExpanded }"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2">
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>

          <!-- 一键重置 -->
          <button
            v-if="hasActiveFilter"
            type="button"
            class="action-btn reset-btn"
            @click="resetFilters"
            title="恢复全部探索筛选条件">
            重置
          </button>
        </div>
      </div>

      <!-- 筛选维度组 -->
      <div class="filter-rows">
        <!-- 维度 1：影视大类 -->
        <div class="filter-row">
          <span class="row-label">影视大类</span>
          <div class="row-options">
            <button
              v-for="opt in typeOptions"
              :key="opt.key"
              type="button"
              :class="['filter-pill', { active: activeType === opt.key }]"
              @click="setFilter('type', opt.key)">
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 维度 2：口碑评分 -->
        <div class="filter-row">
          <span class="row-label">豆瓣评分</span>
          <div class="row-options">
            <button
              v-for="opt in scoreOptions"
              :key="opt.key"
              type="button"
              :class="['filter-pill', { active: activeScore === opt.key }]"
              @click="setFilter('score', opt.key)">
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 折叠面板：题材与发行年代 -->
        <div v-show="isFilterExpanded" class="advanced-filter-drawer">
          <!-- 维度 3：热门题材 -->
          <div class="filter-row">
            <span class="row-label">题材类型</span>
            <div class="row-options scrollable-tags">
              <button
                v-for="opt in genreOptions"
                :key="opt.key"
                type="button"
                :class="['filter-pill', { active: activeGenre === opt.key }]"
                @click="setFilter('genre', opt.key)">
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- 维度 4：发行年代 -->
          <div class="filter-row">
            <span class="row-label">发行年代</span>
            <div class="row-options">
              <button
                v-for="opt in yearOptions"
                :key="opt.key"
                type="button"
                :class="['filter-pill', { active: activeYear === opt.key }]"
                @click="setFilter('year', opt.key)">
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="content-area">
      <!-- 骨架屏 Loading（首屏加载时） -->
      <div v-if="loading && items.length === 0" class="skeleton-grid">
        <div v-for="i in 10" :key="`skeleton-${i}`" class="skeleton-card">
          <div class="skeleton-cover">
            <div class="skeleton-shimmer"></div>
          </div>
          <div class="skeleton-info">
            <div class="skeleton-title"></div>
            <div class="skeleton-desc"></div>
          </div>
        </div>
      </div>

      <!-- 影视海报网格 -->
      <div v-else-if="items.length > 0" class="movie-grid">
        <div class="grid-container">
          <button
            v-for="item in items"
            :key="item.id || item.title"
            type="button"
            class="movie-card"
            data-theme-part="movie-card"
            :aria-label="`搜索 ${item.title} 网盘资源`"
            @click="onFilmClick(item.title, item.id)">
            <div class="card-cover">
              <img
                v-if="item.cover && !imgFailed.includes(item.id)"
                :src="proxyCover(item.cover)"
                :alt="item.title"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="onImgError(item.id)" />
              <div v-else class="cover-placeholder">🎬</div>

              <!-- 豆瓣评分徽章 -->
              <span v-if="item.rate && item.rate !== '0.0'" class="rate-badge">
                ★ {{ item.rate }}
              </span>
            </div>

            <div class="card-info">
              <span class="card-title" :title="item.title">{{ item.title }}</span>
              <span class="card-desc" :title="formatDesc(item)">{{ formatDesc(item) }}</span>
            </div>
          </button>
        </div>

        <!-- 底部加载更多与触底监听 -->
        <div class="load-section">
          <div v-if="hasMore || loadingMore" ref="loadTriggerRef" class="load-trigger">
            <div v-if="loadingMore" class="loading-more">
              <div class="spinner-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span>加载更多优质影视…</span>
            </div>
          </div>
          <div v-else class="end-message">
            — 已为您呈现全部符合条件的影视作品 —
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-text">未找到符合当前组合条件的影视作品</div>
        <button type="button" class="empty-reset-btn" @click="resetFilters">
          恢复默认筛选
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import type { DoubanExploreItem } from "~/server/core/services/doubanExploreService";
import { getDynamicYearRanges } from "~/composables/useResourceParser";

interface Props {
  onSearch: (term: string, doubanId?: string) => void;
}

const props = defineProps<Props>();

// 筛选状态
const activeType = ref("all");
const activeGenre = ref("all");
const activeYear = ref("all");
const activeScore = ref("all");
const activeSort = ref("U");
const isFilterExpanded = ref(true);

// 分页与数据
const currentPage = ref(1);
const items = ref<DoubanExploreItem[]>([]);
const hasMore = ref(true);
const loading = ref(false);
const loadingMore = ref(false);
const imgFailed = ref<string[]>([]);
const loadTriggerRef = ref<HTMLElement | null>(null);
let loadObserver: IntersectionObserver | null = null;
let currentSeq = 0;

// 选项配置
const typeOptions = [
  { key: "all", label: "全部大类" },
  { key: "电影", label: "电影" },
  { key: "电视剧", label: "电视剧/剧集" },
  { key: "动漫", label: "动漫/番剧" },
  { key: "纪录片", label: "纪录片" },
  { key: "综艺", label: "综艺" },
];

const scoreOptions = [
  { key: "all", label: "全部评分" },
  { key: "9-10", label: "★ 9.0分以上 (神作殿堂)" },
  { key: "8-10", label: "★ 8.0分以上 (高分精选)" },
  { key: "7-10", label: "★ 7.0分以上 (值得一看)" },
];

const genreOptions = [
  { key: "all", label: "全部题材" },
  { key: "科幻", label: "科幻" },
  { key: "悬疑", label: "悬疑" },
  { key: "动作", label: "动作" },
  { key: "喜剧", label: "喜剧" },
  { key: "爱情", label: "爱情" },
  { key: "犯罪", label: "犯罪" },
  { key: "惊悚", label: "惊悚" },
  { key: "恐怖", label: "恐怖" },
  { key: "战争", label: "战争" },
  { key: "动画", label: "动画" },
  { key: "奇幻", label: "奇幻" },
  { key: "冒险", label: "冒险" },
  { key: "灾难", label: "灾难" },
  { key: "传记", label: "传记" },
  { key: "历史", label: "历史" },
];

const yearOptions = [
  { key: "all", label: "全部年代" },
  ...getDynamicYearRanges(),
];

const hasActiveFilter = computed(() => {
  return (
    activeType.value !== "all" ||
    activeGenre.value !== "all" ||
    activeYear.value !== "all" ||
    activeScore.value !== "all" ||
    activeSort.value !== "U"
  );
});

function proxyCover(url: string): string {
  if (!url) return "";
  return `/api/img?url=${encodeURIComponent(url)}`;
}

function onImgError(id: string) {
  if (!imgFailed.value.includes(id)) {
    imgFailed.value.push(id);
  }
}

function formatDesc(item: DoubanExploreItem): string {
  const parts: string[] = [];
  if (item.directors && item.directors.length > 0) {
    parts.push(`导: ${item.directors[0]}`);
  }
  if (item.casts && item.casts.length > 0) {
    parts.push(`演: ${item.casts.slice(0, 2).join("/")}`);
  }
  return parts.join(" · ") || "豆瓣推荐影视";
}

async function fetchExploreData(page: number, append = false) {
  const seq = ++currentSeq;
  if (page === 1) {
    loading.value = true;
  } else {
    loadingMore.value = true;
  }

  const queryParams = new URLSearchParams({
    type: activeType.value,
    genre: activeGenre.value,
    yearRange: activeYear.value,
    scoreRange: activeScore.value,
    sort: activeSort.value,
    page: String(page),
    limit: "20",
  });

  try {
    const res = await fetch(`/api/douban-explore?${queryParams.toString()}`);
    const data = await res.json();

    if (seq !== currentSeq) return;

    if (data.code === 0 && data.data) {
      const newItems: DoubanExploreItem[] = data.data.items || [];
      if (append) {
        items.value = [...items.value, ...newItems];
      } else {
        items.value = newItems;
      }
      hasMore.value = data.data.hasMore ?? newItems.length >= 20;
      currentPage.value = page;
    } else {
      if (!append) items.value = [];
      hasMore.value = false;
    }
  } catch (err) {
    console.error("[FilmExplore] 获取影视探索数据失败:", err);
    if (!append && seq === currentSeq) items.value = [];
    if (seq === currentSeq) hasMore.value = false;
  } finally {
    if (seq === currentSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function setFilter(dim: "type" | "genre" | "year" | "score", val: string) {
  if (dim === "type") activeType.value = val;
  else if (dim === "genre") activeGenre.value = val;
  else if (dim === "year") activeYear.value = val;
  else if (dim === "score") activeScore.value = val;
  onFilterChange();
}

function onFilterChange() {
  currentPage.value = 1;
  hasMore.value = true;
  items.value = [];
  fetchExploreData(1, false).then(() => {
    nextTick(() => setupObserver());
  });
}

function resetFilters() {
  activeType.value = "all";
  activeGenre.value = "all";
  activeYear.value = "all";
  activeScore.value = "all";
  activeSort.value = "U";
  onFilterChange();
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value || loading.value) return;
  await fetchExploreData(currentPage.value + 1, true);
}

function setupObserver() {
  if (loadObserver) {
    loadObserver.disconnect();
    loadObserver = null;
  }
  if (!loadTriggerRef.value) return;

  loadObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && hasMore.value && !loading.value && !loadingMore.value) {
        loadMore();
      }
    },
    { rootMargin: "200px", threshold: 0.1 }
  );
  loadObserver.observe(loadTriggerRef.value);
}

function onFilmClick(title: string, doubanId?: string) {
  if (!title) return;
  props.onSearch(title.trim(), doubanId);
}

let initPromise: Promise<void> | null = null;

async function init() {
  if (items.value.length > 0) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await fetchExploreData(1, false);
      await nextTick();
      setupObserver();
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

defineExpose({
  init,
});

onMounted(() => {
  init();
});

onBeforeUnmount(() => {
  if (loadObserver) {
    loadObserver.disconnect();
    loadObserver = null;
  }
});
</script>

<style scoped>
.film-explore-section {
  width: 100%;
  margin-top: 24px;
  animation: fadeIn 0.4s ease-out;
}

/* 顶部工具栏 */
.explore-toolbar {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl, 16px);
  padding: 20px 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.04));
  transition: all 0.3s ease;
}

.toolbar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  font-size: 24px;
  line-height: 1;
}

.section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.section-subtitle {
  margin: 2px 0 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.sort-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sort-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.sort-select {
  padding: 5px 12px;
  font-size: 13px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--border-light);
  background: var(--bg-secondary, rgba(255, 255, 255, 0.05));
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s ease;
}

.sort-select:hover,
.sort-select:focus {
  border-color: var(--primary);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 13px;
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  background: var(--bg-secondary, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.action-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.action-btn.active {
  color: var(--primary);
  background: rgba(15, 118, 110, 0.1);
  border-color: var(--primary);
}

.chevron {
  transition: transform 0.2s ease;
}

.chevron--open {
  transform: rotate(180deg);
}

.reset-btn {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

.reset-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
  color: #ef4444;
}

/* 筛选行 */
.filter-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.advanced-filter-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-light);
  animation: fadeIn 0.25s ease-out;
}

.filter-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.row-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  width: 64px;
  flex-shrink: 0;
  padding-top: 6px;
}

.row-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
}

.scrollable-tags {
  max-height: 120px;
  overflow-y: auto;
}

.filter-pill {
  padding: 5px 12px;
  font-size: 13px;
  border-radius: var(--radius-full, 9999px);
  border: 1px solid var(--border-light);
  background: var(--bg-card, rgba(255, 255, 255, 0.04));
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-pill:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: rgba(15, 118, 110, 0.06);
}

.filter-pill.active {
  background: linear-gradient(135deg, var(--primary), var(--secondary, #f59e0b));
  color: #ffffff;
  border-color: transparent;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(15, 118, 110, 0.25);
}

/* 海报网格 */
.content-area {
  min-height: 350px;
}

.movie-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

.movie-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  text-align: left;
  cursor: pointer;
  padding: 0;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.movie-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
  border-color: var(--primary);
}

.card-cover {
  position: relative;
  aspect-ratio: 2 / 3;
  background: #1e293b;
  overflow: hidden;
}

.card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.movie-card:hover .card-cover img {
  transform: scale(1.04);
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  background: rgba(0, 0, 0, 0.05);
}

.rate-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(4px);
  color: #fbbf24;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.4);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.card-info {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 骨架屏 */
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

.skeleton-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  overflow: hidden;
}

.skeleton-cover {
  aspect-ratio: 2 / 3;
  background: rgba(150, 150, 150, 0.1);
  position: relative;
  overflow: hidden;
}

.skeleton-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.15) 50%, transparent 100%);
  animation: shimmer 1.5s infinite;
}

.skeleton-info {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skeleton-title {
  height: 16px;
  border-radius: 4px;
  background: rgba(150, 150, 150, 0.15);
}

.skeleton-desc {
  height: 12px;
  width: 70%;
  border-radius: 4px;
  background: rgba(150, 150, 150, 0.1);
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 加载更多 */
.load-section {
  padding: 24px 0;
  text-align: center;
}

.loading-more {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-secondary);
}

.spinner-dots {
  display: flex;
  gap: 4px;
}

.spinner-dots span {
  width: 6px;
  height: 6px;
  background: var(--primary);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.spinner-dots span:nth-child(1) { animation-delay: -0.32s; }
.spinner-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.end-message {
  font-size: 13px;
  color: var(--text-secondary);
  opacity: 0.8;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 48px 24px;
  background: var(--bg-primary);
  border: 1px dashed var(--border-light);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-icon {
  font-size: 36px;
}

.empty-text {
  font-size: 15px;
  color: var(--text-secondary);
}

.empty-reset-btn {
  margin-top: 8px;
  padding: 6px 16px;
  font-size: 13px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: opacity 0.2s;
}

.empty-reset-btn:hover {
  opacity: 0.9;
}

/* 响应式断点 */
@media (max-width: 1024px) {
  .grid-container,
  .skeleton-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 768px) {
  .grid-container,
  .skeleton-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .filter-row {
    flex-direction: column;
    gap: 6px;
  }
  .row-label {
    width: 100%;
    padding-top: 0;
  }
}

@media (max-width: 480px) {
  .grid-container,
  .skeleton-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .explore-toolbar {
    padding: 16px;
  }
}
</style>
