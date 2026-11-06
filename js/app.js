import {
  APP_NAME,
  CARDS,
  DUE_DATE_NOTE,
  STATUS_FILTERS,
  activeLoan,
  addDays,
  applyBookFields,
  applyBorrow,
  applyReturn,
  backupFilename,
  buildSampleBooks,
  cardById,
  createBook,
  defaultDueDate,
  duePhrase,
  emptyState,
  formatDisplayDate,
  formatMonthLabel,
  formatWantList,
  isOverdue,
  parseBackup,
  parseISODate,
  parseLoanDays,
  parseRoute,
  removeHistory,
  serializeBackup,
  statsByMonth,
  statusFlags,
  todayISO,
  updateLoan,
  visibleBooks,
} from './model.js';
import { hkplCatalogUrl, lookupIsbn, parseIsbn } from './isbn.js';
import { cameraMessage, loadScannerLibrary, primeCamera, releaseStream, startIsbnScan, stopIsbnScan } from './scan.js';
import { loadState, saveState } from './store.js';

const ui = {
  filters: new Set(['借閱中']),
  query: '',
};

let state = loadState();

const app = document.querySelector('#app');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nowStamp() {
  return new Date().toISOString();
}

function findBook(id) {
  return state.books.find((book) => book.id === id) || null;
}

function persist(next) {
  state = next;
  try {
    saveState(state);
    return true;
  } catch {
    toast('無法寫入這部裝置的儲存空間。');
    return false;
  }
}

function replaceBook(book) {
  return persist({
    ...state,
    books: state.books.map((item) => (item.id === book.id ? book : item)),
  });
}

let toastTimer = 0;
function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

function confirmBox({ title, text, okLabel = '確定', danger = false }) {
  const dialog = document.querySelector('#confirm-dialog');
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-text').textContent = text;
  const ok = document.querySelector('#confirm-ok');
  const cancel = document.querySelector('#confirm-cancel');
  ok.textContent = okLabel;
  ok.classList.toggle('danger', danger);
  return new Promise((resolve) => {
    let accepted = false;
    const onOk = () => {
      accepted = true;
      dialog.close();
    };
    const onCancel = () => {
      accepted = false;
      dialog.close();
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener(
      'close',
      () => {
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(accepted);
      },
      { once: true },
    );
    dialog.showModal();
  });
}

function iconBook() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M5 5.5h9.5A3.5 3.5 0 0 1 18 9v9.5H8.5A3.5 3.5 0 0 0 5 22V5.5z"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M5 5.5A3.5 3.5 0 0 1 8.5 2H18v7"/></svg>';
}

function iconStar(filled) {
  if (filled) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.1l2.35 5.05 5.55.7-4.1 3.8 1.08 5.5L12 15.7 7.12 18.15l1.08-5.5-4.1-3.8 5.55-.7L12 3.1z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.6l2.15 4.6 5.05.64-3.75 3.45.99 5.02L12 15.2 7.56 17.3l.99-5.02L4.8 8.84l5.05-.64L12 3.6z"/></svg>';
}

function iconChart() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 19V10M12 19V5M19 19v-7"/></svg>';
}

function iconGear() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/></svg>';
}

