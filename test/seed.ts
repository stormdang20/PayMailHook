import type { Database } from '../src/core/db/client';
import { transactions, webhookDeliveries } from '../src/core/db/schema';

type Txn = typeof transactions.$inferInsert;
type Delivery = typeof webhookDeliveries.$inferInsert;

/** Inserts a transaction row directly (no email, no DKIM) for API and maintenance tests. */
export async function seedTransaction(
  db: Database,
  config: { id: string; userId: string },
  overrides: Partial<Txn> = {},
) {
  const [txn] = await db
    .insert(transactions)
    .values({
      userId: config.userId,
      emailConfigId: config.id,
      messageId: crypto.randomUUID(),
      bank: 'CAKE',
      direction: 'in',
      amount: 1000,
      description: 'PMH1',
      orderId: '1',
      occurredAt: new Date(),
      ...overrides,
    })
    .returning();
  return txn;
}

export async function seedDelivery(
  db: Database,
  txn: { id: string; userId: string },
  overrides: Partial<Delivery> = {},
) {
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({ userId: txn.userId, transactionId: txn.id, payload: {}, nextAttemptAt: new Date(), ...overrides })
    .returning();
  return delivery;
}
