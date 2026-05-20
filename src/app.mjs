const numberFormat = new Intl.NumberFormat('en-US');
const percentFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});
const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

const state = {
  posts: [],
  filtered: [],
  selectedId: null,
  updatedAt: null,
  filters: {
    search: '',
    range: '90',
    type: 'all',
    minImpressions: 0,
    sort: 'latest'
  }
};

const elements = {
  lastUpdated: document.querySelector('[data-last-updated]'),
  refreshButton: document.querySelector('[data-refresh]'),
  seedButton: document.querySelector('[data-seed]'),
  clearButton: document.querySelector('[data-clear]'),
  importButton: document.querySelector('[data-import-btn]'),
  fileInput: document.querySelector('[data-file-input]'),
  filterSearch: document.querySelector('[data-filter-search]'),
  filterRange: document.querySelector('[data-filter-range]'),
  filterType: document.querySelector('[data-filter-type]'),
  filterMinImpressions: document.querySelector('[data-filter-min-impressions]'),
  filterSort: document.querySelector('[data-filter-sort]'),
  kpiPosts: document.querySelector('[data-kpi-posts]'),
  kpiImpressions: document.querySelector('[data-kpi-impressions]'),
  kpiEngagement: document.querySelector('[data-kpi-engagement]'),
  kpiRate: document.querySelector('[data-kpi-rate]'),
  trendChart: document.querySelector('[data-chart-trend]'),
  topPostsChart: document.querySelector('[data-chart-top-posts]'),
  typeMixChart: document.querySelector('[data-chart-type-mix]'),
  tableSummary: document.querySelector('[data-table-summary]'),
  tableRows: document.querySelector('[data-post-rows]'),
  detailBody: document.querySelector('[data-detail-body]'
  )
};

function formatNumber(value) {
  return numberFormat.format(value || 0);
}

function getPostEngagement(post) {
  return (
    Number(post.engagement) ||
    Number(post.reactions || 0) +
      Number(post.comments || 0) +
      Number(post.reposts || 0) +
      Number(post.clicks || 0) +
      Number(post.saves || 0)
  );
}

function getEngagementRate(post) {
  const impressions = Number(post.impressions || 0);
  if (impressions <= 0) {
    return 0;
  }
  return getPostEngagement(post) / impressions;
}