function tabbar(active) {
  const count = state.books.filter((book) => book.wanted).length;
  const link = (href, id, label, icon) => {
    const on = active === id;
    return `<a href="${href}" class="${on ? 'is-on' : ''}" ${on ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
  };
  return `<nav class="tabbar" aria-label="主要">
    ${link('#/', 'list', '書單', iconBook())}
    <a href="#/wanted" class="${active === 'wanted' ? 'is-on' : ''}" ${active === 'wanted' ? 'aria-current="page"' : ''}>
      ${iconStar(active === 'wanted')}
      <span>想借</span>
      <em id="want-count" class="nav-count"${count ? '' : ' hidden'}>${count}</em>
    </a>
    ${link('#/stats', 'stats', '統計', iconChart())}
    ${link('#/settings', 'settings', '設定', iconGear())}
  </nav>`;
}

function legendHtml() {
  return `<ul class="legend">
    ${CARDS.map((card) => `<li><i class="dot ${card.tone}"></i>${card.label}</li>`).join('')}
  </ul>`;
}

function shell({ eyebrow = '', title, backHref = '', content, tab, fab = false, legend = false }) {
  return `<header class="topbar">
      ${backHref ? `<a class="back" href="${backHref}">返回</a>` : ''}
      ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
      <h1>${esc(title)}</h1>
      ${legend ? legendHtml() : ''}
    </header>
    <div class="ribbon" aria-hidden="true"><span class="rose"></span><span class="blue"></span><span class="mint"></span></div>
    <main class="view" id="main">${content}</main>
    ${fab ? '<a class="fab" href="#/book/new">新增</a>' : ''}
    ${tabbar(tab)}`;
}

function page(title, html, after) {
  return { title, html, after };
}

function field(label, name, value, options = {}) {
  const id = `field-${name}`;
  const shared = `id="${id}" name="${name}" ${options.required ? 'required' : ''} maxlength="${options.max || 200}"`;
  const control = options.multiline
    ? `<textarea ${shared} rows="5">${esc(value)}</textarea>`
    : `<input ${shared} type="text" value="${esc(value)}" ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ''} ${options.autocap ? `autocapitalize="${options.autocap}"` : ''} autocomplete="off">`;
  return `<label class="field-label" for="${id}">${label}${options.required ? ' <span class="req">必填</span>' : ''}${control}</label>`;
}

function cardPicker(selected) {
  return `<fieldset class="card-picks">
    <legend>借書卡</legend>
    ${CARDS.map((card) => `<label class="card-pick tone-${card.tone}">
        <input type="radio" name="card" value="${card.id}" ${card.id === selected ? 'checked' : ''}>
        <span class="pick-name">${card.label}</span>
        <small>${card.swatch} · ${state.settings.loanDays[card.id]} 日</small>
      </label>`).join('')}
  </fieldset>`;
}

function badgesFor(book, today) {
  const loan = activeLoan(book);
  const flags = statusFlags(book, today);
  const badges = [];
  if (loan && isOverdue(book, today)) badges.push(['bad', '已逾期']);
  else if (flags['將到期']) badges.push(['warn', '將到期']);
  else if (loan) badges.push(['ok', '借閱中']);
  else badges.push(['quiet', '未借閱']);
  if (book.reserved) badges.push(['reserve', '已預約']);
  return badges.map(([kind, label]) => `<span class="badge ${kind}">${label}</span>`).join('');
}

function bookCard(book, today) {
  const loan = activeLoan(book);
  const card = loan ? cardById(loan.card) : null;
  const tone = card ? card.tone : 'none';
  let line = '';
  if (loan && card) {
    line = `<p class="loan-line"><span class="card-pill tone-${tone}">${card.label}</span><span>${formatDisplayDate(loan.dueDate)}到期</span><span class="${isOverdue(book, today) ? 'overdue' : ''}">${duePhrase(loan.dueDate, today)}</span></p>`;
  } else if (book.history.length) {
    line = `<p class="loan-line quiet-line">曾借 ${book.history.length} 次</p>`;
  }
  const call = book.callNumber ? `<p class="call-no">索書號 ${esc(book.callNumber)}</p>` : '';
  return `<article class="book tone-${tone}">
    <a class="book-hit" href="#/book/${encodeURIComponent(book.id)}">
      <div class="book-title-row">
        <h2>${esc(book.title)}</h2>
        <span class="badges">${badgesFor(book, today)}</span>
      </div>
      ${book.author ? `<p class="author">${esc(book.author)}</p>` : ''}
      ${call}
      ${line}
    </a>
    <button type="button" class="star${book.wanted ? ' is-on' : ''}" data-action="toggle-want" data-id="${esc(book.id)}" aria-pressed="${book.wanted ? 'true' : 'false'}" aria-label="${esc(book.wanted ? `從想借移除 ${book.title}` : `加入想借 ${book.title}`)}">${iconStar(book.wanted)}</button>
  </article>`;
}

function paintBooks() {
  const list = document.querySelector('#book-list');
  const count = document.querySelector('#result-count');
  if (!list || !count) return;
  const today = todayISO();
  const books = visibleBooks(state.books, [...ui.filters], ui.query, today);
  count.textContent = `${books.length} 本`;
  if (!books.length) {
    list.innerHTML = emptyBooksHtml();
    return;
  }
  list.innerHTML = books.map((book) => bookCard(book, today)).join('');
}

function emptyBooksHtml() {
  if (!state.books.length) {
    return `<div class="empty">
      <h2>還沒有繪本</h2>
      <p>新增一本，或到設定載入範例。範例不會填寫索書號。</p>
      <a class="btn primary" href="#/book/new">新增繪本</a>
      <a class="btn ghost" href="#/settings">前往設定</a>
    </div>`;
  }
  const onlyBorrowing = ui.filters.size === 1 && ui.filters.has('借閱中') && !ui.query.trim();
  if (onlyBorrowing) {
    return `<div class="empty">
      <h2>目前沒有借閱中的繪本</h2>
      <p>借出後會出現在這裡，也可以改看全部繪本。</p>
      <button type="button" class="btn ghost" data-action="clear-filters">顯示全部繪本</button>
    </div>`;
  }
  return `<div class="empty">
    <h2>沒有符合的繪本</h2>
    <p>多個篩選要同時符合才會顯示。可以清除條件再看。</p>
    <button type="button" class="btn ghost" data-action="clear-filters">顯示全部繪本</button>
  </div>`;
}

function renderList() {
  const chips = STATUS_FILTERS.map((name) => {
    const on = ui.filters.has(name);
    return `<button type="button" class="chip${on ? ' is-on' : ''}" data-action="toggle-filter" data-filter="${name}" aria-pressed="${on ? 'true' : 'false'}">${name}</button>`;
  }).join('');
  const hint = ui.filters.size >= 2 ? '<p class="and-hint">顯示同時符合已選條件的繪本</p>' : '';
  const html = shell({
    eyebrow: '香港公共圖書館',
    title: APP_NAME,
    legend: true,
    fab: true,
    tab: 'list',
    content: `<label class="sr-only" for="search">搜尋繪本</label>
      <input id="search" class="search" type="search" enterkeyhint="search" placeholder="搜尋書名、作者、索書號、ISBN" value="${esc(ui.query)}">
      <div class="chips" role="group" aria-label="篩選狀態">${chips}</div>
      ${hint}
      <p class="count-row"><span id="result-count"></span><span class="trust">只存在這部裝置</span></p>
      <div id="book-list" class="book-list"></div>`,
  });
  return page(`${APP_NAME}`, html, paintBooks);
}

function renderMissing() {
  return page(
    `找不到頁面 · ${APP_NAME}`,
    shell({
      title: '找不到頁面',
      backHref: '#/',
      tab: 'list',
      content: `<div class="empty"><p>這個網址沒有對應的頁面。</p><a class="btn primary" href="#/">返回書單</a></div>`,
    }),
  );
}

function renderNotFoundBook() {
  return page(
    `找不到繪本 · ${APP_NAME}`,
    shell({
      title: '找不到這本繪本',
      backHref: '#/',
      tab: 'list',
      content: `<div class="empty"><p>它可能已刪除，或這份備份裡沒有這筆記錄。</p><a class="btn primary" href="#/">返回書單</a></div>`,
    }),
  );
}

function detailFields(book) {
  const rows = [
    ['作者', book.author],
    ['簡介', book.synopsis],
    ['來源', book.source],
    ['索書號', book.callNumber],
    ['ISBN', book.isbn],
  ];
  return `<dl class="facts">${rows
    .map(([label, value]) => {
      const empty = !String(value || '').trim();
      return `<div><dt>${label}</dt><dd class="${empty ? 'is-empty' : ''}">${empty ? '尚未填寫' : esc(value)}</dd></div>`;
    })
    .join('')}</dl>`;
}

function historyHtml(book) {
  if (!book.history.length) {
    return '<p class="help">還沒有借閱紀錄。</p>';
  }
  const items = book.history
    .slice()
    .sort((a, b) => (a.borrowDate < b.borrowDate ? 1 : a.borrowDate > b.borrowDate ? -1 : 0));
  return items
    .map((loan) => {
      const card = cardById(loan.card);
      const open = !loan.returnDate;
      return `<article class="history tone-${card.tone}">
        <header>
          <span class="card-pill tone-${card.tone}">${card.label}</span>
          <span class="badge ${open ? 'ok' : 'quiet'}">${open ? '借閱中' : '已歸還'}</span>
        </header>
        <p>借出 ${formatDisplayDate(loan.borrowDate)}</p>
        <p>到期 ${formatDisplayDate(loan.dueDate)}</p>
        <p>${open ? duePhrase(loan.dueDate, todayISO()) : `歸還 ${formatDisplayDate(loan.returnDate)}`}</p>
        <button type="button" class="text-btn" data-action="delete-loan" data-id="${esc(book.id)}" data-loan="${esc(loan.id)}">刪除這次紀錄</button>
      </article>`;
    })
    .join('');
}

function renderDetail(book) {
  const today = todayISO();
  const loan = activeLoan(book);
  const card = loan ? cardById(loan.card) : null;
  const loanPanel = loan
    ? `<section class="loan-panel tone-${card.tone}">
        <p class="kicker">借閱中</p>
        <h2>${card.label}</h2>
        <p>借出 ${formatDisplayDate(loan.borrowDate)}</p>
        <p>到期 ${formatDisplayDate(loan.dueDate)}</p>
        <p class="due-strong ${isOverdue(book, today) ? 'overdue' : ''}">${duePhrase(loan.dueDate, today)}</p>
      </section>`
    : '<section class="loan-panel tone-none"><p class="kicker">目前未借出</p><h2>可以借出</h2></section>';
  const primary = loan
    ? `<a class="btn primary" href="#/book/${encodeURIComponent(book.id)}/return">歸還</a>
       <a class="btn ghost" href="#/book/${encodeURIComponent(book.id)}/loan">更正這次借閱</a>`
    : `<a class="btn primary" href="#/book/${encodeURIComponent(book.id)}/borrow">借出</a>`;
  const html = shell({
    title: book.title,
    backHref: '#/',
    tab: 'list',
    content: `${loanPanel}
      <div class="badges detail-badges">${badgesFor(book, today)}</div>
      <div class="btn-stack">${primary}</div>
      <div class="btn-grid">
        <button type="button" class="btn ghost" data-action="toggle-want" data-id="${esc(book.id)}">${book.wanted ? '取消想借' : '加入想借'}</button>
        <button type="button" class="btn ghost" data-action="toggle-reserve" data-id="${esc(book.id)}">${book.reserved ? '取消預約' : '標記預約'}</button>
        <a class="btn ghost" href="#/book/${encodeURIComponent(book.id)}/edit">編輯資料</a>
        <button type="button" class="btn danger" data-action="delete-book" data-id="${esc(book.id)}">刪除繪本</button>
      </div>
      <section class="panel">
        <h2>資料</h2>
        ${detailFields(book)}
      </section>
      <section class="panel">
        <h2>借閱紀錄</h2>
        <div class="history-list">${historyHtml(book)}</div>
      </section>`,
  });
  return page(`${book.title} · ${APP_NAME}`, html);
}

function renderBookForm(book) {
  const creating = !book;
  const value = book || {
    title: '',
    author: '',
    synopsis: '',
    source: '',
    callNumber: '',
    isbn: '',
  };
  const html = shell({
    title: creating ? '新增繪本' : '編輯繪本',
    backHref: book ? `#/book/${encodeURIComponent(book.id)}` : '#/',
    tab: 'list',
    content: `<form class="panel form" data-form="book" novalidate>
      ${book ? `<input type="hidden" name="id" value="${esc(book.id)}">` : ''}
      ${field('書名', 'title', value.title, { required: true, max: 200 })}
      ${field('作者', 'author', value.author, { max: 200 })}
      ${field('簡介', 'synopsis', value.synopsis, { multiline: true, max: 5000 })}
      ${field('來源', 'source', value.source, { placeholder: '例如：香港公共圖書館', max: 200 })}
      ${field('索書號', 'callNumber', value.callNumber, { placeholder: '請照圖書館目錄填寫', max: 80, autocap: 'characters' })}
      ${field('ISBN', 'isbn', value.isbn, { placeholder: '可輸入、貼上或掃描', max: 40, autocap: 'off' })}
      <div class="isbn-tools">
        <button type="button" class="btn ghost" data-action="scan-isbn">掃描條碼</button>
        <button type="button" class="btn ghost" data-action="lookup-isbn">查資料</button>
      </div>
      <p id="isbn-status" class="isbn-status" role="status"></p>
      <a id="hkpl-link" class="btn ghost hkpl-link" hidden target="_blank" rel="noopener noreferrer">在香港公共圖書館開啟</a>
      <p class="help">掃描書後的 ISBN 條碼，或輸入後按「查資料」。先查 Open Library；若已設定代理，找不到才再查 Google Books。查完可開啟香港公共圖書館目錄，自行抄下索書號。不會自動填索書號，也不會把借閱紀錄送到圖書館。填上之後每個欄位仍可修改，按儲存才寫進這部裝置。</p>
      <p id="form-error" class="form-error" role="alert"></p>
      <button type="submit" class="btn primary">${creating ? '儲存繪本' : '儲存修改'}</button>
    </form>`,
  });
  return page(`${creating ? '新增繪本' : '編輯繪本'} · ${APP_NAME}`, html);
}

