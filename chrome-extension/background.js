const STORAGE_KEY = 'linkedinCapturedPosts';
const DEFAULT_ENDPOINTS = ['http://localhost:5173/api/posts/ingest', 'http://127.0.0.1:5173/api/posts/ingest'];
let captureAllJob = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null
};

function parseAbbreviatedNumber(text) {
  const normalized = String(text || '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  const match = normalized.match(/(\d+(?:\.\d+)?)(k|m)?/);
  if (!match) {
    return 0;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return 0;
  }

  if (match[2] === 'k') {
    return Math.round(base * 1000);
  }

  if (match[2] === 'm') {
    return Math.round(base * 1000000);
  }

  return Math.round(base);
}

function parseMetric(text, patterns) {
  const lower = String(text || '').toLowerCase();

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match && match[1]) {
      return parseAbbreviatedNumber(match[1]);
    }
  }

  return 0;
}

function inferContentType(postNode) {
  if (postNode.querySelector('video')) {
    return 'video';
  }
  if (postNode.querySelector('img')) {
    return 'image';
  }
  if (postNode.querySelector('a[href*="/pulse/"]')) {
    return 'article';
  }
  if (postNode.innerText?.toLowerCase().includes('poll')) {
    return 'poll';
  }
  return 'text';
}

async function extractLinkedInPostsFromDom(options = {}) {
  const autoScroll = Boolean(options.autoScroll);
  const speedProfileRaw = String(options.speedProfile || 'fast').toLowerCase();
  const speedProfile =
    speedProfileRaw === 'deep' || speedProfileRaw === 'balanced' || speedProfileRaw === 'fast'
      ? speedProfileRaw
      : 'fast';
  const defaultsByProfile = {
    fast: { maxScrollRounds: 45, scrollPauseMs: 700, stableRoundsTarget: 4, stepMultiplier: 1.15 },
    balanced: { maxScrollRounds: 65, scrollPauseMs: 1150, stableRoundsTarget: 6, stepMultiplier: 0.95 },
    deep: { maxScrollRounds: 95, scrollPauseMs: 1850, stableRoundsTarget: 10, stepMultiplier: 0.82 }
  };
  const profileDefaults = defaultsByProfile[speedProfile];

  const maxScrollRounds = Number.isFinite(Number(options.maxScrollRounds))
    ? Number(options.maxScrollRounds)
    : profileDefaults.maxScrollRounds;
  const scrollPauseMs = Number.isFinite(Number(options.scrollPauseMs))
    ? Number(options.scrollPauseMs)
    : profileDefaults.scrollPauseMs;
  const stableRoundsTarget = Number.isFinite(Number(options.stableRoundsTarget))
    ? Number(options.stableRoundsTarget)
    : profileDefaults.stableRoundsTarget;
  const stepMultiplier = Number.isFinite(Number(options.stepMultiplier))
    ? Number(options.stepMultiplier)
    : profileDefaults.stepMultiplier;

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function parseAbbreviatedNumberLocal(text) {
    const normalized = String(text || '')
      .replace(/,/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();

    const match = normalized.match(/(\d+(?:\.\d+)?)(k|m)?/);
    if (!match) {
      return 0;
    }

    const base = Number(match[1]);
    if (!Number.isFinite(base)) {
      return 0;
    }

    if (match[2] === 'k') {
      return Math.round(base * 1000);
    }

    if (match[2] === 'm') {
      return Math.round(base * 1000000);
    }

    return Math.round(base);
  }

  function parseMetricLocal(text, patterns) {
    const lower = String(text || '').toLowerCase();

    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match && match[1]) {
        return parseAbbreviatedNumberLocal(match[1]);
      }
    }

    return 0;
  }

  function parseMetricOptionalLocal(text, patterns) {
    const lower = String(text || '').toLowerCase();

    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match && match[1]) {
        return parseAbbreviatedNumberLocal(match[1]);
      }
    }

    return null;
  }

  function inferContentTypeLocal(postNode) {
    if (postNode.querySelector('video')) {
      return 'video';
    }
    if (postNode.querySelector('img')) {
      return 'image';
    }
    if (postNode.querySelector('a[href*="/pulse/"]')) {
      return 'article';
    }
    if (postNode.innerText?.toLowerCase().includes('poll')) {
      return 'poll';
    }
    return 'text';
  }

  function cleanPostText(rawText) {
    function stripLeadingMetadata(text) {
      let normalized = String(text || '').replace(/\s+/g, ' ').trim();
      if (!normalized) {
        return '';
      }

      normalized = normalized
        .replace(/(reposted this)([A-Z])/g, '$1 $2')
        .replace(/(shared this)([A-Z])/g, '$1 $2')
        .replace(
          /(newsletter)(\d+\s*(?:h|hr|hrs|min|m|d|day|days|w|week|weeks|mo|month|months|yr|year|years))/gi,
          '$1 $2'
        );

      const timeBulletMatch = normalized.match(
        /\b\d+\s*(?:h|hr|hrs|min|m|d|day|days|w|week|weeks|mo|month|months|yr|year|years)\s*•\s*/i
      );
      if (timeBulletMatch?.index !== undefined) {
        const tail = normalized
          .slice(timeBulletMatch.index + timeBulletMatch[0].length)
          .trim();
        if (tail.length >= 20) {
          return tail;
        }
      }

      return normalized;
    }

    const stripped = stripLeadingMetadata(rawText);
    const lines = String(stripped || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const cleaned = lines.filter((line) => {
      const lower = line.toLowerCase();
      if (/^\d[\d,.\s]*\s*(reactions?|comments?|reposts?|impressions?|views?|likes?)$/.test(lower)) {
        return false;
      }
      if (/^follow$/i.test(lower)) {
        return false;
      }
      if (/^\d+\s*(h|hr|hrs|m|min|d|day|days|w|week|weeks|mo|month|months|yr|year|years)\b/i.test(lower)) {
        return false;
      }
      if (/and\s+\d[\d,.]*\s+others\s+reacted/.test(lower)) {
        return false;
      }
      if (/^[a-z .'-]{2,40}\s+reposted\s+this$/i.test(lower)) {
        return false;
      }
      if (/^[a-z .'-]{2,40}\s+shared\s+this$/i.test(lower)) {
        return false;
      }
      if (/^[a-z .'-]{2,40}\s+•\s+/.test(line) && line.length < 120) {
        return false;
      }
      if (/^(like|comment|repost|send|share)$/i.test(lower)) {
        return false;
      }
      if (/^(copy link|copy link to post|see translation|show translation)$/i.test(lower)) {
        return false;
      }
      return true;
    });

    return cleaned.slice(0, 16).join(' ').replace(/\s+/g, ' ').trim();
  }

  function extractPreviewImageUrl(node) {
    const prioritySelectors = [
      '.update-components-image__container img',
      '.update-components-image img',
      '.feed-shared-image__container img',
      '.update-components-article img',
      '.update-components-document img',
      '.ivm-image-view-model img',
      'img'
    ];
    const images = [];
    for (const selector of prioritySelectors) {
      for (const image of node.querySelectorAll(selector)) {
        if (!images.includes(image)) {
          images.push(image);
        }
      }
    }

    function firstUrlFromSrcset(srcset) {
      const candidate = String(srcset || '')
        .split(',')
        .map((part) => part.trim().split(' ')[0])
        .find(Boolean);
      return candidate || '';
    }

    for (const image of images) {
      const src = String(
        image.currentSrc ||
          image.src ||
          image.getAttribute('src') ||
          image.getAttribute('data-delayed-url') ||
          image.getAttribute('data-ghost-url') ||
          image.getAttribute('data-src') ||
          image.getAttribute('data-test-image-url') ||
          firstUrlFromSrcset(image.getAttribute('srcset')) ||
          ''
      ).trim();
      if (!src || src.startsWith('data:')) {
        continue;
      }

      const lowerSrc = src.toLowerCase();
      if (
        lowerSrc.includes('profile-displayphoto') ||
        lowerSrc.includes('company-logo') ||
        lowerSrc.includes('ghost') ||
        lowerSrc.includes('emoji')
      ) {
        continue;
      }

      const width = Number(image.naturalWidth || image.width || 0);
      const height = Number(image.naturalHeight || image.height || 0);
      if (width >= 120 || height >= 120 || lowerSrc.includes('media.licdn.com')) {
        return src;
      }
    }

    const backgroundCandidates = [
      ...node.querySelectorAll('[style*="background-image"]')
    ];
    for (const el of backgroundCandidates) {
      const style = String(el.getAttribute('style') || '');
      const match = style.match(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/i);
      if (!match) {
        continue;
      }
      const src = match[2];
      if (src.toLowerCase().includes('media.licdn.com')) {
        return src;
      }
    }

    return '';
  }

  function inferRepost(node, bodyText) {
    const topText = String((node.innerText || '').split('\n').slice(0, 8).join(' ')).toLowerCase();
    const body = String(bodyText || '').toLowerCase();
    return /\breposted this\b|\breposted\b|\bshared this\b/.test(topText) ||
      /\breposted this\b|\breposted\b|\bshared this\b/.test(body);
  }

  function textFrom(node, selectors) {
    for (const selector of selectors) {
      const candidate = node.querySelector(selector);
      if (candidate?.textContent?.trim()) {
        return candidate.textContent.trim();
      }
    }
    return '';
  }

  function collectCommentaryCandidates(node) {
    const selectors = [
      '[data-test-id="main-feed-activity-card__commentary"]',
      '.feed-shared-update-v2__description-wrapper',
      '.feed-shared-text',
      '.update-components-update-v2__commentary',
      '.update-components-text',
      '.update-components-text-view',
      '.attributed-text-segment-list__container',
      '.feed-shared-inline-show-more-text',
      'span.break-words'
    ];

    const candidates = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const el of node.querySelectorAll(selector)) {
        const text = cleanPostText(el.innerText || el.textContent || '');
        if (!text || text.length < 20) {
          continue;
        }
        const key = text.slice(0, 220);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        candidates.push(text);
      }
    }

    return candidates;
  }

  function scoreBodyCandidate(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const lengthScore = Math.min(words.length, 80);
    let score = lengthScore;

    if (/\n|\.|,|!|\?/.test(text)) {
      score += 8;
    }
    if (/^\s*[A-Z][a-z]+ [A-Z][a-z]+/.test(text)) {
      score -= 10;
    }
    if (/\b(reposted this|shared this|followers|connections)\b/i.test(text)) {
      score -= 18;
    }
    if (/[•|]/.test(text) && words.length < 20) {
      score -= 12;
    }

    return score;
  }

  function extractPostBodyText(node) {
    const selectorText = textFrom(node, [
      '[data-test-id="main-feed-activity-card__commentary"]',
      '.update-components-update-v2__commentary .update-components-text',
      '.feed-shared-update-v2__description-wrapper',
      '.feed-shared-text'
    ]);

    const cleanedSelectorText = cleanPostText(selectorText);
    const candidates = collectCommentaryCandidates(node);
    if (cleanedSelectorText) {
      candidates.unshift(cleanedSelectorText);
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => scoreBodyCandidate(b) - scoreBodyCandidate(a));
      return candidates[0];
    }

    return cleanPostText(node.innerText || '');
  }

  function findBestContext(node) {
    let current = node;

    for (let depth = 0; depth < 9 && current; depth += 1) {
      const text = String(current.innerText || '').trim();
      const postLinks = current.querySelectorAll('a[href*="/feed/update/urn:li:"], a[href*="/posts/"]').length;

      if (text.length > 80 && text.length < 4000 && postLinks >= 1 && postLinks <= 4) {
        return current;
      }

      current = current.parentElement;
    }

    return node.parentElement || node;
  }

  let scrollRounds = 0;
  let stableRounds = 0;
  let lastHeight = 0;
  let lastAnchorCount = 0;
  let mutationCount = 0;
  let loadMoreClicks = 0;

  const anchorSelector = 'a[href*="/feed/update/urn:li:"], a[href*="/posts/"]';

  function getDocumentHeight() {
    return Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    );
  }

  function getScrollTop() {
    const root = document.scrollingElement || document.documentElement;
    return Number(root?.scrollTop || window.scrollY || 0);
  }

  function getAnchorCount() {
    return document.querySelectorAll(anchorSelector).length;
  }

  function clickLoadMoreButtons() {
    const selectors = [
      'button.scaffold-finite-scroll__load-button',
      '.scaffold-finite-scroll__load-button button',
      'button[aria-label*="Load more"]',
      'button[aria-label*="Show more"]',
      'button[aria-label*="See more"]',
      'button[aria-label*="results"]'
    ];

    for (const selector of selectors) {
      const buttons = [...document.querySelectorAll(selector)];
      for (const button of buttons) {
        const disabled = Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true');
        const visible = button.offsetParent !== null;
        if (disabled || !visible) {
          continue;
        }

        button.click();
        return true;
      }
    }

    return false;
  }

  async function waitForSettledContent({ timeoutMs = 5000, quietWindowMs = 900 } = {}) {
    const start = Date.now();
    let lastMutation = Date.now();
    let seenMutations = mutationCount;

    while (Date.now() - start < timeoutMs) {
      await wait(180);

      if (mutationCount !== seenMutations) {
        seenMutations = mutationCount;
        lastMutation = Date.now();
      }

      if (Date.now() - lastMutation >= quietWindowMs) {
        break;
      }
    }
  }

  if (autoScroll) {
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
    });

    observer.observe(document.body || document.documentElement, {
      subtree: true,
      childList: true,
      characterData: false,
      attributes: false
    });

    window.scrollTo({ top: 0, behavior: 'auto' });
    await wait(350);
    await waitForSettledContent({
      timeoutMs: Math.max(700, Math.floor(scrollPauseMs * 1.2)),
      quietWindowMs: Math.max(260, Math.floor(scrollPauseMs * 0.35))
    });

    lastHeight = getDocumentHeight();
    lastAnchorCount = getAnchorCount();

    while (scrollRounds < maxScrollRounds && stableRounds < stableRoundsTarget) {
      const mutationStart = mutationCount;
      const step = Math.max(420, Math.floor((window.innerHeight || 900) * stepMultiplier));
      const beforeTop = getScrollTop();

      window.scrollBy({ top: step, left: 0, behavior: 'auto' });
      await wait(Math.max(180, Math.floor(scrollPauseMs * 0.25)));

      const clicked = clickLoadMoreButtons();
      if (clicked) {
        loadMoreClicks += 1;
      }

      const afterTop = getScrollTop();
      const moved = afterTop > beforeTop + 10;

      await waitForSettledContent({
        timeoutMs: Math.max(1200, Math.floor(scrollPauseMs * 1.8)),
        quietWindowMs: Math.max(280, Math.floor(scrollPauseMs * 0.4))
      });

      const nextHeight = getDocumentHeight();
      const nextAnchorCount = getAnchorCount();
      const mutationDelta = mutationCount - mutationStart;

      const hasProgress =
        nextHeight > lastHeight + 8 ||
        nextAnchorCount > lastAnchorCount ||
        mutationDelta > 0 ||
        clicked;

      if (hasProgress) {
        stableRounds = 0;
      } else {
        stableRounds += 1;
      }

      if (!moved) {
        window.scrollTo({ top: nextHeight, behavior: 'auto' });
        await wait(Math.max(300, Math.floor(scrollPauseMs * 0.5)));
      }

      lastHeight = nextHeight;
      lastAnchorCount = nextAnchorCount;
      scrollRounds += 1;
    }

    observer.disconnect();
  }

  const rawNodes = [
    ...document.querySelectorAll(
      '[data-urn*="urn:li:activity"], [data-id*="urn:li:activity"], .feed-shared-update-v2, article, .occludable-update'
    )
  ];

  const unique = new Set();
  const postNodes = [];

  for (const node of rawNodes) {
    const card = node.closest('article, [data-urn], [data-id], .feed-shared-update-v2') || node;
    if (unique.has(card)) {
      continue;
    }
    unique.add(card);
    postNodes.push(card);
  }

  // Fallback discovery path for profile/activity pages where root cards may not expose expected attributes.
  const postAnchors = [
    ...document.querySelectorAll(anchorSelector)
  ];
  for (const anchor of postAnchors) {
    const card =
      anchor.closest('article, .feed-shared-update-v2, .occludable-update, [data-urn], [data-id]') ||
      findBestContext(anchor);
    if (!card || unique.has(card)) {
      continue;
    }
    unique.add(card);
    postNodes.push(card);
  }

  const posts = [];

  for (const node of postNodes.slice(0, 250)) {
    const linkCountInside = node.querySelectorAll('a[href*="/feed/update/urn:li:"], a[href*="/posts/"]').length;
    if (linkCountInside > 8) {
      continue;
    }

    const urn =
      node.getAttribute('data-urn') ||
      node.getAttribute('data-id') ||
      node.querySelector('[data-urn]')?.getAttribute('data-urn') ||
      '';

    const postLink =
      node.querySelector('a[href*="/feed/update/urn:li:"]')?.href ||
      node.querySelector('a[href*="/posts/"]')?.href ||
      '';

    const bodyText = extractPostBodyText(node);

    if (!bodyText || bodyText.length < 8) {
      continue;
    }

    const timeEl = node.querySelector('time');
    const createdAt =
      timeEl?.getAttribute('datetime') ||
      timeEl?.dateTime ||
      new Date().toISOString();

    const textBlock = node.innerText || '';
    const impressions = parseMetricLocal(textBlock, [
      /(\d[\d.,]*\s*[km]?)\s*impressions?/,
      /(\d[\d.,]*\s*[km]?)\s*views?/
    ]);
    const reactions = parseMetricOptionalLocal(textBlock, [
      /(\d[\d.,]*\s*[km]?)\s*reactions?/,
      /(\d[\d.,]*\s*[km]?)\s*likes?/,
      /and\s+(\d[\d.,]*\s*[km]?)\s+others\s+reacted/,
      /(\d[\d.,]*\s*[km]?)\s+others\s+reacted/
    ]);
    const comments = parseMetricOptionalLocal(textBlock, [
      /(\d[\d.,]*\s*[km]?)\s*comments?/
    ]);
    const reposts = parseMetricOptionalLocal(textBlock, [
      /(\d[\d.,]*\s*[km]?)\s*reposts?/,
      /(\d[\d.,]*\s*[km]?)\s*shares?/
    ]);

    const post = {
      id: urn || postLink || `${createdAt}-${bodyText.slice(0, 20)}`,
      sourceId: urn,
      postUrl: postLink,
      text: bodyText,
      imageUrl: extractPreviewImageUrl(node),
      isRepost: inferRepost(node, bodyText),
      contentType: inferContentTypeLocal(node),
      createdAt,
      impressions,
      reactions,
      comments,
      reposts,
      // These metrics are usually not present in feed/activity DOM; keep as null (unknown), not zero.
      clicks: null,
      saves: null,
      profileVisits: null,
      source: 'chrome-extension'
    };

    posts.push(post);
  }

  return {
    posts,
    diagnostics: {
      url: window.location.href,
      candidateCards: postNodes.length,
      anchorMatches: postAnchors.length,
      autoScroll,
      speedProfile,
      scrollRounds,
      stableRounds,
      finalHeight: lastHeight,
      finalAnchorCount: lastAnchorCount || postAnchors.length,
      loadMoreClicks,
      mutationCount
    }
  };
}

