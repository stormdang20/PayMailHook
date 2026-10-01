import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import { createAuth } from '../src/core/auth';
import type { Database } from '../src/core/db/client';
import { emailConfigs } from '../src/core/db/schema';
import type { Deps } from '../src/core/deps';
import { createTestDb } from './db';
import { makeDeps, testEnv } from './deps';
import { call, json, signUp } from './http';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let cookie: string;
let gmailStatus: number;
let watchStatus: number;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  gmailStatus = 200;
  watchStatus = 200;
  const auth = createAuth(db, testEnv({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' }));
  const context = await auth.$context;
  const provider = context.socialProviders[0];
  context.socialProviders = [
    {
      ...provider,
      requiresIdTokenNonce: false,
      validateAuthorizationCode: async () => ({
        idToken: `${new TextEncoder().encode('{"alg":"none"}').toBase64({ alphabet: 'base64url' })}.${new TextEncoder().encode('{"email":"selected@gmail.com"}').toBase64({ alphabet: 'base64url' })}.`,
        accessToken: 'selected-google-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      }),
      getUserInfo: async () => ({
        user: { email: 'selected@gmail.com', emailVerified: true, name: 'Selected' },
        data: { sub: 'selected-google' },
      }),
    },
  ];
  const deps = makeDeps(db, {
    auth,
    gmailPush: { topic: 'projects/test/topics/gmail', verificationToken: 'test-token' },
    fetch: (async (input: string) =>
      input.endsWith('/profile')
        ? Response.json({ emailAddress: 'Selected@gmail.com' }, { status: gmailStatus })
        : Response.json(
            { historyId: '100', expiration: String(Date.now() + 7 * 86400_000) },
            { status: watchStatus },
          )) as Deps['fetch'],
  }).deps;
  app = createApp(() => deps);
  ({ cookie } = await signUp(app, db, 'owner@test.dev'));
});
afterEach(() => close());

async function authorize(error?: string) {
  const flow = crypto.randomUUID();
  const start = await call(app, cookie, 'POST', '/api/auth/link-social', {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    additionalData: { gmailConnect: flow },
    callbackURL: `/dashboard?gmail=${flow}`,
    errorCallbackURL: `/dashboard?gmailError=${flow}`,
  });
  expect(start.status).toBe(200);
  expect(await db.$count(emailConfigs)).toBe(0);
  const state = new URL((await json(start)).url).searchParams.get('state') ?? '';
  const query = new URLSearchParams({ state, ...(error ? { error } : { code: 'google-code' }) });
  const callback = await app.request(`/api/auth/callback/google?${query}`, {
    headers: { cookie: [cookie, ...start.headers.getSetCookie().map((value) => value.split(';')[0])].join('; ') },
  });
  expect(callback.status).toBe(302);
  const accountCookie = callback.headers.getSetCookie().find((value) => value.startsWith(`pmh_gmail_${flow}=`));
  const cookies = new Map(cookie.split('; ').map((value) => [value.split('=')[0], value]));
  for (const value of callback.headers.getSetCookie()) {
    const pair = value.split(';')[0];
    cookies.set(pair.split('=')[0], pair);
  }
  return { flow, callback, accountCookie, headers: [...cookies.values()].join('; ') };
}

test('linking the signed-in email rotates the session and still completes the Gmail connection', async () => {
  ({ cookie } = await signUp(app, db, 'selected@gmail.com'));
  const previousCookie = cookie;
  const result = await authorize();
  expect((await call(app, result.headers, 'POST', '/api/gmail/connect', { flow: result.flow })).status).toBe(200);
  expect((await call(app, previousCookie, 'GET', '/api/me')).status).toBe(401);
});

test('Google callback selects the account and creates its Gmail without an email input', async () => {
  const { flow, accountCookie, headers, callback } = await authorize();
  expect(callback.headers.get('location')).toContain(`/dashboard?gmail=${flow}`);
  expect(accountCookie).toContain('HttpOnly');
  expect(accountCookie).toContain('Path=/api/gmail');
  const response = await call(app, headers, 'POST', '/api/gmail/connect', {
    flow,
    banks: ['TIMO'],
    webhookUrl: 'https://shop.test/hook',
    gmail: 'forged@gmail.com',
  });
  expect(response.status).toBe(200);
  const body = await json(response);
  expect(body.config.gmail).toBe('selected@gmail.com');
  expect(body.webhookSecret).toStartWith('whsec_');
  const [config] = await db.select().from(emailConfigs);
  expect(config).toMatchObject({
    gmail: 'selected@gmail.com',
    banks: ['TIMO'],
    webhookUrl: 'https://shop.test/hook',
    gmailHistoryId: '100',
  });
  expect(config.googleAccountId).toBeTruthy();
  const again = await call(app, headers, 'POST', '/api/gmail/connect', { flow });
  expect(again.status).toBe(200);
  expect((await json(again)).webhookSecret).toBeNull();
  expect(await db.$count(emailConfigs)).toBe(1);
});

test('re-authorizing an existing Google account also records the selected account', async () => {
  const first = await authorize();
  const second = await authorize();
  expect(first.accountCookie).toBeTruthy();
  expect(second.accountCookie).toBeTruthy();
  expect((await call(app, second.headers, 'POST', '/api/gmail/connect', { flow: second.flow })).status).toBe(200);
  expect(await db.$count(emailConfigs)).toBe(1);
});

test('a denied Google consent creates no Gmail config or selected-account cookie', async () => {
  const result = await authorize('access_denied');
  expect(result.callback.headers.get('location')).toContain('gmailError=');
  expect(result.accountCookie).toBeUndefined();
  expect(await db.$count(emailConfigs)).toBe(0);
});

test('finishing OAuth requires a session, a callback cookie and account ownership', async () => {
  const { flow, accountCookie } = await authorize();
  expect((await call(app, '', 'POST', '/api/gmail/connect', { flow })).status).toBe(401);
  expect((await call(app, cookie, 'POST', '/api/gmail/connect', { flow })).status).toBe(400);
  const other = await signUp(app, db, 'other@test.dev');
  const forged = `${other.cookie}; ${accountCookie?.split(';')[0]}`;
  expect((await call(app, forged, 'POST', '/api/gmail/connect', { flow })).status).toBe(404);
  expect(await db.$count(emailConfigs)).toBe(0);
});

test('failed Gmail permissions or watch setup leave no orphan config', async () => {
  const { flow, headers } = await authorize();
  gmailStatus = 403;
  expect((await call(app, headers, 'POST', '/api/gmail/connect', { flow })).status).toBe(500);
  expect(await db.$count(emailConfigs)).toBe(0);
  gmailStatus = 200;
  watchStatus = 503;
  expect((await call(app, headers, 'POST', '/api/gmail/connect', { flow })).status).toBe(500);
  expect(await db.$count(emailConfigs)).toBe(0);
});

test('webhook validation and concurrent callbacks do not create duplicate configs', async () => {
  const { flow, headers } = await authorize();
  expect(
    (await call(app, headers, 'POST', '/api/gmail/connect', { flow, webhookUrl: 'http://localhost/hook' })).status,
  ).toBe(400);
  const responses = await Promise.all([
    call(app, headers, 'POST', '/api/gmail/connect', { flow }),
    call(app, headers, 'POST', '/api/gmail/connect', { flow }),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const [config] = await db.select().from(emailConfigs);
  await db.update(emailConfigs).set({ gmailHistoryId: '150' }).where(eq(emailConfigs.id, config.id));
  await call(app, headers, 'POST', '/api/gmail/connect', { flow });
  expect(await db.$count(emailConfigs)).toBe(1);
  expect((await db.select().from(emailConfigs))[0].gmailHistoryId).toBe('150');
});
