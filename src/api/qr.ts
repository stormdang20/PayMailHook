import { Hono } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';
import { BanksObject, QRPay } from 'vietnam-qr-pay';
import { z } from 'zod';
import type { AppEnv } from './app';
import { validate } from './validate';

type QrInput = { bank: string; acc: string; amount?: number; des?: string };

const banks = Object.values(BanksObject);

/** EMVCo VietQR content; `bank` is a vietnam-qr-pay key (`cake`, `timo`…) or a 6-digit BIN. Null if unknown. */
export function buildVietQr({ bank, acc, amount, des }: QrInput) {
  const bin = banks.find((b) => b.key === bank.toLowerCase() || b.bin === bank)?.bin;
  if (!bin) return null;
  return QRPay.initVietQR({
    bankBin: bin,
    bankNumber: acc,
    ...(amount && { amount: String(amount) }),
    ...(des && { purpose: des }),
  }).build();
}

export const qrRoutes = new Hono<AppEnv>().get(
  '/',
  cors({ origin: '*' }), // embeddable in any shop page (design §4.2)
  validate(
    'query',
    z.object({
      bank: z.string().max(40),
      acc: z.string().regex(/^[0-9A-Za-z]{1,19}$/),
      amount: z.coerce.number().int().positive().max(999_999_999_999).optional(),
      des: z.string().max(50).optional(),
    }),
  ),
  async (c) => {
    const content = buildVietQr(c.req.valid('query'));
    if (!content) return c.json({ error: { code: 'unknown_bank' } }, 400);
    const svg = await QRCode.toString(content, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
  },
);
