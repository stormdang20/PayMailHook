import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export * from './auth-schema';

const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });
const tz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tz('created_at').notNull().defaultNow();

export const ingestSource = pgEnum('ingest_source', ['apps_script', 'imap']);
export const bank = pgEnum('bank', ['CAKE', 'TIMO']);
export const direction = pgEnum('direction', ['in', 'out']);
export const deliveryStatus = pgEnum('delivery_status', ['pending', 'retrying', 'success', 'failed']);
export const attemptTrigger = pgEnum('attempt_trigger', ['scheduled', 'manual']);

export const emailConfigs = pgTable(
  'email_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    gmail: text('gmail').notNull(),
    source: ingestSource('source').notNull().default('apps_script'),
    ingestTokenHash: text('ingest_token_hash').notNull().unique(),
    imapPasswordEnc: text('imap_password_enc'),
    lastIngestAt: tz('last_ingest_at'),
    ingestError: text('ingest_error'),
    orderPrefix: text('order_prefix').notNull().default('PMH'),
    webhookUrl: text('webhook_url'),
    webhookSecretEnc: text('webhook_secret_enc'),
    /** Public read-only link to this config's incoming transactions (cashier screen); null = not shared. */
    shareToken: text('share_token').unique(),
    createdAt: createdAt(),
    updatedAt: tz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // A Gmail is claimed only once it has delivered a valid email (design §4.4).
  (t) => [uniqueIndex('email_configs_gmail_claimed_uq').on(t.gmail).where(sql`${t.lastIngestAt} is not null`)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    emailConfigId: uuid('email_config_id')
      .notNull()
      .references(() => emailConfigs.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull().unique(),
    bank: bank('bank').notNull(),
    direction: direction('direction').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }),
    bankTxnId: text('bank_txn_id'),
    description: text('description').notNull(),
    orderId: text('order_id'),
    counterpartyName: text('counterparty_name'),
    counterpartyAccount: text('counterparty_account'),
    counterpartyBank: text('counterparty_bank'),
    /** Public link to this one transaction (proof of payment); null = not shared. */
    shareToken: text('share_token').unique(),
    occurredAt: tz('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('transactions_user_occurred_idx').on(t.userId, t.occurredAt.desc())],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),
    status: deliveryStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at'),
    lastStatusCode: integer('last_status_code'),
    createdAt: createdAt(),
    updatedAt: tz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_user_idx').on(t.userId, t.createdAt.desc()),
  ],
);

export const webhookAttempts = pgTable(
  'webhook_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    trigger: attemptTrigger('trigger').notNull(),
    url: text('url').notNull(),
    statusCode: integer('status_code'),
    error: text('error'),
    responseBody: text('response_body'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_attempts_delivery_idx').on(t.deliveryId)],
);

export const inboundFailures = pgTable('inbound_failures', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailConfigId: uuid('email_config_id')
    .notNull()
    .references(() => emailConfigs.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  reason: text('reason').notNull(),
  rawEnc: bytea('raw_enc').notNull(),
  createdAt: createdAt(),
});

export type EmailConfig = typeof emailConfigs.$inferSelect;
