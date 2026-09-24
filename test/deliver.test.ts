import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { Webhook } from 'standardwebhooks';
import { encryptText } from '../src/core/crypto';
import type { Database } from '../src/core/db/client';
import { emailConfigs, webhookAttempts, webhookDeliveries } from '../src/core/db/schema';
import type { Deps } from '../src/core/deps';
import { ingestRawEmail } from '../src/core/ingest';
import { deliver, newWebhookSecret } from '../src/core/webhook';
import { createTestDb, seedConfig } from './db';
import { makeDeps, TEST_KEY } from './deps';
import { signedEmail } from './email';

const cakeIncoming = await Bun.file('test/fixtures/cake/2.html').text();
let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

type Call = { url: string; init: RequestInit };

/** Seeds a pending delivery through the real ingest path; fetch answers from `respond`. */
async function setup(respond: (call: Call) => Response | Promise<Response>) {
  const secret = newWebhookSecret();
  const config = await seedConfig(db, {
    webhookUrl: 'https://shop.example.com/hook',
    webhookSecretEnc: await encryptText(TEST_KEY, secret),
  });
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond({ url, init });
  }) as typeof fetch;
  const { deps, scheduled } = makeDeps(db, { fetch: fakeFetch });
  const raw = await signedEmail({
    from: 'no-reply@cake.vn',
    to: 'owner@gmail.com',
    html: cakeIncoming,
    domain: 'cake.vn',
  });
  const result = await ingestRawEmail({ ...deps, scheduleDelivery: async () => {} }, config, raw);
  if (result.status !== 'stored' || !result.deliveryId) throw new Error('seed failed');
  return { id: result.deliveryId, deps, scheduled, calls, secret, config };
}

const row = async (id: string) => (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0];
const attempts = (id: string) => db.select().from(webhookAttempts).where(eq(webhookAttempts.deliveryId, id));
const makeDue = (id: string) =>
  db.update(webhookDeliveries).set({ nextAttemptAt: sql`now()` }).where(eq(webhookDeliveries.id, id));

test('2xx marks success and sends a verifiable Standard Webhooks request', async () => {
  const { id, deps, calls, secret } = await setup(() => new Response('ok'));
  await deliver(deps, id);
  expect(await row(id)).toMatchObject({ status: 'success', attemptCount: 1, lastStatusCode: 200, nextAttemptAt: null });
  const headers = calls[0].init.headers as Record<string, string>;
  expect(headers['webhook-id']).toBe(id);
  expect(calls[0].init.redirect).toBe('manual');
  expect(() => new Webhook(secret).verify(calls[0].init.body as string, headers)).not.toThrow();
  expect(await attempts(id)).toMatchObject([{ attemptNumber: 1, statusCode: 200, trigger: 'scheduled' }]);
});

test('5xx schedules the first retry 10 seconds later', async () => {
  const { id, deps, scheduled } = await setup(() => new Response('down', { status: 500 }));
  await deliver(deps, id);
  const d = await row(id);
  expect(d).toMatchObject({ status: 'retrying', attemptCount: 1, lastStatusCode: 500 });
  const inSeconds = ((d.nextAttemptAt?.getTime() ?? 0) - Date.now()) / 1000;
  expect(inSeconds).toBeGreaterThan(5);
  expect(inSeconds).toBeLessThan(15);
  expect(scheduled).toEqual([[id, 10]]);
});

test('fails after the 10th send when every attempt fails', async () => {
  const { id, deps } = await setup(() => new Response('down', { status: 503 }));
  for (let i = 0; i < 10; i++) {
    await makeDue(id);
    await deliver(deps, id);
  }
  expect(await row(id)).toMatchObject({ status: 'failed', attemptCount: 10, nextAttemptAt: null });
  expect(await attempts(id)).toHaveLength(10);
});

test('a redirect counts as a failure', async () => {
  const { id, deps } = await setup(() => new Response(null, { status: 301, headers: { location: 'http://10.0.0.1' } }));
  await deliver(deps, id);
  expect(await row(id)).toMatchObject({ status: 'retrying', lastStatusCode: 301 });
});

test('a timeout is recorded as error "timeout"', async () => {
  const { id, deps } = await setup(() => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  });
  await deliver(deps, id);
  expect(await attempts(id)).toMatchObject([{ error: 'timeout', statusCode: null }]);
});

test('two concurrent deliver() calls send only once', async () => {
  const { id, deps, calls } = await setup(() => new Response('ok'));
  await Promise.all([deliver(deps, id), deliver(deps, id)]);
  expect(calls).toHaveLength(1);
});

test('a failed manual retry keeps the status and schedules nothing', async () => {
  const { id, deps, scheduled } = await setup(() => new Response('down', { status: 500 }));
  for (const status of ['failed', 'success'] as const) {
    await db.update(webhookDeliveries).set({ status, nextAttemptAt: null }).where(eq(webhookDeliveries.id, id));
    await deliver(deps, id, 'manual');
    expect(await row(id)).toMatchObject({ status, nextAttemptAt: null });
  }
  expect(scheduled).toEqual([]);
  expect((await attempts(id)).map((a) => a.trigger)).toEqual(['manual', 'manual']);
});

test('a manual retry does not touch a delivery that is still on its schedule', async () => {
  const { id, deps, calls } = await setup(() => new Response('ok'));
  await deliver(deps, id, 'manual');
  expect(calls).toHaveLength(0);
  expect((await row(id)).status).toBe('pending');
});

test('a webhook url that became unsafe is not fetched', async () => {
  const { id, deps, calls, config } = await setup(() => new Response('ok'));
  await db.update(emailConfigs).set({ webhookUrl: 'https://127.0.0.1/x' }).where(eq(emailConfigs.id, config.id));
  await deliver(deps as Deps, id);
  expect(calls).toHaveLength(0);
  expect(await attempts(id)).toMatchObject([{ error: 'ip_not_allowed' }]);
});
