import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hkplCatalogUrl, isValidIsbn10, isValidIsbn13, lookupIsbn, parseIsbn } from '../js/isbn.js';

const ISBN13 = '9780399226908';
const ISBN10 = '0399226907';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('ISBN-10 與 ISBN-13 可以互換，橫線不影響', () => {
  assert.equal(isValidIsbn10(ISBN10), true);
  assert.equal(isValidIsbn13(ISBN13), true);
  assert.deepEqual(parseIsbn(`ISBN ${ISBN10}`), { ok: true, isbn13: ISBN13, isbn10: ISBN10 });
  assert.deepEqual(parseIsbn('978-0-399-22690-8'), { ok: true, isbn13: ISBN13, isbn10: ISBN10 });
  assert.equal(parseIsbn('9780399226909').ok, false);
  assert.match(parseIsbn('9780399226909').error, /校驗/);
  assert.match(parseIsbn('').error, /請先輸入或掃描/);
  assert.match(parseIsbn('12345').error, /格式不正確/);
});

test('不是圖書的條碼不會當成 ISBN', () => {
  const result = parseIsbn('4006381333931');
  assert.equal(result.ok, false);
  assert.match(result.error, /不是圖書 ISBN/);
});

test('Open Library 有資料時填上書名、作者、簡介和 ISBN', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/isbn/')) {
      return jsonResponse(200, {
        title: 'The Very Hungry Caterpillar',
        description: 'A hungry caterpillar eats.<br>Then he sleeps.',
        authors: [{ key: '/authors/OL1A' }],
        isbn_13: [ISBN13],
        publishers: ['Philomel Books'],
        works: [{ key: '/works/OL1W' }],
      });
    }
    if (url.includes('/api/books')) {
      return jsonResponse(200, {
        [`ISBN:${ISBN13}`]: {
          title: 'The Very Hungry Caterpillar',
          authors: [{ name: 'Eric Carle' }],
          publishers: [{ name: 'Philomel Books' }],
        },
      });
    }
    return jsonResponse(404, {});
  };
  const result = await lookupIsbn(ISBN10, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.sourceName, 'Open Library');
  assert.equal(result.book.title, 'The Very Hungry Caterpillar');
  assert.equal(result.book.author, 'Eric Carle');
  assert.match(result.book.synopsis, /hungry caterpillar/);
  assert.doesNotMatch(result.book.synopsis, /<br>/);
  assert.equal(result.book.isbn, ISBN13);
  assert.equal(result.book.publisher, 'Philomel Books');
});

test('Open Library 沒有時改經代理查 Google Books', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('openlibrary.org')) return jsonResponse(404, {});
    if (url.includes('/lookup?isbn=')) {
      return jsonResponse(200, {
        title: '好餓的毛毛蟲',
        author: '艾瑞·卡爾',
        synopsis: '星期一吃蘋果。',
        isbn: ISBN13,
        publisher: '上誼',
      });
    }
    return jsonResponse(404, {});
  };
  const result = await lookupIsbn(ISBN13, { fetchImpl, googleBooksProxyBase: 'https://gb-proxy.test' });
  assert.equal(result.ok, true);
  assert.equal(result.sourceName, 'Google Books');
  assert.equal(result.book.title, '好餓的毛毛蟲');
  assert.equal(result.book.author, '艾瑞·卡爾');
  assert.equal(result.book.synopsis, '星期一吃蘋果。');
  assert.equal(result.book.publisher, '上誼');
  assert.ok(seen.some((url) => url.startsWith('https://gb-proxy.test/lookup?isbn=')));
  assert.equal(seen.some((url) => url.includes('googleapis.com')), false);
});

test('兩邊都沒有時說明找不到，不假裝成功', async () => {
  const fetchImpl = async () => jsonResponse(404, {});
  const result = await lookupIsbn(ISBN13, { fetchImpl, googleBooksProxyBase: 'https://gb-proxy.test' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_found');
  assert.equal(result.isbn, ISBN13);
  assert.match(result.error, /找不到這本書/);
  assert.doesNotMatch(result.error, /請檢查網絡/);
});

test('Open Library 失敗而且 Google 代理回 429 時說明忙碌，不是網絡問題', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('openlibrary.org')) return jsonResponse(500, { error: 'upstream' });
    return jsonResponse(429, { error: 'rate_limited' });
  };
  const result = await lookupIsbn(ISBN13, { fetchImpl, googleBooksProxyBase: 'https://gb-proxy.test' });
  assert.equal(result.code, 'busy');
  assert.match(result.error, /忙碌|上限/);
  assert.doesNotMatch(result.error, /請檢查網絡/);
  assert.equal(result.isbn, ISBN13);
});

test('連線失敗時說明檢查網絡', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  const result = await lookupIsbn(ISBN13, { fetchImpl, googleBooksProxyBase: 'https://gb-proxy.test' });
  assert.equal(result.code, 'network');
  assert.match(result.error, /請檢查網絡/);
  assert.equal(result.isbn, ISBN13);
});

test('未設定代理時仍可只用 Open Library，找不到會說明代理未設定', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return jsonResponse(404, {});
  };
  const result = await lookupIsbn(ISBN13, { fetchImpl, googleBooksProxyBase: '' });
  assert.equal(result.code, 'not_configured');
  assert.match(result.error, /代理尚未設定/);
  assert.equal(seen.some((url) => url.includes('googleapis.com') || url.includes('/lookup')), false);
});

test('香港公共圖書館連結使用 ISBN-13，不抓索書號', () => {
  assert.equal(
    hkplCatalogUrl(ISBN13),
    `https://webcat.hkpl.gov.hk/search/query?field_1=isbn&match_1=MUST&term_1=${ISBN13}&theme=WEB`,
  );
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const isbn = readFileSync(new URL('../js/isbn.js', import.meta.url), 'utf8');
  assert.match(app, /在香港公共圖書館開啟/);
  assert.match(app, /rel="noopener/);
  assert.doesNotMatch(isbn, /googleapis\.com/);
  assert.doesNotMatch(isbn, /AIza/);
  assert.doesNotMatch(app, /AIza/);
});

test('沒有網絡時保留 ISBN 並說明清單仍可離線使用', async () => {
  let called = false;
  const result = await lookupIsbn(ISBN13, {
    online: false,
    fetchImpl: () => {
      called = true;
      return jsonResponse(200, {});
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /需要網絡/);
  assert.match(result.error, /離線/);
});

test('說明檔有掃描和手動查詢', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /掃描條碼/);
  assert.match(readme, /查資料/);
  assert.match(readme, /Open Library/);
  assert.match(readme, /Google Books/);
  assert.match(readme, /不會把借閱紀錄送到香港公共圖書館/);
});
