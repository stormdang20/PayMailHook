import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { emailConfigs, transactions } from '../src/core/db/schema';
import { inboundSignature, receiveForwarded } from '../src/core/forwarding';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';
import { signedEmail } from './email';
import { call, json, signUp } from './http';

const INBOUND = { domain: 'in.paymailhook.test', secret: 'relay-secret' };
const ADDRESS = 'pmh-0123456789abcdef@in.paymailhook.test';
const cakeIncoming = await Bun.file('test/fixtures/cake/2.html').text();

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

const forwardingConfig = () => seedConfig(db, { source: 'forwarding', forwardingAddress: ADDRESS });
const bankMail = () =>
  signedEmail({ from: 'no-reply@cake.vn', to: 'owner@gmail.com', html: cakeIncoming, domain: 'cake.vn' });
const confirmation = (domain: string) =>
  signedEmail({
    from: 'forwarding-noreply@google.com',
    to: ADDRESS,
    subject: '(#512345678) Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com',
    html: '<p>Confirm: https://mail-settings.google.com/mail/vf-abc123-def</p>',
    domain,
  });

test('a forwarded bank email is stored for the config that owns the address', async () => {
  await forwardingConfig();
  const deps = makeDeps(db, { inbound: INBOUND }).deps;
  expect((await receiveForwarded(deps, ADDRESS.toUpperCase(), await bankMail())).status).toBe('stored');
  expect(await db.$count(transactions)).toBe(1);
  expect((await receiveForwarded(deps, 'pmh-nobody@in.paymailhook.test', await bankMail())).status).toBe(
    'unknown_recipient',
  );
});

test("Gmail's confirmation code is kept only when Google really signed it", async () => {
  const config = await forwardingConfig();
  const deps = makeDeps(db, { inbound: INBOUND }).deps;
  const read = async () =>
    (await db.select().from(emailConfigs).where(eq(emailConfigs.id, config.id)))[0].forwardingConfirmation;
  expect((await receiveForwarded(deps, ADDRESS, await confirmation('evil.test'))).status).toBe('confirmation');
  expect(await read()).toBeNull();
  await receiveForwarded(deps, ADDRESS, await confirmation('google.com'));
  expect(await read()).toEqual({ code: '512345678', link: 'https://mail-settings.google.com/mail/vf-abc123-def' });
});

test('/api/inbound needs the relay signature', async () => {
  await forwardingConfig();
  const app = createApp(() => makeDeps(db, { inbound: INBOUND }).deps);
  const raw = await bankMail();
  const post = (signature: string) =>
    app.request('/api/inbound', {
      method: 'POST',
      headers: { 'x-inbound-to': ADDRESS, 'x-inbound-signature': signature },
      body: raw,
    });
  expect((await post('bad')).status).toBe(401);
  const ok = await post(await inboundSignature(INBOUND.secret, ADDRESS, raw));
  expect(await json(ok)).toMatchObject({ ok: true, status: 'stored' });
});

test('a forwarding config gets its own address, only when the server has an inbound domain', async () => {
  const withInbound = createApp(() => makeDeps(db, { inbound: INBOUND }).deps);
  const { cookie } = await signUp(withInbound, db);
  const res = await call(withInbound, cookie, 'POST', '/api/email-configs', {
    gmail: 'a@gmail.com',
    source: 'forwarding',
  });
  expect((await json(res)).config.forwardingAddress).toMatch(/^pmh-[0-9a-f]{16}@in\.paymailhook\.test$/);
  const without = createApp(() => makeDeps(db).deps);
  const refused = await call(without, cookie, 'POST', '/api/email-configs', {
    gmail: 'b@gmail.com',
    source: 'forwarding',
  });
  expect((await json(refused)).error.code).toBe('forwarding_not_available');
});
