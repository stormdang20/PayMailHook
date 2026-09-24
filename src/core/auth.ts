import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import type { Database } from './db/client';

export function createAuth(db: Database) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    emailAndPassword: { enabled: true },
    plugins: [admin(), apiKey()],
  });
}

// Only for `auth generate`; runtime code calls createAuth().
export const auth = createAuth({} as Database);
