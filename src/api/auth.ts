import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { user } from '../core/db/schema';
import type { Deps } from '../core/deps';
import type { AppEnv } from './app';

const PUBLIC_PATHS = [/^\/api\/auth\//, /^\/api\/config$/, /^\/api\/ingest$/, /^\/api\/qr$/, /^\/api\/share\//];

/** Public paths authenticate on their own (better-auth, ingest token) or not at all. */
export const isPublicPath = (path: string) => PUBLIC_PATHS.some((p) => p.test(path));

const isBanned = (u: { banned: boolean | null; banExpires: Date | null } | undefined) =>
  !u || (u.banned === true && (!u.banExpires || u.banExpires > new Date()));

/** Owner of a valid API key, or null. Checks bans, which verifyApiKey doesn't know about (getSession does). */
export async function userFromApiKey({ auth, db }: Deps, key: string | undefined) {
  if (!key) return null;
  const verified = await auth.api.verifyApiKey({ body: { key } });
  if (!verified.valid || !verified.key) return null;
  const [owner] = await db
    .select({ banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, verified.key.referenceId));
  return isBanned(owner) ? null : verified.key.referenceId;
}

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
  const userId = await userFromApiKey(c.var.deps, c.req.header('x-api-key'));
  if (userId) {
    c.set('user', { id: userId, role: null });
    return next();
  }
  return c.json({ error: { code: 'unauthorized' } }, 401);
};
