import { expect, test } from 'bun:test';
import { bankForSender, extractOrderId, ParseError, parseCake, parseTimo } from '../src/core/banks';
import { htmlToLines, normalizeEmail } from '../src/core/text';

const lines = async (p: string) => htmlToLines(await Bun.file(`test/fixtures/${p}`).text());

test('parses CAKE incoming transfer', async () => {
  const txn = parseCake(await lines('cake/2.html'));
  expect(txn).toMatchObject({ direction: 'in', amount: 149000, bankTxnId: '500000001', description: 'PMH123456' });
  expect(txn.occurredAt.toISOString()).toBe('2026-09-20T11:28:07.000Z'); // 18:28:07 +07:00
  expect(txn.counterparty).toEqual({ account: '123456***7890', name: 'NGUYEN VAN A', bank: 'TIMO' });
});

test('parses CAKE outgoing transfer', async () => {
  const txn = parseCake(await lines('cake/1.html'));
  expect(txn).toMatchObject({ direction: 'out', amount: 149001, bankTxnId: '500000002' });
  expect(txn.counterparty?.bank).toBe('NH Số Timo');
});

test('parses Timo increase and decrease with balance', async () => {
  const txn = parseTimo(await lines('timo/2.html'));
  expect(txn).toMatchObject({ direction: 'in', amount: 2570000, balanceAfter: 3000000 });
  expect(txn.occurredAt.toISOString()).toBe('2026-09-16T02:49:00.000Z');
  expect(txn.description.startsWith('MBVCB.10000000001.')).toBe(true);
  expect(txn.description.endsWith('.')).toBe(false);
  expect(parseTimo(await lines('timo/1.html'))).toMatchObject({ direction: 'out', amount: 100000 });
});

test('throws ParseError on an unknown template', () => {
  expect(() => parseCake(['Hello'])).toThrow(ParseError);
  expect(() => parseTimo(['Hello'])).toThrow(ParseError);
});

test('extracts order id without swallowing trailing text', () => {
  expect(extractOrderId('MBVCB.123.PMH456.DANG chuyen tien', 'PMH')).toBe('456');
  expect(extractOrderId('pmh789 thanh toan', 'PMH')).toBe('789');
  expect(extractOrderId('no code here', 'PMH')).toBeNull();
});

test('maps sender to bank, ignores unknown', () => {
  expect(bankForSender('No-Reply@cake.vn')?.code).toBe('CAKE');
  expect(bankForSender('someone@evil.test')).toBeUndefined();
});

test('normalizes gmail aliases', () => {
  expect(normalizeEmail('D.Qst+bank@GoogleMail.com')).toBe('dqst@gmail.com');
  expect(normalizeEmail('a.b@company.vn')).toBe('a.b@company.vn');
});

test('htmlToLines decodes entities and survives malformed ones', () => {
  expect(htmlToLines('<p>A&amp;B&#233;&#x20AC;</p><style>x{}</style><b>&#abc; &#99999999;</b>')).toEqual([
    'A&Bé€',
    '&#abc; &#99999999;',
  ]);
});
