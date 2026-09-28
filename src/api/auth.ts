import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { user } from '../core/db/schema';
import type { Deps } from '../core/deps';
import type { AppEnv } from './app';

const PUBLIC_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/config$/,
  /^\/api\/qr$/,
  /^\/api\/share\//,
  /^\/api\/gmail\/pubsub$/,
  /^\/api\/inbound$/, // authenticated by the relay's HMAC signature
];

/** Public paths authenticate on their own (better-auth, Pub/Sub token, relay signature) or not at all. */
export const isPublicPath = (path: string) => PUBLIC_PATHS.some((p) => p.test(path));

const isBanned = (u: { banned: boolean | null; banExpires: Date | null } | undefined) =>
  !u || (u.banned === true && (!u.banExpires || u.banExpires > new Date()));

type KeyCheck = { userId: string } | { retryAfterSeconds: number } | null;

/**
 * Owner of a valid API key; `retryAfterSeconds` when the key is over its rate limit; null otherwise.
 * Checks bans, which verifyApiKey doesn't know about (getSession does).
 */
export async function userFromApiKey({ auth, db }: Deps, key: string | undefined): Promise<KeyCheck> {
  if (!key) return null;
  const verified = await auth.api.verifyApiKey({ body: { key } });
  if (verified.error?.code === 'RATE_LIMITED') {
    const details = (verified.error as { details?: { tryAgainIn?: number } }).details;
    return { retryAfterSeconds: Math.max(1, Math.ceil((details?.tryAgainIn ?? 60_000) / 1000)) };
  }
  if (!verified.valid || !verified.key) return null;
  const [owner] = await db
    .select({ banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, verified.key.referenceId));
  return isBanned(owner) ? null : { userId: verified.key.referenceId };
}

/** 401 for a bad key, 429 with Retry-After for a busy one. */
export const keyRejection = (check: KeyCheck) =>
  check && 'retryAfterSeconds' in check
    ? Response.json(
        { error: { code: 'rate_limited' } },
        { status: 429, headers: { 'retry-after': String(check.retryAfterSeconds) } },
      )
    : Response.json({ error: { code: 'unauthorized' } }, { status: 401 });

/** Session cookie first, then `x-api-key` (saasmail's order). Sets `c.var.user` (design §4.2). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (isPublicPath(c.req.path)) return next();
  const { auth } = c.var.deps;
  // Bypass the 5-minute cookie cache: API routes hit the DB anyway, and a ban or sign-out
  // must take effect immediately rather than when the cached cookie expires.
  const session = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } });
  if (session) {
    c.set('user', { id: session.user.id, role: session.user.role ?? null });
    return next();
  }
  const check = await userFromApiKey(c.var.deps, c.req.header('x-api-key'));
  if (check && 'userId' in check) {
    c.set('user', { id: check.userId, role: null });
    return next();
  }
  if (check) return keyRejection(check);
  return c.json({ error: { code: 'unauthorized' } }, 401);
};
