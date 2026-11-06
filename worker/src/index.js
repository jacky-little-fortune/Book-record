import { normalizeIsbn13 } from './isbn.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 30;
const ALLOWED_PAGE_ORIGIN = 'https://jacky-little-fortune.github.io';
const buckets = new Map();

export function resetRateLimits() {
  buckets.clear();
}

function allowedOrigin(origin) {
  if (!origin) return '';
  if (origin === ALLOWED_PAGE_ORIGIN) return origin;
  if (/^http:\/\/localhost(?::\d+)?$/.test(origin)) return origin;
  if (/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)) return origin;
  return '';
}

function json(body, status, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

export function takeRateLimit(ip, now = Date.now()) {
  const recent = (buckets.get(ip) || []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    buckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  buckets.set(ip, recent);
  if (buckets.size > 5000) {
    const oldest = buckets.keys().next().value;
    buckets.delete(oldest);
  }
  return true;
}

function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clip(value, max) {
  const text = plainText(value);
  return text.length > max ? text.slice(0, max) : text;
}

function coverFromLinks(links) {
  if (!links || typeof links !== 'object') return '';
  const raw = links.extraLarge || links.large || links.medium || links.small || links.thumbnail || links.smallThumbnail || '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function mapVolume(payload, fallbackIsbn) {
  const info = payload?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const identifiers = info.industryIdentifiers || [];
  const isbn13 = identifiers.find((item) => item.type === 'ISBN_13')?.identifier;
  return {
    title: clip(info.title, 200),
    author: clip((info.authors || []).join('、'), 200),
    synopsis: clip(info.description, 5000),
    isbn: isbn13 || fallbackIsbn,
    publisher: clip(info.publisher, 200),
    cover: coverFromLinks(info.imageLinks),
  };
}

async function readIsbn(request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('isbn');
  if (fromQuery) return fromQuery;
  if (request.method !== 'POST') return '';
  try {
    const body = await request.json();
    return body?.isbn || '';
  } catch {
    return '';
  }
}

export async function handle(request, env = {}, deps = {}) {
  const originHeader = request.headers.get('Origin') || '';
  const origin = allowedOrigin(originHeader);
  if (originHeader && !origin) return json({ error: 'forbidden_origin' }, 403, '');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin || ALLOWED_PAGE_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, origin);
  }

  const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
  if (path !== '/lookup' && path !== '/books') return json({ error: 'not_found' }, 404, origin);

  const isbn13 = normalizeIsbn13(await readIsbn(request));
  if (!isbn13) return json({ error: 'invalid_isbn' }, 400, origin);

  if (!takeRateLimit(clientIp(request))) {
    return json({ error: 'rate_limited' }, 429, origin, { 'Retry-After': '600' });
  }

  const apiKey = String(env.GOOGLE_BOOKS_API_KEY || '').trim();
  if (!apiKey) return json({ error: 'not_configured' }, 503, origin);

  const googleUrl = new URL('https://www.googleapis.com/books/v1/volumes');
  googleUrl.searchParams.set('q', `isbn:${isbn13}`);
  googleUrl.searchParams.set('key', apiKey);
  const doFetch = deps.fetch || fetch;
  let upstream;
  try {
    upstream = await doFetch(googleUrl, {
      headers: {
        Accept: 'application/json',
        Referer: `${ALLOWED_PAGE_ORIGIN}/`,
      },
    });
  } catch {
    return json({ error: 'upstream' }, 502, origin);
  }
  if (upstream.status === 429) return json({ error: 'rate_limited' }, 429, origin);
  if (upstream.status >= 500) return json({ error: 'upstream' }, 502, origin);
  if (!upstream.ok) return json({ error: 'upstream' }, 502, origin);

  let payload = null;
  try {
    payload = await upstream.json();
  } catch {
    return json({ error: 'upstream' }, 502, origin);
  }
  const book = mapVolume(payload, isbn13);
  if (!book) return json({ error: 'not_found' }, 404, origin);
  return json(book, 200, origin);
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
