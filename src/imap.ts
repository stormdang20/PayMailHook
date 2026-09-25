// Self-host email source (design §2.6): one IMAP IDLE connection per `source = imap` config.
import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { BANKS } from './core/banks';
import { decryptText } from './core/crypto';
import { type EmailConfig, emailConfigs } from './core/db/schema';
import type { Deps } from './core/deps';
import { ingestRawEmail } from './core/ingest';

export type ImapClient = Pick<ImapFlow, 'search' | 'fetchAll'>;
type Connection = ImapClient & Pick<ImapFlow, 'connect' | 'list' | 'mailboxOpen' | 'getMailboxLock' | 'on' | 'logout'>;
type MakeClient = (user: string, pass: string) => Connection;

const QUERY = `from:(${BANKS.flatMap((b) => b.senders).join(' OR ')}) newer_than:1d`;
const MAX_BACKOFF_MS = 5 * 60_000;

const gmail: MakeClient = (user, pass) =>
  new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    maxIdleTime: 25 * 60_000, // Gmail drops IDLE after ~29 minutes
  });

/**
 * Ingests bank mail from the last day not yet handled in this session; a failed email is retried next scan.
 * Mail that reached Gmail before `connectedAt` (when the user added this Gmail) is skipped: connecting an
 * inbox shouldn't import its history. Arrival times are read first so skipped mail is never downloaded.
 */
export async function scan(
  client: ImapClient,
  seen: Set<number>,
  ingest: (raw: Uint8Array<ArrayBuffer>) => Promise<unknown>,
  connectedAt = new Date(0),
) {
  const uids = (await client.search({ gmraw: QUERY }, { uid: true })) || [];
  const unseen = uids.filter((uid) => !seen.has(uid));
  if (unseen.length === 0) return;
  const fresh: number[] = [];
  for (const m of await client.fetchAll(unseen, { internalDate: true }, { uid: true })) {
    if (new Date(m.internalDate ?? 0) >= connectedAt) fresh.push(m.uid);
    else seen.add(m.uid);
  }
  if (fresh.length === 0) return;
  for (const message of await client.fetchAll(fresh, { source: true }, { uid: true })) {
    if (!message.source) continue;
    await ingest(new Uint8Array(message.source));
    seen.add(message.uid);
  }
}

const isAuthFailure = (e: unknown) =>
  e instanceof Error && 'authenticationFailed' in e && e.authenticationFailed === true;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Holds one connection open until it closes; resolves on close, throws on connect/auth errors. */
async function session(deps: Deps, config: EmailConfig, client: Connection, seen: Set<number>, signal?: AbortSignal) {
  const closed = new Promise<void>((resolve) => client.on('close', resolve));
  await client.connect();
  // "All Mail": the user's filters may move bank mail out of INBOX.
  const all = (await client.list()).find((m) => m.specialUse === '\\All')?.path ?? 'INBOX';
  // Select the mailbox but hold its lock only while scanning: imapflow only IDLEs on a connection with no
  // lock held, and without IDLE Gmail's new-mail push arrives only with the ~5-minute keepalive.
  await client.mailboxOpen(all);
  signal?.addEventListener('abort', () => client.logout().catch(console.error), { once: true });
  const ingest = async (raw: Uint8Array<ArrayBuffer>) => {
    // Re-read the config: webhook URL or prefix may have changed since the connection opened.
    const [fresh] = await deps.db.select().from(emailConfigs).where(eq(emailConfigs.id, config.id));
    if (fresh) await ingestRawEmail(deps, fresh, raw);
  };
  let queue = Promise.resolve();
  const trigger = () => {
    queue = queue
      .then(async () => {
        const lock = await client.getMailboxLock(all);
        try {
          await scan(client, seen, ingest, config.createdAt);
        } finally {
          lock.release();
        }
      })
      .catch(console.error);
  };
  client.on('exists', trigger);
  trigger();
  await closed;
}

/** Keeps one config connected with backoff; stops on abort or on an authentication failure. */
export async function startImap(deps: Deps, config: EmailConfig, makeClient: MakeClient = gmail, signal?: AbortSignal) {
  if (!config.imapPasswordEnc) return;
  const seen = new Set<number>();
  let backoff = 1000;
  while (!signal?.aborted) {
    const client = makeClient(config.gmail, await decryptText(deps.encryptionKey, config.imapPasswordEnc));
    try {
      await session(deps, config, client, seen, signal);
      backoff = 1000;
    } catch (e) {
      if (isAuthFailure(e)) {
        // Retrying a wrong App Password only gets the account locked; wait for the user to update it.
        await deps.db
          .update(emailConfigs)
          .set({ ingestError: 'imap_auth_failed' })
          .where(eq(emailConfigs.id, config.id));
        return;
      }
      console.error(`imap ${config.id}:`, e);
    }
    await sleep(backoff, signal);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

/** Every minute, (re)starts listeners so they match the imap configs in the DB. */
export function superviseImap(deps: Deps) {
  const running = new Map<string, AbortController>(); // key: id + encrypted password, so a new password restarts
  async function sync() {
    const wanted = await deps.db
      .select()
      .from(emailConfigs)
      .where(
        and(
          eq(emailConfigs.source, 'imap'),
          isNotNull(emailConfigs.imapPasswordEnc),
          or(isNull(emailConfigs.ingestError), ne(emailConfigs.ingestError, 'imap_auth_failed')),
        ),
      );
    const keys = new Map(wanted.map((c) => [`${c.id}:${c.imapPasswordEnc}`, c]));
    for (const [key, controller] of running) {
      if (!keys.has(key)) {
        controller.abort();
        running.delete(key);
      }
    }
    for (const [key, config] of keys) {
      if (running.has(key)) continue;
      const controller = new AbortController();
      running.set(key, controller);
      startImap(deps, config, gmail, controller.signal)
        .catch(console.error)
        .finally(() => running.get(key) === controller && running.delete(key));
    }
  }
  const tick = () => sync().catch(console.error);
  tick();
  return setInterval(tick, 60_000);
}
