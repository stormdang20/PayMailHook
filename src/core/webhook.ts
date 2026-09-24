import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { ParsedTxn } from './banks';
import { decryptText } from './crypto';
import { emailConfigs, transactions, webhookAttempts, webhookDeliveries } from './db/schema';
import type { Deps, Trigger } from './deps';

export const newWebhookSecret = () => `whsec_${crypto.getRandomValues(new Uint8Array(24)).toBase64()}`;

/** Standard Webhooks: v1,base64(HMAC-SHA256(key, "{id}.{ts}.{body}")). */
export async function signWebhook(secret: string, id: string, timestamp: number, body: string) {
  const keyBytes = Uint8Array.fromBase64(secret.replace(/^whsec_/, ''));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${new Uint8Array(mac).toBase64()}`;
}

type PayloadInput = ParsedTxn & { id: string; bank: string; orderId: string };

/** Webhook body (design §3.1); built once per delivery and resent unchanged. */
export function buildPayload(t: PayloadInput) {
  const occurredAt = t.occurredAt.toISOString();
  return {
    type: 'payment.received',
    timestamp: occurredAt,
    data: {
      orderId: t.orderId,
      transaction: {
        id: t.id,
        bank: t.bank,
        direction: t.direction,
        amount: t.amount,
        currency: 'VND',
        description: t.description,
        bankTxnId: t.bankTxnId ?? null,
        balanceAfter: t.balanceAfter ?? null,
        counterparty: {
          name: t.counterparty?.name ?? null,
          account: t.counterparty?.account ?? null,
          bank: t.counterparty?.bank ?? null,
        },
        occurredAt,
      },
    },
  };
}

type UrlPolicy = { allowPrivate: boolean; appHost: string };

export const urlPolicy = (deps: Deps): UrlPolicy => ({
  allowPrivate: deps.allowPrivateWebhooks,
  appHost: new URL(deps.appUrl).host,
});
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost'];

function parseUrl(raw: string) {
  try {
    return new URL(raw);
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
}

/** Returns an error code, or null when the URL is acceptable (design §3.4). */
export function validateWebhookUrl(raw: string, policy: UrlPolicy): string | null {
  const url = parseUrl(raw);
  if (!url) return 'invalid_url';
  if (policy.allowPrivate) return ['https:', 'http:'].includes(url.protocol) ? null : 'invalid_protocol';
  if (url.protocol !== 'https:') return 'https_required';
  if (url.username || url.password) return 'credentials_not_allowed';
  if (url.port && url.port !== '443') return 'port_not_allowed';
  // WHATWG URL already normalizes 0x7f000001 → 127.0.0.1; drop the FQDN dot so "localhost." can't slip by.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || /^[\d.]+$/.test(host)) return 'ip_not_allowed';
  const blocked = host === 'localhost' || !host.includes('.') || host === policy.appHost;
  if (blocked || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return 'host_not_allowed';
  // ponytail: no DNS check for names resolving to private IPs; add a DoH A/AAAA check if abuse appears.
  return null;
}

const RETRY_SCHEDULE = [10, 10, 20, 30, 50, 3600, 7200, 14400, 28800];

type Delivery = typeof webhookDeliveries.$inferSelect;
type Outcome = { statusCode: number | null; responseBody: string | null; error: string | null };

/** Conditional UPDATE as a lease: only one caller wins, a crashed sender is retried after 60s (design §3.2). */
async function claim(deps: Deps, id: string, trigger: Trigger) {
  // Manual only re-sends finished deliveries, so it never races or cancels a scheduled retry.
  const due =
    trigger === 'manual'
      ? inArray(webhookDeliveries.status, ['success', 'failed'])
      : and(
          inArray(webhookDeliveries.status, ['pending', 'retrying']),
          lte(webhookDeliveries.nextAttemptAt, sql`now() + interval '5 seconds'`),
        );
  const [row] = await deps.db
    .update(webhookDeliveries)
    .set({ nextAttemptAt: sql`now() + interval '60 seconds'` })
    .where(and(eq(webhookDeliveries.id, id), due))
    .returning();
  return row;
}

async function loadTarget(deps: Deps, transactionId: string) {
  const [target] = await deps.db
    .select({ url: emailConfigs.webhookUrl, secretEnc: emailConfigs.webhookSecretEnc })
    .from(transactions)
    .innerJoin(emailConfigs, eq(transactions.emailConfigId, emailConfigs.id))
    .where(eq(transactions.id, transactionId));
  return target;
}

/** One signed POST; never throws for HTTP or network failures, they come back as the outcome. */
export async function postWebhook(
  deps: Deps,
  id: string,
  payload: unknown,
  url: string,
  secretEnc: string,
): Promise<Outcome> {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const signature = await signWebhook(await decryptText(deps.encryptionKey, secretEnc), id, ts, body);
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'PayMailHook/1.0',
        'webhook-id': id,
        'webhook-timestamp': String(ts),
        'webhook-signature': signature,
      },
    });
    return { statusCode: res.status, responseBody: (await res.text()).slice(0, 1024), error: null };
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return { statusCode: null, responseBody: null, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

async function transition(deps: Deps, delivery: Delivery, trigger: Trigger, statusCode: number | null) {
  const update = (set: PgUpdateSetSource<typeof webhookDeliveries>) =>
    deps.db
      .update(webhookDeliveries)
      .set({ attemptCount: delivery.attemptCount + 1, lastStatusCode: statusCode, ...set })
      .where(eq(webhookDeliveries.id, delivery.id));
  if (statusCode !== null && statusCode >= 200 && statusCode < 300) {
    return update({ status: 'success', nextAttemptAt: null });
  }
  if (trigger === 'manual') return update({ nextAttemptAt: null });
  const delay = RETRY_SCHEDULE[delivery.attemptCount];
  if (delay === undefined) return update({ status: 'failed', nextAttemptAt: null });
  await update({ status: 'retrying', nextAttemptAt: sql`now() + make_interval(secs => ${delay})` });
  await deps.scheduleDelivery(delivery.id, delay);
}

export async function deliver(deps: Deps, id: string, trigger: Trigger = 'scheduled') {
  const delivery = await claim(deps, id, trigger);
  if (!delivery) return;
  const target = await loadTarget(deps, delivery.transactionId);
  const url = target?.url;
  const secretEnc = target?.secretEnc;
  const blocked = url && secretEnc ? validateWebhookUrl(url, urlPolicy(deps)) : 'webhook_not_configured';
  const started = Date.now();
  const outcome: Outcome =
    url && secretEnc && !blocked
      ? await postWebhook(deps, delivery.id, delivery.payload, url, secretEnc)
      : { statusCode: null, responseBody: null, error: blocked };
  await deps.db.insert(webhookAttempts).values({
    deliveryId: delivery.id,
    attemptNumber: delivery.attemptCount + 1,
    trigger,
    url: url ?? '',
    ...outcome,
    durationMs: Date.now() - started,
  });
  await transition(deps, delivery, trigger, outcome.statusCode);
}