function renderBorrow(book) {
  const today = todayISO();
  const days = state.settings.loanDays.mom;
  const html = shell({
    title: '借出',
    eyebrow: book.title,
    backHref: `#/book/${encodeURIComponent(book.id)}`,
    tab: 'list',
    content: `<form class="panel form" data-form="borrow" novalidate>
      <input type="hidden" name="id" value="${esc(book.id)}">
      ${cardPicker('mom')}
      <label class="field-label" for="borrow-date">借出日
        <input id="borrow-date" name="borrowDate" type="date" value="${today}" required>
      </label>
      <label class="field-label" for="due-date">到期日
        <input id="due-date" name="dueDate" type="date" value="${defaultDueDate(today, days)}" required>
      </label>
      <p id="loan-days-hint" class="help"></p>
      <p id="form-error" class="form-error" role="alert"></p>
      <button type="submit" class="btn primary">確認借出</button>
      <p class="note">${DUE_DATE_NOTE}</p>
    </form>`,
  });
  return page(`借出 · ${APP_NAME}`, html, syncDueDate);
}

function renderReturn(book) {
  const loan = activeLoan(book);
  if (!loan) return renderDetail(book);
  const card = cardById(loan.card);
  const html = shell({
    title: '歸還',
    eyebrow: book.title,
    backHref: `#/book/${encodeURIComponent(book.id)}`,
    tab: 'list',
    content: `<form class="panel form" data-form="return" novalidate>
      <input type="hidden" name="id" value="${esc(book.id)}">
      <input type="hidden" name="loanId" value="${esc(loan.id)}">
      <p class="help">目前以${card.label}借出。借出 ${formatDisplayDate(loan.borrowDate)}，到期 ${formatDisplayDate(loan.dueDate)}。</p>
      <label class="field-label" for="return-date">歸還日
        <input id="return-date" name="returnDate" type="date" value="${todayISO()}" required>
      </label>
      <p id="form-error" class="form-error" role="alert"></p>
      <button type="submit" class="btn primary">確認歸還</button>
    </form>`,
  });
  return page(`歸還 · ${APP_NAME}`, html);
}

