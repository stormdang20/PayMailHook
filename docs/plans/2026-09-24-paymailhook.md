# PayMailHook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans (or subagent-driven-development) to work through this plan task by task. Always follow [CLAUDE.md](../../CLAUDE.md): code, comments, commits and docs in English; replies to the user in Vietnamese; TDD; one commit per step.

**Goal:** Build PayMailHook exactly as specified in [docs/design.md](../design.md). The system receives balance-change emails (CAKE, Timo), verifies DKIM, parses them, stores the transaction, then sends a signed webhook with retries. It has a dashboard and runs in two modes: Hosted (Cloudflare Workers) and Self-host (Docker).

**Architecture:** All logic lives in `src/core`, written in plain TS, receiving every runtime dependency through `Deps`. `src/api/app.ts` is a runtime-agnostic Hono app. Two thin entries: `src/worker.ts` (Workers + Queues + Cron) and `src/server.ts` (Bun + setTimeout + IMAP). Tests use `bun test` with PGlite.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle (pg-core), postgres.js, PGlite (test), postal-mime, mailauth (`lib/dkim/*`), better-auth, Cloudflare Workers/Queues/Cron/Hyperdrive, Neon, React + Vite + TanStack Query + shadcn/ui, imapflow, Biome.

**Skills to use:** `ponytail` (always on), `tdd`, `drizzle-orm-expert`, `postgres-best-practices`, `hono`, `cloudflare-workers-expert`, `bun-development`, `better-auth-best-practices`, `better-auth-security-best-practices`, `google-apps-script`, `shadcn`, `tanstack-query-expert`, `react-best-practices`. Look up the latest docs via context7 before using a library's API. Run `ponytail-review` at the end of each phase.

**Level of detail:** P1 has full code, since it is the phase being done now. P2 through P4 are described at task level only (files, tests, done criteria). Detailed plans for those phases will be written when each phase starts, because they must build on P1's real code (`ponytail`: don't write code for things that have no foundation yet).

---

## Starting a new session

The environment has already been prepared (2026-09-24):

| Item | Status |
|---|---|
| Bun 1.3.14, Docker, tmux | ✅ Available |
| Postgres 17 for dev | ✅ Container `paymailhook-postgres` on `localhost:5435` (user/pass `postgres`, db `paymailhook`, volume `paymailhook-pgdata`, auto-restart). Ports 5432 and 5434 are used by other projects |
| Node | ⚠️ v20, while wrangler needs ≥22. **Run wrangler with Bun** (`bun node_modules/wrangler/bin/wrangler.js …`): `deploy --dry-run` is verified to work. `wrangler dev` does **not** work because glibc 2.31 cannot run `workerd` (see research §3) |
| Real sample emails | ✅ `mail-template/{cake,timo}/*.eml` and `mail-template/pii.json`, both gitignored |
| Reference repos | ✅ `repo-ref/` (gitignored), see research §4 |
| `.env` | ❌ **Not created yet.** Per CLAUDE.md, the agent must not create or edit `.env*`. The user runs `cp .env.example .env` and fills in `ENCRYPTION_KEY=$(openssl rand -base64 32)` |

Kickoff prompt for the agent: *"Read CLAUDE.md, README.md, docs/design.md and this plan, then do Task 1.0."*

---

## Conventions

- **Check before every commit:** `bun run check`, i.e. Biome, `tsc --noEmit` and `bun test` must all pass.
- **Commits:** Conventional Commits, one commit per task. End the message with a `Co-Authored-By` line.
- **Never edit by hand:** `bun.lock` (changes only via `bun add`), `.env*`, `migrations/*` (generated only via `bun run db:generate`).
- **Error handling:** no bare `catch {}`; always catch the specific error type.
- **Size:** each function under 50 lines, each file under 300 lines.
- **Long-running:** long-running commands (dev server) run in tmux, session named `PayMailHook`.

---

# P1: Core pipeline

When P1 is done: a real CAKE or Timo email, sent by Apps Script to `POST /api/ingest`, creates a transaction. If it has an order code, a signed webhook is sent and retried on schedule. Runs on both Bun (local) and Workers (`wrangler deploy --dry-run` passes).

### Task 1.0: Scaffold

**Files:** Create `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `drizzle.config.ts`, `.env.example`.

**Step 1:** Create the project and install dependencies:

```bash
bun init -y
bun add hono drizzle-orm postgres postal-mime mailauth better-auth
bun add -d @biomejs/biome typescript @types/bun drizzle-kit @electric-sql/pglite wrangler @cloudflare/workers-types standardwebhooks
```

**Step 2:** Edit `package.json`:

```json
{
  "name": "paymailhook",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/server.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "check": "biome check . && tsc --noEmit && bun test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "build:worker": "bun node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir dist"
  }
}
```

**Step 3:** Create `tsconfig.json` (strict, `"types": ["bun", "@cloudflare/workers-types"]`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"noEmit": true`) and `biome.json` (`biome init`, ignore `repo-ref`, `migrations`, `dist`). Create `drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/core/db/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
```

**Step 4:** `.env.example`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5435/paymailhook
ENCRYPTION_KEY=            # openssl rand -base64 32
APP_HOST=localhost
ALLOW_PRIVATE_WEBHOOKS=true
```

**Step 5:** Run `bun run lint && bun run typecheck`. Expect pass.

**Step 6:** Commit `chore: scaffold bun project with biome, drizzle and wrangler`.

### Task 1.1: DB schema and PGlite test helper

**Files:**
- Create `src/core/auth.ts`, `src/core/db/auth-schema.ts` (generated), `src/core/db/schema.ts`, `src/core/db/client.ts`
- Create `test/db.ts`, `test/schema.test.ts`
- Generate `migrations/`

**Step 1:** Create a minimal `src/core/auth.ts` so the CLI can generate the auth tables. The full configuration is left for P2.

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { apiKey } from 'better-auth/plugins/api-key';
import type { Database } from './db/client';

export function createAuth(db: Database) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    emailAndPassword: { enabled: true },
    plugins: [admin(), apiKey()],
  });
}

// Only for `auth generate`; runtime code calls createAuth().
export const auth = createAuth({} as Database);
```

Run `bunx auth@latest generate --config src/core/auth.ts --output src/core/db/auth-schema.ts -y`. Double-check the plugin import paths against the installed version (skill `better-auth-best-practices`).

