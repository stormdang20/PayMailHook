import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { pushSubscriptions } from '../core/db/schema';
import { pushEndpointError } from '../core/push';
import type { AppEnv } from './app';
import { validate } from './validate';

const endpoint = z.string().max(2048);

/** A browser's PushSubscription (as `subscription.toJSON()` gives it) for the signed-in user. */
export const pushRoutes = new Hono<AppEnv>()
  .post(
    '/subscriptions',
    validate(
      'json',
      z.object({ endpoint, keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
    ),
    async (c) => {
      const { deps } = c.var;
      const { endpoint: url, keys } = c.req.valid('json');
      const reason = pushEndpointError(url, new URL(deps.appUrl).host);
      if (reason) return c.json({ error: { code: 'invalid_push_endpoint', reason } }, 400);
      await deps.db
        .insert(pushSubscriptions)
        .values({ userId: c.var.user.id, endpoint: url, ...keys })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: c.var.user.id, ...keys } });
      return c.json({ ok: true }, 201);
    },
  )
  .delete('/subscriptions', validate('json', z.object({ endpoint })), async (c) => {
    await c.var.deps.db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, c.req.valid('json').endpoint), eq(pushSubscriptions.userId, c.var.user.id)),
      );
    return c.body(null, 204);
  });
