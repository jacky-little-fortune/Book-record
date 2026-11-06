export const APP_NAME = '繪本借閱清單';

export const DUE_DATE_NOTE =
  '到期日假設：香港公共圖書館一般圖書借期預設 14 日（可於設定調整）；實際以圖書館規定為準。';

export const STATUS_FILTERS = ['未借閱', '借閱中', '將到期', '已預約', '想借', '已借過'];

export const CARDS = [
  { id: 'mom', label: '媽媽卡', tone: 'rose', swatch: '玫瑰色' },
  { id: 'dad', label: '爸爸卡', tone: 'blue', swatch: '藍色' },
  { id: 'daughter', label: '女兒卡', tone: 'mint', swatch: '薄荷綠' },
];

export const DEFAULT_LOAN_DAYS = 14;

const CARD_IDS = new Set(CARDS.map((card) => card.id));

export function cardById(id) {
  return CARDS.find((card) => card.id === id) || null;
}

export function defaultLoanDays() {
  return { mom: DEFAULT_LOAN_DAYS, dad: DEFAULT_LOAN_DAYS, daughter: DEFAULT_LOAN_DAYS };
}

export function emptyState() {
  return { version: 1, settings: { loanDays: defaultLoanDays() }, books: [] };
}

export function parseISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function formatISODate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(now = new Date()) {
  return formatISODate(now);
}

export function addDays(iso, days) {
  const date = parseISODate(iso);
  if (!date || !Number.isFinite(days)) return '';
  date.setDate(date.getDate() + days);
  return formatISODate(date);
}

