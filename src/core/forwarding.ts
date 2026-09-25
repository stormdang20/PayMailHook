// Forwarding source (design D2, learned from mailflare): the user's Gmail forwards bank mail to a unique
// address on our inbound domain; Cloudflare Email Routing hands it to the Worker's email() handler, or,
// for self-host, a relay Worker posts it to /api/inbound. The bank's DKIM signature survives forwarding
// and `To` is still the user's Gmail, so the normal ingest checks apply unchanged.
import { eq } from 'drizzle-orm';
import PostalMime from 'postal-mime';
import { emailConfigs } from './db/schema';
import type { Deps } from './deps';
import { verifyBankDkim } from './dkim';
import { type IngestResult, ingestRawEmail } from './ingest';

export type Inbound = { domain: string; secret?: string };
export type ForwardedResult = IngestResult | { status: 'unknown_recipient' | 'confirmation' };

/** Hard to guess, so nobody else can send mail into this config's pipeline without knowing it. */
export const newForwardingAddress = (domain: string) =>
  `pmh-${crypto.getRandomValues(new Uint8Array(8)).toHex()}@${domain.toLowerCase()}`;

const GMAIL_CONFIRMATION_SENDER = 'forwarding-noreply@google.com';

/**
 * Gmail asks the new forwarding address to confirm itself. Keep its code and link on the config so the
 * user can finish the setup from our UI, but only when the mail really comes from Google (DKIM google.com).
 */
async function saveConfirmation(deps: Deps, configId: string, raw: Uint8Array) {
  if (!(await verifyBankDkim(raw, { dkimDomain: 'google.com' }, deps.resolveTxt))) return;
  const email = await PostalMime.parse(raw);
  const text = `${email.subject ?? ''}\n${email.text ?? ''}\n${email.html ?? ''}`;
  const code = text.match(/\(#(\d{6,})\)/)?.[1] ?? null;
  const link = text.match(/https:\/\/mail-settings\.google\.com\/mail\/vf-[^\s"'<>]+/)?.[0] ?? null;
  await deps.db
    .update(emailConfigs)
    .set({ forwardingConfirmation: { code, link } })
    .where(eq(emailConfigs.id, configId));
}

/** Handles one message delivered to `recipient` on the inbound domain. */
export async function receiveForwarded(
  deps: Deps,
  recipient: string,
  raw: Uint8Array<ArrayBuffer>,
): Promise<ForwardedResult> {
  const [config] = await deps.db
    .select()
    .from(emailConfigs)
    .where(eq(emailConfigs.forwardingAddress, recipient.trim().toLowerCase()));
  if (!config) return { status: 'unknown_recipient' };
  const from = (await PostalMime.parse(raw)).from?.address?.toLowerCase();
  if (from === GMAIL_CONFIRMATION_SENDER) {
    await saveConfirmation(deps, config.id, raw);
    return { status: 'confirmation' };
  }
  return ingestRawEmail(deps, config, raw);
}

/** HMAC-SHA256 (hex) over `${to}\n` + raw, the relay Worker's signature on /api/inbound. */
export async function inboundSignature(secret: string, to: string, raw: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const prefix = new TextEncoder().encode(`${to}\n`);
  const data = new Uint8Array(prefix.length + raw.length);
  data.set(prefix);
  data.set(raw, prefix.length);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data)).toHex();
}