**Step 2:** Create `src/core/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  bigint, customType, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
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
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    gmail: text('gmail').notNull(),
    source: ingestSource('source').notNull().default('apps_script'),
    ingestTokenHash: text('ingest_token_hash').notNull().unique(),
    imapPasswordEnc: text('imap_password_enc'),
    lastIngestAt: tz('last_ingest_at'),
    ingestError: text('ingest_error'),
    orderPrefix: text('order_prefix').notNull().default('PMH'),
    webhookUrl: text('webhook_url'),
    webhookSecretEnc: text('webhook_secret_enc'),
    createdAt: createdAt(),
    updatedAt: tz('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  },
  // A Gmail is claimed only once it has delivered a valid email (design §4.4).
  (t) => [uniqueIndex('email_configs_gmail_claimed_uq').on(t.gmail).where(sql`${t.lastIngestAt} is not null`)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    emailConfigId: uuid('email_config_id').notNull().references(() => emailConfigs.id, { onDelete: 'cascade' }),
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
    occurredAt: tz('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('transactions_user_occurred_idx').on(t.userId, t.occurredAt.desc())],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id').notNull().unique().references(() => transactions.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),
    status: deliveryStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at'),
    lastStatusCode: integer('last_status_code'),
    createdAt: createdAt(),
    updatedAt: tz('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
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
    deliveryId: uuid('delivery_id').notNull().references(() => webhookDeliveries.id, { onDelete: 'cascade' }),
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
  emailConfigId: uuid('email_config_id').notNull().references(() => emailConfigs.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  reason: text('reason').notNull(),
  rawEnc: bytea('raw_enc').notNull(),
  createdAt: createdAt(),
});

export type EmailConfig = typeof emailConfigs.$inferSelect;
```

**Step 3:** Create `src/core/db/client.ts`:

```ts
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/** Driver-agnostic handle: postgres.js in prod, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  const client = postgres(url, { max: 5, fetch_types: false });
  return { db: drizzle(client, { schema }) as unknown as Database, close: () => client.end() };
}
```

**Step 4:** Generate the migration with `bun run db:generate`. Expect `migrations/0000_*.sql` to be created.

**Step 5:** Create `test/db.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from '../src/core/db/client';
import * as schema from '../src/core/db/schema';

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'migrations' });
  return { db: db as unknown as Database, close: () => client.close() };
}

export async function seedConfig(db: Database, overrides: Partial<schema.EmailConfig> = {}) {
  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, name: 'Test', email: `${userId}@test.local`, emailVerified: false });
  const [config] = await db
    .insert(schema.emailConfigs)
    .values({ userId, gmail: 'owner@gmail.com', ingestTokenHash: crypto.randomUUID(), ...overrides })
    .returning();
  return config;
}
```

**Step 6:** Write `test/schema.test.ts` for the partial unique index:

```ts
import { expect, test } from 'bun:test';
import { createTestDb, seedConfig } from './db';

test('same gmail may exist twice until one of them is claimed', async () => {
  const { db, close } = await createTestDb();
  await seedConfig(db, { lastIngestAt: new Date() });
  await seedConfig(db); // unclaimed duplicate is allowed
  expect(seedConfig(db, { lastIngestAt: new Date() })).rejects.toThrow();
  await close();
});
```

**Step 7:** Run `bun test test/schema.test.ts`. Expect PASS. If it FAILs because `migrations/` is missing, go back to Step 4.

**Step 8:** Commit `feat(db): add domain schema and pglite test helper`.

### Task 1.2: Crypto helper

**Files:** Create `src/core/crypto.ts`, test `test/crypto.test.ts`.

**Step 1: Test first**

```ts
import { expect, test } from 'bun:test';
import { decrypt, decryptText, encrypt, encryptText, sha256Hex } from '../src/core/crypto';

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

test('sha256Hex matches known vector', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('AES-GCM round-trips bytes and text, with a fresh IV each time', async () => {
  const data = new TextEncoder().encode('raw mime');
  expect(await decrypt(key, await encrypt(key, data))).toEqual(data);
  expect(await decryptText(key, await encryptText(key, 'whsec_x'))).toBe('whsec_x');
  expect(await encryptText(key, 'same')).not.toBe(await encryptText(key, 'same'));
});
```

**Step 2:** Run `bun test test/crypto.test.ts`. Expect FAIL because the module does not exist.

**Step 3: Code**

```ts
const utf8 = new TextEncoder();

export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toBase64Url = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomToken = (bytes = 24) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(s: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(s)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const aesKey = (keyB64: string) =>
  crypto.subtle.importKey('raw', fromBase64(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Output layout: 12-byte IV || ciphertext+tag. */
export async function encrypt(keyB64: string, data: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decrypt(keyB64: string, blob: Uint8Array) {
  const params = { name: 'AES-GCM', iv: blob.slice(0, 12) };
  return new Uint8Array(await crypto.subtle.decrypt(params, await aesKey(keyB64), blob.slice(12)));
}

export const encryptText = async (keyB64: string, s: string) => toBase64(await encrypt(keyB64, utf8.encode(s)));
export const decryptText = async (keyB64: string, s: string) =>
  new TextDecoder().decode(await decrypt(keyB64, fromBase64(s)));
```

**Step 4:** Run `bun test test/crypto.test.ts`. Expect PASS.

**Step 5:** Commit `feat(core): add hashing and AES-GCM helpers`.

### Task 1.3: Anonymized fixtures

**Files:** Create `scripts/anonymize-fixtures.ts`. Generates `test/fixtures/{cake,timo}/*.html`.

**Step 1:** ✅ `mail-template/pii.json` already exists (17 entries: names, account numbers, Gmail, reference codes, balances; `PAYHOOK433417283` is replaced with `PMH123456`, so the CAKE incoming fixture already contains an order code for tests). Names and account numbers appear verbatim in the HTML (not entity-encoded), so `replaceAll` is enough.

**Step 2: Code**

```ts
// Usage: bun scripts/anonymize-fixtures.ts
// Decodes each raw .eml in mail-template/, replaces PII from mail-template/pii.json,
// strips URLs, and writes the HTML body to test/fixtures/<bank>/<name>.html.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import PostalMime from 'postal-mime';

const pii: Record<string, string> = JSON.parse(await readFile('mail-template/pii.json', 'utf8'));

for (const bank of ['cake', 'timo']) {
  await mkdir(`test/fixtures/${bank}`, { recursive: true });
  const files = (await readdir(`mail-template/${bank}`)).filter((f) => f.endsWith('.eml'));
  for (const [i, file] of files.entries()) {
    const email = await PostalMime.parse(await readFile(`mail-template/${bank}/${file}`));
    let html = (email.html ?? '').replace(/https?:\/\/[^\s"'<>]+/g, 'https://example.invalid');
    for (const [real, fake] of Object.entries(pii)) html = html.replaceAll(real, fake);
    await writeFile(`test/fixtures/${bank}/${i + 1}.html`, html);
  }
}
```

**Step 3:** Run `bun scripts/anonymize-fixtures.ts`, then check no PII remains with `rg -f <(jq -r 'keys[]' mail-template/pii.json) test/fixtures`. Expect no matching lines.

**Step 4:** Open each HTML file and inspect it by eye (beyond the PII list there may be balances, transaction codes…). Commit `test: add anonymized CAKE and Timo fixtures`.

### Task 1.4: Text extraction and CAKE/Timo parsers (TDD)

**Files:** Create `src/core/text.ts`, `src/core/banks.ts`, test `test/banks.test.ts`.

**Step 1: Test first.** Expected values come from the anonymized fixtures. Open the HTML files, read them and fill them in.

