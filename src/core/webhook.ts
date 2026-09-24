import type { ParsedTxn } from './banks';

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
