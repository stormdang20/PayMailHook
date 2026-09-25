import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/core/db/client';
import { emailConfigs, inboundFailures, transactions, webhookDeliveries } from '../src/core/db/schema';
import { ingestRawEmail } from '../src/core/ingest';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';
import { signedEmail } from './email';

const cakeIncoming = await Bun.file('test/fixtures/cake/2.html').text(); // +149.000 đ, "PMH123456"
const cakeOutgoing = await Bun.file('test/fixtures/cake/1.html').text();
const cake = (o: { to?: string; html?: string; from?: string; domain?: string } = {}) =>
  signedEmail({ from: 'no-reply@cake.vn', to: 'owner@gmail.com', html: cakeIncoming, domain: 'cake.vn', ...o });

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

const hookConfig = () => seedConfig(db, { webhookUrl: 'https://shop.example.com/hook', webhookSecretEnc: 'x' });

test('stores a transaction, creates a pending delivery and schedules it', async () => {
  const config = await hookConfig();
  const { deps, scheduled } = makeDeps(db);
  const result = await ingestRawEmail(deps, config, await cake());
  expect(result.status).toBe('stored');
  const [txn] = await db.select().from(transactions);
  expect(txn).toMatchObject({
    orderId: '123456',
    amount: 149000,
    direction: 'in',
    bank: 'CAKE',
    userId: config.userId,
  });
  const [delivery] = await db.select().from(webhookDeliveries);
  expect(delivery).toMatchObject({ status: 'pending', transactionId: txn.id });
  expect(delivery.payload).toMatchObject({ type: 'payment.received', data: { orderId: '123456' } });
  expect(scheduled).toEqual([[delivery.id, 0]]);
  const [updated] = await db.select().from(emailConfigs);
  expect(updated.lastIngestAt).toBeInstanceOf(Date);
});

test('the same email twice is a duplicate with no extra delivery', async () => {
  const config = await hookConfig();
  const { deps, scheduled } = makeDeps(db);
  const raw = await cake();
  await ingestRawEmail(deps, config, raw);
  expect(await ingestRawEmail(deps, config, raw)).toEqual({ status: 'duplicate' });
  expect(await db.$count(webhookDeliveries)).toBe(1);
  expect(scheduled).toHaveLength(1);
});

test('To of another mailbox is rejected and kept as an encrypted failure', async () => {
  const config = await hookConfig();
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake({ to: 'other@gmail.com' }));
  expect(result).toEqual({ status: 'rejected', reason: 'to_mismatch' });
  const [failure] = await db.select().from(inboundFailures);
  expect(failure.reason).toBe('to_mismatch');
  expect(failure.rawEnc.byteLength).toBeGreaterThan(0);
  const [updated] = await db.select().from(emailConfigs);
  expect(updated.ingestError).toBe('to_mismatch');
});

test('Gmail aliases of the owner are accepted', async () => {
  const config = await hookConfig();
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake({ to: 'O.w.n.e.r+x@googlemail.com' }));
  expect(result.status).toBe('stored');
});

test('signature from another domain is rejected as dkim_failed', async () => {
  const config = await hookConfig();
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake({ domain: 'evil.test' }));
  expect(result).toEqual({ status: 'rejected', reason: 'dkim_failed' });
});

test('mail from an unknown sender is ignored and not stored', async () => {
  const config = await hookConfig();
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake({ from: 'news@shop.test' }));
  expect(result).toEqual({ status: 'ignored' });
  expect(await db.$count(inboundFailures)).toBe(0);
});

test('unknown template is rejected as parse_failed', async () => {
  const config = await hookConfig();
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake({ html: '<p>Xin chào</p>' }));
  expect(result).toEqual({ status: 'rejected', reason: 'parse_failed' });
});

test('config without webhook url stores the transaction without a delivery', async () => {
  const config = await seedConfig(db);
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake());
  expect(result.status).toBe('stored');
  expect(await db.$count(webhookDeliveries)).toBe(0);
});

test('outgoing money with a code creates no delivery', async () => {
  const config = await hookConfig();
  const html = cakeOutgoing.replace('Chuyen khoan tu Cake', 'PMH999');
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake({ html }));
  expect(result.status).toBe('stored');
  expect(await db.$count(webhookDeliveries)).toBe(0);
});

test('a Gmail already claimed by another config is rejected as to_mismatch', async () => {
  await seedConfig(db, { lastIngestAt: new Date() }); // someone else owns owner@gmail.com
  const config = await hookConfig();
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake());
  expect(result).toEqual({ status: 'rejected', reason: 'to_mismatch' });
  expect(await db.$count(transactions)).toBe(0);
  const [mine] = await db.select().from(emailConfigs).where(eq(emailConfigs.id, config.id));
  expect(mine.lastIngestAt).toBeNull();
});

test("a bank this Gmail isn't set up for is ignored", async () => {
  const config = await seedConfig(db, { banks: ['TIMO'] });
  const result = await ingestRawEmail(makeDeps(db).deps, config, await cake());
  expect(result).toEqual({ status: 'ignored' });
  expect(await db.$count(transactions)).toBe(0);
});
