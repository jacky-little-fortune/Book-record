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

/** Returns a normalized ISBN-13 for a book, or null when the input is not a valid ISBN. */
export function normalizeIsbn13(input) {
  const raw = String(input || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (raw.length === 12 && /^\d{12}$/.test(raw)) return normalizeIsbn13(`0${raw}`);
  if (raw.length === 10 && isValidIsbn10(raw)) return isbn10to13(raw);
  if (raw.length === 13 && isValidIsbn13(raw) && (raw.startsWith('978') || raw.startsWith('979'))) return raw;
  return null;
}
