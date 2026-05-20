import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'posts.json');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function hashText(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function sanitizeContentType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['text', 'image', 'video', 'document', 'poll', 'article'].includes(normalized)) {
    return normalized;
  }
  return 'text';
}

function decodeLinkedInActivityTimestamp(input) {
  const raw = String(input || '');
  const match = raw.match(/activity[:/-](\d{15,20})/i) || raw.match(/(\d{15,20})/);
  if (!match) {
    return null;
  }

  try {
    const id = BigInt(match[1]);
    const ms = Number(id >> 22n);
    if (!Number.isFinite(ms)) {
      return null;
    }

    const min = Date.parse('2010-01-01T00:00:00.000Z');
    const max = Date.now() + 2 * 24 * 60 * 60 * 1000;
    if (ms < min || ms > max) {
      return null;
    }

    return ms;
  } catch {
    return null;
  }
}

function normalizePost(post, index = 0) {
  const text = String(post.text || post.caption || post.description || '').trim();
  const createdAtValue = post.createdAt || post.publishedAt || post.date || new Date().toISOString();
  const decodedTimestamp =
    decodeLinkedInActivityTimestamp(post.postUrl) ||
    decodeLinkedInActivityTimestamp(post.sourceId) ||
    decodeLinkedInActivityTimestamp(post.id);
  const createdAt = decodedTimestamp
    ? new Date(decodedTimestamp).toISOString()
    : Number.isNaN(Date.parse(createdAtValue))
      ? new Date().toISOString()
      : new Date(createdAtValue).toISOString();

  const impressions = toFiniteNumber(post.impressions || post.views || post.viewCount);
  const reactions = toFiniteNumber(post.reactions || post.likes);
  const comments = toFiniteNumber(post.comments || post.commentCount);
  const reposts = toFiniteNumber(post.reposts || post.shares || post.repostCount);
  const clicks = toFiniteNumber(post.clicks || post.clickCount);
  const saves = toFiniteNumber(post.saves || post.saveCount);
  const videoViews = toFiniteNumber(post.videoViews || post.videoViewCount);
  const profileVisits = toFiniteNumber(post.profileVisits || post.profileViewCount);

  const engagement =
    toFiniteNumber(post.engagement) || reactions + comments + reposts + clicks + saves;

  const postUrl =
    String(post.postUrl || post.url || post.link || '').trim() ||
    `https://www.linkedin.com/feed/update/urn:li:activity:${Date.now()}${index}`;

  const idSeed = String(post.id || post.urn || postUrl || `${createdAt}-${text}`);
  const id = `li_${hashText(idSeed)}`;
  const imageUrl = String(
    post.imageUrl || post.previewImageUrl || post.thumbnailUrl || post.mediaUrl || ''
  ).trim();
  const isRepost =
    Boolean(post.isRepost) ||
    String(post.postType || '').toLowerCase() === 'repost' ||
    /\breposted\b|\bshared\b/i.test(String(post.text || ''));

  return {
    id,
    sourceId: String(post.sourceId || post.id || post.urn || ''),
    postUrl,
    authorName: String(post.authorName || post.author || '').trim() || 'Me',
    text,
    imageUrl,
    isRepost,
    contentType: sanitizeContentType(post.contentType),
    createdAt,
    capturedAt: new Date().toISOString(),
    impressions,
    reactions,
    comments,
    reposts,
    clicks,
    saves,
    videoViews,
    profileVisits,
    engagement,
    source: String(post.source || 'chrome-extension')
  };
}

function mergePosts(oldPost, newPost) {
  const merged = { ...oldPost, ...newPost };

  merged.createdAt = oldPost.createdAt || newPost.createdAt;
  merged.text = (newPost.text || '').length > (oldPost.text || '').length ? newPost.text : oldPost.text;
  merged.imageUrl = newPost.imageUrl || oldPost.imageUrl || '';
  merged.isRepost = Boolean(oldPost.isRepost || newPost.isRepost);

  merged.impressions = Math.max(oldPost.impressions || 0, newPost.impressions || 0);
  merged.reactions = Math.max(oldPost.reactions || 0, newPost.reactions || 0);
  merged.comments = Math.max(oldPost.comments || 0, newPost.comments || 0);
  merged.reposts = Math.max(oldPost.reposts || 0, newPost.reposts || 0);
  merged.clicks = Math.max(oldPost.clicks || 0, newPost.clicks || 0);
  merged.saves = Math.max(oldPost.saves || 0, newPost.saves || 0);
  merged.videoViews = Math.max(oldPost.videoViews || 0, newPost.videoViews || 0);
  merged.profileVisits = Math.max(oldPost.profileVisits || 0, newPost.profileVisits || 0);
  merged.engagement =
    Math.max(oldPost.engagement || 0, newPost.engagement || 0) ||
    merged.reactions + merged.comments + merged.reposts + merged.clicks + merged.saves;

  return merged;
}

