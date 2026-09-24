import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { transactions } from '../core/db/schema';
import type { AppEnv } from './app';
import { keyset, pageQuery } from './pagination';
import { validate } from './validate';

const columns = {
  id: transactions.id,
  emailConfigId: transactions.emailConfigId,
  bank: transactions.bank,
  direction: transactions.direction,
  amount: transactions.amount,
  balanceAfter: transactions.balanceAfter,
  bankTxnId: transactions.bankTxnId,
  description: transactions.description,
  orderId: transactions.orderId,
  counterpartyName: transactions.counterpartyName,
  counterpartyAccount: transactions.counterpartyAccount,
  counterpartyBank: transactions.counterpartyBank,
  occurredAt: transactions.occurredAt,
  createdAt: transactions.createdAt,
};

const byTime = keyset(transactions.occurredAt, transactions.id);

export const transactionRoutes = new Hono<AppEnv>()
  .get(
    '/',
    validate(
      'query',
      z.object({
        ...pageQuery,
        configId: z.uuid().optional(),
        orderId: z.string().max(64).optional(),
        direction: z.enum(['in', 'out']).optional(),
      }),
    ),
    async (c) => {
      const q = c.req.valid('query');
      const rows = await c.var.deps.db
        .select({ ...columns, ...byTime.select })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, c.var.user.id),
            q.configId ? eq(transactions.emailConfigId, q.configId) : undefined,
            q.orderId ? eq(transactions.orderId, q.orderId.toUpperCase()) : undefined,
            q.direction ? eq(transactions.direction, q.direction) : undefined,
            byTime.before(q.cursor),
          ),
        )
        .orderBy(desc(transactions.occurredAt), desc(transactions.id))
        .limit(q.limit + 1);
      return c.json(byTime.page(rows, q.limit));
    },
  )
  .get('/:id', validate('param', z.object({ id: z.uuid() })), async (c) => {
    const [txn] = await c.var.deps.db
      .select(columns)
      .from(transactions)
      .where(and(eq(transactions.id, c.req.valid('param').id), eq(transactions.userId, c.var.user.id)));
    return txn ? c.json(txn) : c.json({ error: { code: 'not_found' } }, 404);
  });
