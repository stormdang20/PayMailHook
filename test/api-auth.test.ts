import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import { createAuth } from '../src/core/auth';
import type { Database } from '../src/core/db/client';
import { user } from '../src/core/db/schema';
import type { Deps } from '../src/core/deps';
import { createTestDb } from './db';
import { makeDeps, testEnv } from './deps';
import { json, ORIGIN, signUp as signUpAs } from './http';

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

const signUp = (email?: string) => signUpAs(app, db, email);

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

test('public config lists configured social providers', async () => {
  const res = await app.request('/api/config');
  expect(await json(res)).toEqual({ socialProviders: [], imap: false });
});

test('sign-in rate limit is per client IP, not one bucket for everybody', async () => {
  const limitedApp = createApp(() => makeDeps(db, { auth: createAuth(db, testEnv(), undefined, 'x-client-ip') }).deps);
  const signIn = (ip: string) =>
    limitedApp.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-client-ip': ip },
      body: JSON.stringify({ email: 'nobody@test.dev', password: 'wrong-password-123' }),
    });
  for (let i = 0; i < 6; i++) await signIn('198.51.100.1');
  expect((await signIn('198.51.100.1')).status).toBe(429);
  expect((await signIn('203.0.113.9')).status).not.toBe(429);
});
