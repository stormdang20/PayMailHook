import { and, desc, eq, gte, ilike, isNotNull, lt, lte, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { bank, transactions } from '../core/db/schema';
import type { AppEnv } from './app';
import { keyset, pageQuery } from './pagination';
import { share, unshare } from './share';
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
  shareToken: transactions.shareToken,
};

const byTime = keyset(transactions.occurredAt, transactions.id);

/** A calendar day as the shop sees it: YYYY-MM-DD in Vietnam time. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const vnDayStart = (date: string, plusDays = 0) => {
  const start = new Date(`${date}T00:00:00+07:00`);
  start.setUTCDate(start.getUTCDate() + plusDays);
  return start;
};

/** Case-insensitive "contains" over description, order code and payer name; the user's % and _ are literal. */
const textMatch = (text: string) => {
  const pattern = `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  return or(
    ilike(transactions.description, pattern),
    ilike(transactions.orderId, pattern),
    ilike(transactions.counterpartyName, pattern),
  );
};
const idParam = validate('param', z.object({ id: z.uuid() }));
const notFound = { error: { code: 'not_found' } };

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
        // Only transactions whose description carried an order code (the ones that trigger webhooks).
        hasOrder: z.literal('true').optional(),
        bank: z.enum(bank.enumValues).optional(),
        from: day.optional(),
        to: day.optional(),
        q: z.string().trim().min(1).max(100).optional(),
        minAmount: z.coerce.number().int().nonnegative().optional(),
        maxAmount: z.coerce.number().int().nonnegative().optional(),
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
            q.hasOrder ? isNotNull(transactions.orderId) : undefined,
            q.bank ? eq(transactions.bank, q.bank) : undefined,
            q.from ? gte(transactions.occurredAt, vnDayStart(q.from)) : undefined,
            q.to ? lt(transactions.occurredAt, vnDayStart(q.to, 1)) : undefined,
            q.minAmount !== undefined ? gte(transactions.amount, q.minAmount) : undefined,
            q.maxAmount !== undefined ? lte(transactions.amount, q.maxAmount) : undefined,
            q.q ? textMatch(q.q) : undefined,
            byTime.before(q.cursor),
          ),
        )
        .orderBy(desc(transactions.occurredAt), desc(transactions.id))
        .limit(q.limit + 1);
      return c.json(byTime.page(rows, q.limit));
    },
  )
  .get('/:id', idParam, async (c) => {
    const [txn] = await c.var.deps.db
      .select(columns)
      .from(transactions)
      .where(and(eq(transactions.id, c.req.valid('param').id), eq(transactions.userId, c.var.user.id)));
    return txn ? c.json(txn) : c.json(notFound, 404);
  })
  .post('/:id/share', idParam, async (c) => {
    const token = await share(c.var.deps.db, transactions, c.var.user.id, c.req.valid('param').id);
    return token ? c.json({ token }) : c.json(notFound, 404);
  })
  .delete('/:id/share', idParam, async (c) => {
    const done = await unshare(c.var.deps.db, transactions, c.var.user.id, c.req.valid('param').id);
    return done ? c.body(null, 204) : c.json(notFound, 404);
  });
