import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createApp } from '../src/api/app';
import { sha256Hex } from '../src/core/crypto';
import type { Database } from '../src/core/db/client';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';
import { signedEmail } from './email';

const html = await Bun.file('test/fixtures/cake/2.html').text();
const raw = await signedEmail({ from: 'no-reply@cake.vn', to: 'owner@gmail.com', html, domain: 'cake.vn' });

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedConfig(db, { ingestTokenHash: await sha256Hex('good-token') });
});
afterEach(() => close());

const ingest = (app: ReturnType<typeof createApp>, authorization?: string) =>
  app.request('/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'message/rfc822', ...(authorization ? { authorization } : {}) },
    body: raw,
  });

test('missing or wrong token is 401', async () => {
  const app = createApp(() => makeDeps(db).deps);
  expect((await ingest(app)).status).toBe(401);
  expect((await ingest(app, 'Bearer nope')).status).toBe(401);
});

test('valid token and email is stored', async () => {
  const app = createApp(() => makeDeps(db).deps);
  const res = await ingest(app, 'Bearer good-token');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, status: 'stored' });
});

test('database failure is a 500 without details, so Apps Script keeps its cursor', async () => {
  const brokenDb = new Proxy({} as Database, {
    get: () => () => {
      throw new Error('connection refused');
    },
  });
  const app = createApp(() => makeDeps(brokenDb).deps);
  const errorLog = console.error;
  console.error = () => {};
  const res = await ingest(app, 'Bearer good-token');
  console.error = errorLog;
  expect(res.status).toBe(500);
  const body: unknown = await res.json();
  expect(body).toEqual({ error: { code: 'internal' } });
});
