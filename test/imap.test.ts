import { afterEach, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { encryptText } from '../src/core/crypto';
import type { Database } from '../src/core/db/client';
import { emailConfigs } from '../src/core/db/schema';
import { type ImapClient, scan, startImap } from '../src/imap';
import { createTestDb, seedConfig } from './db';
import { makeDeps, TEST_KEY } from './deps';

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

function fakeClient(uids: number[]) {
  const searches: unknown[] = [];
  const client: ImapClient = {
    search: async (query) => {
      searches.push(query);
      return uids;
    },
    fetchAll: async (range) => (range as number[]).map((uid) => ({ uid, source: Buffer.from(`raw-${uid}`) })) as never,
  };
  return { client, searches };
}

test('scan ingests each bank email once and asks Gmail only for recent bank mail', async () => {
  const { client, searches } = fakeClient([1, 2]);
  const seen = new Set<number>();
  const ingested: string[] = [];
  const ingest = async (raw: Uint8Array) => {
    ingested.push(new TextDecoder().decode(raw));
  };
  await scan(client, seen, ingest);
  await scan(client, seen, ingest);
  expect(ingested).toEqual(['raw-1', 'raw-2']);
  expect(searches[0]).toEqual({ gmraw: 'from:(no-reply@cake.vn OR support@timo.vn) newer_than:1d' });
});

test('an email whose ingest failed is retried on the next scan', async () => {
  const { client } = fakeClient([7]);
  const seen = new Set<number>();
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error('db down');
  };
  await expect(scan(client, seen, flaky)).rejects.toThrow('db down');
  await scan(client, seen, flaky);
  expect(calls).toBe(2);
  expect(seen.has(7)).toBe(true);
});

test('an authentication failure is recorded and the listener stops reconnecting', async () => {
  const config = await seedConfig(db, {
    source: 'imap',
    imapPasswordEnc: await encryptText(TEST_KEY, 'wrong app password'),
  });
  let connects = 0;
  const failing = () => ({
    on: () => {},
    connect: async () => {
      connects++;
      throw Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
    },
  });
  const done = startImap(makeDeps(db).deps, config, failing as never);
  await done;
  const [row] = await db.select().from(emailConfigs).where(eq(emailConfigs.id, config.id));
  expect(row.ingestError).toBe('imap_auth_failed');
  expect(connects).toBe(1);
});

test('the mailbox lock is released after each scan, so the connection can IDLE for push', async () => {
  const config = await seedConfig(db, {
    source: 'imap',
    imapPasswordEnc: await encryptText(TEST_KEY, 'abcdefghijklmnop'),
  });
  let held = 0;
  let close = () => {};
  let scanned!: () => void;
  const scanDone = new Promise<void>((r) => {
    scanned = r;
  });
  const fake = () => ({
    on: (event: string, fn: () => void) => {
      if (event === 'close') close = fn;
    },
    connect: async () => {},
    list: async () => [{ path: '[Gmail]/All Mail', specialUse: '\\All' }],
    mailboxOpen: async () => ({}),
    getMailboxLock: async () => {
      held++;
      return { release: () => held-- };
    },
    search: async () => {
      queueMicrotask(scanned);
      return [];
    },
    fetchAll: async () => [],
    logout: async () => {},
  });
  const controller = new AbortController();
  const running = startImap(makeDeps(db).deps, config, fake as never, controller.signal);
  await scanDone;
  await Bun.sleep(10);
  expect(held).toBe(0); // idle between scans: nothing holds the mailbox
  controller.abort();
  close();
  await running;
});