```ts
import { expect, test } from 'bun:test';
import { bankForSender, extractOrderId, parseCake, parseTimo } from '../src/core/banks';
import { htmlToLines, normalizeEmail } from '../src/core/text';

const lines = async (p: string) => htmlToLines(await Bun.file(`test/fixtures/${p}`).text());

test('parses CAKE incoming transfer', async () => {
  const txn = parseCake(await lines('cake/2.html')); // pick the "+" sample
  expect(txn).toMatchObject({ direction: 'in', amount: 149000, bankTxnId: expect.any(String) });
  expect(txn.occurredAt.toISOString()).toBe('2026-09-20T11:28:07.000Z'); // 18:28:07 +07:00
  expect(txn.counterparty?.bank).toBe('TIMO');
});

test('parses CAKE outgoing transfer', async () => {
  expect(parseCake(await lines('cake/1.html'))).toMatchObject({ direction: 'out', amount: 149001 });
});

test('parses Timo increase and decrease with balance', async () => {
  const txn = parseTimo(await lines('timo/2.html'));
  expect(txn).toMatchObject({ direction: 'in', amount: 2570000, balanceAfter: expect.any(Number) });
  expect(txn.description.endsWith('.')).toBe(false);
});

test('extracts order id without swallowing trailing text', () => {
  expect(extractOrderId('MBVCB.123.PMH456.DANG chuyen tien', 'PMH')).toBe('456');
  expect(extractOrderId('pmh789 thanh toan', 'PMH')).toBe('789');
  expect(extractOrderId('no code here', 'PMH')).toBeNull();
});

test('maps sender to bank, ignores unknown', () => {
  expect(bankForSender('No-Reply@cake.vn')?.code).toBe('CAKE');
  expect(bankForSender('someone@evil.test')).toBeUndefined();
});

test('normalizes gmail aliases', () => {
  expect(normalizeEmail('D.Qst+bank@GoogleMail.com')).toBe('dqst@gmail.com');
  expect(normalizeEmail('a.b@company.vn')).toBe('a.b@company.vn');
});
```

**Step 2:** Run `bun test test/banks.test.ts`. Expect FAIL.

**Step 3: Code `src/core/text.ts`**

```ts
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(match: string, body: string) {
  if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? match;
  const hex = body[1]?.toLowerCase() === 'x';
  return String.fromCodePoint(Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
}

/** Visible text of an HTML email, one trimmed non-empty line per text node. */
export function htmlToLines(html: string): string[] {
  return html
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, decodeEntity)
    .normalize('NFC')
    .split('\n')
    .map((l) => l.replace(/[\s‌]+/g, ' ').trim())
    .filter(Boolean);
}

export const parseVnd = (s: string) => Number(s.replace(/\D/g, ''));

export const vnTime = (d: string, m: string, y: string, hh: string, mm: string, ss = '00') =>
  new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}+07:00`);

/** Gmail ignores dots and +tags in the local part; other domains compare as-is. */
export function normalizeEmail(address: string) {
  const [local = '', domain = ''] = address.trim().toLowerCase().split('@');
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return `${local}@${domain}`;
  return `${(local.split('+')[0] ?? '').replaceAll('.', '')}@gmail.com`;
}
```

**Step 4: Code `src/core/banks.ts`**

```ts
import { parseVnd, vnTime } from './text';

export type ParsedTxn = {
  direction: 'in' | 'out';
  amount: number;
  description: string;
  occurredAt: Date;
  bankTxnId?: string;
  balanceAfter?: number;
  counterparty?: { name?: string; account?: string; bank?: string };
};

export class ParseError extends Error {}

const valueAfter = (lines: string[], label: string) => {
  const i = lines.indexOf(label);
  return i >= 0 ? lines[i + 1] : undefined;
};

export function parseCake(lines: string[]): ParsedTxn {
  const amount = valueAfter(lines, 'Số tiền');
  const time = valueAfter(lines, 'Ngày giờ giao dịch')?.match(/^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})$/);
  if (!amount || !time) throw new ParseError('cake: amount or time not found');
  const direction = amount.startsWith('-') ? 'out' : 'in';
  const other = direction === 'in' ? 'chuyển' : 'nhận'; // the counterparty side
  return {
    direction,
    amount: parseVnd(amount),
    description: valueAfter(lines, 'Nội dung giao dịch') ?? '',
    occurredAt: vnTime(time[1], time[2], time[3], time[4], time[5], time[6]),
    bankTxnId: valueAfter(lines, 'Mã giao dịch'),
    counterparty: {
      account: valueAfter(lines, `Tài khoản ${other}`),
      name: valueAfter(lines, `Tên người ${other}`),
      bank: valueAfter(lines, `Ngân hàng ${other}`),
    },
  };
}

