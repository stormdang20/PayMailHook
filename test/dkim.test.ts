import { expect, spyOn, test } from 'bun:test';
import nodeCrypto from 'node:crypto';
import { BANKS } from '../src/core/banks';
import { verifyBankDkim } from '../src/core/dkim';
import { insertDate, prependHeader, signedEmail, signedEmailWithH, testResolver } from './email';

const [CAKE, TIMO] = BANKS;
const base = { from: 'no-reply@cake.vn', to: 'owner@gmail.com', html: '<p>Số tiền</p>', domain: 'cake.vn' };
const verify = (raw: Uint8Array, bank = CAKE) => verifyBankDkim(raw, bank, testResolver);

test('passes a valid bank signature', async () => {
  expect(await verify(await signedEmail(base))).toBe(true);
});

test('uses a portable digest name for RSA verification on Workers', async () => {
  const raw = await signedEmail(base);
  const verifier = spyOn(nodeCrypto, 'verify');
  try {
    expect(await verify(raw)).toBe(true);
    expect(verifier).toHaveBeenCalled();
    for (const [algorithm] of verifier.mock.calls) expect(algorithm).toBe('sha256');
  } finally {
    verifier.mockRestore();
  }
});

test('rejects signature from another domain', async () => {
  expect(await verify(await signedEmail({ ...base, domain: 'evil.test' }))).toBe(false);
});

test('rejects when To is not covered by the signature', async () => {
  expect(await verify(signedEmailWithH(base, ['from', 'to', 'subject']))).toBe(true); // control: hand signer works
  expect(await verify(signedEmailWithH(base, ['from', 'subject', 'message-id']))).toBe(false);
});

test('rejects tampered body', async () => {
  const raw = Buffer.from(await signedEmail(base))
    .toString('latin1')
    .replace(/\r\n\r\n(.)/, '\r\n\r\nX$1');
  expect(await verify(new Uint8Array(Buffer.from(raw, 'latin1')))).toBe(false);
});

test('rejects body-length-limited (l=) signatures', async () => {
  expect(await verify(await signedEmail({ ...base, maxBodyLength: 10 }))).toBe(false);
});

test('rejects an unsigned extra To or From header (still a valid signature)', async () => {
  const raw = await signedEmail(base);
  expect(await verify(prependHeader(raw, 'To: victim@gmail.com'))).toBe(false);
  expect(await verify(prependHeader(raw, 'From: <no-reply@cake.vn>'))).toBe(false);
});

test('Timo: tolerates Gmail-inserted Date only for banks flagged gmailAddsDate', async () => {
  // Like Timo: h= lists date while the message has none, so a Date added by Gmail breaks the signature.
  const h = ['from', 'to', 'subject', 'date'];
  const timo = signedEmailWithH({ ...base, from: 'support@timo.vn', domain: 'timo.vn', withDate: false }, h);
  expect(await verify(timo, TIMO)).toBe(true);
  expect(await verify(insertDate(timo), TIMO)).toBe(true);
  const cake = signedEmailWithH({ ...base, withDate: false }, h);
  expect(await verify(insertDate(cake), CAKE)).toBe(false);
});

test.skipIf(!(await Bun.file('mail-template/pii.json').exists()))('real samples verify with live DNS', async () => {
  const { dohResolveTxt } = await import('../src/core/dkim');
  for (const bank of BANKS) {
    const dir = `mail-template/${bank.code.toLowerCase()}`;
    for await (const f of new Bun.Glob('*.eml').scan(dir)) {
      const raw = new Uint8Array(await Bun.file(`${dir}/${f}`).arrayBuffer());
      expect(await verifyBankDkim(raw, bank, dohResolveTxt)).toBe(true);
    }
  }
});
