import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { emailConfigs } from '../src/core/db/schema';
import { createTestDb } from './db';
import { makeDeps } from './deps';
import { call, json, signUp } from './http';

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

const PASSWORD = 'abcd efgh ijkl mnop';
const appWith = (imapEnabled: boolean) => createApp(() => makeDeps(db, { imapEnabled }).deps);

test('an imap config stores the App Password encrypted and never returns it', async () => {
  const app = appWith(true);
  const { cookie } = await signUp(app, db);
  const res = await call(app, cookie, 'POST', '/api/email-configs', {
    gmail: 'a@gmail.com',
    source: 'imap',
    imapPassword: PASSWORD,
  });
  expect(res.status).toBe(201);
  const body = await json(res);
  expect(body.config).toMatchObject({ source: 'imap', hasImapPassword: true });
  const [row] = await db.select().from(emailConfigs);
  expect(row.imapPasswordEnc).toBeString();
  const everything = JSON.stringify([body, await json(await call(app, cookie, 'GET', '/api/email-configs'))]);
  expect(everything).not.toContain('abcdefghijklmnop');
  expect(everything).not.toContain(row.imapPasswordEnc ?? '-');
});

test('imap needs a 16-letter App Password and a self-hosted server', async () => {
  const selfHost = appWith(true);
  const { cookie } = await signUp(selfHost, db);
  const create = (app: ReturnType<typeof createApp>, body: unknown) =>
    call(app, cookie, 'POST', '/api/email-configs', body);
  expect((await create(selfHost, { gmail: 'a@gmail.com', source: 'imap' })).status).toBe(400);
  expect((await create(selfHost, { gmail: 'a@gmail.com', source: 'imap', imapPassword: 'short' })).status).toBe(400);
  const hosted = await create(appWith(false), { gmail: 'a@gmail.com', source: 'imap', imapPassword: PASSWORD });
  expect(hosted.status).toBe(400);
  expect((await json(hosted)).error.code).toBe('imap_not_available');
});

test('a new App Password clears imap_auth_failed so the listener restarts', async () => {
  const app = appWith(true);
  const { cookie } = await signUp(app, db);
  const { config } = await json(
    await call(app, cookie, 'POST', '/api/email-configs', {
      gmail: 'a@gmail.com',
      source: 'imap',
      imapPassword: PASSWORD,
    }),
  );
  await db.update(emailConfigs).set({ ingestError: 'imap_auth_failed' }).where(eq(emailConfigs.id, config.id));
  const [before] = await db.select().from(emailConfigs);
  const res = await call(app, cookie, 'PATCH', `/api/email-configs/${config.id}`, {
    imapPassword: 'qrst uvwx yzab cdef',
  });
  expect(await json(res)).toMatchObject({ ingestError: null, hasImapPassword: true });
  const [after] = await db.select().from(emailConfigs);
  expect(after.imapPasswordEnc).not.toBe(before.imapPasswordEnc);
});

test('public config tells the SPA whether imap is available', async () => {
  expect(await json(await appWith(true).request('/api/config'))).toMatchObject({ imap: true });
  expect(await json(await appWith(false).request('/api/config'))).toMatchObject({ imap: false });
});
