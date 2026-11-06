const BOOK_PREFIXES = ['978', '979'];

export function plainText(value) {
  if (!value) return '';
  if (typeof value === 'object') value = value.value || '';
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isbn10CheckDigit(body9) {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (10 - i) * Number(body9[i]);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
}

export function isbn13CheckDigit(body12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  return isbn10CheckDigit(isbn.slice(0, 9)) === isbn[9];
}

export function isValidIsbn13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  return isbn13CheckDigit(isbn.slice(0, 12)) === isbn[12];
}

export function isbn10to13(isbn10) {
  const core = `978${isbn10.slice(0, 9)}`;
  return `${core}${isbn13CheckDigit(core)}`;
}

export function isbn13to10(isbn13) {
  if (!isbn13.startsWith('978')) return '';
  const core = isbn13.slice(3, 12);
  return `${core}${isbn10CheckDigit(core)}`;
}

export function parseIsbn(input) {
  const raw = String(input || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (!raw) return { ok: false, error: '請先輸入或掃描 ISBN。' };
  if (raw.length === 12 && /^\d{12}$/.test(raw)) return parseIsbn(`0${raw}`);
  if (raw.length === 13 && isValidIsbn13(raw)) {
    if (!BOOK_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
      return { ok: false, error: '這組條碼不是圖書 ISBN。請掃描書後標著 ISBN 的條碼。' };
    }
    return { ok: true, isbn13: raw, isbn10: isbn13to10(raw) };
  }
  if (raw.length === 10 && isValidIsbn10(raw)) {
    return { ok: true, isbn13: isbn10to13(raw), isbn10: raw };
  }
  if (raw.length === 10 || raw.length === 13) {
    return { ok: false, error: '這個 ISBN 校驗不正確，請再核對一次。' };
  }
  return { ok: false, error: '這個 ISBN 格式不正確。請輸入 10 位或 13 位，或掃描書後的條碼。' };
}

function clip(value, max) {
  const text = plainText(value);
  return text.length > max ? text.slice(0, max) : text;
}

function publisherName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return publisherName(value[0]);
  return String(value.name || '').trim();
}

async function fetchJson(fetchImpl, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) return { missing: true, status: 404 };
    if (!response.ok) {
      const error = new Error('http');
      error.status = response.status;
      throw error;
    }
    return { missing: false, status: response.status, data: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

function bookFromDataApi(data, isbn) {
  if (!data || typeof data !== 'object') return null;
  return data[`ISBN:${isbn}`] || Object.values(data).find((item) => item && item.title) || null;
}

async function lookupOpenLibrary(parsed, fetchImpl) {
  const candidates = [...new Set([parsed.isbn13, parsed.isbn10].filter(Boolean))];
  let edition = null;
  let summary = null;
  for (const isbn of candidates) {
    const [editionResult, summaryResult] = await Promise.all([
      fetchJson(fetchImpl, `https://openlibrary.org/isbn/${isbn}.json`),
      fetchJson(fetchImpl, `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`),
    ]);
    if (!summaryResult.missing) summary = bookFromDataApi(summaryResult.data, isbn);
    if (!editionResult.missing) edition = editionResult.data;
    if (edition?.title || summary?.title) break;
  }
  if (!edition?.title && !summary?.title) return null;

  let synopsis = clip(edition?.description, 5000);
  const workKey = edition?.works?.[0]?.key;
  if (!synopsis && workKey) {
    try {
      const work = await fetchJson(fetchImpl, `https://openlibrary.org${workKey}.json`);
      if (!work.missing) synopsis = clip(work.data?.description, 5000);
    } catch {
      synopsis = '';
    }
  }
  if (!synopsis) synopsis = clip(summary?.excerpts?.[0]?.text || summary?.notes, 5000);

  let authors = (summary?.authors || []).map((author) => author.name).filter(Boolean);
  if (!authors.length && edition?.authors?.length) {
    const names = await Promise.all(
      edition.authors.slice(0, 3).map(async (author) => {
        if (!author?.key) return '';
        try {
          const result = await fetchJson(fetchImpl, `https://openlibrary.org${author.key}.json`);
          return result.missing ? '' : result.data?.name || '';
        } catch {
          return '';
        }
      }),
    );
    authors = names.filter(Boolean);
  }

  const title = clip(edition?.title || summary?.title, 200);
  if (!title) return null;
  return {
    title,
    author: clip(authors.join('、'), 200),
    synopsis,
    isbn: edition?.isbn_13?.[0] || parsed.isbn13 || parsed.isbn10,
    publisher: publisherName(edition?.publishers) || publisherName(summary?.publishers),
  };
}

async function lookupGoogleBooks(parsed, fetchImpl) {
  const isbn = parsed.isbn13 || parsed.isbn10;
  const result = await fetchJson(
    fetchImpl,
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`,
  );
  if (result.missing) return null;
  const info = result.data?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const identifiers = info.industryIdentifiers || [];
  const isbn13 = identifiers.find((item) => item.type === 'ISBN_13')?.identifier;
  return {
    title: clip(info.title, 200),
    author: clip((info.authors || []).join('、'), 200),
    synopsis: clip(info.description, 5000),
    isbn: isbn13 || parsed.isbn13 || parsed.isbn10,
    publisher: publisherName(info.publisher),
  };
}

export async function lookupIsbn(input, options = {}) {
  const parsed = parseIsbn(input);
  if (!parsed.ok) return parsed;
  const online = options.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!online) {
    return {
      ok: false,
      isbn: parsed.isbn13,
      error: '查詢書目需要網絡。這份清單仍可離線查看和修改，請稍後再查，或自行填寫。',
    };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let openLibraryError = null;
  try {
    const book = await lookupOpenLibrary(parsed, fetchImpl);
    if (book?.title) return { ok: true, sourceName: 'Open Library', book };
  } catch (error) {
    openLibraryError = error;
  }
  try {
    const book = await lookupGoogleBooks(parsed, fetchImpl);
    if (book?.title) return { ok: true, sourceName: 'Google Books', book };
  } catch (error) {
    if (!openLibraryError && (error.status === 429 || error.status >= 500)) {
      return {
        ok: false,
        isbn: parsed.isbn13,
        error: '暫時查不到這本書，書目服務正忙。請稍後再試，或自行填寫。ISBN 已保留。',
      };
    }
    return {
      ok: false,
      isbn: parsed.isbn13,
      error: '查詢失敗，請檢查網絡後再試。ISBN 已保留，你可以自行填寫。',
    };
  }
  return {
    ok: false,
    isbn: parsed.isbn13,
    error: '找不到這本書的資料。ISBN 已保留，請自行填寫書名、作者和簡介。',
  };
}