function renderLoanEdit(book) {
  const loan = activeLoan(book);
  if (!loan) return renderDetail(book);
  const html = shell({
    title: '更正這次借閱',
    eyebrow: book.title,
    backHref: `#/book/${encodeURIComponent(book.id)}`,
    tab: 'list',
    content: `<form class="panel form" data-form="loan" novalidate>
      <input type="hidden" name="id" value="${esc(book.id)}">
      <input type="hidden" name="loanId" value="${esc(loan.id)}">
      ${cardPicker(loan.card)}
      <label class="field-label" for="edit-borrow-date">借出日
        <input id="edit-borrow-date" name="borrowDate" type="date" value="${esc(loan.borrowDate)}" required>
      </label>
      <label class="field-label" for="edit-due-date">到期日
        <input id="edit-due-date" name="dueDate" type="date" value="${esc(loan.dueDate)}" required>
      </label>
      <p class="help">更正不會自動重算到期日。若圖書館印的日期不同，直接改這裡。</p>
      <p id="form-error" class="form-error" role="alert"></p>
      <button type="submit" class="btn primary">儲存更正</button>
      <p class="note">${DUE_DATE_NOTE}</p>
    </form>`,
  });
  return page(`更正借閱 · ${APP_NAME}`, html);
}

function renderWanted() {
  const today = todayISO();
  const wanted = state.books.filter((book) => book.wanted);
  const canShare = typeof navigator.share === 'function';
  const list = wanted.length
    ? `<div class="book-list">${wanted.map((book) => bookCard(book, today)).join('')}</div>
       <section class="panel">
         <h2>純文字清單</h2>
         <p class="help">只會寫上書名、作者，以及已填的索書號和 ISBN。</p>
         <pre id="want-preview" class="preview"></pre>
       </section>`
    : `<div class="empty"><h2>還沒有想借的繪本</h2><p>在書單按星星，就會加到這裡。</p><a class="btn primary" href="#/">返回書單</a></div>`;
  const actions = wanted.length
    ? `<div class="btn-stack sticky-actions">
        <button type="button" class="btn primary" data-action="copy-want">複製清單</button>
        ${canShare ? '<button type="button" class="btn ghost" data-action="share-want">分享</button>' : ''}
      </div>`
    : '';
  const html = shell({
    eyebrow: APP_NAME,
    title: '想借',
    tab: 'wanted',
    content: `${actions}${list}`,
  });
  return page(
    `想借 · ${APP_NAME}`,
    html,
    () => {
      const preview = document.querySelector('#want-preview');
      if (preview) preview.textContent = formatWantList(state.books);
    },
  );
}

