import type { Database } from '../src/core/db/client';
import type { Deps } from '../src/core/deps';
import { testResolver } from './email';

export const TEST_KEY = new Uint8Array(32).fill(7).toBase64();

/** Test deps; `scheduled` records every scheduleDelivery call. */
export const makeDeps = (db: Database, overrides: Partial<Deps> = {}) => {
  const scheduled: [string, number, string?][] = [];
  const deps: Deps = {
    db,
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
