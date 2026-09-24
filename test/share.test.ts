import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { emailConfigs } from '../src/core/db/schema';
import { createTestDb } from './db';
import { makeDeps } from './deps';
import { call, json, signUp } from './http';
import { seedTransaction } from './seed';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const { deps } = makeDeps(db);
  app = createApp(() => deps);
});
afterEach(() => close());

async function owner(email = 'a@test.dev') {
  const { cookie, userId } = await signUp(app, db, email);
  const res = await call(app, cookie, 'POST', '/api/email-configs', {
    gmail: `${userId}@gmail.com`,
    webhookUrl: 'https://secret-shop.example.com/hook',
  });
  const [config] = await db
    .select()
    .from(emailConfigs)
    .where(eq(emailConfigs.id, (await json(res)).config.id));
  return { cookie, config };
}

const PRIVATE = ['secret-shop', 'gmail.com', 'NGUYEN VAN A', '0123456789', 'userId', 'emailConfigId', 'webhook'];
const expectNoPrivateData = (body: unknown) => {
  const text = JSON.stringify(body);
  for (const secret of PRIVATE) expect(text).not.toContain(secret);
};

test('a shared transaction is readable without signing in, until the link is revoked', async () => {
  const { cookie, config } = await owner();
  const txn = await seedTransaction(db, config, {
    amount: 149000,
    orderId: '123',
    counterpartyName: 'NGUYEN VAN A',
    counterpartyAccount: '0123456789',
  });
  const { token } = await json(await call(app, cookie, 'POST', `/api/transactions/${txn.id}/share`));
  const again = await json(await call(app, cookie, 'POST', `/api/transactions/${txn.id}/share`));
  expect(again.token).toBe(token); // idempotent: the same link
  const pub = await app.request(`/api/share/t/${token}`);
  expect(pub.status).toBe(200);
  const body = await json(pub);
  expect(body).toMatchObject({ amount: 149000, orderId: '123', direction: 'in', bank: 'CAKE' });
  expectNoPrivateData(body);
  expect((await call(app, cookie, 'DELETE', `/api/transactions/${txn.id}/share`)).status).toBe(204);
  expect((await app.request(`/api/share/t/${token}`)).status).toBe(404);
});

test('a shared config lists only its incoming transactions, newest first', async () => {
  const { cookie, config } = await owner();
  await seedTransaction(db, config, { amount: 1, occurredAt: new Date('2026-09-20T01:00:00Z') });
  await seedTransaction(db, config, { amount: 2, occurredAt: new Date('2026-09-21T01:00:00Z') });
  await seedTransaction(db, config, { amount: 3, direction: 'out' });
  const { token } = await json(await call(app, cookie, 'POST', `/api/email-configs/${config.id}/share`));
  const body = await json(await app.request(`/api/share/c/${token}`));
  expect(body.items.map((t: { amount: number }) => t.amount)).toEqual([2, 1]);
  expectNoPrivateData(body);
  await call(app, cookie, 'DELETE', `/api/email-configs/${config.id}/share`);
  expect((await app.request(`/api/share/c/${token}`)).status).toBe(404);
});

test('only the owner can share, and a bad token is a 404', async () => {
  const { config } = await owner();
  const txn = await seedTransaction(db, config);
  const stranger = await signUp(app, db, 'b@test.dev');
  expect((await call(app, stranger.cookie, 'POST', `/api/transactions/${txn.id}/share`)).status).toBe(404);
  expect((await call(app, stranger.cookie, 'POST', `/api/email-configs/${config.id}/share`)).status).toBe(404);
  expect((await app.request('/api/share/t/nope')).status).toBe(404);
  expect((await app.request('/api/share/c/nope')).status).toBe(404);
});
