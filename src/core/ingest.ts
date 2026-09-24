import { eq, sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import PostalMime from 'postal-mime';
import { type Bank, bankForSender, extractOrderId, type ParsedTxn, ParseError } from './banks';
import { encrypt } from './crypto';
import { type EmailConfig, emailConfigs, inboundFailures, transactions, webhookDeliveries } from './db/schema';
import type { Deps } from './deps';
import { verifyBankDkim } from './dkim';
import { htmlToLines, normalizeEmail } from './text';
import { buildPayload } from './webhook';

const MAX_RAW_BYTES = 2 * 1024 * 1024;

type RejectReason = 'too_large' | 'malformed' | 'to_mismatch' | 'dkim_failed' | 'parse_failed';
export type IngestResult =
  | { status: 'stored'; transactionId: string; deliveryId?: string }
  | { status: 'duplicate' | 'ignored' }
  | { status: 'rejected'; reason: RejectReason };

async function reject(
  deps: Deps,
  config: EmailConfig,
  raw: Uint8Array<ArrayBuffer>,
  reason: RejectReason,
  messageId?: string,
) {
  const rawEnc = await encrypt(deps.encryptionKey, raw);
  await deps.db.insert(inboundFailures).values({ emailConfigId: config.id, messageId, reason, rawEnc });
  await deps.db.update(emailConfigs).set({ ingestError: reason }).where(eq(emailConfigs.id, config.id));
  return { status: 'rejected', reason } as const;
}

function parseBody(parse: Bank['parse'], html: string) {
  try {
    return parse(htmlToLines(html));
  } catch (e) {
    if (e instanceof ParseError) return null;
    throw e;
  }
}

/** Drizzle wraps driver errors; both postgres.js and PGlite expose the SQLSTATE as `code`. */
const isUniqueViolation = (e: unknown) =>
  e instanceof DrizzleQueryError && (e.cause as { code?: string } | undefined)?.code === '23505';

async function store(deps: Deps, config: EmailConfig, bank: Bank, messageId: string, txn: ParsedTxn) {
  const orderId = txn.direction === 'in' ? extractOrderId(txn.description, config.orderPrefix) : null;
  return deps.db.transaction(async (tx): Promise<IngestResult> => {
    // First, so a Gmail already claimed by another config (partial unique index) rolls everything back.
    await tx
      .update(emailConfigs)
      .set({ lastIngestAt: sql`now()`, ingestError: null })
      .where(eq(emailConfigs.id, config.id));
    const [row] = await tx
      .insert(transactions)
      .values({
        userId: config.userId,
        emailConfigId: config.id,
        messageId,
        bank: bank.code,
        direction: txn.direction,
        amount: txn.amount,
        balanceAfter: txn.balanceAfter,
        bankTxnId: txn.bankTxnId,
        description: txn.description,
        orderId,
        counterpartyName: txn.counterparty?.name,
        counterpartyAccount: txn.counterparty?.account,
        counterpartyBank: txn.counterparty?.bank,
        occurredAt: txn.occurredAt,
      })
      .onConflictDoNothing({ target: transactions.messageId })
      .returning({ id: transactions.id });
    if (!row) return { status: 'duplicate' };
    if (!orderId || !config.webhookUrl) return { status: 'stored', transactionId: row.id };
    const payload = buildPayload({ ...txn, id: row.id, bank: bank.code, orderId });
    const [delivery] = await tx
      .insert(webhookDeliveries)
      .values({ userId: config.userId, transactionId: row.id, payload, nextAttemptAt: new Date() })
      .returning({ id: webhookDeliveries.id });
    return { status: 'stored', transactionId: row.id, deliveryId: delivery.id };
  });
}

export async function ingestRawEmail(
  deps: Deps,
  config: EmailConfig,
  raw: Uint8Array<ArrayBuffer>,
): Promise<IngestResult> {
  if (raw.byteLength > MAX_RAW_BYTES) return { status: 'rejected', reason: 'too_large' };
  const email = await PostalMime.parse(raw);
  const bank = bankForSender(email.from?.address);
  if (!bank) return { status: 'ignored' };
  const messageId = email.messageId;
  if (!messageId) return reject(deps, config, raw, 'malformed');
  const owner = normalizeEmail(config.gmail);
  if (!email.to?.some((a) => a.address && normalizeEmail(a.address) === owner)) {
    return reject(deps, config, raw, 'to_mismatch', messageId);
  }
  if (!(await verifyBankDkim(raw, bank, deps.resolveTxt))) return reject(deps, config, raw, 'dkim_failed', messageId);
  const txn = parseBody(bank.parse, email.html ?? '');
  if (!txn) return reject(deps, config, raw, 'parse_failed', messageId);
  try {
    const result = await store(deps, config, bank, messageId, txn);
    if (result.status === 'stored' && result.deliveryId) await deps.scheduleDelivery(result.deliveryId, 0);
    return result;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return reject(deps, config, raw, 'to_mismatch', messageId); // Gmail claimed by another config
  }
}
