import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { account, type EmailConfig, emailConfigs, transactions } from '../src/core/db/schema';
import type { Deps } from '../src/core/deps';
import { connectGmail } from '../src/core/gmail-oauth';
import { runMaintenance } from '../src/core/maintenance';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';
import { signedEmail } from './email';

const PUSH = { topic: 'projects/p/topics/gmail', verificationToken: 'pubsub-secret' };
const EMAIL_OF: Record<string, string> = {
  'tok-acc-other': 'someone.else@gmail.com',
  'tok-acc-owner': 'Owner@gmail.com',
};

let db: Database;
let close: () => Promise<void>;
let calls: string[];
let staleHistory: boolean;
let bankRaw: string;
let receivedAt: number | undefined;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  calls = [];
  staleHistory = false;
  receivedAt = undefined;
  const html = await Bun.file('test/fixtures/cake/2.html').text();
  const raw = await signedEmail({ from: 'no-reply@cake.vn', to: 'owner@gmail.com', html, domain: 'cake.vn' });
  bankRaw = raw.toBase64({ alphabet: 'base64url', omitPadding: true });
});
afterEach(() => close());

/** Just enough of the Gmail REST API, keyed by the bearer token each linked account gets. */
const gmailApi = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const path = u.pathname.replace('/gmail/v1/users/me', '');
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  calls.push(`${init?.method ?? 'GET'} ${path}${u.search}`);
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  if (path === '/profile') return json({ emailAddress: EMAIL_OF[token], historyId: '900' });
  if (path === '/watch') return json({ historyId: '100', expiration: String(Date.now() + 7 * 86400_000) });
  if (path === '/history')
    return staleHistory
      ? json({}, 404)
      : json({
          history: [{ messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] }],
          historyId: '150',
        });
  if (path === '/messages') return json({ messages: [{ id: 'm1' }] });
  const from = path === '/messages/m1' ? 'CAKE <no-reply@cake.vn>' : 'Shop <news@shop.test>';
  if (u.searchParams.get('format') === 'metadata') {
    return json({
      internalDate: String(receivedAt ?? Date.now()),
      payload: { headers: [{ name: 'From', value: from }] },
    });
  }
  if (path === '/messages/m1') return json({ raw: bankRaw });
  return json({ error: 'unexpected' }, 500);
}) as typeof fetch;

async function setup() {
  const config = await seedConfig(db, { source: 'gmail_oauth', gmail: 'owner@gmail.com' });
  for (const id of ['acc-other', 'acc-owner']) {
    await db
      .insert(account)
      .values({ id, accountId: `google-${id}`, providerId: 'google', userId: config.userId, createdAt: new Date() });
  }
  const base = makeDeps(db, { fetch: gmailApi, gmailPush: PUSH }).deps;
  const api = {
    ...base.auth.api,
    getAccessToken: async ({ body }: { body: { accountId: string } }) => ({ accessToken: `tok-${body.accountId}` }),
  };
  const deps: Deps = { ...base, auth: { ...base.auth, api } as unknown as Deps['auth'] };
  return { config, deps };
}
const reload = async (id: string) =>
  (await db.select().from(emailConfigs).where(eq(emailConfigs.id, id)))[0] as EmailConfig;

test('connect finds the linked Google account that owns the Gmail and starts the watch', async () => {
  const { config, deps } = await setup();
  expect(await connectGmail(deps, config)).toBeNull();
  expect(await reload(config.id)).toMatchObject({
    googleAccountId: 'acc-owner',
    gmailHistoryId: '100',
    gmail: 'owner@gmail.com',
  });
  expect(calls).toContain('POST /watch');
  const other = await seedConfig(db, { source: 'gmail_oauth', gmail: 'not-linked@gmail.com', userId: config.userId });
  expect(await connectGmail(deps, other)).toBe('gmail_account_mismatch');
});

test('a Pub/Sub push ingests new bank mail only and advances the history id', async () => {
  const { config, deps } = await setup();
  await connectGmail(deps, config);
  const app = createApp(() => deps);
  const data = new TextEncoder().encode(JSON.stringify({ emailAddress: 'owner@gmail.com', historyId: 150 })).toBase64();
  const push = (token: string) =>
    app.request(`/api/gmail/pubsub?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { data } }),
    });
  expect((await push('wrong')).status).toBe(403);
  expect((await push('pubsub-secret')).status).toBe(204);
  expect(await db.$count(transactions)).toBe(1);
  expect(calls).not.toContain('GET /messages/m2?format=raw'); // non-bank mail is never downloaded
  expect((await reload(config.id)).gmailHistoryId).toBe('150');
});

test('an expired history id falls back to the last day of bank mail', async () => {
  const { config, deps } = await setup();
  await connectGmail(deps, config);
  staleHistory = true;
  const { syncGmail } = await import('../src/core/gmail-oauth');
  await syncGmail(deps, await reload(config.id));
  expect(await db.$count(transactions)).toBe(1);
  expect((await reload(config.id)).gmailHistoryId).toBe('900');
});

test('the fallback scan skips bank mail that reached Gmail before the Gmail was connected', async () => {
  const { config, deps } = await setup();
  await connectGmail(deps, config);
  staleHistory = true;
  receivedAt = Date.now() - 86_400_000; // yesterday, before this config existed
  const { syncGmail } = await import('../src/core/gmail-oauth');
  await syncGmail(deps, await reload(config.id));
  expect(await db.$count(transactions)).toBe(0);
  expect(calls).not.toContain('GET /messages/m1?format=raw');
});

test('the hourly job renews watches that expire within a day, keeping the history id', async () => {
  const { config, deps } = await setup();
  await connectGmail(deps, config);
  await db
    .update(emailConfigs)
    .set({ gmailWatchExpiresAt: sql`now() + interval '1 hour'`, gmailHistoryId: '120' })
    .where(eq(emailConfigs.id, config.id));
  calls = [];
  await runMaintenance(deps);
  expect(calls).toEqual(['POST /watch']);
  const after = await reload(config.id);
  expect(after.gmailHistoryId).toBe('120');
  expect(after.gmailWatchExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
});
