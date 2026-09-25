import { afterEach, beforeEach, expect, test } from 'bun:test';
import { serializeSignedCookie } from 'better-call';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { account, user } from '../src/core/db/schema';
import type { Deps } from '../src/core/deps';
import { createTestDb } from './db';
import { makeDeps } from './deps';
import { call, json, ORIGIN, signUp } from './http';

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

/** An unsigned JWT is enough: the hook only reads the email Google put in the id_token it just returned. */
const idToken = (email: string) =>
  ['{"alg":"none"}', JSON.stringify({ email, email_verified: true })]
    .map((p) => new TextEncoder().encode(p).toBase64({ alphabet: 'base64url', omitPadding: true }))
    .join('.')
    .concat('.');

/** What better-auth does when Google sign-in links into an existing account. */
async function linkGoogle(userId: string, email: string) {
  const ctx = await deps.auth.$context;
  await ctx.internalAdapter.linkAccount({
    userId,
    providerId: 'google',
    accountId: `g-${email}`,
    idToken: idToken(email),
  });
}
/** The session better-auth creates right after a Google sign-in (linking revokes the older ones). */
async function googleSession(userId: string) {
  const ctx = await deps.auth.$context;
  const created = await ctx.internalAdapter.createSession(userId);
  const cookie = await serializeSignedCookie(ctx.authCookies.sessionToken.name, created.token, ctx.secret);
  return cookie.split(';')[0];
}

const signIn = (email: string, password: string) =>
  app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
const credentials = (userId: string) =>
  db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));

test('Google proving the email of an unverified account drops the password nobody verified', async () => {
  const { userId } = await signUp(app, db, 'owner@gmail.com');
  await linkGoogle(userId, 'Owner@gmail.com');
  expect(await credentials(userId)).toHaveLength(0);
  expect((await db.select().from(user).where(eq(user.id, userId)))[0].emailVerified).toBe(true);
  expect((await signIn('owner@gmail.com', 'correct-horse-battery')).status).toBe(401);
});

test('linking a different Google account (Gmail OAuth source) keeps the password', async () => {
  const { userId } = await signUp(app, db, 'owner@gmail.com');
  await linkGoogle(userId, 'shop.inbox@gmail.com');
  expect(await credentials(userId)).toHaveLength(1);
  expect((await signIn('owner@gmail.com', 'correct-horse-battery')).status).toBe(200);
});

test('an account without a password can set one, then sign in with email and password', async () => {
  const { userId, cookie: passwordSession } = await signUp(app, db, 'owner@gmail.com');
  await linkGoogle(userId, 'owner@gmail.com');
  expect((await call(app, passwordSession, 'GET', '/api/me')).status).toBe(401); // pre-existing sessions revoked
  const cookie = await googleSession(userId);
  expect(await json(await call(app, cookie, 'GET', '/api/me'))).toMatchObject({ hasPassword: false });
  const res = await call(app, cookie, 'POST', '/api/me/password', { newPassword: 'my-new-password-1' });
  expect(res.status).toBe(200);
  expect((await signIn('owner@gmail.com', 'my-new-password-1')).status).toBe(200);
  const again = await call(app, cookie, 'POST', '/api/me/password', { newPassword: 'another-password-2' });
  expect(again.status).toBe(400); // has one now: use "change password", which needs the current one
});