function truncate(text, max = 90) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}...`;
}

function getDisplayText(post) {
  const raw = String(post.text || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return 'Untitled post';
  }
  return raw;
}

function getPostTitle(post, maxWords = 8) {
  const words = getDisplayText(post).split(' ').filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(' ');
  }
  return `${words.slice(0, maxWords).join(' ')}...`;
}

function isRepost(post) {
  if (typeof post.isRepost === 'boolean') {
    return post.isRepost;
  }
  const text = String(post.text || '').toLowerCase();
  return /\breposted this\b|\breposted\b|\bshared this\b/.test(text);
}

function getPreviewImageUrl(post) {
  const url = String(post.imageUrl || post.previewImageUrl || post.thumbnailUrl || '').trim();
  if (!url) {
    return '';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return '';
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getDateLabel(dateValue) {
  const timestamp = Date.parse(dateValue);
  if (Number.isNaN(timestamp)) {
    return 'Unknown date';
  }
  return dateFormat.format(new Date(timestamp));
}

function withinRange(dateValue, range) {
  if (range === 'all') {
    return true;
  }

  const days = Number(range);
  if (!Number.isFinite(days) || days <= 0) {
    return true;
  }

  const timestamp = Date.parse(dateValue);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return timestamp >= cutoff;
}

function sortPosts(posts, sortBy) {
  const sorted = [...posts];

  if (sortBy === 'oldest') {
    sorted.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return sorted;
  }

  if (sortBy === 'impressions') {
    sorted.sort((a, b) => Number(b.impressions || 0) - Number(a.impressions || 0));
    return sorted;
  }

  if (sortBy === 'engagement') {
    sorted.sort((a, b) => getPostEngagement(b) - getPostEngagement(a));
    return sorted;
  }

  if (sortBy === 'engagementRate') {
    sorted.sort((a, b) => getEngagementRate(b) - getEngagementRate(a));
    return sorted;
  }

  sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return sorted;
}

function applyFilters() {
  const searchLower = state.filters.search.toLowerCase();

  let next = state.posts.filter((post) => {
    if (!withinRange(post.createdAt, state.filters.range)) {
      return false;
    }

    if (state.filters.type !== 'all' && String(post.contentType || 'text') !== state.filters.type) {
      return false;
    }

    if (Number(post.impressions || 0) < state.filters.minImpressions) {
      return false;
    }

    if (!searchLower) {
      return true;
    }

    const haystack = `${post.text || ''} ${post.authorName || ''} ${post.postUrl || ''}`.toLowerCase();
    return haystack.includes(searchLower);
  });

  next = sortPosts(next, state.filters.sort);
  state.filtered = next;

  const stillVisible = state.filtered.some((post) => post.id === state.selectedId);
  if (!stillVisible) {
    state.selectedId = state.filtered[0]?.id || null;
  }
}

function getKpis(posts) {
  let impressions = 0;
  let engagement = 0;

  for (const post of posts) {
    impressions += Number(post.impressions || 0);
    engagement += getPostEngagement(post);
  }

  const averageRate = impressions > 0 ? engagement / impressions : 0;

  return {
    totalPosts: posts.length,
    impressions,
    engagement,
    averageRate
  };
}

function renderKpis() {
  const kpis = getKpis(state.filtered);

  elements.kpiPosts.textContent = formatNumber(kpis.totalPosts);
  elements.kpiImpressions.textContent = formatNumber(kpis.impressions);
  elements.kpiEngagement.textContent = formatNumber(kpis.engagement);
  elements.kpiRate.textContent = percentFormat.format(kpis.averageRate);
}

function buildTrendSeries(posts) {
  const byDay = new Map();

  for (const post of posts) {
    const date = new Date(post.createdAt);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const key = date.toISOString().slice(0, 10);
    const existing = byDay.get(key) || { impressions: 0, engagement: 0 };
    existing.impressions += Number(post.impressions || 0);
    existing.engagement += getPostEngagement(post);
    byDay.set(key, existing);
  }

  return [...byDay.entries()]
    .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
    .map(([date, metrics]) => ({ date, ...metrics }));
}

function pointsFromSeries(values, width, height, maxValue) {
  if (values.length === 0) {
    return '';
  }

  const safeMax = maxValue <= 0 ? 1 : maxValue;

  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - (value / safeMax) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function renderTrendChart() {
  const series = buildTrendSeries(state.filtered);

  if (series.length === 0) {
    elements.trendChart.innerHTML = '<p class="empty-copy">No data for current filters.</p>';
    return;
  }

  const width = 840;
  const height = 220;
  const padX = 36;
  const padY = 12;

  const impressions = series.map((entry) => entry.impressions);
  const engagements = series.map((entry) => entry.engagement);
  const impressionMax = Math.max(...impressions, 1);
  const engagementMax = Math.max(...engagements, 1);

  const impressionPoints = pointsFromSeries(
    impressions,
    width - padX * 2,
    height - padY * 2,
    impressionMax
  );
  const engagementPoints = pointsFromSeries(
    engagements,
    width - padX * 2,
    height - padY * 2,
    engagementMax
  );

  const lastImpression = impressions[impressions.length - 1] || 0;
  const firstLabel = getDateLabel(series[0].date);
  const lastLabel = getDateLabel(series[series.length - 1].date);
  const maxLabel = formatNumber(impressionMax);

  elements.trendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Impressions and engagement trend">
      <g transform="translate(${padX}, ${padY})">
        <rect x="0" y="0" width="${width - padX * 2}" height="${height - padY * 2}" fill="transparent" />
        <line x1="0" y1="${height - padY * 2}" x2="${width - padX * 2}" y2="${height - padY * 2}" stroke="#b9c1ae" stroke-width="1" />
        <polyline points="${impressionPoints}" fill="none" stroke="#1443d3" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
        <polyline points="${engagementPoints}" fill="none" stroke="#07874f" stroke-width="3" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" />
      </g>
      <text x="${padX}" y="${height - 2}" fill="#546172" font-size="11">${escapeHtml(firstLabel)}</text>
      <text x="${width - padX}" y="${height - 2}" text-anchor="end" fill="#546172" font-size="11">${escapeHtml(lastLabel)}</text>
      <text x="${padX}" y="11" fill="#546172" font-size="11">Peak impressions: ${maxLabel}</text>
      <text x="${width - padX}" y="11" text-anchor="end" fill="#546172" font-size="11">Latest day impressions: ${formatNumber(lastImpression)}</text>
    </svg>
    <div class="legend-row">
      <span class="legend-impressions">Impressions</span>
      <span class="legend-engagement">Engagement</span>
    </div>
  `;
}

