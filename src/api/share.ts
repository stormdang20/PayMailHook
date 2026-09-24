import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { randomToken } from '../core/crypto';
import type { Database } from '../core/db/client';
import { emailConfigs, transactions } from '../core/db/schema';
import type { AppEnv } from './app';
import { keyset, pageQuery } from './pagination';
import { validate } from './validate';

type Shareable = typeof transactions | typeof emailConfigs;

/** Creates the share token once; calling again returns the same link. Null if the row isn't the user's. */
export async function share(db: Database, table: Shareable, userId: string, id: string) {
  const [row] = await db
    .update(table)
    .set({ shareToken: sql`coalesce(${table.shareToken}, ${randomToken()})` })
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .returning({ token: table.shareToken });
  return row?.token ?? null;
}

export async function unshare(db: Database, table: Shareable, userId: string, id: string) {
  const rows = await db
    .update(table)
    .set({ shareToken: null })
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .returning({ id: table.id });
  return rows.length > 0;
}

/** What a share link may show: no Gmail, webhook, counterparty (the payer's PII) or internal ids. */
const publicColumns = {
  id: transactions.id,
  bank: transactions.bank,
  direction: transactions.direction,
  amount: transactions.amount,
  description: transactions.description,
  orderId: transactions.orderId,
  bankTxnId: transactions.bankTxnId,
  occurredAt: transactions.occurredAt,
};
const byTime = keyset(transactions.occurredAt, transactions.id);
const token = validate('param', z.object({ token: z.string().max(64) }));
const notFound = { error: { code: 'not_found' } };

export const shareRoutes = new Hono<AppEnv>()
  .get('/t/:token', token, async (c) => {
    const [txn] = await c.var.deps.db
      .select(publicColumns)
      .from(transactions)
      .where(eq(transactions.shareToken, c.req.valid('param').token));
    return txn ? c.json(txn) : c.json(notFound, 404);
  })
  // Incoming money only: a cashier screen has no business seeing what the shop spends.
  .get('/c/:token', token, validate('query', z.object(pageQuery)), async (c) => {
    const { db } = c.var.deps;
    const q = c.req.valid('query');
    const [config] = await db
      .select({ id: emailConfigs.id })
      .from(emailConfigs)
      .where(eq(emailConfigs.shareToken, c.req.valid('param').token));
    if (!config) return c.json(notFound, 404);
    const rows = await db
      .select({ ...publicColumns, ...byTime.select })
      .from(transactions)
      .where(and(eq(transactions.emailConfigId, config.id), eq(transactions.direction, 'in'), byTime.before(q.cursor)))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(q.limit + 1);
    return c.json(byTime.page(rows, q.limit));
  });
