import { expect, test } from 'bun:test';
import { bankForSender, extractOrderId, ParseError, parseCake, parsePaypal, parseTimo } from '../src/core/banks';
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

const sentAt = new Date('2026-09-28T01:03:31Z');

test('parses PayPal money received, amount in cents, time from the Date header', async () => {
  const txn = parsePaypal(await lines('paypal/6.html'), sentAt);
  expect(txn).toEqual({
    direction: 'in',
    amount: 100,
    currency: 'USD',
    description: '',
    occurredAt: sentAt,
    bankTxnId: '1AA00000AA0000005',
    counterparty: { name: 'dataSpring Singapore PTE. LTD.' },
  });
});

test('PayPal payer note becomes the description', async () => {
  const txn = parsePaypal(await lines('paypal/4.html'), sentAt);
  expect(txn).toMatchObject({ amount: 209, currency: 'USD', bankTxnId: '1AA00000AA0000006' });
  expect(txn?.description.startsWith('Thank you very much for being our valued user')).toBe(true);
});

test('PayPal mail other than money received is not a transaction', async () => {
  for (const file of ['paypal/1.html', 'paypal/3.html']) expect(parsePaypal(await lines(file), sentAt)).toBeNull();
  expect(parsePaypal(['Đăng nhập mới vào tài khoản PayPal'], sentAt)).toBeNull();
});

test('PayPal money received without a usable Date header throws ParseError', async () => {
  const received = await lines('paypal/6.html');
  expect(() => parsePaypal(received)).toThrow(ParseError);
  expect(() => parsePaypal(received, new Date('nope'))).toThrow(ParseError);
  expect(() =>
    parsePaypal(
      received.filter((l) => l !== 'Mã giao dịch'),
      sentAt,
    ),
  ).toThrow(ParseError);
});

test('maps sender to bank, ignores unknown', () => {
  expect(bankForSender('No-Reply@cake.vn')?.code).toBe('CAKE');
  expect(bankForSender('service@intl.paypal.com')?.code).toBe('PAYPAL');
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
