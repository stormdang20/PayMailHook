import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { createTestDb } from './db';
import { makeDeps } from './deps';
import { call, json, signUp } from './http';

let db: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const { deps } = makeDeps(db);
  app = createApp(() => deps);
});
afterEach(() => close());

test('only admins can use the admin endpoints the admin page calls', async () => {
  const admin = await signUp(app, db, 'admin@test.dev'); // first user
  const member = await signUp(app, db, 'member@test.dev');
  expect((await call(app, member.cookie, 'GET', '/api/auth/admin/list-users')).status).toBe(403);
  const list = await call(app, admin.cookie, 'GET', '/api/auth/admin/list-users');
  expect(list.status).toBe(200);
  expect((await json(list)).users).toHaveLength(2);

  expect(
    (await call(app, member.cookie, 'POST', '/api/auth/admin/set-role', { userId: member.userId, role: 'admin' }))
      .status,
  ).toBe(403);
  const ban = await call(app, admin.cookie, 'POST', '/api/auth/admin/ban-user', {
    userId: member.userId,
    banReason: 'spam',
  });
  expect(ban.status).toBe(200);
  expect((await call(app, member.cookie, 'GET', '/api/me')).status).toBe(401); // sessions revoked on ban
  const reset = await call(app, admin.cookie, 'POST', '/api/auth/admin/set-user-password', {
    userId: member.userId,
    newPassword: 'another-long-password',
  });
  expect(reset.status).toBe(200);
});
