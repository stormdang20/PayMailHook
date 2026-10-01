const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(match: string, body: string) {
  if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? match;
  const hex = body[1]?.toLowerCase() === 'x';
  const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
  // fromCodePoint throws on NaN or > U+10FFFF; keep malformed entities as-is.
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
}

/** Visible text of an HTML email, one trimmed non-empty line per text node. */
export function htmlToLines(html: string): string[] {
  return html
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, decodeEntity)
    .normalize('NFC')
    .split('\n')
    .map((l) => l.replace(/[\s‌]+/g, ' ').trim())
    .filter(Boolean);
}

const vnd = new Intl.NumberFormat('vi-VN');

/** `amount` in minor units of `currency`; VND keeps the banks' "149.000 đ" style. */
export function formatMoney(amount: number, currency: string) {
  if (currency === 'VND') return `${vnd.format(amount)} đ`;
  const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency });
  return money.format(amount / 10 ** (money.resolvedOptions().maximumFractionDigits ?? 0));
}

export const parseVnd = (s: string) => Number(s.replace(/\D/g, ''));

export const vnTime = (d: string, m: string, y: string, hh: string, mm: string, ss = '00') =>
  new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}+07:00`);

/** Gmail ignores dots and +tags in the local part; other domains compare as-is. */
export function normalizeEmail(address: string) {
  const [local = '', domain = ''] = address.trim().toLowerCase().split('@');
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return `${local}@${domain}`;
  return `${(local.split('+')[0] ?? '').replaceAll('.', '')}@gmail.com`;
}
