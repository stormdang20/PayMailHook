import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { username } from 'better-auth/plugins/username';
import { and, eq } from 'drizzle-orm';
import type { Database } from './db/client';
import { account, session, user } from './db/schema';
import type { Env } from './env';

type WaitUntil = (promise: Promise<unknown>) => void;

/** The email in the id_token Google just returned to better-auth (already verified by that exchange). */
function googleEmail(idToken: string | null | undefined) {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(payload, { alphabet: 'base64url' })));
  return typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
}

/**
 * Google has just proven the owner of this account's email. If the email was never verified, the password
 * may have been set by someone else who registered it first (account pre-hijacking): drop it and every
 * session, and mark the email verified. The owner signs in with Google and can set a new password.
 * A Google account with another address (the Gmail OAuth source) changes nothing.
 */
async function claimEmail(db: Database, userId: string, email: string | null) {
  const [owner] = await db.select().from(user).where(eq(user.id, userId));
  if (!owner || !email || owner.email.toLowerCase() !== email || owner.emailVerified) return;
  await db.delete(account).where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
  await db.delete(session).where(eq(session.userId, userId));
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
}

/**
 * Design §4.4. Email verification and password reset stay off: there is no mail sender yet.
 * `ipHeader` names the header carrying a trustworthy client IP; without it every client shares one
 * rate-limit bucket, so a few failed sign-ins by anyone would lock everybody out.
 */
export function createAuth(db: Database, env: Env, waitUntil?: WaitUntil, ipHeader?: string) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            disableSignUp: !env.ALLOW_SIGNUP,
            // A refresh token, so the optional Gmail OAuth source keeps working after the first hour.
            accessType: 'offline' as const,
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
    // Gmail OAuth links a second Google account whose address may differ from the sign-in email.
    // One email, one account: Google sign-in with an account's email lands in that account.
    account: { accountLinking: { enabled: true, trustedProviders: ['google'], allowDifferentEmails: true } },
    plugins: [
      admin(),
      username(), // sign in with a username or the email, like payhook.codes
      // The plugin's default is 10 requests per key per day, far too low for polling order status.
      apiKey({ rateLimit: { timeWindow: 60_000, maxRequests: 120 } }),
    ],
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/username': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 300 } }, // fewer queries, fewer Neon wake-ups
    advanced: {
      ...(waitUntil && { backgroundTasks: { handler: waitUntil } }),
      ...(ipHeader && { ipAddress: { ipAddressHeaders: [ipHeader] } }),
    },
    databaseHooks: {
      user: {
        create: {
          // Self-host convenience: whoever signs up first right after `docker compose up` is admin.
          before: async (data) => ({ data: { ...data, role: (await db.$count(user)) === 0 ? 'admin' : 'user' } }),
        },
      },
      account: {
        create: {
          after: async (linked) => {
            if (linked.providerId === 'google') await claimEmail(db, linked.userId, googleEmail(linked.idToken));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
