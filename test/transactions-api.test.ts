import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { emailConfigs } from '../src/core/db/schema';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';
import { call, json, signUp } from './http';
import { seedDelivery, seedTransaction } from './seed';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let scheduled: [string, number, string?][];
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const made = makeDeps(db, { inbound: { domain: 'in.test', secret: 'relay-secret' } });
  scheduled = made.scheduled;
  app = createApp(() => made.deps);
});
afterEach(() => close());

/** Signed-in user with one config (created through the API, so it is really theirs). */
async function owner(email = 'a@test.dev') {
  const { cookie, userId } = await signUp(app, db, email);
  const res = await call(app, cookie, 'POST', '/api/email-configs', {
    gmail: `${userId}@gmail.com`,
    source: 'forwarding',
  });
  const [config] = await db
    .select()
    .from(emailConfigs)
    .where(eq(emailConfigs.id, (await json(res)).config.id));
  return { cookie, config };
}

test('keyset pagination is stable across ties and returns every row once, newest first', async () => {
  const { cookie, config } = await owner();
  const same = new Date('2026-09-20T10:00:00Z');
  for (let i = 0; i < 5; i++) await seedTransaction(db, config, { occurredAt: same });
  for (let i = 0; i < 3; i++) await seedTransaction(db, config, { occurredAt: new Date(Date.UTC(2026, 8, 21 + i)) });
  const seen: { id: string; occurredAt: string }[] = [];
  let cursor = '';
  for (let pages = 0; pages < 10; pages++) {
    const page = await json(
      await call(app, cookie, 'GET', `/api/transactions?limit=3${cursor && `&cursor=${cursor}`}`),
    );
    seen.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(new Set(seen.map((t) => t.id)).size).toBe(8);
  expect(seen).toHaveLength(8);
  const times = seen.map((t) => t.occurredAt);
  expect(times).toEqual([...times].sort().reverse());
});

test('filters by direction and orderId; other users see nothing', async () => {
  const { cookie, config } = await owner();
  await seedTransaction(db, config, { orderId: '42' });
  const out = await seedTransaction(db, config, { direction: 'out', orderId: null });
  const byDirection = await json(await call(app, cookie, 'GET', '/api/transactions?direction=out'));
  expect(byDirection.items.map((t: { id: string }) => t.id)).toEqual([out.id]);
  const byOrder = await json(await call(app, cookie, 'GET', '/api/transactions?orderId=42'));
  expect(byOrder.items).toHaveLength(1);
  const stranger = await signUp(app, db, 'b@test.dev');
  expect((await json(await call(app, stranger.cookie, 'GET', '/api/transactions'))).items).toEqual([]);
  expect((await call(app, stranger.cookie, 'GET', `/api/transactions/${out.id}`)).status).toBe(404);
  expect((await call(app, cookie, 'GET', `/api/transactions/${out.id}`)).status).toBe(200);
});

test('a bad cursor is a 400, not a database error', async () => {
  const { cookie } = await owner();
  expect((await call(app, cookie, 'GET', '/api/transactions?cursor=garbage')).status).toBe(400);
});

test('delivery detail includes its attempts; list filters by status', async () => {
  const { cookie, config } = await owner();
  const txn = await seedTransaction(db, config);
  const failed = await seedDelivery(db, txn, { status: 'failed' });
  await seedDelivery(db, await seedTransaction(db, config), { status: 'success' });
  const list = await json(await call(app, cookie, 'GET', '/api/webhook-deliveries?status=failed'));
  expect(list.items).toMatchObject([{ id: failed.id, status: 'failed', orderId: '1', amount: 1000 }]);
  const detail = await json(await call(app, cookie, 'GET', `/api/webhook-deliveries/${failed.id}`));
  expect(detail).toMatchObject({ id: failed.id, attempts: [] });
});

test('manual retry schedules finished deliveries only, and only for the owner', async () => {
  const { cookie, config } = await owner();
  const failed = await seedDelivery(db, await seedTransaction(db, config), { status: 'failed' });
  const retrying = await seedDelivery(db, await seedTransaction(db, config), { status: 'retrying' });
  expect((await call(app, cookie, 'POST', `/api/webhook-deliveries/${failed.id}/retry`)).status).toBe(202);
  expect(scheduled).toEqual([[failed.id, 0, 'manual']]);
  const busy = await call(app, cookie, 'POST', `/api/webhook-deliveries/${retrying.id}/retry`);
  expect(busy.status).toBe(409);
  const stranger = await signUp(app, db, 'b@test.dev');
  expect((await call(app, stranger.cookie, 'POST', `/api/webhook-deliveries/${failed.id}/retry`)).status).toBe(404);
  expect(scheduled).toHaveLength(1);
});

test('hasOrder=true keeps only transactions carrying an order code', async () => {
  const { cookie, config } = await owner();
  const paid = await seedTransaction(db, config, { orderId: '42' });
  await seedTransaction(db, config, { orderId: null, description: 'chuyen tien an trua' });
  const page = await json(await call(app, cookie, 'GET', '/api/transactions?hasOrder=true'));
  expect(page.items.map((t: { id: string }) => t.id)).toEqual([paid.id]);
  expect((await json(await call(app, cookie, 'GET', '/api/transactions'))).items).toHaveLength(2);
});

test('filters by Vietnam date range, bank, gmail, text and amount', async () => {
  const { cookie, config } = await owner();
  const other = await seedConfig(db, { userId: config.userId, gmail: 'timo.inbox@gmail.com' });
  const t = (o: Parameters<typeof seedTransaction>[2], c = config) => seedTransaction(db, c, o);
  // 24/09 23:30 and 25/09 00:30 in Vietnam time (UTC+7).
  const lateNight = await t({
    occurredAt: new Date('2026-09-24T16:30:00Z'),
    amount: 50_000,
    description: 'Tien an trua 50%',
  });
  const nextDay = await t({
    occurredAt: new Date('2026-09-24T17:30:00Z'),
    amount: 149_000,
    description: 'PMH777 thanh toan',
    orderId: '777',
  });
  const timo = await t(
    { bank: 'TIMO', occurredAt: new Date('2026-09-25T03:00:00Z'), amount: 2_000_000, counterpartyName: 'TRAN THI B' },
    other,
  );
  const ids = async (query: string) =>
    (await json(await call(app, cookie, 'GET', `/api/transactions?${query}`))).items
      .map((x: { id: string }) => x.id)
      .sort();
  expect(await ids('from=2026-09-25')).toEqual([nextDay.id, timo.id].sort());
  expect(await ids('to=2026-09-24')).toEqual([lateNight.id]);
  expect(await ids('from=2026-09-25&to=2026-09-25&bank=TIMO')).toEqual([timo.id]);
  expect(await ids(`configId=${other.id}`)).toEqual([timo.id]);
  expect(await ids('q=pmh777')).toEqual([nextDay.id]);
  expect(await ids('q=tran%20thi')).toEqual([timo.id]); // payer name
  expect(await ids('q=50%25')).toEqual([lateNight.id]); // a literal %, not a wildcard
  expect(await ids('minAmount=100000&maxAmount=1000000')).toEqual([nextDay.id]);
  expect((await call(app, cookie, 'GET', '/api/transactions?from=25-09-2026')).status).toBe(400);
});
