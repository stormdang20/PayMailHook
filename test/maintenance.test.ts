import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../src/core/db/client';
import { emailConfigs, inboundFailures, transactions, webhookDeliveries } from '../src/core/db/schema';
import { runMaintenance } from '../src/core/maintenance';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

async function seedDelivery(status: 'pending' | 'retrying' | 'success' | 'failed') {
  const config = await seedConfig(db, { lastIngestAt: null, gmail: `${crypto.randomUUID()}@gmail.com` });
  const [txn] = await db
    .insert(transactions)
    .values({
      userId: config.userId,
      emailConfigId: config.id,
      messageId: crypto.randomUUID(),
      bank: 'CAKE',
      direction: 'in',
      amount: 1,
      description: 'PMH1',
      occurredAt: new Date(),
    })
    .returning();
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({ userId: config.userId, transactionId: txn.id, payload: {}, status, nextAttemptAt: new Date() })
    .returning();
  return { config, delivery };
}

test('re-enqueues deliveries whose schedule was lost', async () => {
  const { delivery: stuck } = await seedDelivery('retrying');
  await seedDelivery('pending'); // due now: not stuck, must not be re-enqueued
  await db
    .update(webhookDeliveries)
    .set({ nextAttemptAt: sql`now() - interval '10 minutes'` })
    .where(eq(webhookDeliveries.id, stuck.id));
  const { deps, scheduled } = makeDeps(db);
  await runMaintenance(deps);
  expect(scheduled).toEqual([[stuck.id, 0]]);
});

test('prunes finished deliveries after 30 days and failures after 7 days', async () => {
  const { delivery: old, config } = await seedDelivery('success');
  const { delivery: open } = await seedDelivery('retrying');
  const { delivery: recent } = await seedDelivery('failed');
  const aged = sql`now() - interval '31 days'`;
  await db
    .update(webhookDeliveries)
    .set({ createdAt: aged })
    .where(sql`${webhookDeliveries.id} in (${old.id}, ${open.id})`);
  await db.insert(inboundFailures).values([
    {
      emailConfigId: config.id,
      reason: 'dkim_failed',
      rawEnc: new Uint8Array([1]),
      createdAt: new Date(Date.now() - 8 * 86400_000),
    },
    { emailConfigId: config.id, reason: 'dkim_failed', rawEnc: new Uint8Array([2]) },
  ]);
  await runMaintenance(makeDeps(db).deps);
  const left = (await db.select({ id: webhookDeliveries.id }).from(webhookDeliveries)).map((d) => d.id).sort();
  expect(left).toEqual([open.id, recent.id].sort());
  expect(await db.$count(inboundFailures)).toBe(1);
});

test('deletes configs that never received an email within 7 days', async () => {
  const abandoned = await seedConfig(db, { gmail: 'a@gmail.com' });
  const active = await seedConfig(db, { gmail: 'b@gmail.com', lastIngestAt: new Date() });
  const young = await seedConfig(db, { gmail: 'c@gmail.com' });
  await db
    .update(emailConfigs)
    .set({ createdAt: sql`now() - interval '8 days'` })
    .where(sql`${emailConfigs.id} in (${abandoned.id}, ${active.id})`);
  await runMaintenance(makeDeps(db).deps);
  const left = (await db.select({ id: emailConfigs.id }).from(emailConfigs)).map((c) => c.id).sort();
  expect(left).toEqual([active.id, young.id].sort());
});
