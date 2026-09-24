import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { user } from '../core/db/schema';
import type { AppEnv } from './app';

const PUBLIC_PATHS = [/^\/api\/auth\//, /^\/api\/ingest$/, /^\/api\/qr$/, /^\/api\/share\//];

/** Public paths authenticate on their own (better-auth, ingest token) or not at all. */
export const isPublicPath = (path: string) => PUBLIC_PATHS.some((p) => p.test(path));

const isBanned = (u: { banned: boolean | null; banExpires: Date | null } | undefined) =>
  !u || (u.banned === true && (!u.banExpires || u.banExpires > new Date()));

/** Session cookie first, then `x-api-key` (saasmail's order). Sets `c.var.user` (design §4.2). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (isPublicPath(c.req.path)) return next();
  const { auth, db } = c.var.deps;
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set('user', { id: session.user.id, role: session.user.role ?? null });
    return next();
  }
  const key = c.req.header('x-api-key');
  const verified = key ? await auth.api.verifyApiKey({ body: { key } }) : null;
  if (verified?.valid && verified.key) {
    // verifyApiKey doesn't know about the admin plugin's bans; getSession does.
    const [owner] = await db
      .select({ banned: user.banned, banExpires: user.banExpires })
      .from(user)
      .where(eq(user.id, verified.key.referenceId));
    if (!isBanned(owner)) {
      c.set('user', { id: verified.key.referenceId, role: null });
      return next();
    }
  }
  return c.json({ error: { code: 'unauthorized' } }, 401);
};