function renderStats() {
  const rows = statsByMonth(state.books);
  const totals = { total: 0, mom: 0, dad: 0, daughter: 0 };
  for (const row of rows) {
    totals.total += row.total;
    totals.mom += row.mom;
    totals.dad += row.dad;
    totals.daughter += row.daughter;
  }
  const max = Math.max(1, ...rows.map((row) => row.total));
  const tiles = CARDS.map((card) => {
    return `<article class="tile tone-${card.tone}"><span>${card.label}</span><strong>${totals[card.id]}</strong><small>次</small></article>`;
  }).join('');
  const chart = rows.length
    ? rows
        .map((row) => {
          const parts = CARDS.map((card) => {
            const width = (row[card.id] / max) * 100;
            return width ? `<span class="seg ${card.tone}" style="width:${width}%"></span>` : '';
          }).join('');
          const detail = CARDS.map((card) => `${card.label} ${row[card.id]} 次`).join('，');
          return `<div class="stat-row">
            <div class="stat-label"><span>${formatMonthLabel(row.month)}</span><strong>${row.total}</strong></div>
            <div class="bar" role="img" aria-label="${formatMonthLabel(row.month)} ${detail}">${parts}</div>
          </div>`;
        })
        .join('')
    : '<div class="empty"><h2>還沒有借閱紀錄</h2><p>借出繪本後，這裡會按借出月份顯示次數。</p></div>';
  const html = shell({
    eyebrow: APP_NAME,
    title: '閱讀統計',
    tab: 'stats',
    content: `<section class="tile-row" aria-label="各借書卡累計">${tiles}</section>
      <p class="total-line">累計 <strong>${totals.total}</strong> 次借出</p>
      <p class="help">次數以借出月份計算。同一本書每借出一次計一次，歸還月份不計。</p>
      <div class="chart">${chart}</div>
      <ul class="legend inline-legend">
        ${CARDS.map((card) => `<li><i class="dot ${card.tone}"></i>${card.label}</li>`).join('')}
      </ul>`,
  });
  return page(`閱讀統計 · ${APP_NAME}`, html);
}

