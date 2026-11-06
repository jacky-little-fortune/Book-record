import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DUE_DATE_NOTE,
  activeLoan,
  addDays,
  applyBorrow,
  buildSampleBooks,
  cardById,
  cleanCoverUrl,
  createBook,
  defaultDueDate,
  formatWantList,
  isDueSoon,
  matchesFilters,
  parseBackup,
  parseRoute,
  serializeBackup,
  statsByMonth,
  statusFlags,
  visibleBooks,
} from '../js/model.js';

const TODAY = '2026-11-06';

test('封面網址只接受 Open Library 與 Google Books 的 https', () => {
  assert.equal(cleanCoverUrl('https://covers.openlibrary.org/b/isbn/9780399226908-M.jpg?default=false'), 'https://covers.openlibrary.org/b/isbn/9780399226908-M.jpg?default=false');
  assert.equal(cleanCoverUrl('http://books.google.com/books/content?id=1'), 'https://books.google.com/books/content?id=1');
  assert.equal(cleanCoverUrl('javascript:alert(1)'), '');
  assert.equal(cleanCoverUrl('https://evil.example/cover.jpg'), '');
});

test('借期按借出日加上日數', () => {
  assert.equal(addDays('2026-11-06', 14), '2026-11-20');
  assert.equal(defaultDueDate('2026-01-31', 14), '2026-02-14');
});

test('將到期包含今天、3 日內和已逾期，不含第 4 日', () => {
  const book = (due) => ({
    history: [{ id: '1', card: 'mom', borrowDate: '2026-10-01', dueDate: due, returnDate: null }],
  });
  assert.equal(isDueSoon(book(TODAY), TODAY), true);
  assert.equal(isDueSoon(book(addDays(TODAY, 3)), TODAY), true);
  assert.equal(isDueSoon(book(addDays(TODAY, 4)), TODAY), false);
  assert.equal(isDueSoon(book(addDays(TODAY, -1)), TODAY), true);
  assert.equal(isDueSoon({ history: [] }, TODAY), false);
  const returned = {
    history: [{ id: '1', card: 'mom', borrowDate: '2026-10-01', dueDate: '2026-10-02', returnDate: '2026-10-03' }],
  };
  assert.equal(isDueSoon(returned, TODAY), false);
});

test('篩選芯片用 AND', () => {
  const books = buildSampleBooks(TODAY);
  const borrowing = books.filter((book) => matchesFilters(book, ['借閱中'], TODAY));
  const dueSoon = books.filter((book) => matchesFilters(book, ['借閱中', '將到期'], TODAY));
  const impossible = books.filter((book) => matchesFilters(book, ['借閱中', '未借閱'], TODAY));
  const reservedWanted = books.filter((book) => matchesFilters(book, ['已預約', '想借'], TODAY));
  const returned = books.filter((book) => matchesFilters(book, ['未借閱', '已借過'], TODAY));
  assert.equal(borrowing.length, 3);
  assert.equal(dueSoon.length, 2);
  assert.equal(impossible.length, 0);
  assert.equal(reservedWanted.length, 1);
  assert.equal(reservedWanted[0].title, '鱷魚怕怕牙醫怕怕');
  assert.equal(returned.length, 2);
  assert.equal(visibleBooks(books, [], '', TODAY).length, books.length);
});

test('範例不填索書號或 ISBN', () => {
  const books = buildSampleBooks(TODAY);
  assert.equal(books.length, 8);
  for (const book of books) {
    assert.equal(book.callNumber, '');
    assert.equal(book.isbn, '');
  }
  const text = formatWantList(books);
  assert.match(text, /花格子大象艾瑪/);
  assert.match(text, /鱷魚怕怕牙醫怕怕/);
  assert.doesNotMatch(text, /索書號/);
  assert.doesNotMatch(text, /ISBN/);
  assert.match(text, /作者：/);
});

test('想借清單只在有資料時寫索書號和 ISBN', () => {
  const book = {
    title: '小書',
    author: '某人',
    callNumber: '',
    isbn: '978-123',
    wanted: true,
  };
  const text = formatWantList([book]);
  assert.match(text, /1\. 小書/);
  assert.match(text, /作者：某人/);
  assert.match(text, /ISBN：978-123/);
  assert.doesNotMatch(text, /索書號/);
});

test('借出寫入所選借書卡，已借出不能再借', () => {
  const created = createBook({ title: '小船' }, '2026-11-06T00:00:00.000Z', 'book-1');
  const borrowed = applyBorrow(created.book, {
    card: 'daughter',
    borrowDate: TODAY,
    dueDate: addDays(TODAY, 14),
    id: 'loan-1',
    nowIso: '2026-11-06T01:00:00.000Z',
  });
  assert.equal(borrowed.ok, true);
  assert.equal(borrowed.book.reserved, false);
  assert.equal(activeLoan(borrowed.book).card, 'daughter');
  assert.equal(cardById(activeLoan(borrowed.book).card).tone, 'mint');
  assert.equal(statusFlags(borrowed.book, TODAY)['借閱中'], true);
  const again = applyBorrow(borrowed.book, {
    card: 'mom',
    borrowDate: TODAY,
    dueDate: addDays(TODAY, 14),
    id: 'loan-2',
    nowIso: '2026-11-06T02:00:00.000Z',
  });
  assert.equal(again.ok, false);
});

test('統計按借出月份計次', () => {
  const rows = statsByMonth(buildSampleBooks(TODAY));
  const november = rows.find((row) => row.month === '2026-11');
  const october = rows.find((row) => row.month === '2026-10');
  const september = rows.find((row) => row.month === '2026-09');
  assert.equal(november.total, 1);
  assert.equal(november.dad, 1);
  assert.equal(october.mom, 2);
  assert.equal(october.daughter, 1);
  assert.equal(september.daughter, 1);
});

test('JSON 備份可匯入，並拒絕其他檔案', () => {
  const state = {
    version: 1,
    settings: { loanDays: { mom: 21, dad: 14, daughter: 10 } },
    books: buildSampleBooks(TODAY),
  };
  const parsed = parseBackup(serializeBackup(state, '2026-11-06T00:00:00.000Z'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.books.length, 8);
  assert.equal(parsed.state.settings.loanDays.mom, 21);
  assert.equal(parseBackup('不是 json').ok, false);
  assert.equal(parseBackup(JSON.stringify({ app: '別的', books: [] })).ok, false);
});

test('路由', () => {
  assert.deepEqual(parseRoute('#/'), { name: 'list' });
  assert.deepEqual(parseRoute(''), { name: 'list' });
  assert.deepEqual(parseRoute('#/book/new'), { name: 'edit', id: null });
  assert.deepEqual(parseRoute('#/book/abc/borrow'), { name: 'borrow', id: 'abc' });
  assert.equal(parseRoute('#/nope').name, 'missing');
});

test('設定句子和說明檔使用同一句到期日假設', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(readme, new RegExp(DUE_DATE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(app, /DUE_DATE_NOTE/);
  assert.equal(
    DUE_DATE_NOTE,
    '到期日假設：香港公共圖書館一般圖書借期預設 14 日（可於設定調整）；實際以圖書館規定為準。',
  );
});