export function daysFromTo(fromIso, toIso) {
  const from = parseISODate(fromIso);
  const to = parseISODate(toIso);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export function formatDisplayDate(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatMonthLabel(yearMonth) {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth || '');
  if (!match) return yearMonth || '';
  return `${match[1]}年${Number(match[2])}月`;
}

export function activeLoan(book) {
  const open = (book?.history || []).filter((loan) => !loan.returnDate);
  if (!open.length) return null;
  return open.slice().sort((a, b) => (a.borrowDate < b.borrowDate ? 1 : a.borrowDate > b.borrowDate ? -1 : 0))[0];
}

export function isOverdue(book, today) {
  const loan = activeLoan(book);
  if (!loan?.dueDate) return false;
  return loan.dueDate < today;
}

/** 將到期：借閱中，而且到期日在今天起計 3 日內（含今天），或已經逾期。 */
export function isDueSoon(book, today) {
  const loan = activeLoan(book);
  if (!loan?.dueDate || !parseISODate(today) || !parseISODate(loan.dueDate)) return false;
  return loan.dueDate <= addDays(today, 3);
}

export function duePhrase(dueDate, today) {
  const days = daysFromTo(today, dueDate);
  if (days == null) return '';
  if (days < 0) return `已逾期 ${-days} 日`;
  if (days === 0) return '今日到期';
  if (days === 1) return '明日到期';
  return `還有 ${days} 日`;
}

export function statusFlags(book, today) {
  const loan = activeLoan(book);
  return {
    未借閱: !loan,
    借閱中: Boolean(loan),
    將到期: isDueSoon(book, today),
    已預約: Boolean(book?.reserved),
    想借: Boolean(book?.wanted),
    已借過: (book?.history || []).length > 0,
  };
}

export function matchesFilters(book, filters, today) {
  const flags = statusFlags(book, today);
  return (filters || []).every((name) => flags[name]);
}

export function matchesQuery(book, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const blob = [book.title, book.author, book.synopsis, book.source, book.callNumber, book.isbn]
    .join('\n')
    .toLowerCase();
  if (blob.includes(needle)) return true;
  const compact = needle.replace(/[-\s]/g, '');
  if (!compact) return false;
  return String(book.isbn || '').replace(/[-\s]/g, '').toLowerCase().includes(compact);
}

export function sortBooks(books) {
  return books.slice().sort((a, b) => {
    const loanA = activeLoan(a);
    const loanB = activeLoan(b);
    if (loanA && loanB && loanA.dueDate !== loanB.dueDate) {
      return loanA.dueDate < loanB.dueDate ? -1 : 1;
    }
    if (loanA && !loanB) return -1;
    if (!loanA && loanB) return 1;
    return a.title.localeCompare(b.title, 'zh-Hant-HK');
  });
}

export function visibleBooks(books, filters, query, today) {
  return sortBooks(
    books.filter((book) => matchesFilters(book, filters, today) && matchesQuery(book, query)),
  );
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

export function applyBookFields(book, fields, nowIso) {
  const title = cleanText(fields.title, 200);
  if (!title) return { ok: false, error: '請填寫書名。' };
  return {
    ok: true,
    book: {
      ...book,
      title,
      author: cleanText(fields.author, 200),
      synopsis: cleanText(fields.synopsis, 5000),
      source: cleanText(fields.source, 200),
      callNumber: cleanText(fields.callNumber, 80),
      isbn: cleanText(fields.isbn, 40),
      updatedAt: nowIso,
    },
  };
}

export function createBook(fields, nowIso, id) {
  return applyBookFields(
    {
      id,
      title: '',
      author: '',
      synopsis: '',
      source: '',
      callNumber: '',
      isbn: '',
      wanted: false,
      reserved: false,
      history: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    fields,
    nowIso,
  );
}

export function defaultDueDate(borrowDate, days) {
  return addDays(borrowDate, days);
}

export function applyBorrow(book, { card, borrowDate, dueDate, id, nowIso }) {
  if (activeLoan(book)) return { ok: false, error: '這本繪本借閱中，請先歸還。' };
  if (!CARD_IDS.has(card)) return { ok: false, error: '請選擇借書卡。' };
  if (!parseISODate(borrowDate) || !parseISODate(dueDate)) return { ok: false, error: '請填寫有效日期。' };
  if (dueDate < borrowDate) return { ok: false, error: '到期日不能早於借出日。' };
  return {
    ok: true,
    book: {
      ...book,
      reserved: false,
      updatedAt: nowIso,
      history: [...book.history, { id, card, borrowDate, dueDate, returnDate: null }],
    },
  };
}

export function applyReturn(book, loanId, returnDate, nowIso) {
  if (!parseISODate(returnDate)) return { ok: false, error: '請填寫有效日期。' };
  let found = false;
  let error = '';
  const history = book.history.map((loan) => {
    if (loan.id !== loanId) return loan;
    found = true;
    if (loan.returnDate) error = '這次借閱已經歸還。';
    else if (returnDate < loan.borrowDate) error = '歸還日不能早於借出日。';
    return { ...loan, returnDate };
  });
  if (!found) return { ok: false, error: '找不到這次借閱。' };
  if (error) return { ok: false, error };
  return { ok: true, book: { ...book, history, updatedAt: nowIso } };
}

export function updateLoan(book, loanId, { card, borrowDate, dueDate }, nowIso) {
  if (!CARD_IDS.has(card)) return { ok: false, error: '請選擇借書卡。' };
  if (!parseISODate(borrowDate) || !parseISODate(dueDate)) return { ok: false, error: '請填寫有效日期。' };
  if (dueDate < borrowDate) return { ok: false, error: '到期日不能早於借出日。' };
  let found = false;
  const history = book.history.map((loan) => {
    if (loan.id !== loanId) return loan;
    found = true;
    return { ...loan, card, borrowDate, dueDate };
  });
  if (!found) return { ok: false, error: '找不到這次借閱。' };
  return { ok: true, book: { ...book, history, updatedAt: nowIso } };
}

export function removeHistory(book, loanId, nowIso) {
  return {
    ...book,
    history: book.history.filter((loan) => loan.id !== loanId),
    updatedAt: nowIso,
  };
}

export function parseLoanDays(input) {
  const loanDays = {};
  for (const card of CARDS) {
    const raw = String(input?.[card.id] ?? '').trim();
    if (!/^\d+$/.test(raw)) return { ok: false, error: '借期請輸入整數。' };
    const days = Number(raw);
    if (days < 1 || days > 180) return { ok: false, error: '借期請輸入 1 至 180 日。' };
    loanDays[card.id] = days;
  }
  return { ok: true, loanDays };
}

export function statsByMonth(books) {
  const map = new Map();
  for (const book of books) {
    for (const loan of book.history || []) {
      const month = String(loan.borrowDate || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      if (!map.has(month)) map.set(month, { month, total: 0, mom: 0, dad: 0, daughter: 0 });
      const row = map.get(month);
      row.total += 1;
      if (Object.prototype.hasOwnProperty.call(row, loan.card)) row[loan.card] += 1;
    }
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

export function formatWantList(books) {
  const wanted = books.filter((book) => book.wanted);
  if (!wanted.length) return '';
  const blocks = wanted.map((book, index) => {
    const lines = [`${index + 1}. ${book.title}`];
    if (book.author.trim()) lines.push(`作者：${book.author.trim()}`);
    if (book.callNumber.trim()) lines.push(`索書號：${book.callNumber.trim()}`);
    if (book.isbn.trim()) lines.push(`ISBN：${book.isbn.trim()}`);
    return lines.join('\n');
  });
  return `${APP_NAME} · 想借\n\n${blocks.join('\n\n')}\n`;
}

function shiftMonth(iso, delta, day) {
  const date = parseISODate(iso);
  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return formatISODate(date);
}

function makeLoan(card, borrowDate, dueDate, returnDate) {
  return {
    id: crypto.randomUUID(),
    card,
    borrowDate,
    dueDate,
    returnDate,
  };
}

export function buildSampleBooks(today) {
  const now = `${today}T00:00:00.000Z`;
  const days = DEFAULT_LOAN_DAYS;
  const soonBorrow = addDays(today, -12);
  const normalBorrow = addDays(today, -1);
  const overdueBorrow = addDays(today, -16);
  const pastBorrow = shiftMonth(today, -1, 3);
  const olderBorrow = shiftMonth(today, -2, 8);

  const base = (fields) => ({
    id: crypto.randomUUID(),
    title: '',
    author: '',
    synopsis: '',
    source: '香港公共圖書館',
    callNumber: '',
    isbn: '',
    wanted: false,
    reserved: false,
    history: [],
    createdAt: now,
    updatedAt: now,
    ...fields,
  });

  return [
    base({
      title: '逃家小兔',
      author: '瑪格麗特·懷茲·布朗',
      synopsis: '小兔說要跑走，媽媽每次都說自己會跟著變成一樣的東西，最後用愛意把它引回家。',
      history: [makeLoan('mom', soonBorrow, addDays(soonBorrow, days), null)],
    }),
    base({
      title: '好餓的毛毛蟲',
      author: '艾瑞·卡爾',
      synopsis: '毛毛蟲從星期一吃到星期天，吃出一個小洞，最後結繭變成蝴蝶。',
      history: [makeLoan('dad', normalBorrow, addDays(normalBorrow, days), null)],
    }),
    base({
      title: '猜猜我有多愛你',
      author: '山姆·麥克布雷尼',
      synopsis: '大兔和小兔輪流把雙手張得更開，比一比誰的愛比較多。',
      history: [makeLoan('daughter', overdueBorrow, addDays(overdueBorrow, days), null)],
    }),
    base({
      title: '鱷魚怕怕牙醫怕怕',
      author: '五味太郎',
      synopsis: '鱷魚和牙醫都很害怕，仍然把檢查做完。',
      wanted: true,
      reserved: true,
    }),
    base({
      title: '花格子大象艾瑪',
      author: '大衛·麥基',
      synopsis: '艾瑪的格子花紋和別的大象不一樣，出走一圈之後，他喜歡回自己的樣子。',
      wanted: true,
    }),
    base({
      title: '我爸爸',
      author: '安東尼·布朗',
      synopsis: '孩子眼中的爸爸什麼都不怕，也什麼都會。',
      history: [makeLoan('mom', pastBorrow, addDays(pastBorrow, days), addDays(pastBorrow, 10))],
    }),
    base({
      title: '野獸國',
      author: '莫里斯·桑達克',
      synopsis: '麥斯航海到野獸國，當上國王，又決定自己回家。',
      source: '家中藏書',
    }),
    base({
      title: '魔法親親',
      author: '奧黛莉·潘',
      synopsis: '媽媽把親親印在手心，讓孩子把愛帶到想去的地方。',
      history: [makeLoan('daughter', olderBorrow, addDays(olderBorrow, days), addDays(olderBorrow, 9))],
    }),
  ];
}

function fallbackLoanDays(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 180) return fallback;
  return number;
}

export function normalizeSettings(settings) {
  const defaults = defaultLoanDays();
  const incoming = settings?.loanDays || {};
  return {
    loanDays: {
      mom: fallbackLoanDays(incoming.mom, defaults.mom),
      dad: fallbackLoanDays(incoming.dad, defaults.dad),
      daughter: fallbackLoanDays(incoming.daughter, defaults.daughter),
    },
  };
}

function normalizeLoan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!CARD_IDS.has(raw.card)) return null;
  if (!parseISODate(raw.borrowDate) || !parseISODate(raw.dueDate)) return null;
  if (raw.dueDate < raw.borrowDate) return null;
  let returnDate = null;
  if (raw.returnDate) {
    if (!parseISODate(raw.returnDate) || raw.returnDate < raw.borrowDate) return null;
    returnDate = raw.returnDate;
  }
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : crypto.randomUUID(),
    card: raw.card,
    borrowDate: raw.borrowDate,
    dueDate: raw.dueDate,
    returnDate,
  };
}

export function normalizeBook(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanText(raw.title, 200);
  if (!title) return null;
  const history = [];
  if (Array.isArray(raw.history)) {
    for (const loan of raw.history) {
      const normalized = normalizeLoan(loan);
      if (normalized) history.push(normalized);
    }
  }
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : crypto.randomUUID(),
    title,
    author: cleanText(raw.author, 200),
    synopsis: cleanText(raw.synopsis, 5000),
    source: cleanText(raw.source, 200),
    callNumber: cleanText(raw.callNumber, 80),
    isbn: cleanText(raw.isbn, 40),
    wanted: Boolean(raw.wanted),
    reserved: Boolean(raw.reserved),
    history,
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
  };
}

export function normalizeState(raw) {
  const settings = normalizeSettings(raw?.settings);
  const books = [];
  const seenBooks = new Set();
  if (Array.isArray(raw?.books)) {
    for (const item of raw.books) {
      const book = normalizeBook(item);
      if (!book) continue;
      if (seenBooks.has(book.id)) book.id = crypto.randomUUID();
      seenBooks.add(book.id);
      const seenLoans = new Set();
      book.history = book.history.map((loan) => {
        if (seenLoans.has(loan.id)) loan.id = crypto.randomUUID();
        seenLoans.add(loan.id);
        return loan;
      });
      books.push(book);
    }
  }
  return { version: 1, settings, books };
}

export function serializeBackup(state, exportedAt) {
  return JSON.stringify(
    {
      app: APP_NAME,
      version: 1,
      exportedAt,
      settings: state.settings,
      books: state.books,
    },
    null,
    2,
  );
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '檔案不是有效的 JSON。' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '備份格式不正確。' };
  }
  if (data.app && data.app !== APP_NAME) {
    return { ok: false, error: '這不是繪本借閱清單的備份。' };
  }
  if (!Array.isArray(data.books)) {
    return { ok: false, error: '備份缺少繪本清單。' };
  }
  const state = normalizeState({ settings: data.settings, books: data.books });
  const skipped = data.books.length - state.books.length;
  if (!state.books.length && data.books.length) {
    return { ok: false, error: '備份裡沒有可讀的繪本。' };
  }
  return { ok: true, state, skipped };
}

export function parseRoute(hash) {
  const raw = String(hash || '#/').replace(/^#/, '');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const parts = path.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts.length === 0) return { name: 'list' };
  if (parts[0] === 'wanted') return { name: 'wanted' };
  if (parts[0] === 'stats') return { name: 'stats' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'book' && parts[1] === 'new') return { name: 'edit', id: null };
  if (parts[0] === 'book' && parts[1]) {
    const action = parts[2] || 'detail';
    if (action === 'detail') return { name: 'detail', id: parts[1] };
    if (action === 'edit' || action === 'borrow' || action === 'return' || action === 'loan') {
      return { name: action, id: parts[1] };
    }
  }
  return { name: 'missing' };
}

export function backupFilename(today) {
  return `${APP_NAME}-備份-${today}.json`;
}