function renderTopPostsChart() {
  const top = [...state.filtered]
    .sort((a, b) => getPostEngagement(b) - getPostEngagement(a))
    .slice(0, 6);

  if (top.length === 0) {
    elements.topPostsChart.innerHTML = '<p class="empty-copy">No posts in current filter.</p>';
    return;
  }

  const maxEngagement = Math.max(...top.map((post) => getPostEngagement(post)), 1);

  const items = top
    .map((post) => {
      const engagement = getPostEngagement(post);
      const percentage = (engagement / maxEngagement) * 100;

      return `
        <li>
          <div class="top-post-header">
            <span class="top-post-snippet">${escapeHtml(truncate(getPostTitle(post), 76))}</span>
            <strong>${formatNumber(engagement)}</strong>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${percentage.toFixed(1)}%"></div>
          </div>
        </li>
      `;
    })
    .join('');

  elements.topPostsChart.innerHTML = `<ul class="top-post-list">${items}</ul>`;
}

function renderTypeMixChart() {
  if (state.filtered.length === 0) {
    elements.typeMixChart.innerHTML = '<p class="empty-copy">No type data available.</p>';
    return;
  }

  const totals = new Map();

  for (const post of state.filtered) {
    const type = String(post.contentType || 'text');
    totals.set(type, (totals.get(type) || 0) + 1);
  }

  const content = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const ratio = count / state.filtered.length;
      return `
        <article class="type-pill">
          <p>${escapeHtml(type)}</p>
          <p class="value">${formatNumber(count)}</p>
          <p>${percentFormat.format(ratio)} of filtered posts</p>
        </article>
      `;
    })
    .join('');

  elements.typeMixChart.innerHTML = content;
}

