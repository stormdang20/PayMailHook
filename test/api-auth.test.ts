import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { user } from '../src/core/db/schema';
import type { Deps } from '../src/core/deps';
import { createTestDb } from './db';
import { makeDeps } from './deps';

const ORIGIN = 'http://app.test';
let db: Database;
let close: () => Promise<void>;
let deps: Deps;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  deps = makeDeps(db).deps;
  app = createApp(() => deps);
});
afterEach(() => close());

/** Signs up through the real HTTP endpoint and returns the session cookie. */
async function signUp(email = 'a@test.dev') {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: 'correct-horse-battery', name: 'A' }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return { cookie, userId: row.id };
}

test('no session and no API key is 401', async () => {
  expect((await app.request('/api/me')).status).toBe(401);
  expect((await app.request('/api/me', { headers: { 'x-api-key': 'nope' } })).status).toBe(401);
});

test('a session cookie identifies the user', async () => {
  const { cookie } = await signUp();
  const res = await app.request('/api/me', { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ email: 'a@test.dev', role: 'admin' });
});

test('an API key works like a session, until its owner is banned', async () => {
  const { userId } = await signUp();
  const { key } = await deps.auth.api.createApiKey({ body: { userId, name: 'shop' } });
  const me = () => app.request('/api/me', { headers: { 'x-api-key': key } });
  expect((await me()).status).toBe(200);
  await db.update(user).set({ banned: true }).where(eq(user.id, userId));
  expect((await me()).status).toBe(401);
});

test('a cross-site form POST with the cookie is blocked, same-origin is not', async () => {
  const { cookie } = await signUp();
  const post = (headers: Record<string, string>) =>
    app.request('/api/me', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    });
  expect((await post({})).status).toBe(403);
  expect((await post({ origin: 'https://evil.test' })).status).toBe(403);
  expect((await post({ origin: ORIGIN })).status).not.toBe(403);
});

test('ingest stays public (token-authenticated, no session)', async () => {
  const res = await app.request('/api/ingest', { method: 'POST', headers: { authorization: 'Bearer x' }, body: 'x' });
  expect(res.status).toBe(401);
  const body: unknown = await res.json();
  expect(body).toEqual({ error: { code: 'unauthorized' } });
});
