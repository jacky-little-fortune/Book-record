import assert from 'node:assert/strict';
import test from 'node:test';
import { handle, resetRateLimits } from '../worker/src/index.js';

const ISBN = '9780399226908';
const PAGE = 'https://jacky-little-fortune.github.io';

function request(path, { origin = PAGE, ip = '203.0.113.10', method = 'GET' } = {}) {
  return new Request(`https://book-record-gb.test${path}`, {
    method,
    headers: { Origin: origin, 'CF-Connecting-IP': ip, Accept: 'application/json' },
  });
}

function googlePayload() {
  return {
    items: [
      {
        volumeInfo: {
          title: '好餓的毛毛蟲',
          authors: ['艾瑞·卡爾'],
          description: '<p>星期一吃蘋果。</p>',
          publisher: '上誼',
          industryIdentifiers: [{ type: 'ISBN_13', identifier: ISBN }],
          imageLinks: { thumbnail: 'https://example.test/cover.jpg' },
          previewLink: 'https://books.google.com/secret',
        },
      },
    ],
  };
}

test('拒絕無效 ISBN、缺少密鑰，以及不允許的來源', async () => {
  resetRateLimits();
  const bad = await handle(request(`/lookup?isbn=9780399226909`), { GOOGLE_BOOKS_API_KEY: 'test-key' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_isbn');

  const missing = await handle(request(`/lookup?isbn=${ISBN}`, { ip: '203.0.113.11' }), {});
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'not_configured');

  const forbidden = await handle(request(`/lookup?isbn=${ISBN}`, { origin: 'https://evil.example', ip: '203.0.113.12' }), {
    GOOGLE_BOOKS_API_KEY: 'test-key',
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get('Access-Control-Allow-Origin'), null);
});

test('只回傳整理過的書目，並加上允許的 CORS', async () => {
  resetRateLimits();
  let called = '';
  const response = await handle(
    request(`/lookup?isbn=${ISBN}`, { ip: '203.0.113.20' }),
    { GOOGLE_BOOKS_API_KEY: 'test-key' },
    {
      fetch: async (url) => {
        called = String(url);
        return new Response(JSON.stringify(googlePayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PAGE);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['author', 'cover', 'isbn', 'publisher', 'synopsis', 'title']);
  assert.equal(body.cover, 'https://example.test/cover.jpg');
  assert.equal(body.title, '好餓的毛毛蟲');
  assert.equal(body.author, '艾瑞·卡爾');
  assert.equal(body.synopsis, '星期一吃蘋果。');
  assert.equal(body.isbn, ISBN);
  assert.equal(called.includes('key=test-key'), true);
  assert.equal(called.includes('googleapis.com'), true);
  assert.equal(JSON.stringify(body).includes('previewLink'), false);
});

test('本機來源可以通過，Google 沒有資料時是 not_found', async () => {
  resetRateLimits();
  const response = await handle(
    request(`/books?isbn=${ISBN}`, { origin: 'http://127.0.0.1:8765', ip: '203.0.113.21' }),
    { GOOGLE_BOOKS_API_KEY: 'test-key' },
    { fetch: async () => new Response(JSON.stringify({ totalItems: 0 }), { status: 200 }) },
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8765');
  assert.equal((await response.json()).error, 'not_found');
});

test('同一 IP 超過次數會被限制', async () => {
  resetRateLimits();
  const ip = '203.0.113.30';
  let last = 0;
  for (let i = 0; i < 31; i += 1) {
    const response = await handle(request(`/lookup?isbn=${ISBN}`, { ip }), { GOOGLE_BOOKS_API_KEY: 'test-key' }, {
      fetch: async () => new Response(JSON.stringify({ totalItems: 0 }), { status: 200 }),
    });
    last = response.status;
  }
  assert.equal(last, 429);
});