function canShareFiles() {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function renderSettings() {
  const days = state.settings.loanDays;
  const shareBackup = canShareFiles()
    ? '<button type="button" class="btn ghost" data-action="share-backup">分享備份檔</button>'
    : '';
  const html = shell({
    eyebrow: APP_NAME,
    title: '設定',
    tab: 'settings',
    content: `<section class="panel">
        <h2>借期</h2>
        <p class="help">三張卡預設都是 14 日。之後新借出的繪本會用這裡的日數計算到期日，已借出的紀錄不會自動改。</p>
        <form class="form" data-form="settings" novalidate>
          ${CARDS.map((card) => `<label class="field-label" for="loan-${card.id}">${card.label}（日）
              <input id="loan-${card.id}" name="${card.id}" type="number" inputmode="numeric" min="1" max="180" step="1" value="${days[card.id]}">
            </label>`).join('')}
          <p id="form-error" class="form-error" role="alert"></p>
          <button type="submit" class="btn primary">儲存借期</button>
        </form>
        <p class="note" id="due-note">${DUE_DATE_NOTE}</p>
      </section>
      <section class="panel">
        <h2>備份</h2>
        <p class="help">JSON 備份存在你選擇的位置。換手機或清除瀏覽器資料前，請先下載。</p>
        <div class="btn-stack">
          <button type="button" class="btn primary" data-action="export-backup">下載 JSON 備份</button>
          ${shareBackup}
          <button type="button" class="btn ghost" data-action="pick-import">匯入 JSON 備份</button>
        </div>
        <input id="import-file" class="sr-only" type="file" accept="application/json,.json">
        <p class="help">匯入會取代這部裝置上的繪本和借期設定。</p>
      </section>
      <section class="panel">
        <h2>範例繪本</h2>
        <p class="help">清單是空的時候，可以載入 8 本常見繪本作示範。範例不含索書號或 ISBN，請自行對照圖書館目錄填寫。</p>
        <button type="button" class="btn ghost" data-action="load-samples" ${state.books.length ? 'disabled' : ''}>載入範例繪本</button>
        ${state.books.length ? '<p class="help">清單已有繪本，不會載入範例。</p>' : ''}
      </section>
      <section class="panel">
        <h2>這部裝置</h2>
        <p>資料只存在這個瀏覽器裡。不會上傳，也不會傳送給香港公共圖書館或任何伺服器。</p>
        <p class="help">加入主畫面後，請先在有網絡時開啟一次。頁面儲存好之後，沒有網絡也可以查看和修改清單。</p>
      </section>
      <section class="panel danger-panel">
        <h2>清除</h2>
        <p class="help">會刪除繪本、借閱紀錄和借期設定，且無法復原。</p>
        <button type="button" class="btn danger" data-action="clear-data">清除全部資料</button>
      </section>`,
  });
  return page(`設定 · ${APP_NAME}`, html);
}

function renderRoute(route) {
  if (route.name === 'list') return renderList();
  if (route.name === 'wanted') return renderWanted();
  if (route.name === 'stats') return renderStats();
  if (route.name === 'settings') return renderSettings();
  if (route.name === 'missing') return renderMissing();
  const book = route.id ? findBook(route.id) : null;
  if (route.name === 'edit' && !route.id) return renderBookForm(null);
  if (!book && route.name !== 'edit') return renderNotFoundBook();
  if (route.name === 'detail') return renderDetail(book);
  if (route.name === 'edit') return renderBookForm(book);
  if (route.name === 'borrow') {
    if (activeLoan(book)) return renderDetail(book);
    return renderBorrow(book);
  }
  if (route.name === 'return') return renderReturn(book);
  if (route.name === 'loan') return renderLoanEdit(book);
  return renderMissing();
}

let lastRouteKey = '';

function render({ routeChanged = false, preserveScroll = false, focusHeading = false } = {}) {
  const y = preserveScroll ? window.scrollY : 0;
  const route = parseRoute(location.hash);
  const view = renderRoute(route);
  app.innerHTML = view.html;
  document.title = view.title;
  if (view.after) view.after();
  if (routeChanged) window.scrollTo(0, 0);
  else window.scrollTo(0, y);
  if (focusHeading) {
    const heading = app.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}

function showFormError(message) {
  const el = document.querySelector('#form-error');
  if (el) el.textContent = message;
}

function readForm(form) {
  const data = {};
  for (const [key, value] of new FormData(form).entries()) data[key] = String(value);
  if (!data.card) {
    const checked = form.querySelector('input[name="card"]:checked');
    if (checked) data.card = checked.value;
  }
  return data;
}

function saveBookForm(form) {
  const data = readForm(form);
  const stamp = nowStamp();
  if (data.id) {
    const book = findBook(data.id);
    if (!book) return;
    const result = applyBookFields(book, data, stamp);
    if (!result.ok) {
      showFormError(result.error);
      form.querySelector('[name="title"]')?.focus();
      return;
    }
    if (!replaceBook(result.book)) return;
    toast('已儲存修改');
    location.hash = `#/book/${encodeURIComponent(result.book.id)}`;
    return;
  }
  const result = createBook(data, stamp, crypto.randomUUID());
  if (!result.ok) {
    showFormError(result.error);
    form.querySelector('[name="title"]')?.focus();
    return;
  }
  if (!persist({ ...state, books: [result.book, ...state.books] })) return;
  toast('已新增繪本');
  location.hash = `#/book/${encodeURIComponent(result.book.id)}`;
}

function saveBorrow(form) {
  const data = readForm(form);
  const book = findBook(data.id);
  if (!book) return;
  const result = applyBorrow(book, {
    card: data.card,
    borrowDate: data.borrowDate,
    dueDate: data.dueDate,
    id: crypto.randomUUID(),
    nowIso: nowStamp(),
  });
  if (!result.ok) {
    showFormError(result.error);
    return;
  }
  if (!replaceBook(result.book)) return;
  const card = cardById(data.card);
  toast(`已記下借出。${card.label}，到期 ${formatDisplayDate(data.dueDate)}`);
  location.hash = `#/book/${encodeURIComponent(book.id)}`;
}

function saveReturn(form) {
  const data = readForm(form);
  const book = findBook(data.id);
  if (!book) return;
  const result = applyReturn(book, data.loanId, data.returnDate, nowStamp());
  if (!result.ok) {
    showFormError(result.error);
    return;
  }
  if (!replaceBook(result.book)) return;
  toast('已記下歸還');
  location.hash = `#/book/${encodeURIComponent(book.id)}`;
}

function saveLoanEdit(form) {
  const data = readForm(form);
  const book = findBook(data.id);
  if (!book) return;
  const result = updateLoan(
    book,
    data.loanId,
    { card: data.card, borrowDate: data.borrowDate, dueDate: data.dueDate },
    nowStamp(),
  );
  if (!result.ok) {
    showFormError(result.error);
    return;
  }
  if (!replaceBook(result.book)) return;
  toast('已更正這次借閱');
  location.hash = `#/book/${encodeURIComponent(book.id)}`;
}

function saveSettings(form) {
  const data = readForm(form);
  const result = parseLoanDays(data);
  if (!result.ok) {
    showFormError(result.error);
    return;
  }
  if (!persist({ ...state, settings: { loanDays: result.loanDays } })) return;
  showFormError('');
  toast('已儲存借期');
}

function selectedLoanDays() {
  const checked = document.querySelector('input[name="card"]:checked');
  const id = checked ? checked.value : 'mom';
  return state.settings.loanDays[id] || 14;
}

function syncDueDate() {
  const borrow = document.querySelector('#borrow-date');
  const due = document.querySelector('#due-date');
  const hint = document.querySelector('#loan-days-hint');
  if (!borrow || !due) return;
  const checked = document.querySelector('input[name="card"]:checked');
  const card = cardById(checked ? checked.value : 'mom');
  const days = selectedLoanDays();
  if (hint && card) {
    hint.textContent = `${card.label}借期 ${days} 日。到期日已按借出日自動計算，確認前可以修改。`;
  }
  if (due.dataset.touched === '1') return;
  if (parseISODate(borrow.value)) due.value = addDays(borrow.value, days);
}

function updateWantButton(id, wanted, title) {
  const button = document.querySelector(`button.star[data-id="${CSS.escape(id)}"]`);
  if (!button) return;
  button.classList.toggle('is-on', wanted);
  button.setAttribute('aria-pressed', wanted ? 'true' : 'false');
  button.setAttribute('aria-label', wanted ? `從想借移除 ${title}` : `加入想借 ${title}`);
  button.innerHTML = iconStar(wanted);
}

function updateWantCount() {
  const slot = document.querySelector('#want-count');
  if (!slot) return;
  const count = state.books.filter((book) => book.wanted).length;
  slot.hidden = count === 0;
  slot.textContent = String(count);
}

async function toggleWant(id) {
  const book = findBook(id);
  if (!book) return;
  const next = { ...book, wanted: !book.wanted, updatedAt: nowStamp() };
  if (!replaceBook(next)) return;
  const onList = document.querySelector('#book-list');
  if (onList) {
    if (ui.filters.has('想借') && !next.wanted) paintBooks();
    else updateWantButton(id, next.wanted, next.title);
    updateWantCount();
  } else {
    render({ preserveScroll: true });
  }
  toast(next.wanted ? '已加入想借' : '已從想借移除');
}

function toggleReserve(id) {
  const book = findBook(id);
  if (!book) return;
  const next = { ...book, reserved: !book.reserved, updatedAt: nowStamp() };
  if (!replaceBook(next)) return;
  toast(next.reserved ? '已標記預約' : '已取消預約');
  render({ preserveScroll: true });
}

async function deleteBook(id) {
  const book = findBook(id);
  if (!book) return;
  const ok = await confirmBox({
    title: '刪除繪本',
    text: `要刪除「${book.title}」和它的借閱紀錄嗎？此動作無法復原。`,
    okLabel: '刪除',
    danger: true,
  });
  if (!ok) return;
  if (!persist({ ...state, books: state.books.filter((item) => item.id !== id) })) return;
  toast('已刪除繪本');
  location.hash = '#/';
}

async function deleteLoan(bookId, loanId) {
  const book = findBook(bookId);
  if (!book) return;
  const ok = await confirmBox({
    title: '刪除借閱紀錄',
    text: '刪除後，閱讀統計會一併除去這次借出。',
    okLabel: '刪除紀錄',
    danger: true,
  });
  if (!ok) return;
  if (!replaceBook(removeHistory(book, loanId, nowStamp()))) return;
  toast('已刪除這次紀錄');
  render({ preserveScroll: true });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

async function copyWant() {
  const text = formatWantList(state.books);
  if (!text) {
    toast('還沒有想借的繪本');
    return;
  }
  const ok = await copyText(text);
  toast(ok ? '已複製想借清單' : '無法複製，請長按下方文字手動複製');
}

async function shareWant() {
  const text = formatWantList(state.books);
  if (!text || typeof navigator.share !== 'function') return;
  try {
    await navigator.share({ title: '想借繪本', text });
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    toast('無法分享，請改用複製');
  }
}

function backupPayload() {
  return serializeBackup(state, nowStamp());
}

function downloadBackup() {
  const text = backupPayload();
  const blob = new Blob([text], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = backupFilename(todayISO());
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('已開始下載備份');
}

async function shareBackup() {
  const text = backupPayload();
  const file = new File([text], backupFilename(todayISO()), { type: 'application/json' });
  try {
    await navigator.share({ title: `${APP_NAME}備份`, files: [file] });
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    toast('無法分享備份，請改用下載');
  }
}

async function importFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let text = '';
  try {
    text = await file.text();
  } catch {
    toast('無法讀取這個檔案。');
    return;
  }
  const result = parseBackup(text);
  if (!result.ok) {
    toast(result.error);
    return;
  }
  const ok = await confirmBox({
    title: '匯入備份',
    text: '匯入會以備份取代這部裝置上的繪本和借期設定。',
    okLabel: '取代現有清單',
    danger: true,
  });
  if (!ok) return;
  if (!persist(result.state)) return;
  const skipped = result.skipped ? `，略過 ${result.skipped} 筆不完整資料` : '';
  toast(`已匯入 ${result.state.books.length} 本繪本${skipped}`);
  render();
}

async function loadSamples() {
  if (state.books.length) {
    toast('清單已有繪本，不會載入範例。');
    return;
  }
  const books = buildSampleBooks(todayISO());
  if (!persist({ ...state, books })) return;
  ui.filters = new Set(['借閱中']);
  ui.query = '';
  toast('已載入範例繪本');
  location.hash = '#/';
  if (location.hash === '#/' || location.hash === '') render({ routeChanged: true });
}

async function clearData() {
  const ok = await confirmBox({
    title: '清除全部資料',
    text: '會刪除繪本、借閱紀錄和借期設定，且無法復原。請先下載備份。',
    okLabel: '全部清除',
    danger: true,
  });
  if (!ok) return;
  if (!persist(emptyState())) return;
  ui.filters = new Set(['借閱中']);
  ui.query = '';
  toast('已清除全部資料');
  render();
}

function setHkplLink(isbn13) {
  const link = document.querySelector('#hkpl-link');
  if (!link) return;
  if (!isbn13) {
    link.hidden = true;
    link.removeAttribute('href');
    return;
  }
  link.href = hkplCatalogUrl(isbn13);
  link.hidden = false;
}

function setIsbnStatus(message, kind = '') {
  const el = document.querySelector('#isbn-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
  if (message) el.scrollIntoView({ block: 'center' });
}

function setIsbnBusy(busy) {
  document.querySelectorAll('[data-action="lookup-isbn"], [data-action="scan-isbn"]').forEach((button) => {
    button.disabled = busy;
  });
}

let lookupSerial = 0;

function applyIsbnResult(result) {
  const isbnInput = document.querySelector('#field-isbn');
  if (!isbnInput) return;
  const isbn13 = result.isbn || (result.ok ? result.book?.isbn : '');
  setHkplLink(isbn13 && /^\d{13}$/.test(isbn13) ? isbn13 : '');
  if (!result.ok) {
    if (result.isbn) isbnInput.value = result.isbn;
    setIsbnStatus(result.error, 'error');
    return;
  }
  const book = result.book;
  isbnInput.value = book.isbn || result.isbn || isbnInput.value;
  const titleInput = document.querySelector('#field-title');
  const authorInput = document.querySelector('#field-author');
  const synopsisInput = document.querySelector('#field-synopsis');
  if (titleInput && book.title) titleInput.value = book.title;
  if (authorInput && book.author) authorInput.value = book.author;
  if (synopsisInput && book.synopsis) synopsisInput.value = book.synopsis;
  const filled = [];
  if (book.title) filled.push('書名');
  if (book.author) filled.push('作者');
  if (book.synopsis) filled.push('簡介');
  filled.push('ISBN');
  const missing = [];
  if (!book.author) missing.push('作者');
  if (!book.synopsis) missing.push('簡介');
  let message = `已從 ${result.sourceName} 填上${filled.join('、')}。請核對，每個欄位仍可修改。索書號請到香港公共圖書館目錄抄寫。`;
  if (missing.length) message += `沒有找到${missing.join('和')}。`;
  if (book.publisher) message += `出版社：${book.publisher}。`;
  setIsbnStatus(message, 'ok');
}

async function runIsbnLookup() {
  const serial = ++lookupSerial;
  const input = document.querySelector('#field-isbn');
  if (!input) return;
  setIsbnBusy(true);
  setHkplLink('');
  setIsbnStatus('正在查詢書目…');
  try {
    const result = await lookupIsbn(input.value);
    if (serial !== lookupSerial || !document.querySelector('#field-isbn')) return;
    applyIsbnResult(result);
  } catch {
    if (serial === lookupSerial) {
      setIsbnStatus('查詢失敗，請檢查網絡後再試。ISBN 已保留，你可以自行填寫。', 'error');
      const parsed = parseIsbn(input.value);
      setHkplLink(parsed.ok ? parsed.isbn13 : '');
    }
  } finally {
    if (serial === lookupSerial) setIsbnBusy(false);
  }
}

async function closeScanner() {
  await stopIsbnScan();
  const dialog = document.querySelector('#scan-dialog');
  if (dialog?.open) dialog.close();
}

async function scanIsbn() {
  if (!window.isSecureContext) {
    setIsbnStatus('相機只可在 HTTPS 下使用。請改為輸入 ISBN，再按「查資料」。', 'error');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setIsbnStatus('這部瀏覽器不能使用相機。請輸入 ISBN，再按「查資料」。', 'error');
    return;
  }
  setIsbnStatus('正在開啟相機…');
  let stream;
  try {
    stream = await primeCamera();
  } catch (error) {
    setIsbnStatus(cameraMessage(error), 'error');
    return;
  }
  releaseStream(stream);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const dialog = document.querySelector('#scan-dialog');
  const errorBox = document.querySelector('#scan-error');
  if (errorBox) errorBox.textContent = '';
  dialog.showModal();
  await startIsbnScan({
    elementId: 'scan-region',
    onCode: async (raw) => {
      const input = document.querySelector('#field-isbn');
      if (input) input.value = String(raw || '').trim();
      await closeScanner();
      await runIsbnLookup();
    },
    onError: (message) => {
      if (errorBox) errorBox.textContent = message;
      setIsbnStatus(message, 'error');
    },
  });
}

document.querySelector('#scan-close')?.addEventListener('click', () => {
  closeScanner();
});
document.querySelector('#scan-dialog')?.addEventListener('close', () => {
  stopIsbnScan();
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || !app.contains(button)) return;
  const action = button.dataset.action;
  if (action === 'toggle-filter') {
    const name = button.dataset.filter;
    if (ui.filters.has(name)) ui.filters.delete(name);
    else ui.filters.add(name);
    render({ preserveScroll: true });
    return;
  }
  if (action === 'clear-filters') {
    ui.filters.clear();
    ui.query = '';
    render();
    return;
  }
  if (action === 'toggle-want') {
    event.preventDefault();
    toggleWant(button.dataset.id);
    return;
  }
  if (action === 'toggle-reserve') toggleReserve(button.dataset.id);
  if (action === 'delete-book') deleteBook(button.dataset.id);
  if (action === 'delete-loan') deleteLoan(button.dataset.id, button.dataset.loan);
  if (action === 'copy-want') copyWant();
  if (action === 'share-want') shareWant();
  if (action === 'export-backup') downloadBackup();
  if (action === 'share-backup') shareBackup();
  if (action === 'pick-import') document.querySelector('#import-file')?.click();
  if (action === 'load-samples') loadSamples();
  if (action === 'clear-data') clearData();
  if (action === 'lookup-isbn') {
    event.preventDefault();
    runIsbnLookup();
  }
  if (action === 'scan-isbn') {
    event.preventDefault();
    scanIsbn().catch(() => setIsbnStatus('無法開啟掃描。請改為輸入 ISBN，再按「查資料」。', 'error'));
  }
});

app.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === 'book') saveBookForm(form);
  if (kind === 'borrow') saveBorrow(form);
  if (kind === 'return') saveReturn(form);
  if (kind === 'loan') saveLoanEdit(form);
  if (kind === 'settings') saveSettings(form);
});

app.addEventListener('input', (event) => {
  if (event.target.id === 'search') {
    ui.query = event.target.value;
    paintBooks();
  }
});

app.addEventListener('search', (event) => {
  if (event.target.id === 'search') {
    ui.query = event.target.value;
    paintBooks();
  }
});

app.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id === 'due-date') {
    target.dataset.touched = '1';
    return;
  }
  if (target.id === 'borrow-date' || target.name === 'card') syncDueDate();
  if (target.id === 'import-file') importFile(target);
});

window.addEventListener('hashchange', () => {
  closeScanner();
  const key = location.hash || '#/';
  const changed = key !== lastRouteKey;
  lastRouteKey = key;
  render({ routeChanged: changed });
});

lastRouteKey = location.hash || '#/';
render({ routeChanged: true });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const preloadScanner = () => {
  loadScannerLibrary().catch(() => {});
};
if ('requestIdleCallback' in window) requestIdleCallback(preloadScanner, { timeout: 3000 });
else setTimeout(preloadScanner, 1200);
