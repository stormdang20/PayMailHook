import { createAuth } from '../src/core/auth';
import type { Database } from '../src/core/db/client';
import type { Deps } from '../src/core/deps';
import { type Env, parseEnv } from '../src/core/env';
import { testResolver } from './email';

export const TEST_KEY = new Uint8Array(32).fill(7).toBase64();

export const testEnv = (overrides: Record<string, string> = {}): Env =>
  parseEnv({
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    BETTER_AUTH_URL: 'http://app.test',
    ENCRYPTION_KEY: TEST_KEY,
    ...overrides,
  });

/** Test deps; `scheduled` records every scheduleDelivery call. */
export const makeDeps = (db: Database, overrides: Partial<Deps> = {}) => {
  const scheduled: [string, number, string?][] = [];
  const deps: Deps = {
    db,
    auth: createAuth(db, testEnv()),
    resolveTxt: testResolver,
    encryptionKey: TEST_KEY,
    fetch,
    allowPrivateWebhooks: false,
    appHost: 'app.test',
    scheduleDelivery: async (id, delay, trigger) => {
      scheduled.push(trigger ? [id, delay, trigger] : [id, delay]);
    },
    ...overrides,
  };
  return { deps, scheduled };
};
