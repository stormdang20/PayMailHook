import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { transactions, webhookAttempts, webhookDeliveries } from '../core/db/schema';
import type { AppEnv } from './app';
import { keyset, pageQuery } from './pagination';
import { validate } from './validate';

const columns = {
  id: webhookDeliveries.id,
  transactionId: webhookDeliveries.transactionId,
  status: webhookDeliveries.status,
  attemptCount: webhookDeliveries.attemptCount,
  nextAttemptAt: webhookDeliveries.nextAttemptAt,
  lastStatusCode: webhookDeliveries.lastStatusCode,
  createdAt: webhookDeliveries.createdAt,
  orderId: transactions.orderId,
  amount: transactions.amount,
  currency: transactions.currency,
};

const byCreated = keyset(webhookDeliveries.createdAt, webhookDeliveries.id);
const idParam = validate('param', z.object({ id: z.uuid() }));
const notFound = { error: { code: 'not_found' } };
const owned = (userId: string, id: string) => and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.userId, userId));

export const deliveryRoutes = new Hono<AppEnv>()
  .get(
    '/',
    validate(
      'query',
      z.object({ ...pageQuery, status: z.enum(['pending', 'retrying', 'success', 'failed']).optional() }),
    ),
    async (c) => {
      const q = c.req.valid('query');
      const rows = await c.var.deps.db
        .select({ ...columns, ...byCreated.select })
        .from(webhookDeliveries)
        .innerJoin(transactions, eq(webhookDeliveries.transactionId, transactions.id))
        .where(
          and(
            eq(webhookDeliveries.userId, c.var.user.id),
            q.status ? eq(webhookDeliveries.status, q.status) : undefined,
            byCreated.before(q.cursor),
          ),
        )
        .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
        .limit(q.limit + 1);
      return c.json(byCreated.page(rows, q.limit));
    },
  )
  .get('/:id', idParam, async (c) => {
    const { db } = c.var.deps;
    const id = c.req.valid('param').id;
    const [delivery] = await db
      .select({ ...columns, payload: webhookDeliveries.payload })
      .from(webhookDeliveries)
      .innerJoin(transactions, eq(webhookDeliveries.transactionId, transactions.id))
      .where(owned(c.var.user.id, id));
    if (!delivery) return c.json(notFound, 404);
    const attempts = await db
      .select()
      .from(webhookAttempts)
      .where(eq(webhookAttempts.deliveryId, id))
      .orderBy(asc(webhookAttempts.attemptNumber));
    return c.json({ ...delivery, attempts });
  })
  .post('/:id/retry', idParam, async (c) => {
    const { deps } = c.var;
    const id = c.req.valid('param').id;
    const [delivery] = await deps.db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(owned(c.var.user.id, id));
    if (!delivery) return c.json(notFound, 404);
    // Manual sends only re-send finished deliveries; scheduled ones are already on their way (deviation 1.8-a).
    if (delivery.status !== 'success' && delivery.status !== 'failed') {
      return c.json({ error: { code: 'not_finished', status: delivery.status } }, 409);
    }
    await deps.scheduleDelivery(id, 0, 'manual');
    return c.json({ ok: true }, 202);
  });
