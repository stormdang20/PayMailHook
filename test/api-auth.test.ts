import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import { createAuth } from '../src/core/auth';
import type { Database } from '../src/core/db/client';
import { apikey, user } from '../src/core/db/schema';
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

test('inbound stays public (relay-signature-authenticated, no session)', async () => {
  deps = makeDeps(db, { inbound: { domain: 'in.test', secret: 'relay-secret' } }).deps;
  const res = await app.request('/api/inbound', { method: 'POST', headers: { 'x-inbound-signature': 'x' }, body: 'x' });
  expect(res.status).toBe(401);
  const body: unknown = await res.json();
  expect(body).toEqual({ error: { code: 'unauthorized' } });
});

test('public config lists configured social providers', async () => {
  const res = await app.request('/api/config');
  expect(await json(res)).toMatchObject({ socialProviders: [], imap: false, vapidPublicKey: null, gmailOAuth: false });
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

test('an API key over its rate limit gets 429, not 401', async () => {
  const { userId } = await signUp();
  const { key, id } = await deps.auth.api.createApiKey({ body: { userId, name: 'busy' } });
  await db.update(apikey).set({ requestCount: 120, lastRequest: new Date() }).where(eq(apikey.id, id));
  const res = await app.request('/api/me', { headers: { 'x-api-key': key } });
  expect(res.status).toBe(429);
  expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
});

test('sign up with a username, then sign in with either the username or the email', async () => {
  const post = (path: string, body: object, ip = '198.51.100.7') =>
    app.request(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-client-ip': ip },
      body: JSON.stringify(body),
    });
  const password = 'correct-horse-battery';
  const signUpRes = await post('sign-up/email', {
    email: 'shop@test.dev',
    password,
    name: 'shop_owner',
    username: 'Shop_Owner',
  });
  expect(signUpRes.status).toBe(200);
  expect((await post('sign-in/username', { username: 'shop_owner', password })).status).toBe(200);
  expect((await post('sign-in/email', { email: 'shop@test.dev', password })).status).toBe(200);
  expect((await post('sign-in/username', { username: 'shop_owner', password: 'wrong-password-1' })).status).toBe(401);
  const taken = await post('sign-up/email', { email: 'other@test.dev', password, name: 'x', username: 'shop_owner' });
  expect(taken.status).toBe(400);
});

test('change password: the new one works, the old one and other sessions stop working', async () => {
  const { cookie } = await signUp('change@test.dev');
  const secondDevice = await (
    await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: 'change@test.dev', password: 'correct-horse-battery' }),
    })
  ).headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const res = await app.request('/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: JSON.stringify({
      currentPassword: 'correct-horse-battery',
      newPassword: 'a-brand-new-password',
      revokeOtherSessions: true,
    }),
  });
  expect(res.status).toBe(200);
  const signIn = (password: string) =>
    app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: 'change@test.dev', password }),
    });
  expect((await signIn('a-brand-new-password')).status).toBe(200);
  expect((await signIn('correct-horse-battery')).status).toBe(401);
  expect((await app.request('/api/me', { headers: { cookie: secondDevice } })).status).toBe(401);
});