export function parseTimo(lines: string[]): ParsedTxn {
  const text = lines.join(' ');
  const m = text.match(/vừa (tăng|giảm) ([\d.]+) VND vào (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!m) throw new ParseError('timo: amount or time not found');
  const balance = text.match(/Số dư hiện tại: ([\d.]+) VND/);
  const description = lines.find((l) => l.startsWith('Mô tả:'))?.slice('Mô tả:'.length).trim() ?? '';
  return {
    direction: m[1] === 'tăng' ? 'in' : 'out',
    amount: parseVnd(m[2]),
    occurredAt: vnTime(m[3], m[4], m[5], m[6], m[7]),
    balanceAfter: balance ? parseVnd(balance[1]) : undefined,
    description: description.replace(/\.$/, ''),
  };
}

export type Bank = {
  code: 'CAKE' | 'TIMO';
  senders: string[];
  dkimDomain: string;
  parse: (lines: string[]) => ParsedTxn;
  /** Bank omits Date; Gmail adds one and breaks the signature (research §3). */
  gmailAddsDate?: boolean;
};

export const BANKS: Bank[] = [
  { code: 'CAKE', senders: ['no-reply@cake.vn'], dkimDomain: 'cake.vn', parse: parseCake },
  { code: 'TIMO', senders: ['support@timo.vn'], dkimDomain: 'timo.vn', parse: parseTimo, gmailAddsDate: true },
];

export const bankForSender = (address?: string) =>
  BANKS.find((b) => address && b.senders.includes(address.toLowerCase()));

export function extractOrderId(description: string, prefix: string) {
  const safePrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return description.toUpperCase().match(new RegExp(`${safePrefix}([A-Z0-9]+)`))?.[1] ?? null;
}
```

**Step 5:** Run `bun test test/banks.test.ts`. Expect PASS. If the CAKE labels don't match, print `lines` to inspect, then fix the code or the test to match the real data.

**Step 6:** Commit `feat(core): parse CAKE and Timo notification emails`.

### Task 1.5: DKIM verification (TDD with synthetic signed emails)

**Files:** Create `src/core/dkim.ts` (including the DoH resolver), `test/email.ts` (helper), test `test/dkim.test.ts`.

**Step 1:** Create helper `test/email.ts`:

```ts
import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign';
import type { ResolveTxt } from '../src/core/dkim';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Resolver that knows only `test._domainkey.<any domain>`. */
export const testResolver: ResolveTxt = async (name) => {
  if (!name.startsWith('test._domainkey.')) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return [[`v=DKIM1; k=rsa; p=${publicKey.toString('base64')}`]];
};

type EmailOptions = {
  from: string;
  to: string;
  html: string;
  domain: string;
  messageId?: string;
  withDate?: boolean;
  headerList?: string[];
  maxBodyLength?: number;
};

export async function signedEmail(o: EmailOptions) {
  const headers = [
    `From: <${o.from}>`,
    `To: ${o.to}`,
    'Subject: test',
    `Message-ID: ${o.messageId ?? `<${crypto.randomUUID()}@test>`}`,
    ...(o.withDate === false ? [] : [`Date: ${new Date().toUTCString()}`]),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = Buffer.from(o.html).toString('base64').replace(/.{76}/g, '$&\r\n');
  const message = `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
  const { signatures } = await dkimSign(message, {
    canonicalization: 'relaxed/relaxed',
    headerList: o.headerList,
    signatureData: [{ signingDomain: o.domain, selector: 'test', privateKey, maxBodyLength: o.maxBodyLength }],
  });
  return new Uint8Array(Buffer.from(signatures + message));
}

/** Simulates Gmail inserting a Date header after the bank signed. */
export const insertDate = (raw: Uint8Array) =>
  new Uint8Array(Buffer.from(`Date: Wed, 23 Sep 2026 20:42:19 -0700 (PDT)\r\n${Buffer.from(raw).toString('latin1')}`, 'latin1'));
```

The option name `maxBodyLength` (tag `l=`) must be double-checked in `repo-ref/mailauth/lib/dkim/sign.js`.

**Step 2: Test first** (`test/dkim.test.ts`):

```ts
import { expect, test } from 'bun:test';
import { BANKS } from '../src/core/banks';
import { verifyBankDkim } from '../src/core/dkim';
import { insertDate, signedEmail, testResolver } from './email';

const [CAKE, TIMO] = BANKS;
const base = { from: 'no-reply@cake.vn', to: 'owner@gmail.com', html: '<p>Số tiền</p>', domain: 'cake.vn' };
const verify = (raw: Uint8Array, bank = CAKE) => verifyBankDkim(raw, bank, testResolver);

test('passes a valid bank signature', async () => {
  expect(await verify(await signedEmail(base))).toBe(true);
});

test('rejects signature from another domain', async () => {
  expect(await verify(await signedEmail({ ...base, domain: 'evil.test' }))).toBe(false);
});

test('rejects when To is not covered by the signature', async () => {
  expect(await verify(await signedEmail({ ...base, headerList: ['from', 'subject', 'message-id'] }))).toBe(false);
});

test('rejects tampered body', async () => {
  const raw = Buffer.from(await signedEmail(base)).toString('latin1').replace(/\r\n\r\n(.)/, '\r\n\r\nX$1');
  expect(await verify(new Uint8Array(Buffer.from(raw, 'latin1')))).toBe(false);
});

test('rejects body-length-limited (l=) signatures', async () => {
  expect(await verify(await signedEmail({ ...base, maxBodyLength: 10 }))).toBe(false);
});

test('Timo: tolerates Gmail-inserted Date only for banks flagged gmailAddsDate', async () => {
  const timo = await signedEmail({ ...base, from: 'support@timo.vn', domain: 'timo.vn', withDate: false });
  expect(await verify(insertDate(timo), TIMO)).toBe(true);
  const cake = await signedEmail({ ...base, withDate: false });
  expect(await verify(insertDate(cake), CAKE)).toBe(false);
});

test.skipIf(!(await Bun.file('mail-template/pii.json').exists()))('real samples verify with live DNS', async () => {
  const { dohResolveTxt } = await import('../src/core/dkim');
  for (const bank of BANKS) {
    const dir = `mail-template/${bank.code.toLowerCase()}`;
    for await (const f of new Bun.Glob('*.eml').scan(dir)) {
      const raw = new Uint8Array(await Bun.file(`${dir}/${f}`).arrayBuffer());
      expect(await verifyBankDkim(raw, bank, dohResolveTxt)).toBe(true);
    }
  }
});
```

**Step 3:** Run `bun test test/dkim.test.ts`. Expect FAIL.

**Step 4: Code `dohResolveTxt`** (placed at the end of `src/core/dkim.ts`)

```ts
/** DNS-over-HTTPS TXT lookup; works on Workers and Bun alike (Bun's node:dns TXT shape broke mailauth, research §3). */
export const dohResolveTxt: ResolveTxt = async (name) => {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: 'application/dns-json' },
  });
  if (!res.ok) throw new Error(`doh ${res.status}`);
  const { Answer = [] } = (await res.json()) as { Answer?: { type: number; data: string }[] };
  const txt = Answer.filter((a) => a.type === 16);
  if (!txt.length) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return txt.map((a) => [a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '')]);
};
```

**Step 5: Code `src/core/dkim.ts`**

```ts
import { dkimVerify } from 'mailauth/lib/dkim/verify';
import type { Bank } from './banks';

export type ResolveTxt = (name: string, rrtype: string) => Promise<string[][]>;

const REQUIRED_SIGNED = ['from', 'to'];

async function hasTrustedSignature(raw: Uint8Array, bank: Bank, resolver: ResolveTxt) {
  const { results } = await dkimVerify(Buffer.from(raw), { resolver });
  return results.some((r) => {
    const signed = String(r.signingHeaders?.keys ?? '').toLowerCase().split(':').map((h) => h.trim());
    return (
      r.status?.result === 'pass' &&
      r.signingDomain === bank.dkimDomain &&
      REQUIRED_SIGNED.every((h) => signed.includes(h)) &&
      !r.canonBodyLengthLimited
    );
  });
}

/** Drops every Date header (incl. folded lines) from the header block. */
function stripDateHeader(raw: Uint8Array) {
  const s = Buffer.from(raw).toString('latin1');
  const split = s.indexOf('\r\n\r\n');
  const head = s.slice(0, split + 2).replace(/^Date:.*\r\n(?:[ \t].*\r\n)*/gim, '');
  return new Uint8Array(Buffer.from(head + s.slice(split + 2), 'latin1'));
}

export async function verifyBankDkim(raw: Uint8Array, bank: Bank, resolver: ResolveTxt) {
  if (await hasTrustedSignature(raw, bank, resolver)) return true;
  return bank.gmailAddsDate === true && hasTrustedSignature(stripDateHeader(raw), bank, resolver);
}
```

**Step 6:** Run `bun test test/dkim.test.ts`. Expect PASS, and the real-email test also PASSes on the dev machine. If `mailauth` types are missing fields, extend the types locally; don't cast to `any`.

**Step 7:** Commit `feat(core): verify bank DKIM with To coverage and Timo Date quirk`.

### Task 1.6: Webhook signing and URL validation

**Files:** Create `src/core/webhook.ts` (part 1), test `test/webhook.test.ts` (part 1).

**Step 1: Test first**

```ts
import { expect, test } from 'bun:test';
import { Webhook } from 'standardwebhooks';
import { newWebhookSecret, signWebhook, validateWebhookUrl } from '../src/core/webhook';

test('signature verifies with the standardwebhooks library', async () => {
  const secret = newWebhookSecret();
  const ts = Math.floor(Date.now() / 1000);
  const body = '{"type":"payment.received"}';
  const headers = { 'webhook-id': 'd1', 'webhook-timestamp': String(ts), 'webhook-signature': await signWebhook(secret, 'd1', ts, body) };
  expect(() => new Webhook(secret).verify(body, headers)).not.toThrow();
});

const strict = { allowPrivate: false, appHost: 'paymailhook.example.workers.dev' };
test.each([
  ['https://shop.example.com/hook', null],
  ['http://shop.example.com/hook', 'https_required'],
  ['https://user:pw@shop.example.com', 'credentials_not_allowed'],
  ['https://shop.example.com:8443', 'port_not_allowed'],
  ['https://127.0.0.1/x', 'ip_not_allowed'],
  ['https://0x7f000001/x', 'ip_not_allowed'],
  ['https://[::1]/x', 'ip_not_allowed'],
  ['https://localhost/x', 'host_not_allowed'],
  ['https://printer.local/x', 'host_not_allowed'],
  ['https://paymailhook.example.workers.dev/x', 'host_not_allowed'],
  ['not a url', 'invalid_url'],
])('validateWebhookUrl(%s) → %s', (url, expected) => {
  expect(validateWebhookUrl(url, strict)).toBe(expected);
});

test('self-host mode allows LAN http', () => {
  expect(validateWebhookUrl('http://192.168.1.10:8080/hook', { ...strict, allowPrivate: true })).toBeNull();
});
```

**Step 2:** Run the test. Expect FAIL.

**Step 3: Code** (first part of `src/core/webhook.ts`)

```ts
import { fromBase64, toBase64 } from './crypto';

export const newWebhookSecret = () => `whsec_${toBase64(crypto.getRandomValues(new Uint8Array(24)))}`;

/** Standard Webhooks: v1,base64(HMAC-SHA256(key, "{id}.{ts}.{body}")). */
export async function signWebhook(secret: string, id: string, timestamp: number, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', fromBase64(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${toBase64(new Uint8Array(mac))}`;
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
  const host = url.hostname.toLowerCase(); // WHATWG URL already normalizes 0x7f000001 → 127.0.0.1
  if (host.startsWith('[') || /^[\d.]+$/.test(host)) return 'ip_not_allowed';
  const blocked = host === 'localhost' || !host.includes('.') || host === policy.appHost;
  if (blocked || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return 'host_not_allowed';
  // ponytail: no DNS check for names resolving to private IPs; add a DoH A/AAAA check if abuse appears.
  return null;
}
```

**Step 4:** Run the test. Expect PASS.

**Step 5:** Commit `feat(core): sign webhooks per Standard Webhooks and validate URLs`.

### Task 1.7: `ingestRawEmail`

**Files:** Create `src/core/deps.ts`, `src/core/ingest.ts`, test `test/ingest.test.ts`.

**Step 1: `src/core/deps.ts`**

```ts
import type { Database } from './db/client';
import type { ResolveTxt } from './dkim';

export type Trigger = 'scheduled' | 'manual';

export type Deps = {
  db: Database;
  resolveTxt: ResolveTxt;
  encryptionKey: string;
  fetch: typeof fetch;
  allowPrivateWebhooks: boolean;
  appHost: string;
  scheduleDelivery: (id: string, delaySeconds: number, trigger?: Trigger) => Promise<void>;
};
```

**Step 2: Test first** (`test/ingest.test.ts`). Use `createTestDb`, `seedConfig` and `signedEmail`, with HTML from the CAKE incoming fixture after changing `Nội dung giao dịch` to `PMH123456`. Cases:
- `stored`: new row in `transactions`, `orderId = '123456'`, one `webhook_deliveries` row in `pending`, `scheduleDelivery` called with `(id, 0)`, `last_ingest_at` set.
- Same raw sent a second time: `duplicate`, no extra delivery created.
- `To: other@gmail.com`: `rejected` with reason `to_mismatch`, one `inbound_failures` row, `ingest_error = 'to_mismatch'`.
- `To: O.w.n.e.r+x@googlemail.com`: `stored` (Gmail normalization).
- Signature `d=evil.test`: `rejected` with reason `dkim_failed`.
- `from: news@shop.test`: `ignored`, nothing stored.
- Config without `webhook_url`: `stored`, no delivery created.
- Outgoing money (`direction = out`) containing a code: no delivery created.

```ts
const makeDeps = (db: Database) => {
  const scheduled: [string, number][] = [];
  const deps: Deps = {
    db, resolveTxt: testResolver, encryptionKey: TEST_KEY, fetch, allowPrivateWebhooks: false, appHost: 'app.test',
    scheduleDelivery: async (id, delay) => { scheduled.push([id, delay]); },
  };
  return { deps, scheduled };
};
```

**Step 3:** Run the test. Expect FAIL.

**Step 4: Code `src/core/ingest.ts`**

```ts
import { eq } from 'drizzle-orm';
import PostalMime from 'postal-mime';
import { bankForSender, extractOrderId, ParseError, type ParsedTxn } from './banks';
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

async function reject(deps: Deps, config: EmailConfig, raw: Uint8Array, reason: RejectReason, messageId?: string) {
  const rawEnc = await encrypt(deps.encryptionKey, raw);
  await deps.db.insert(inboundFailures).values({ emailConfigId: config.id, messageId, reason, rawEnc });
  await deps.db.update(emailConfigs).set({ ingestError: reason }).where(eq(emailConfigs.id, config.id));
  return { status: 'rejected', reason } as const;
}

function parseBody(parse: (lines: string[]) => ParsedTxn, html: string) {
  try {
    return parse(htmlToLines(html));
  } catch (e) {
    if (e instanceof ParseError) return null;
    throw e;
  }
}

export async function ingestRawEmail(deps: Deps, config: EmailConfig, raw: Uint8Array): Promise<IngestResult> {
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
  const result = await store(deps, config, bank.code, messageId, txn);
  if (result.status === 'stored' && result.deliveryId) await deps.scheduleDelivery(result.deliveryId, 0);
  return result;
}
```

The `store()` function lives in the same file, under 50 lines:
1. Open `deps.db.transaction`.
2. Run `UPDATE email_configs SET last_ingest_at = now(), ingest_error = null`. This may hit the partial unique index: catch Postgres error code `23505` and return `rejected: to_mismatch`, because this Gmail has already been claimed by another config.
3. `INSERT transactions ... onConflictDoNothing({ target: transactions.messageId }).returning({ id })`. If no row is returned, return `duplicate`.
4. Compute `orderId = txn.direction === 'in' ? extractOrderId(...) : null`.
5. If there is an `orderId` and `config.webhookUrl`, `INSERT webhook_deliveries { payload: buildPayload(...), nextAttemptAt: new Date() }`.

`buildPayload` lives in `webhook.ts` and returns exactly the shape in design §3.1.

**Step 5:** Run `bun test test/ingest.test.ts`. Expect all PASS.

**Step 6:** Commit `feat(core): ingest raw bank emails into transactions`.

### Task 1.8: `deliver()` and periodic maintenance

**Files:** Add to `src/core/webhook.ts` (part 2). Create `src/core/maintenance.ts`. Add tests to `test/webhook.test.ts`, create `test/maintenance.test.ts`.

**Step 1: Test first.** Seed a delivery via the ingest helper; a fake `fetch` returns statuses per scenario:
- 200: `success`, one attempt, `webhook-id` equals the delivery id, signature verifies with `standardwebhooks`.
- 500: `retrying`, `attempt_count = 1`, `next_attempt_at` about 10 seconds from now, `scheduleDelivery` called with `(id, 10)`.
- Fail 10 times in a row (resetting `next_attempt_at = now()` before each call): the 10th becomes `failed`.
- 301 response: counts as a failure.
- `fetch` throws `TimeoutError`: attempt has `error = 'timeout'`.
- **Claim:** `await Promise.all([deliver(d, id), deliver(d, id)])` with the fake fetch called only **once**.
- Manual retry that still fails: status unchanged (`failed` stays `failed`, `success` stays `success`), `scheduleDelivery` not called.
- `webhook_url` changed to `https://127.0.0.1`: attempt has `error = 'ip_not_allowed'`, fetch not called.

**Step 2:** Run the test. Expect FAIL.

**Step 3: Code** (part 2 of `webhook.ts`)

```ts
export const RETRY_SCHEDULE = [10, 10, 20, 30, 50, 3600, 7200, 14400, 28800];
const LEASE = sql`now() + interval '60 seconds'`;

async function claim(deps: Deps, id: string, trigger: Trigger) {
  const due = trigger === 'manual'
    ? inArray(webhookDeliveries.status, ['success', 'failed'])
    : and(inArray(webhookDeliveries.status, ['pending', 'retrying']),
          lte(webhookDeliveries.nextAttemptAt, sql`now() + interval '5 seconds'`));
  const [row] = await deps.db.update(webhookDeliveries).set({ nextAttemptAt: LEASE })
    .where(and(eq(webhookDeliveries.id, id), due)).returning();
  return row;
}

async function send(deps: Deps, delivery: Delivery, url: string, secretEnc: string) {
  const body = JSON.stringify(delivery.payload);
  const ts = Math.floor(Date.now() / 1000);
  const signature = await signWebhook(await decryptText(deps.encryptionKey, secretEnc), delivery.id, ts, body);
  try {
    const res = await deps.fetch(url, {
      method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'user-agent': 'PayMailHook/1.0',
                 'webhook-id': delivery.id, 'webhook-timestamp': String(ts), 'webhook-signature': signature },
    });
    return { statusCode: res.status, responseBody: (await res.text()).slice(0, 1024), error: null };
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return { statusCode: null, responseBody: null, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

export async function deliver(deps: Deps, id: string, trigger: Trigger = 'scheduled') {
  const delivery = await claim(deps, id, trigger);
  if (!delivery) return;
  const target = await loadTarget(deps, delivery.transactionId); // { url, secretEnc } via transactions → email_configs
  const blocked = !target?.url || !target.secretEnc ? 'webhook_not_configured'
    : validateWebhookUrl(target.url, { allowPrivate: deps.allowPrivateWebhooks, appHost: deps.appHost });
  const started = Date.now();
  const outcome = blocked
    ? { statusCode: null, responseBody: null, error: blocked }
    : await send(deps, delivery, target.url, target.secretEnc);
  await recordAttempt(deps, delivery, trigger, target?.url ?? '', outcome, Date.now() - started);
  await transition(deps, delivery, trigger, outcome.statusCode);
}
```

`transition()`:
- 2xx: `success`, `nextAttemptAt: null`.
- Failure on `manual`: **keep status unchanged** (design §3.2), `nextAttemptAt: null`.
- Failure with schedule remaining: `delay = RETRY_SCHEDULE[delivery.attemptCount]` → `retrying`, `nextAttemptAt: now + delay`, then call `deps.scheduleDelivery(id, delay)`.
- Failure with schedule exhausted: `failed`.

Always apply `attemptCount + 1` and update `lastStatusCode`. `recordAttempt` inserts into `webhook_attempts` with `attemptNumber = delivery.attemptCount + 1`.

**Step 4: Code `src/core/maintenance.ts`**

```ts
/** Hourly: re-enqueue stuck deliveries and prune old rows in bounded batches (design §3.5). */
export async function runMaintenance(deps: Deps) {
  const stuck = await deps.db.select({ id: webhookDeliveries.id }).from(webhookDeliveries)
    .where(and(inArray(webhookDeliveries.status, ['pending', 'retrying']),
               lt(webhookDeliveries.nextAttemptAt, sql`now() - interval '2 minutes'`)))
    .limit(100);
  for (const { id } of stuck) await deps.scheduleDelivery(id, 0);
  await deps.db.execute(sql`delete from webhook_deliveries where id in (select id from webhook_deliveries
    where status in ('success','failed') and created_at < now() - interval '30 days' limit 1000)`);
  await deps.db.execute(sql`delete from inbound_failures where id in (select id from inbound_failures
    where created_at < now() - interval '7 days' limit 1000)`);
  await deps.db.execute(sql`delete from email_configs where id in (select id from email_configs
    where last_ingest_at is null and created_at < now() - interval '7 days' limit 1000)`);
}

```

Tests: a stuck delivery is rescheduled; old rows are deleted; a config that never received an email for over 7 days is deleted. Use `UPDATE ... SET created_at = now() - interval '31 days'` to create old data.

**Step 5:** Run `bun test`. Expect all PASS.

**Step 6:** Commit `feat(core): deliver webhooks with lease claim, retry schedule and maintenance`.

### Task 1.9: Hono app and `POST /api/ingest`

**Files:** Create `src/api/app.ts`, test `test/api.test.ts`.

**Step 1: Test first**
- Missing or wrong token: 401.
- Correct token and valid raw: `200 {ok:true,status:'stored'}`.
- `db` throws: 500 with `{error:{code:'internal'}}` (Apps Script keeps its cursor).

Call it with `app.request('/api/ingest', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'message/rfc822' }, body: raw })`.

**Step 2: Code**

```ts
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { sha256Hex } from '../core/crypto';
import { emailConfigs } from '../core/db/schema';
import type { Deps } from '../core/deps';
import { ingestRawEmail } from '../core/ingest';

export type AppEnv = { Variables: { deps: Deps } };

export function createApp(makeDeps: (c: Context) => Deps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  app.use('*', async (c, next) => {
    c.set('deps', makeDeps(c));
    await next();
  });

  app.post('/api/ingest', async (c) => {
    const { deps } = c.var;
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    const [config] = token
      ? await deps.db.select().from(emailConfigs).where(eq(emailConfigs.ingestTokenHash, await sha256Hex(token)))
      : [];
    if (!config) return c.json({ error: { code: 'unauthorized' } }, 401);
    const result = await ingestRawEmail(deps, config, new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ ok: true, ...result });
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
```

**Step 3:** Run `bun test test/api.test.ts`. Expect PASS.

**Step 4:** Commit `feat(api): add hono app with ingest endpoint`.

### Task 1.10: Bun entry (Self-host/dev) and config creation script

**Files:** Create `src/server.ts`, `scripts/create-config.ts`.

**Step 1: `src/server.ts`**

```ts
import { inArray } from 'drizzle-orm';
import { createApp } from './api/app';
import { createDb } from './core/db/client';
import { webhookDeliveries } from './core/db/schema';
import type { Deps } from './core/deps';
import { dohResolveTxt } from './core/dkim';
import { runMaintenance } from './core/maintenance';
import { deliver } from './core/webhook';

const env = process.env;
const required = (name: string) => env[name] ?? (() => { throw new Error(`${name} is required`); })();

const { db } = createDb(required('DATABASE_URL'));
const deps: Deps = {
  db,
  resolveTxt: dohResolveTxt,
  encryptionKey: required('ENCRYPTION_KEY'),
  fetch,
  allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS !== 'false',
  appHost: env.APP_HOST ?? 'localhost',
  // ponytail: in-process timers; state lives in the DB and the startup scan below re-arms them.
  scheduleDelivery: async (id, delaySeconds, trigger) => {
    setTimeout(() => deliver(deps, id, trigger).catch(console.error), delaySeconds * 1000);
  },
};

// Self-host startup: re-arm timers for every open delivery.
const open = await db.select({ id: webhookDeliveries.id, at: webhookDeliveries.nextAttemptAt })
  .from(webhookDeliveries).where(inArray(webhookDeliveries.status, ['pending', 'retrying']));
for (const d of open) await deps.scheduleDelivery(d.id, Math.max(0, ((d.at?.getTime() ?? 0) - Date.now()) / 1000));
setInterval(() => runMaintenance(deps).catch(console.error), 60 * 60 * 1000);

export default { port: Number(env.PORT ?? 3000), fetch: createApp(() => deps).fetch };
```

**Step 2:** Create `src/core/apps-script.ts` with `renderAppsScript(url, token)`: read `apps-script/Code.gs` (imported as text) and replace the two placeholders. P2 reuses this function. Then write `scripts/create-config.ts <gmail> <webhookUrl>`:
1. Create a dev user.
2. Create a config with `ingestTokenHash = sha256Hex(token)` and `webhookSecretEnc = encryptText(newWebhookSecret())`.
3. Print the token, the secret and the contents of `apps-script/Code.gs` with placeholders replaced.

The purpose is to test P1 by hand before the dashboard exists.

**Step 3: Manual check**
1. Postgres is already running in the `paymailhook-postgres` container (`docker start paymailhook-postgres` if it is stopped).
2. Run `bun run db:migrate`.
3. Run `bun run dev` in tmux.
4. Send a test: `curl -X POST localhost:3000/api/ingest -H "authorization: Bearer <token>" --data-binary @mail-template/cake/<file>.eml`.

Expect `status: 'stored'`. If the Gmail in the config differs from the sample email's `To`, expect `to_mismatch`.

**Step 4:** Commit `feat: add bun server entry and dev config script`.

### Task 1.11: Workers entry

**Files:** Create `src/worker.ts`, `wrangler.jsonc`.

**Step 1: `wrangler.jsonc`**

```jsonc
{
  "name": "paymailhook",
  "main": "src/worker.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive-id>" }],
  "queues": {
    "producers": [{ "binding": "QUEUE", "queue": "paymailhook-deliveries" }],
    "consumers": [{ "queue": "paymailhook-deliveries", "max_batch_size": 10, "max_retries": 10 }]
  },
  "triggers": { "crons": ["0 * * * *"] },
  "vars": { "APP_HOST": "paymailhook.<account>.workers.dev", "ALLOW_PRIVATE_WEBHOOKS": "false" },
  "secrets": { "required": ["ENCRYPTION_KEY"] }
}
```

**Step 2: `src/worker.ts`**

```ts
import { createApp } from './api/app';
import { createDb } from './core/db/client';
import type { Deps, Trigger } from './core/deps';
import { dohResolveTxt } from './core/dkim';
import { runMaintenance } from './core/maintenance';
import { deliver } from './core/webhook';

type Env = {
  HYPERDRIVE: Hyperdrive;
  QUEUE: Queue<{ id: string; trigger: Trigger }>;
  ENCRYPTION_KEY: string;
  APP_HOST: string;
  ALLOW_PRIVATE_WEBHOOKS?: string;
};

function makeDeps(env: Env) {
  const { db, close } = createDb(env.HYPERDRIVE.connectionString);
  const deps: Deps = {
    db, resolveTxt: dohResolveTxt, encryptionKey: env.ENCRYPTION_KEY, fetch: fetch.bind(globalThis),
    allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS === 'true', appHost: env.APP_HOST,
    scheduleDelivery: async (id, delaySeconds, trigger = 'scheduled') => {
      await env.QUEUE.send({ id, trigger }, { delaySeconds: Math.ceil(delaySeconds) });
    },
  };
  return { deps, close };
}

/** One DB connection per invocation, closed only after the handler has finished. */
async function withDeps<T>(env: Env, ctx: ExecutionContext, run: (deps: Deps) => Promise<T>) {
  const { deps, close } = makeDeps(env);
  try {
    return await run(deps);
  } finally {
    ctx.waitUntil(close());
  }
}

export default {
  fetch: (req, env, ctx) => withDeps(env, ctx, (deps) => createApp(() => deps).fetch(req, env, ctx)),
  queue: (batch, env, ctx) =>
    withDeps(env, ctx, async (deps) => {
      for (const msg of batch.messages) {
        try {
          await deliver(deps, msg.body.id, msg.body.trigger);
          msg.ack();
        } catch (e) {
          console.error(e); // infrastructure failure: let Queues redeliver
          msg.retry({ delaySeconds: 60 });
        }
      }
    }),
  scheduled: (_event, env, ctx) => withDeps(env, ctx, runMaintenance),
} satisfies ExportedHandler<Env, { id: string; trigger: Trigger }>;
```

`createApp()` is called per request, since route registration is cheap. This connection-closing approach must be checked against the latest Hyperdrive + postgres.js docs (context7).

**Step 3:** Run `bun run build:worker`. Expect a successful build, no `node:sqlite` errors, and gzip size under 3MB.

**Step 4:** Commit `feat: add cloudflare worker entry with queue consumer and cron`.

### Task 1.12: Apps Script

**Files:** Create `apps-script/Code.gs`, test `test/apps-script.test.ts`.

**Step 1: Test first.** Load the script with `new Function('GmailApp', 'UrlFetchApp', 'PropertiesService', 'LockService', 'ScriptApp', code + '; return { poll, setup };')` using fake objects. Cases:
- All responses are 200 with `ok:true`: cursor equals the newest message's time.
- One response is 500: cursor unchanged.
- Two messages in the same thread: both are sent.
- 200 response but the body is not JSON: cursor unchanged.

**Step 2: Code** (skill `google-apps-script`)

```js
// PayMailHook ingest script. Paste into script.google.com, then run setup() once.
const INGEST_URL = '{{INGEST_URL}}';
const INGEST_TOKEN = '{{INGEST_TOKEN}}';
const SENDERS = ['no-reply@cake.vn', 'support@timo.vn'];
const OVERLAP_SECONDS = 300; // re-sending is safe: the server dedupes by Message-ID

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(1).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('cursor')) props.setProperty('cursor', String(Math.floor(Date.now() / 1000)));
}

function isAck(response) {
  if (response.getResponseCode() !== 200) return false;
  try {
    return JSON.parse(response.getContentText()).ok === true;
  } catch (e) {
    if (e instanceof SyntaxError) return false;
    throw e;
  }
}

function poll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const since = Number(props.getProperty('cursor')) - OVERLAP_SECONDS;
    const messages = GmailApp.search(`from:(${SENDERS.join(' OR ')}) after:${since}`, 0, 50)
      .flatMap((thread) => thread.getMessages()) // per message, not per thread
      .filter((m) => m.getDate().getTime() / 1000 > since);
    if (messages.length === 0) return;
    const responses = UrlFetchApp.fetchAll(messages.map((m) => ({
      url: INGEST_URL, method: 'post', contentType: 'message/rfc822', muteHttpExceptions: true,
      headers: { Authorization: `Bearer ${INGEST_TOKEN}` }, payload: m.getRawContent(),
    })));
    if (!responses.every(isAck)) return; // keep cursor; next run retries
    const newest = Math.max(...messages.map((m) => Math.floor(m.getDate().getTime() / 1000)));
    props.setProperty('cursor', String(Math.max(Number(props.getProperty('cursor')), newest)));
  } finally {
    lock.releaseLock();
  }
}
```

**Step 3:** Run `bun test test/apps-script.test.ts`. Expect PASS.

**Step 4:** Commit `feat: add gmail apps script ingest client`.

### Task 1.13: Real Gmail spike and CI

**Step 1: Manual spike**
1. Deploy the Worker to Cloudflare (create Neon, Hyperdrive and Queue per the README instructions).
2. Run `scripts/create-config.ts` pointed at the Neon DB.
3. Paste `Code.gs` into a real Gmail account and run `setup()`.
4. Transfer 1,000 VND with the description `PMH1`.

Expect: a transaction exists, the webhook reaches `https://webhook.site/...`, and the signature verifies. Record the results in research.md §3:
- Whether `getRawContent()` passes DKIM verification.
- CPU time measured in Workers Logs, compared with the 10ms limit.

If it exceeds 10ms CPU, move the verify and parse steps into the queue consumer (see the note in README).

**Step 2: CI**, create `.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run build:worker
```

**Step 3:** Push to GitHub and check CI is green. Commit `ci: run checks and worker bundle build`.

**Step 4:** Run `ponytail-review` over all of P1 and address the findings before moving to P2.

---

# P2: Accounts and configuration

The detailed plan is written when P2 starts. Tasks:

| Task | Files | Test / Done when |
|---|---|---|
| 2.1 Full better-auth configuration (design §4.4): optional Google, DB-backed rate limit, cookie cache, first user becomes admin, `ALLOW_SIGNUP`. Install `zod` and `@hono/zod-validator`, add `BETTER_AUTH_*` to env/secrets | `src/core/auth.ts` | First user has `role=admin`; sign-up is blocked when `ALLOW_SIGNUP=false` |
| 2.2 Middleware: mount `/api/auth/*`, `csrf()`, `requireUser` (cookie or API key) | `src/api/app.ts`, `src/api/auth.ts` | No session → 401; API key works like a session; cookie POST without Origin → 403 |
| 2.3 Email config CRUD: POST returns the token and `Code.gs` once (using `renderAppsScript` from P1); PATCH validates the URL; rotate token and secret; test webhook | `src/api/email-configs.ts` | Accessing another user's config returns 404; old token after rotation returns 401 |
| 2.4 Transaction and delivery API (keyset pagination), retry/resend | `src/api/transactions.ts`, `src/api/deliveries.ts` | Stable pagination; manual retry behaves as in §3.5 |
| 2.5 SPA: Vite + React Router + TanStack Query + shadcn, better-auth client, `hc<AppType>` | `web/*`, `vite.config.ts`, update `wrangler.jsonc` (assets + `run_worker_first: ["/api/*"]`) | `bun run build` then visiting `/` loads the SPA; F5 on `/transactions` still serves the SPA |
| 2.6 Pages: sign in/sign up, config list, Apps Script onboarding (copy script, `last_ingest_at` and `ingest_error` status), transactions, webhook log | `web/routes/*` | Manual test of the full flow from creating a config to receiving a webhook |

# P2.5: Self-host

| Task | Files | Test / Done when |
|---|---|---|
| 2.7 IMAP listener (design §2.6): open the special-use `\All` mailbox, scan with `gmraw`, IDLE with `maxIdleTime` 25 minutes, backoff on reconnect, stop on auth failure | `src/imap.ts`, edit `src/server.ts` | Test `scan()` with a fake client; manual test with real Gmail (unplug the network, it reconnects on its own) |
| 2.8 UI for the IMAP source: enter App Password (stored encrypted) | `web/routes/*`, `src/api/email-configs.ts` | Password is never returned by the API |
| 2.9 Dockerfile (bun build, non-root user) and `docker-compose.yml` (app + postgres + migrate on startup) | `Dockerfile`, `docker-compose.yml` | `docker compose up`, open `localhost:3000`, sign up and become admin |
| 2.10 README: deployment guide for Hosted (Neon, Hyperdrive, Queue, secrets) and Self-host | `README.md` | A newcomer can follow it end to end |

# P3: Complete dashboard

| Task | Files | Test / Done when |
|---|---|---|
| 3.1 Realtime transactions: poll with `refetchInterval` 5 seconds while the tab is visible, stop when hidden (so Neon can sleep) | `web/routes/transactions.tsx` | New transactions appear within ≤6 seconds |
| 3.2 `GET /api/qr`: VietQR (`vietnam-qr-pay`) rendered as SVG (`qrcode`), params `acc`, `bank`, `amount`, `des` | `src/api/qr.ts` | QR payload decodes back correctly; banking apps can scan it (manual test) |
| 3.3 QR generator page | `web/routes/qr.tsx` | |
| 3.4 Transaction sharing: settle the scope first (a single transaction or a list), then add `share_token` via migration | migration, `src/api/share.ts`, `web/routes/share.tsx` | Public link does not expose `webhook_url` or config details |
| 3.5 Guide page (payload, signature verification with `standardwebhooks` for Node/PHP/Python, §3.6) and Privacy page | `web/routes/guide.tsx`, `privacy.tsx` | |
| 3.6 Playwright E2E: sign up, create config, send a synthetic signed email to `/api/ingest`, see the transaction and a `success` delivery in the UI | `e2e/*` | CI runs E2E |

# P4: Extensions

| Task | Files | Test / Done when |
|---|---|---|
| 4.1 Web Push (VAPID, learn from `saasmail/worker/src/lib/web-push.ts`): `push_subscriptions` table, send a push on incoming money | migration, `src/core/push.ts`, `public/sw.js` | Notification received in Chrome |
| 4.2 Admin UI using the admin plugin endpoints: user list, roles, ban accounts, reset passwords | `web/routes/admin/*` | Non-admin users are blocked |
| 4.3 MCP server `/mcp` (`@hono/mcp`, API key auth, learn from saasmail): tools `list_transactions`, `get_payment_status(orderId)` | `src/api/mcp.ts` | MCP inspector can call the tools; route registered **before** the SPA fallback |
| 4.4 Gmail OAuth (optional): `gmail.readonly`, `users.watch` with Pub/Sub, renew watch via cron, `history.list`, `messages.get(format=raw)` then feed into `ingestRawEmail`. Learn from `inbox-zero/apps/web/utils/gmail/watch.ts`. Add `source = gmail_oauth` via migration | `src/core/gmail-oauth.ts`, `src/api/google-webhook.ts` | Up to 100 test users; "unsafe" warning shown until CASA is passed |
