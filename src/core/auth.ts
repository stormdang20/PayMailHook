import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import type { Database } from './db/client';
import { user } from './db/schema';
import type { Env } from './env';

type WaitUntil = (promise: Promise<unknown>) => void;

/** Design §4.4. Email verification and password reset stay off: there is no mail sender yet. */
export function createAuth(db: Database, env: Env, waitUntil?: WaitUntil) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            disableSignUp: !env.ALLOW_SIGNUP,
          },
        }
      : {};
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    database: drizzleAdapter(db, { provider: 'pg' }),
    emailAndPassword: { enabled: true, disableSignUp: !env.ALLOW_SIGNUP },
    socialProviders: google, // default scopes openid/email/profile: no CASA review needed
    plugins: [
      admin(),
      // The plugin's default is 10 requests per key per day, far too low for polling order status.
      apiKey({ rateLimit: { timeWindow: 60_000, maxRequests: 120 } }),
    ],
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 3 } },
    },
    session: { cookieCache: { enabled: true, maxAge: 300 } }, // fewer queries, fewer Neon wake-ups
    advanced: waitUntil ? { backgroundTasks: { handler: waitUntil } } : undefined,
    databaseHooks: {
      user: {
        create: {
          // Self-host convenience: whoever signs up first right after `docker compose up` is admin.
          before: async (data) => ({ data: { ...data, role: (await db.$count(user)) === 0 ? 'admin' : 'user' } }),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
