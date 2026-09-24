// Optional Gmail OAuth source (P4, design D2): Gmail pushes changes to Pub/Sub, Pub/Sub pushes to
// /api/gmail/pubsub, and we read new bank mail through the Gmail REST API with the user's token
// (stored by better-auth's linkSocial). Plain fetch, so it runs on Workers and Bun alike.
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { BANKS, bankForSender } from './banks';
import { account, type EmailConfig, emailConfigs } from './db/schema';
import type { Deps } from './deps';
import { ingestRawEmail } from './ingest';
import { normalizeEmail } from './text';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export type GmailPush = { topic: string; verificationToken: string };

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const RECENT_BANK_MAIL = `from:(${BANKS.flatMap((b) => b.senders).join(' OR ')}) newer_than:1d`;

export class GmailError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`gmail ${status}: ${body.slice(0, 200)}`);
  }
}

async function gmail<T>(deps: Deps, token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await deps.fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!res.ok) throw new GmailError(res.status, await res.text());
  return (await res.json()) as T;
}

/** A fresh access token for one linked Google account (better-auth refreshes it when expired). */
const tokenFor = async (deps: Deps, userId: string, accountId: string) =>
  (await deps.auth.api.getAccessToken({ body: { accountId, userId } })).accessToken;

/** users.watch without label filters, so bank mail moved out of INBOX by filters still notifies. Valid 7 days. */
async function watch(deps: Deps, token: string) {
  if (!deps.gmailPush) throw new Error('gmail push is not configured');
  const res = await gmail<{ historyId: string; expiration: string }>(deps, token, '/watch', {
    method: 'POST',
    body: JSON.stringify({ topicName: deps.gmailPush.topic }),
  });
  return { gmailHistoryId: res.historyId, gmailWatchExpiresAt: new Date(Number(res.expiration)) };
}

/**
 * Finds which of the user's linked Google accounts is this config's Gmail (proving ownership),
 * then starts the watch. Returns an error code, or null on success.
 */
export async function connectGmail(deps: Deps, config: EmailConfig) {
  const linked = await deps.db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, config.userId), eq(account.providerId, 'google')));
  for (const { id } of linked) {
    const token = await tokenFor(deps, config.userId, id);
    const profile = await gmail<{ emailAddress: string }>(deps, token, '/profile').catch((e) => {
      if (e instanceof GmailError) return null; // this account didn't grant the Gmail scope
      throw e;
    });
    if (!profile || normalizeEmail(profile.emailAddress) !== normalizeEmail(config.gmail)) continue;
    await deps.db
      .update(emailConfigs)
      // Store Gmail's own spelling of the address: Pub/Sub notifications are looked up by it.
      .set({
        googleAccountId: id,
        gmail: profile.emailAddress.toLowerCase(),
        ingestError: null,
        ...(await watch(deps, token)),
      })
      .where(eq(emailConfigs.id, config.id));
    return null;
  }
  return 'gmail_account_mismatch';
}

type History = {
  history?: { messagesAdded?: { message: { id: string } }[] }[];
  historyId: string;
  nextPageToken?: string;
};

/** Message ids added since `startHistoryId`, and the history id to continue from. */
async function addedSince(deps: Deps, token: string, startHistoryId: string) {
  const ids = new Set<string>();
  let page: History | undefined;
  let pageToken = '';
  do {
    const query = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
      ...(pageToken && { pageToken }),
    });
    page = await gmail<History>(deps, token, `/history?${query}`);
    for (const h of page.history ?? []) for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return { ids: [...ids], historyId: page.historyId };
}

/** Too old a history id answers 404: fall back to bank mail from the last day (message_id dedupes). */
async function recentBankMail(deps: Deps, token: string) {
  const list = await gmail<{ messages?: { id: string }[] }>(
    deps,
    token,
    `/messages?${new URLSearchParams({ q: RECENT_BANK_MAIL })}`,
  );
  const { historyId } = await gmail<{ historyId: string }>(deps, token, '/profile');
  return { ids: (list.messages ?? []).map((m) => m.id), historyId };
}

async function ingestMessage(deps: Deps, token: string, config: EmailConfig, id: string) {
  const meta = await gmail<{ payload?: { headers?: { name: string; value: string }[] } }>(
    deps,
    token,
    `/messages/${id}?format=metadata&metadataHeaders=From`,
  );
  const from = meta.payload?.headers?.find((h) => h.name.toLowerCase() === 'from')?.value ?? '';
  if (!bankForSender(from.match(/<([^>]+)>/)?.[1] ?? from.trim())) return; // only bank mail is downloaded
  const { raw } = await gmail<{ raw: string }>(deps, token, `/messages/${id}?format=raw`);
  await ingestRawEmail(deps, config, Uint8Array.fromBase64(raw, { alphabet: 'base64url' }));
}

/** Handles one Pub/Sub notification for a connected config. */
export async function syncGmail(deps: Deps, config: EmailConfig) {
  if (!config.googleAccountId || !config.gmailHistoryId) return;
  let token: string;
  try {
    token = await tokenFor(deps, config.userId, config.googleAccountId);
  } catch (e) {
    console.error(`gmail token for ${config.id}:`, e);
    await deps.db.update(emailConfigs).set({ ingestError: 'gmail_auth_failed' }).where(eq(emailConfigs.id, config.id));
    return;
  }
  const { ids, historyId } = await addedSince(deps, token, config.gmailHistoryId).catch((e) => {
    if (e instanceof GmailError && e.status === 404) return recentBankMail(deps, token);
    throw e;
  });
  for (const id of ids) await ingestMessage(deps, token, config, id);
  await deps.db.update(emailConfigs).set({ gmailHistoryId: historyId }).where(eq(emailConfigs.id, config.id));
}

/** Hourly: re-watch every connected mailbox whose 7-day watch ends within a day. */
export async function renewGmailWatches(deps: Deps) {
  if (!deps.gmailPush) return;
  const due = await deps.db
    .select()
    .from(emailConfigs)
    .where(
      and(
        eq(emailConfigs.source, 'gmail_oauth'),
        isNotNull(emailConfigs.googleAccountId),
        lt(emailConfigs.gmailWatchExpiresAt, sql`now() + interval '1 day'`),
      ),
    );
  for (const config of due) {
    try {
      const token = await tokenFor(deps, config.userId, config.googleAccountId ?? '');
      const { gmailWatchExpiresAt } = await watch(deps, token); // keep our history id: nothing may be skipped
      await deps.db.update(emailConfigs).set({ gmailWatchExpiresAt }).where(eq(emailConfigs.id, config.id));
    } catch (e) {
      console.error(`gmail watch renewal for ${config.id}:`, e);
      await deps.db
        .update(emailConfigs)
        .set({ ingestError: 'gmail_auth_failed' })
        .where(eq(emailConfigs.id, config.id));
    }
  }
}
