import { expect, test } from 'bun:test';
import { QRPay } from 'vietnam-qr-pay';
import { createApp } from '../src/api/app';
import { buildVietQr } from '../src/api/qr';
import type { Database } from '../src/core/db/client';
import { makeDeps } from './deps';

test('the VietQR payload decodes back to the same account, amount and description', () => {
  const content = buildVietQr({ bank: 'cake', acc: '0123456789', amount: 149000, des: 'PMH123456' });
  const qr = new QRPay(content ?? '');
  expect(qr.isValid).toBe(true);
  expect(qr.consumer.bankBin).toBe('546034');
  expect(qr.consumer.bankNumber).toBe('0123456789');
  expect(qr.amount).toBe('149000');
  expect(qr.additionalData.purpose).toBe('PMH123456');
});

test('a bank BIN works like a bank key; only banks PayMailHook reads (CAKE, Timo) are accepted', () => {
  expect(buildVietQr({ bank: '963388', acc: '1' })).toBe(buildVietQr({ bank: 'timo', acc: '1' }));
  expect(buildVietQr({ bank: 'nope', acc: '1' })).toBeNull();
  expect(buildVietQr({ bank: 'vietcombank', acc: '1' })).toBeNull(); // a real bank, but its emails aren't parsed
  expect(buildVietQr({ bank: '970436', acc: '1' })).toBeNull();
});

test('GET /api/qr is public, cacheable, CORS-open SVG', async () => {
  const app = createApp(() => makeDeps({} as Database).deps);
  const res = await app.request('/api/qr?bank=cake&acc=0123456789&amount=149000&des=PMH123456');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toStartWith('image/svg+xml');
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('cache-control')).toContain('max-age');
  expect(await res.text()).toStartWith('<svg');
  expect((await app.request('/api/qr?bank=nope&acc=1')).status).toBe(400);
  expect((await app.request('/api/qr?bank=cake&acc=1&amount=-5')).status).toBe(400);
});