function renderTable() {
  elements.tableSummary.textContent = `${formatNumber(state.filtered.length)} matching posts`;

  if (state.filtered.length === 0) {
    elements.tableRows.innerHTML =
      '<tr><td colspan="7" class="empty-copy">No posts match your filters.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const post of state.filtered) {
    const row = document.createElement('tr');
    if (post.id === state.selectedId) {
      row.classList.add('active');
    }
    row.dataset.postId = post.id;

    const dateCell = document.createElement('td');
    dateCell.textContent = getDateLabel(post.createdAt);

    const postCell = document.createElement('td');
    const media = document.createElement('div');
    media.className = 'post-media';
    const imageUrl = getPreviewImageUrl(post);

    if (imageUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'post-thumb';
      thumb.src = imageUrl;
      thumb.alt = '';
      thumb.loading = 'lazy';
      media.appendChild(thumb);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'post-thumb post-thumb-placeholder';
      placeholder.textContent = 'No image';
      media.appendChild(placeholder);
    }

    const copyWrap = document.createElement('div');
    copyWrap.className = 'post-copy';

    const title = document.createElement('div');
    title.className = 'post-title';
    title.textContent = getPostTitle(post);

    const snippet = document.createElement('div');
    snippet.className = 'post-snippet';
    snippet.textContent = truncate(getDisplayText(post), 96);

    copyWrap.appendChild(title);
    copyWrap.appendChild(snippet);
    media.appendChild(copyWrap);
    postCell.appendChild(media);

    const typeCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = String(post.contentType || 'text');
    typeCell.appendChild(badge);

    const originCell = document.createElement('td');
    const originBadge = document.createElement('span');
    originBadge.className = `badge ${isRepost(post) ? 'badge-repost' : 'badge-original'}`;
    originBadge.textContent = isRepost(post) ? 'Repost' : 'Original';
    originCell.appendChild(originBadge);

    const impressionsCell = document.createElement('td');
    impressionsCell.textContent = formatNumber(Number(post.impressions || 0));

    const engagementCell = document.createElement('td');
    engagementCell.textContent = formatNumber(getPostEngagement(post));

    const rateCell = document.createElement('td');
    rateCell.textContent = percentFormat.format(getEngagementRate(post));

    row.appendChild(dateCell);
    row.appendChild(postCell);
    row.appendChild(typeCell);
    row.appendChild(originCell);
    row.appendChild(impressionsCell);
    row.appendChild(engagementCell);
    row.appendChild(rateCell);

    row.addEventListener('click', () => {
      state.selectedId = post.id;
      renderTable();
      renderDetail();
    });

    fragment.appendChild(row);
  }

  elements.tableRows.innerHTML = '';
  elements.tableRows.appendChild(fragment);
}

function renderDetail() {
  const post = state.filtered.find((item) => item.id === state.selectedId);

  if (!post) {
    elements.detailBody.innerHTML = '<p class="empty-copy">No post selected yet.</p>';
    return;
  }

  const stats = [
    ['Impressions', formatNumber(post.impressions || 0)],
    ['Engagement', formatNumber(getPostEngagement(post))],
    ['Engagement rate', percentFormat.format(getEngagementRate(post))],
    ['Reactions', formatNumber(post.reactions || 0)],
    ['Comments', formatNumber(post.comments || 0)],
    ['Reposts', formatNumber(post.reposts || 0)],
    ['Clicks', formatNumber(post.clicks || 0)],
    ['Saves', formatNumber(post.saves || 0)],
    ['Video views', formatNumber(post.videoViews || 0)],
    ['Profile visits', formatNumber(post.profileVisits || 0)]
  ];

  const boxes = stats
    .map(
      ([label, value]) =>
        `<article class="metric-box"><p>${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong></article>`
    )
    .join('');

  const postText = escapeHtml(post.text || 'No text captured for this post.');
  const safeUrl = escapeHtml(post.postUrl || '#');
  const postDate = escapeHtml(getDateLabel(post.createdAt));
  const postType = escapeHtml(post.contentType || 'text');
  const postOrigin = isRepost(post) ? 'Repost' : 'Original';
  const previewImage = getPreviewImageUrl(post);
  const imageBlock = previewImage
    ? `<img class="detail-image" src="${escapeHtml(previewImage)}" alt="" loading="lazy" />`
    : '';

  elements.detailBody.innerHTML = `
    ${imageBlock}
    <p class="detail-title">${postText}</p>
    <p><strong>Date:</strong> ${postDate}</p>
    <p><strong>Type:</strong> <span class="badge">${postType}</span></p>
    <p><strong>Origin:</strong> <span class="badge ${isRepost(post) ? 'badge-repost' : 'badge-original'}">${postOrigin}</span></p>
    <div class="detail-meta">${boxes}</div>
    <p><a class="inline-link" href="${safeUrl}" target="_blank" rel="noreferrer">Open post on LinkedIn</a></p>
  `;
}