function dedupePosts(posts) {
  const byKey = new Map();

  for (const post of posts) {
    const key = post.postUrl || post.sourceId || post.id;
    if (!key) {
      continue;
    }

    if (!byKey.has(key)) {
      byKey.set(key, post);
      continue;
    }

    const previous = byKey.get(key);
    byKey.set(key, {
      ...previous,
      ...post,
      createdAt: previous.createdAt || post.createdAt,
      imageUrl: post.imageUrl || previous.imageUrl || '',
      isRepost: Boolean(previous.isRepost || post.isRepost),
      impressions: Math.max(Number(previous.impressions || 0), Number(post.impressions || 0)),
      reactions: Math.max(Number(previous.reactions || 0), Number(post.reactions || 0)),
      comments: Math.max(Number(previous.comments || 0), Number(post.comments || 0)),
      reposts: Math.max(Number(previous.reposts || 0), Number(post.reposts || 0))
    });
  }

  return [...byKey.values()];
}

async function getStoredPosts() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

async function setStoredPosts(posts) {
  await chrome.storage.local.set({ [STORAGE_KEY]: posts });
}

async function captureCurrentTab(options = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url?.includes('linkedin.com')) {
    throw new Error('Open a LinkedIn tab first, then run capture.');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractLinkedInPostsFromDom,
    args: [options]
  });

  const scriptResult = results?.[0] || null;
  const captured = Array.isArray(scriptResult?.result?.posts) ? scriptResult.result.posts : [];
  const diagnostics = scriptResult?.result?.diagnostics || null;
  const executionError = scriptResult?.error ? String(scriptResult.error) : null;

  if (executionError) {
    return {
      captured: 0,
      totalStored: (await getStoredPosts()).length,
      diagnostics,
      error: executionError
    };
  }

  if (captured.length === 0) {
    return {
      captured: 0,
      totalStored: (await getStoredPosts()).length,
      diagnostics
    };
  }

  const existing = await getStoredPosts();
  const merged = dedupePosts([...existing, ...captured]);
  await setStoredPosts(merged);

  return {
    captured: captured.length,
    totalStored: merged.length,
    diagnostics
  };
}

