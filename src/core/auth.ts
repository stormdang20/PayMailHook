import { apiKey } from '@better-auth/api-key';
import { betterAuth, type GenericEndpointContext } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getOAuthState } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { admin } from 'better-auth/plugins/admin';
import { username } from 'better-auth/plugins/username';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './db/client';
import { account, session, user } from './db/schema';
import type { Env } from './env';

type WaitUntil = (promise: Promise<unknown>) => void;

async function rememberGmailAccount(
  linked: { id: string; providerId: string },
  context: GenericEndpointContext | null,
  appUrl: string,
) {
  if (linked.providerId !== 'google' || !context?.path?.startsWith('/callback/')) return;
  const flow = z.uuid().safeParse((await getOAuthState())?.gmailConnect);
  if (!flow.success) return;
  context.setCookie(`pmh_gmail_${flow.data}`, linked.id, {
    httpOnly: true,
    secure: new URL(appUrl).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/gmail',
    maxAge: 600,
  });
}

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
  return true;
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
          after: async (linked, context) => {
            if (linked.providerId !== 'google') return;
            const claimed = await claimEmail(db, linked.userId, googleEmail(linked.idToken));
            if (claimed && context && (await getOAuthState())?.link?.userId === linked.userId) {
              const owner = await context.context.internalAdapter.findUserById(linked.userId);
              const currentSession = await context.context.internalAdapter.createSession(linked.userId);
              if (owner && currentSession) await setSessionCookie(context, { user: owner, session: currentSession });
            }
            await rememberGmailAccount(linked, context, env.BETTER_AUTH_URL);
          },
        },
        update: {
          after: async (linked, context) => rememberGmailAccount(linked, context, env.BETTER_AUTH_URL),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
