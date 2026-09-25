import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Webhook } from 'standardwebhooks';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { createTestDb } from './db';
import { makeDeps } from './deps';
import { call, json, signUp } from './http';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let sent: { url: string; init: RequestInit }[];
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  sent = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response('received', { status: 202 });
  }) as typeof fetch;
  const { deps } = makeDeps(db, { fetch: fakeFetch });
  app = createApp(() => deps);
});
afterEach(() => close());

const create = async (cookie: string, body: unknown = { gmail: 'Shop.Owner@gmail.com' }) => {
  const res = await call(app, cookie, 'POST', '/api/email-configs', body);
  return { res, body: await json(res) };
};

test('create returns the token, secret and Code.gs once; reads never expose them', async () => {
  const { cookie } = await signUp(app, db);
  const { res, body } = await create(cookie, {
    gmail: 'Shop.Owner@gmail.com',
    webhookUrl: 'https://shop.example.com/hook',
  });
  expect(res.status).toBe(201);
  expect(body.ingestToken).toBeString();
  expect(body.webhookSecret).toStartWith('whsec_');
  expect(body.appsScript).toContain(`const INGEST_TOKEN = '${body.ingestToken}';`);
  expect(body.appsScript).toContain("const INGEST_URL = 'http://app.test/api/ingest';");
  expect(body.config).toMatchObject({
    gmail: 'shop.owner@gmail.com',
    orderPrefix: 'PMH',
    webhookUrl: 'https://shop.example.com/hook',
  });
  const list = await json(await call(app, cookie, 'GET', '/api/email-configs'));
  expect(list).toHaveLength(1);
  const text = JSON.stringify(list);
  for (const secret of ['ingestTokenHash', 'webhookSecretEnc', 'imapPasswordEnc', body.ingestToken])
    expect(text).not.toContain(secret);
});

test("another user's config is 404 for every route", async () => {
  const owner = await signUp(app, db, 'owner@test.dev');
  const { body } = await create(owner.cookie);
  const other = await signUp(app, db, 'other@test.dev');
  const id = body.config.id;
  for (const [method, path] of [
    ['GET', `/api/email-configs/${id}`],
    ['PATCH', `/api/email-configs/${id}`],
    ['DELETE', `/api/email-configs/${id}`],
    ['POST', `/api/email-configs/${id}/rotate-token`],
    ['POST', `/api/email-configs/${id}/rotate-secret`],
    ['POST', `/api/email-configs/${id}/test-webhook`],
  ]) {
    const res = await call(app, other.cookie, method, path, method === 'PATCH' ? { orderPrefix: 'ABC' } : undefined);
    expect([method, path, res.status]).toEqual([method, path, 404]);
  }
  expect((await call(app, owner.cookie, 'GET', `/api/email-configs/${id}`)).status).toBe(200);
});

test('PATCH validates the webhook url and the order prefix', async () => {
  const { cookie } = await signUp(app, db);
  const { body } = await create(cookie);
  const patch = (b: unknown) => call(app, cookie, 'PATCH', `/api/email-configs/${body.config.id}`, b);
  const unsafe = await patch({ webhookUrl: 'https://127.0.0.1/hook' });
  expect(unsafe.status).toBe(400);
  expect(await json(unsafe)).toEqual({ error: { code: 'invalid_webhook_url', reason: 'ip_not_allowed' } });
  expect((await patch({ orderPrefix: '' })).status).toBe(400);
  expect((await patch({ orderPrefix: 'P-M' })).status).toBe(400);
  const ok = await patch({ webhookUrl: 'https://shop.example.com/h', orderPrefix: 'dh' });
  expect(await json(ok)).toMatchObject({ webhookUrl: 'https://shop.example.com/h', orderPrefix: 'DH' });
  expect(await json(await patch({ webhookUrl: null }))).toMatchObject({ webhookUrl: null });
});

test('rotating the token invalidates the old one', async () => {
  const { cookie } = await signUp(app, db);
  const { body } = await create(cookie);
  const rotated = await json(await call(app, cookie, 'POST', `/api/email-configs/${body.config.id}/rotate-token`));
  expect(rotated.appsScript).toContain(rotated.ingestToken);
  const ingest = (token: string) =>
    app.request('/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: 'x' });
  expect((await ingest(body.ingestToken)).status).toBe(401);
  expect((await ingest(rotated.ingestToken)).status).not.toBe(401);
});

test('rotating the secret returns a new one; test-webhook signs with it', async () => {
  const { cookie } = await signUp(app, db);
  const { body } = await create(cookie, { gmail: 'a@gmail.com', webhookUrl: 'https://shop.example.com/hook' });
  const id = body.config.id;
  const { webhookSecret } = await json(await call(app, cookie, 'POST', `/api/email-configs/${id}/rotate-secret`));
  expect(webhookSecret).not.toBe(body.webhookSecret);
  const res = await call(app, cookie, 'POST', `/api/email-configs/${id}/test-webhook`);
  expect(await json(res)).toMatchObject({ statusCode: 202, responseBody: 'received', error: null });
  const payload = new Webhook(webhookSecret).verify(
    sent[0].init.body as string,
    sent[0].init.headers as Record<string, string>,
  );
  expect(payload).toMatchObject({ type: 'payment.test' });
});

test('test-webhook without a url is a 400', async () => {
  const { cookie } = await signUp(app, db);
  const { body } = await create(cookie);
  const res = await call(app, cookie, 'POST', `/api/email-configs/${body.config.id}/test-webhook`);
  expect(res.status).toBe(400);
  expect(sent).toHaveLength(0);
});

test('invalid bodies are 400 validation errors; delete removes the config', async () => {
  const { cookie } = await signUp(app, db);
  const bad = await create(cookie, { gmail: 'not-an-email' });
  expect(bad.res.status).toBe(400);
  expect(bad.body.error.code).toBe('validation');
  const { body } = await create(cookie);
  expect((await call(app, cookie, 'DELETE', `/api/email-configs/${body.config.id}`)).status).toBe(204);
  expect(await json(await call(app, cookie, 'GET', '/api/email-configs'))).toEqual([]);
  expect((await call(app, cookie, 'GET', '/api/email-configs/not-a-uuid')).status).toBe(400);
});

test('banks: both by default, chosen on create, editable, never empty', async () => {
  const { cookie } = await signUp(app, db);
  expect((await create(cookie)).body.config.banks).toEqual(['CAKE', 'TIMO']);
  const { body } = await create(cookie, { gmail: 'timo.only@gmail.com', banks: ['TIMO'] });
  expect(body.config.banks).toEqual(['TIMO']);
  const patch = (b: unknown) => call(app, cookie, 'PATCH', `/api/email-configs/${body.config.id}`, b);
  expect(await json(await patch({ banks: ['CAKE'] }))).toMatchObject({ banks: ['CAKE'] });
  expect((await patch({ banks: [] })).status).toBe(400);
  expect((await create(cookie, { gmail: 'x@gmail.com', banks: ['VCB'] })).res.status).toBe(400);
});
