import { parseVnd, vnTime } from './text';

export type ParsedTxn = {
  direction: 'in' | 'out';
  amount: number;
  description: string;
  occurredAt: Date;
  bankTxnId?: string;
  balanceAfter?: number;
  counterparty?: { name?: string; account?: string; bank?: string };
};

export class ParseError extends Error {}

const valueAfter = (lines: string[], label: string) => {
  const i = lines.indexOf(label);
  return i >= 0 ? lines[i + 1] : undefined;
};

export function parseCake(lines: string[]): ParsedTxn {
  const amount = valueAfter(lines, 'Số tiền');
  const time = valueAfter(lines, 'Ngày giờ giao dịch')?.match(/^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})$/);
  if (!amount || !time) throw new ParseError('cake: amount or time not found');
  const direction = amount.startsWith('-') ? 'out' : 'in';
  const other = direction === 'in' ? 'chuyển' : 'nhận'; // the counterparty side
  return {
    direction,
    amount: parseVnd(amount),
    description: valueAfter(lines, 'Nội dung giao dịch') ?? '',
    occurredAt: vnTime(time[1], time[2], time[3], time[4], time[5], time[6]),
    bankTxnId: valueAfter(lines, 'Mã giao dịch'),
    counterparty: {
      account: valueAfter(lines, `Tài khoản ${other}`),
      name: valueAfter(lines, `Tên người ${other}`),
      bank: valueAfter(lines, `Ngân hàng ${other}`),
    },
  };
}

export function parseTimo(lines: string[]): ParsedTxn {
  const text = lines.join(' ');
  const m = text.match(/vừa (tăng|giảm) ([\d.]+) VND vào (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!m) throw new ParseError('timo: amount or time not found');
  const balance = text.match(/Số dư hiện tại: ([\d.]+) VND/);
  const description =
    lines
      .find((l) => l.startsWith('Mô tả:'))
      ?.slice('Mô tả:'.length)
      .trim() ?? '';
  return {
    direction: m[1] === 'tăng' ? 'in' : 'out',
    amount: parseVnd(m[2]),
    occurredAt: vnTime(m[3], m[4], m[5], m[6], m[7]),
    balanceAfter: balance ? parseVnd(balance[1]) : undefined,
    description: description.replace(/\.$/, ''),
  };
}

export type Bank = {
  code: 'CAKE' | 'TIMO';
  senders: string[];
  dkimDomain: string;
  parse: (lines: string[]) => ParsedTxn;
  /** Bank omits Date; Gmail adds one and breaks the signature (research §3). */
  gmailAddsDate?: boolean;
};

export const BANKS: Bank[] = [
  { code: 'CAKE', senders: ['no-reply@cake.vn'], dkimDomain: 'cake.vn', parse: parseCake },
  { code: 'TIMO', senders: ['support@timo.vn'], dkimDomain: 'timo.vn', parse: parseTimo, gmailAddsDate: true },
];

export const bankForSender = (address?: string) =>
  BANKS.find((b) => address && b.senders.includes(address.toLowerCase()));

export function extractOrderId(description: string, prefix: string) {
  const safePrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return description.toUpperCase().match(new RegExp(`${safePrefix}([A-Z0-9]+)`))?.[1] ?? null;
}