async function captureAllCurrentTab(speedProfile = 'fast') {
  return captureCurrentTab({
    autoScroll: true,
    speedProfile
  });
}

function getCaptureAllJobStatus() {
  return { ...captureAllJob };
}

function startCaptureAllJob(speedProfile = 'fast') {
  if (captureAllJob.status === 'running') {
    return { started: false, alreadyRunning: true, job: getCaptureAllJobStatus() };
  }

  captureAllJob = {
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null
  };

  (async () => {
    try {
      const result = await captureAllCurrentTab(speedProfile);
      captureAllJob = {
        status: 'completed',
        startedAt: captureAllJob.startedAt,
        finishedAt: new Date().toISOString(),
        result,
        error: null
      };
    } catch (error) {
      captureAllJob = {
        status: 'failed',
        startedAt: captureAllJob.startedAt,
        finishedAt: new Date().toISOString(),
        result: null,
        error: error?.message || 'Capture all failed.'
      };
    }
  })();

  return { started: true, alreadyRunning: false, job: getCaptureAllJobStatus() };
}

async function syncToDashboard() {
  const posts = await getStoredPosts();
  if (!posts.length) {
    throw new Error('No captured posts in extension storage. Capture first.');
  }

  let lastError = null;

  for (const endpoint of DEFAULT_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Sync failed (${response.status})`);
      }

      const payload = await response.json();
      return {
        ok: true,
        endpoint,
        ingested: payload.ingested || posts.length,
        totalPosts: payload.totalPosts || payload.posts?.length || 0
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'Unable to reach local dashboard API on port 5173.');
}

async function clearStoredPosts() {
  await setStoredPosts([]);
  return { ok: true, totalStored: 0 };
}

async function getStatus() {
  const posts = await getStoredPosts();
  return {
    totalStored: posts.length,
    latestPostDate: posts[0]?.createdAt || null
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message?.type === 'capture') {
      return captureCurrentTab();
    }

    if (message?.type === 'captureAll') {
      return captureAllCurrentTab();
    }

    if (message?.type === 'captureAllStart') {
      return startCaptureAllJob(message?.speedProfile || 'fast');
    }

    if (message?.type === 'captureAllStatus') {
      return getCaptureAllJobStatus();
    }

    if (message?.type === 'sync') {
      return syncToDashboard();
    }

    if (message?.type === 'clear') {
      return clearStoredPosts();
    }

    if (message?.type === 'status') {
      return getStatus();
    }

    if (message?.type === 'getPosts') {
      const posts = await getStoredPosts();
      return { posts };
    }

    return { ok: true };
  };

  run()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'Unknown error' }));

  return true;
});