function mulberry32(seed) {
  let value = seed;
  return function random() {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createDemoPosts(count = 72) {
  const random = mulberry32(19061995);
  const now = Date.now();
  const contentTypes = ['text', 'image', 'video', 'document', 'article'];
  const topics = [
    'B2B growth',
    'product storytelling',
    'career lessons',
    'founder journey',
    'AI workflows',
    'sales leadership',
    'team culture',
    'market insights'
  ];

  const demo = [];

  for (let i = 0; i < count; i += 1) {
    const dayOffset = Math.floor(random() * 150);
    const createdAt = new Date(now - dayOffset * 24 * 60 * 60 * 1000);
    const impressions = Math.floor(600 + random() * 28000);
    const reactions = Math.floor(impressions * (0.01 + random() * 0.06));
    const comments = Math.floor(reactions * (0.08 + random() * 0.4));
    const reposts = Math.floor(reactions * (0.05 + random() * 0.3));
    const clicks = Math.floor(impressions * (0.003 + random() * 0.02));
    const saves = Math.floor(reactions * (0.03 + random() * 0.2));
    const videoViews = Math.floor(impressions * (0.15 + random() * 0.5));
    const profileVisits = Math.floor(impressions * (0.004 + random() * 0.02));
    const topic = topics[Math.floor(random() * topics.length)];
    const contentType = contentTypes[i % contentTypes.length];

    const post = normalizePost(
      {
        sourceId: `demo-${i}`,
        postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:demo-${i}`,
        authorName: 'You',
        text: `Post ${i + 1}: Thoughts on ${topic}. Practical takeaways and field notes from the week.`,
        imageUrl:
          contentType === 'image'
            ? `https://picsum.photos/seed/linkedin-${i}/320/180`
            : '',
        isRepost: i % 5 === 0,
        contentType,
        createdAt: createdAt.toISOString(),
        impressions,
        reactions,
        comments,
        reposts,
        clicks,
        saves,
        videoViews,
        profileVisits,
        source: 'demo-data'
      },
      i
    );

    demo.push(post);
  }

  return demo.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    const empty = { updatedAt: new Date().toISOString(), posts: [] };
    await fs.writeFile(DATA_FILE, JSON.stringify(empty, null, 2), 'utf8');
  }
}

async function readData() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.posts)) {
      return { updatedAt: new Date().toISOString(), posts: [] };
    }
    return parsed;
  } catch {
    return { updatedAt: new Date().toISOString(), posts: [] };
  }
}

async function writeData(posts) {
  const payload = {
    updatedAt: new Date().toISOString(),
    posts: posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  };
  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (!text) {
          resolve({});
          return;
        }
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  return fs
    .readFile(filePath)
    .then((content) => {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    })
    .catch(() => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });
}

function resolveStaticPath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const safePath = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.normalize(path.join(ROOT_DIR, safePath));

  if (!resolved.startsWith(ROOT_DIR)) {
    return null;
  }

  return resolved;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
    return;
  }

  if (url.pathname === '/api/posts' && req.method === 'GET') {
    const data = await readData();
    sendJson(res, 200, data);
    return;
  }

  if (url.pathname === '/api/posts' && req.method === 'DELETE') {
    const next = await writeData([]);
    sendJson(res, 200, { ...next, message: 'All posts cleared.' });
    return;
  }

  if (url.pathname === '/api/posts/demo' && req.method === 'POST') {
    const existing = await readData();
    const demoPosts = createDemoPosts(72);
    const byKey = new Map();

    for (const post of existing.posts) {
      byKey.set(post.postUrl || post.id, post);
    }

    for (const post of demoPosts) {
      const key = post.postUrl || post.id;
      const prev = byKey.get(key);
      byKey.set(key, prev ? mergePosts(prev, post) : post);
    }

    const next = await writeData([...byKey.values()]);
    sendJson(res, 200, {
      ...next,
      ingested: demoPosts.length,
      totalPosts: next.posts.length,
      message: 'Demo posts generated successfully.'
    });
    return;
  }

  if (url.pathname === '/api/posts/ingest' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const incomingRaw = Array.isArray(body) ? body : body.posts;

      if (!Array.isArray(incomingRaw) || incomingRaw.length === 0) {
        sendJson(res, 400, { error: 'Payload must include a non-empty posts array.' });
        return;
      }

      const incoming = incomingRaw.map((post, index) => normalizePost(post, index));
      const existing = await readData();
      const byKey = new Map();

      for (const post of existing.posts) {
        byKey.set(post.postUrl || post.id, post);
      }

      for (const post of incoming) {
        const key = post.postUrl || post.id;
        const previous = byKey.get(key);
        byKey.set(key, previous ? mergePosts(previous, post) : post);
      }

      const next = await writeData([...byKey.values()]);

      sendJson(res, 200, {
        ...next,
        ingested: incoming.length,
        totalPosts: next.posts.length,
        message: 'Posts ingested successfully.'
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Unable to ingest posts.' });
    }
    return;
  }

  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  await sendFile(res, filePath);
});

server.listen(PORT, HOST, async () => {
  await ensureDataFile();
  console.log(`LinkedIn analytics app running on http://${HOST}:${PORT}`);
});