function renderHeader() {
  if (state.posts.length === 0) {
    elements.lastUpdated.textContent = 'No posts loaded yet.';
    return;
  }

  const timestamp = state.updatedAt ? getDateLabel(state.updatedAt) : 'Unknown';
  const filteredCount = formatNumber(state.filtered.length);
  const totalCount = formatNumber(state.posts.length);
  elements.lastUpdated.textContent = `Last sync: ${timestamp}. Showing ${filteredCount} of ${totalCount} posts.`;
}

function refreshTypeOptions() {
  const current = elements.filterType.value || 'all';
  const allTypes = [...new Set(state.posts.map((post) => String(post.contentType || 'text')))].sort();

  elements.filterType.innerHTML = '<option value="all">All types</option>';

  for (const type of allTypes) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    elements.filterType.appendChild(option);
  }

  if (allTypes.includes(current)) {
    elements.filterType.value = current;
    state.filters.type = current;
  } else {
    elements.filterType.value = 'all';
    state.filters.type = 'all';
  }
}

function renderAll() {
  applyFilters();
  renderHeader();
  renderKpis();
  renderTrendChart();
  renderTopPostsChart();
  renderTypeMixChart();
  renderTable();
  renderDetail();
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload.error || payload.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
}

async function loadPosts() {
  try {
    const data = await apiRequest('/api/posts');
    state.posts = Array.isArray(data.posts) ? data.posts : [];
    state.updatedAt = data.updatedAt || null;
    refreshTypeOptions();
    renderAll();
  } catch (error) {
    elements.lastUpdated.textContent = `Unable to load posts: ${error.message}`;
  }
}

async function createDemoData() {
  try {
    await apiRequest('/api/posts/demo', { method: 'POST' });
    await loadPosts();
  } catch (error) {
    elements.lastUpdated.textContent = `Unable to seed demo data: ${error.message}`;
  }
}

async function clearData() {
  const confirmed = window.confirm('Clear all stored LinkedIn posts?');
  if (!confirmed) {
    return;
  }

  try {
    await apiRequest('/api/posts', { method: 'DELETE' });
    await loadPosts();
  } catch (error) {
    elements.lastUpdated.textContent = `Unable to clear posts: ${error.message}`;
  }
}

async function importJson(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const posts = Array.isArray(parsed) ? parsed : parsed.posts;

    if (!Array.isArray(posts) || posts.length === 0) {
      throw new Error('JSON file must contain a non-empty posts array.');
    }

    await apiRequest('/api/posts/ingest', {
      method: 'POST',
      body: JSON.stringify({ posts })
    });

    await loadPosts();
  } catch (error) {
    elements.lastUpdated.textContent = `Import failed: ${error.message}`;
  }
}

function bindEvents() {
  elements.filterSearch.addEventListener('input', () => {
    state.filters.search = elements.filterSearch.value.trim();
    renderAll();
  });

  elements.filterRange.addEventListener('change', () => {
    state.filters.range = elements.filterRange.value;
    renderAll();
  });

  elements.filterType.addEventListener('change', () => {
    state.filters.type = elements.filterType.value;
    renderAll();
  });

  elements.filterMinImpressions.addEventListener('input', () => {
    const value = Number(elements.filterMinImpressions.value || 0);
    state.filters.minImpressions = Number.isFinite(value) && value > 0 ? value : 0;
    renderAll();
  });

  elements.filterSort.addEventListener('change', () => {
    state.filters.sort = elements.filterSort.value;
    renderAll();
  });

  elements.refreshButton.addEventListener('click', () => {
    loadPosts();
  });

  elements.seedButton.addEventListener('click', () => {
    createDemoData();
  });

  elements.clearButton.addEventListener('click', () => {
    clearData();
  });

  elements.importButton.addEventListener('click', () => {
    elements.fileInput.value = '';
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener('change', () => {
    const file = elements.fileInput.files?.[0];
    importJson(file);
  });
}

bindEvents();
loadPosts();
