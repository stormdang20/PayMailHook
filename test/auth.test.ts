import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createAuth } from '../src/core/auth';
import type { Database } from '../src/core/db/client';
import { user } from '../src/core/db/schema';
import { createTestDb } from './db';
import { testEnv } from './deps';

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

const signUp = (auth: ReturnType<typeof createAuth>, email: string) =>
  auth.api.signUpEmail({ body: { email, password: 'correct-horse-battery', name: 'Test' } });

test('the first user becomes admin, later users do not', async () => {
  const auth = createAuth(db, testEnv());
  await signUp(auth, 'first@test.dev');
  await signUp(auth, 'second@test.dev');
  const roles = Object.fromEntries((await db.select().from(user)).map((u) => [u.email, u.role]));
  expect(roles).toEqual({ 'first@test.dev': 'admin', 'second@test.dev': 'user' });
});

test('ALLOW_SIGNUP=false blocks email sign-up', async () => {
  const auth = createAuth(db, testEnv({ ALLOW_SIGNUP: 'false' }));
  await expect(signUp(auth, 'first@test.dev')).rejects.toThrow();
  expect(await db.$count(user)).toBe(0);
});

test('env validation rejects a bad encryption key and a half-configured Google login', () => {
  expect(() => testEnv({ ENCRYPTION_KEY: 'short' })).toThrow();
  expect(() => testEnv({ GOOGLE_CLIENT_ID: 'id' })).toThrow();
  expect(testEnv({ GOOGLE_CLIENT_ID: '', ALLOW_SIGNUP: '' })).toMatchObject({ ALLOW_SIGNUP: true });
});
