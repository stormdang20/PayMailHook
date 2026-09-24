# PayMailHook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans (hoặc subagent-driven-development) để làm plan này theo từng task. Luôn theo [CLAUDE.md](../../CLAUDE.md): code và comment viết bằng tiếng Anh, trả lời bằng tiếng Việt, TDD, mỗi bước một commit.

**Goal:** Xây dựng PayMailHook đúng theo [docs/design.md](../design.md). Hệ thống nhận email biến động số dư (CAKE, Timo), verify DKIM, parse, lưu giao dịch, rồi gửi webhook đã ký kèm retry. Có dashboard, và chạy được ở hai chế độ Hosted (Cloudflare Workers) và Self-host (Docker).

**Architecture:** Toàn bộ logic nằm trong `src/core`, viết bằng TS thuần, nhận mọi phụ thuộc runtime qua `Deps`. `src/api/app.ts` là Hono app, không phụ thuộc runtime. Hai entry mỏng: `src/worker.ts` (Workers + Queues + Cron) và `src/server.ts` (Bun + setTimeout + IMAP). Test bằng `bun test` với PGlite.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle (pg-core), postgres.js, PGlite (test), postal-mime, mailauth (`lib/dkim/*`), better-auth, Cloudflare Workers/Queues/Cron/Hyperdrive, Neon, React + Vite + TanStack Query + shadcn/ui, imapflow, Biome.

**Skills dùng khi làm:** `ponytail` (luôn bật), `tdd`, `drizzle-orm-expert`, `postgres-best-practices`, `hono`, `cloudflare-workers-expert`, `bun-development`, `better-auth-best-practices`, `better-auth-security-best-practices`, `google-apps-script`, `shadcn`, `tanstack-query-expert`, `react-best-practices`. Tra docs mới nhất qua context7 trước khi dùng API của một thư viện. Cuối mỗi pha chạy `ponytail-review`.

**Mức độ chi tiết:** P1 có code đầy đủ, vì là pha làm ngay. P2 đến P4 chỉ ghi ở mức task (file, test, tiêu chí xong). Plan chi tiết cho các pha này sẽ được viết khi bắt đầu từng pha, vì cần dựa trên code thật của P1 (`ponytail`: không viết code cho những thứ chưa có nền).

---

## Bắt đầu session mới

Môi trường đã được chuẩn bị sẵn (2026-09-24):

| Thứ | Trạng thái |
|---|---|
| Bun 1.3.14, Docker, tmux | ✅ Có sẵn |
| Postgres 17 cho dev | ✅ Container `paymailhook-postgres` ở `localhost:5435` (user/pass `postgres`, db `paymailhook`, volume `paymailhook-pgdata`, tự khởi động lại). Các cổng 5432 và 5434 đã có project khác dùng |
| Node | ⚠️ v20, trong khi wrangler cần ≥22. **Chạy wrangler bằng Bun** (`bun node_modules/wrangler/bin/wrangler.js …`): lệnh `deploy --dry-run` đã được kiểm chứng chạy được. `wrangler dev` thì **không** dùng được vì glibc 2.31 không chạy nổi `workerd` (xem research §3) |
| Email mẫu thật | ✅ `mail-template/{cake,timo}/*.eml` và `mail-template/pii.json`, đều đã gitignore |
| Repo tham khảo | ✅ `repo-ref/` (đã gitignore), xem research §4 |
| `.env` | ❌ **Chưa có.** Theo CLAUDE.md, agent không được tạo hay sửa `.env*`. Người dùng tự chạy `cp .env.example .env` rồi điền `ENCRYPTION_KEY=$(openssl rand -base64 32)` |

Lệnh mở đầu cho agent: *"Đọc CLAUDE.md, README.md, docs/design.md và plan này, rồi làm Task 1.0."*

---

## Quy ước chung

- **Kiểm tra trước mỗi commit:** `bun run check`, tức Biome, `tsc --noEmit` và `bun test` đều phải pass.
- **Commit:** theo Conventional Commits, mỗi task một commit. Cuối message có dòng `Co-Authored-By`.
- **Không bao giờ sửa tay:** `bun.lock` (chỉ thay đổi qua `bun add`), `.env*`, `migrations/*` (chỉ sinh bằng `bun run db:generate`).
- **Xử lý lỗi:** không dùng `catch {}` trần, luôn bắt đúng loại lỗi.
- **Kích thước:** mỗi hàm dưới 50 dòng, mỗi file dưới 300 dòng.
- **Chạy lâu:** lệnh chạy lâu (dev server) chạy trong tmux, session đặt tên `PayMailHook`.

---

# P1: Core pipeline

Khi xong P1: một email CAKE hoặc Timo thật, được Apps Script gửi lên `POST /api/ingest`, sẽ tạo ra một transaction. Nếu có mã đơn, webhook đã ký được gửi đi và retry theo lịch. Chạy được cả trên Bun (local) lẫn Workers (`wrangler deploy --dry-run` pass).

### Task 1.0: Scaffold

**Files:** Tạo `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `drizzle.config.ts`, `.env.example`.

**Step 1:** Tạo project và cài dependency:

```bash
bun init -y
bun add hono drizzle-orm postgres postal-mime mailauth better-auth
bun add -d @biomejs/biome typescript @types/bun drizzle-kit @electric-sql/pglite wrangler @cloudflare/workers-types standardwebhooks
```

**Step 2:** Sửa `package.json`:

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

**Step 3:** Tạo `tsconfig.json` (strict, `"types": ["bun", "@cloudflare/workers-types"]`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"noEmit": true`) và `biome.json` (`biome init`, bỏ qua `repo-ref`, `migrations`, `dist`). Tạo `drizzle.config.ts`:

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

**Step 5:** Chạy `bun run lint && bun run typecheck`. Kỳ vọng pass.

**Step 6:** Commit `chore: scaffold bun project with biome, drizzle and wrangler`.

### Task 1.1: Schema DB và helper PGlite cho test

**Files:**
- Tạo `src/core/auth.ts`, `src/core/db/auth-schema.ts` (sinh tự động), `src/core/db/schema.ts`, `src/core/db/client.ts`
- Tạo `test/db.ts`, `test/schema.test.ts`
- Sinh `migrations/`

**Step 1:** Tạo `src/core/auth.ts` ở dạng tối thiểu, để CLI sinh được các bảng auth. Cấu hình đầy đủ để dành cho P2.

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

Chạy `bunx auth@latest generate --config src/core/auth.ts --output src/core/db/auth-schema.ts -y`. Kiểm tra lại đường import của plugin với version thực tế (skill `better-auth-best-practices`).

**Step 2:** Tạo `src/core/db/schema.ts`:

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

**Step 3:** Tạo `src/core/db/client.ts`:

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

**Step 4:** Sinh migration bằng `bun run db:generate`. Kỳ vọng tạo ra `migrations/0000_*.sql`.

**Step 5:** Tạo `test/db.ts`:

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

**Step 6:** Viết test `test/schema.test.ts` cho unique index một phần:

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

**Step 7:** Chạy `bun test test/schema.test.ts`. Kỳ vọng PASS. Nếu FAIL vì chưa có `migrations/` thì quay lại Step 4.

**Step 8:** Commit `feat(db): add domain schema and pglite test helper`.

### Task 1.2: Crypto helper

**Files:** Tạo `src/core/crypto.ts`, test `test/crypto.test.ts`.

**Step 1: Test viết trước**

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

**Step 2:** Chạy `bun test test/crypto.test.ts`. Kỳ vọng FAIL vì module chưa tồn tại.

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

**Step 4:** Chạy `bun test test/crypto.test.ts`. Kỳ vọng PASS.

**Step 5:** Commit `feat(core): add hashing and AES-GCM helpers`.

### Task 1.3: Fixture ẩn danh

**Files:** Tạo `scripts/anonymize-fixtures.ts`. Sinh ra `test/fixtures/{cake,timo}/*.html`.

**Step 1:** ✅ Đã có `mail-template/pii.json` (17 mục: tên, số TK, Gmail, mã tham chiếu, số dư; `PAYHOOK433417283` được đổi thành `PMH123456`, nên fixture CAKE tiền vào đã chứa sẵn mã đơn cho test). Tên và số TK xuất hiện nguyên văn trong HTML (không bị mã hoá entity), nên `replaceAll` là đủ.

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

**Step 3:** Chạy `bun scripts/anonymize-fixtures.ts`, rồi kiểm tra không còn PII bằng `rg -f <(jq -r 'keys[]' mail-template/pii.json) test/fixtures`. Kỳ vọng không có dòng nào khớp.

**Step 4:** Mở từng file HTML ra kiểm tra bằng mắt (ngoài danh sách PII còn có thể có số dư, mã giao dịch…). Commit `test: add anonymized CAKE and Timo fixtures`.

### Task 1.4: Bóc tách text và parser CAKE/Timo (TDD)

**Files:** Tạo `src/core/text.ts`, `src/core/banks.ts`, test `test/banks.test.ts`.

**Step 1: Test viết trước.** Các giá trị kỳ vọng lấy từ fixture sau khi ẩn danh. Mở file HTML ra đọc rồi điền vào.

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

**Step 2:** Chạy `bun test test/banks.test.ts`. Kỳ vọng FAIL.

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

**Step 5:** Chạy `bun test test/banks.test.ts`. Kỳ vọng PASS. Nếu label của CAKE không khớp, in `lines` ra để xem, rồi sửa code hoặc sửa test cho đúng với dữ liệu thật.

**Step 6:** Commit `feat(core): parse CAKE and Timo notification emails`.

### Task 1.5: Verify DKIM (TDD với email ký tổng hợp)

**Files:** Tạo `src/core/dkim.ts` (gồm cả DoH resolver), `test/email.ts` (helper), test `test/dkim.test.ts`.

**Step 1:** Tạo helper `test/email.ts`:

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

Tên option `maxBodyLength` (tag `l=`) phải kiểm tra lại trong `repo-ref/mailauth/lib/dkim/sign.js`.

**Step 2: Test viết trước** (`test/dkim.test.ts`):

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

**Step 3:** Chạy `bun test test/dkim.test.ts`. Kỳ vọng FAIL.

**Step 4: Code `dohResolveTxt`** (đặt ở cuối `src/core/dkim.ts`)

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

**Step 6:** Chạy `bun test test/dkim.test.ts`. Kỳ vọng PASS, và test với email thật cũng PASS trên máy dev. Nếu type của `mailauth` thiếu field thì mở rộng type cục bộ, không ép sang `any`.

**Step 7:** Commit `feat(core): verify bank DKIM with To coverage and Timo Date quirk`.

### Task 1.6: Ký webhook và kiểm tra URL

**Files:** Tạo `src/core/webhook.ts` (phần 1), test `test/webhook.test.ts` (phần 1).

**Step 1: Test viết trước**

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

**Step 2:** Chạy test. Kỳ vọng FAIL.

**Step 3: Code** (phần đầu của `src/core/webhook.ts`)

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

**Step 4:** Chạy test. Kỳ vọng PASS.

**Step 5:** Commit `feat(core): sign webhooks per Standard Webhooks and validate URLs`.

### Task 1.7: `ingestRawEmail`

**Files:** Tạo `src/core/deps.ts`, `src/core/ingest.ts`, test `test/ingest.test.ts`.

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

**Step 2: Test viết trước** (`test/ingest.test.ts`). Dùng `createTestDb`, `seedConfig` và `signedEmail`, lấy HTML từ fixture CAKE tiền vào sau khi đã sửa `Nội dung giao dịch` thành `PMH123456`. Các case:
- `stored`: có dòng mới trong `transactions`, `orderId = '123456'`, có một `webhook_deliveries` ở trạng thái `pending`, `scheduleDelivery` được gọi với `(id, 0)`, `last_ingest_at` đã được đặt.
- Cùng raw gửi lần hai: `duplicate`, không tạo thêm delivery.
- `To: other@gmail.com`: `rejected` với lý do `to_mismatch`, có một dòng `inbound_failures`, `ingest_error = 'to_mismatch'`.
- `To: O.w.n.e.r+x@googlemail.com`: `stored` (chuẩn hoá Gmail).
- Chữ ký `d=evil.test`: `rejected` với lý do `dkim_failed`.
- `from: news@shop.test`: `ignored`, không lưu gì.
- Config không có `webhook_url`: `stored`, không tạo delivery.
- Tiền ra (`direction = out`) có chứa mã: không tạo delivery.

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

**Step 3:** Chạy test. Kỳ vọng FAIL.

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

Hàm `store()` đặt trong cùng file, dưới 50 dòng:
1. Mở `deps.db.transaction`.
2. Chạy `UPDATE email_configs SET last_ingest_at = now(), ingest_error = null`. Việc này có thể đụng unique index một phần: bắt lỗi Postgres mã `23505` và trả `rejected: to_mismatch`, vì Gmail này đã bị một config khác claim.
3. `INSERT transactions ... onConflictDoNothing({ target: transactions.messageId }).returning({ id })`. Không có dòng nào trả về thì return `duplicate`.
4. Tính `orderId = txn.direction === 'in' ? extractOrderId(...) : null`.
5. Nếu có `orderId` và `config.webhookUrl` thì `INSERT webhook_deliveries { payload: buildPayload(...), nextAttemptAt: new Date() }`.

`buildPayload` nằm trong `webhook.ts` và trả về đúng shape ở design §3.1.

**Step 5:** Chạy `bun test test/ingest.test.ts`. Kỳ vọng PASS toàn bộ.

**Step 6:** Commit `feat(core): ingest raw bank emails into transactions`.

### Task 1.8: `deliver()` và bảo trì định kỳ

**Files:** Thêm vào `src/core/webhook.ts` (phần 2). Tạo `src/core/maintenance.ts`. Thêm test vào `test/webhook.test.ts`, tạo `test/maintenance.test.ts`.

**Step 1: Test viết trước.** Seed một delivery bằng helper ingest, `fetch` giả trả về status theo kịch bản:
- 200: `success`, có một attempt, `webhook-id` bằng delivery id, chữ ký verify được bằng `standardwebhooks`.
- 500: `retrying`, `attempt_count = 1`, `next_attempt_at` cách hiện tại khoảng 10 giây, `scheduleDelivery` được gọi với `(id, 10)`.
- Lặp lỗi 10 lần (mỗi lần đặt lại `next_attempt_at = now()` trước khi gọi): lần thứ 10 chuyển sang `failed`.
- Phản hồi 301: tính là lỗi.
- `fetch` ném `TimeoutError`: attempt có `error = 'timeout'`.
- **Claim:** `await Promise.all([deliver(d, id), deliver(d, id)])` mà fetch giả chỉ được gọi **một lần**.
- Retry thủ công mà vẫn lỗi: giữ nguyên status (`failed` vẫn là `failed`, `success` vẫn là `success`), `scheduleDelivery` không được gọi.
- `webhook_url` bị đổi thành `https://127.0.0.1`: attempt có `error = 'ip_not_allowed'`, không gọi fetch.

**Step 2:** Chạy test. Kỳ vọng FAIL.

**Step 3: Code** (phần 2 của `webhook.ts`)

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
- Lỗi khi `manual`: **giữ nguyên status** (design §3.2), `nextAttemptAt: null`.
- Lỗi khi còn lịch: `delay = RETRY_SCHEDULE[delivery.attemptCount]` → `retrying`, `nextAttemptAt: now + delay`, rồi gọi `deps.scheduleDelivery(id, delay)`.
- Lỗi khi hết lịch: `failed`.

Luôn chạy `attemptCount + 1` và cập nhật `lastStatusCode`. `recordAttempt` chèn vào `webhook_attempts` với `attemptNumber = delivery.attemptCount + 1`.

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

Test: delivery bị kẹt thì được lên lịch lại; bản ghi cũ bị xoá; config chưa từng nhận email quá 7 ngày bị xoá. Dùng `UPDATE ... SET created_at = now() - interval '31 days'` để tạo dữ liệu cũ.

**Step 5:** Chạy `bun test`. Kỳ vọng tất cả PASS.

**Step 6:** Commit `feat(core): deliver webhooks with lease claim, retry schedule and maintenance`.

### Task 1.9: Hono app và `POST /api/ingest`

**Files:** Tạo `src/api/app.ts`, test `test/api.test.ts`.

**Step 1: Test viết trước**
- Không có token hoặc token sai: 401.
- Token đúng và raw hợp lệ: `200 {ok:true,status:'stored'}`.
- `db` ném lỗi: 500 với `{error:{code:'internal'}}` (Apps Script sẽ giữ cursor).

Gọi bằng `app.request('/api/ingest', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'message/rfc822' }, body: raw })`.

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

**Step 3:** Chạy `bun test test/api.test.ts`. Kỳ vọng PASS.

**Step 4:** Commit `feat(api): add hono app with ingest endpoint`.

### Task 1.10: Entry cho Bun (Self-host/dev) và script tạo config

**Files:** Tạo `src/server.ts`, `scripts/create-config.ts`.

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

**Step 2:** Tạo `src/core/apps-script.ts` với `renderAppsScript(url, token)`: đọc `apps-script/Code.gs` (import dạng text) rồi thay hai placeholder. P2 dùng lại hàm này. Sau đó viết `scripts/create-config.ts <gmail> <webhookUrl>`:
1. Tạo user dev.
2. Tạo config với `ingestTokenHash = sha256Hex(token)` và `webhookSecretEnc = encryptText(newWebhookSecret())`.
3. In ra token, secret và nội dung `apps-script/Code.gs` đã thay placeholder.

Mục đích là test tay P1 trước khi có dashboard.

**Step 3: Kiểm tra bằng tay**
1. Postgres đã chạy sẵn trong container `paymailhook-postgres` (`docker start paymailhook-postgres` nếu nó đang dừng).
2. Chạy `bun run db:migrate`.
3. Chạy `bun run dev` trong tmux.
4. Gửi thử: `curl -X POST localhost:3000/api/ingest -H "authorization: Bearer <token>" --data-binary @mail-template/cake/<file>.eml`.

Kỳ vọng nhận `status: 'stored'`. Nếu Gmail trong config khác với `To` của email mẫu thì nhận `to_mismatch`.

**Step 4:** Commit `feat: add bun server entry and dev config script`.

### Task 1.11: Entry cho Workers

**Files:** Tạo `src/worker.ts`, `wrangler.jsonc`.

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

`createApp()` được gọi cho mỗi request, vì việc đăng ký route rất rẻ. Cách đóng connection này cần đối chiếu lại với tài liệu Hyperdrive + postgres.js mới nhất (context7).

**Step 3:** Chạy `bun run build:worker`. Kỳ vọng build thành công, không có lỗi `node:sqlite`, và kích thước gzip dưới 3MB.

**Step 4:** Commit `feat: add cloudflare worker entry with queue consumer and cron`.

### Task 1.12: Apps Script

**Files:** Tạo `apps-script/Code.gs`, test `test/apps-script.test.ts`.

**Step 1: Test viết trước.** Nạp script bằng `new Function('GmailApp', 'UrlFetchApp', 'PropertiesService', 'LockService', 'ScriptApp', code + '; return { poll, setup };')` với các object giả. Các case:
- Mọi response đều 200 kèm `ok:true`: cursor bằng thời điểm của message mới nhất.
- Có một response 500: cursor giữ nguyên.
- Hai message nằm trong cùng thread: cả hai đều được gửi.
- Phản hồi 200 nhưng body không phải JSON: cursor giữ nguyên.

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

**Step 3:** Chạy `bun test test/apps-script.test.ts`. Kỳ vọng PASS.

**Step 4:** Commit `feat: add gmail apps script ingest client`.

### Task 1.13: Spike với Gmail thật và CI

**Step 1: Spike thủ công**
1. Deploy Worker lên Cloudflare (tạo Neon, Hyperdrive và Queue theo hướng dẫn trong README).
2. Chạy `scripts/create-config.ts` trỏ tới DB Neon.
3. Dán `Code.gs` vào Gmail thật và chạy `setup()`.
4. Chuyển 1.000đ với nội dung `PMH1`.

Kỳ vọng: có transaction, webhook tới được `https://webhook.site/...`, và chữ ký verify được. Ghi lại kết quả vào research.md §3:
- `getRawContent()` có verify DKIM được không.
- CPU time đo trong Workers Logs, so với giới hạn 10ms.

Nếu vượt 10ms CPU thì chuyển bước verify và parse sang queue consumer (xem ghi chú ở README).

**Step 2: CI**, tạo `.github/workflows/ci.yml`:

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

**Step 3:** Push lên GitHub và kiểm tra CI xanh. Commit `ci: run checks and worker bundle build`.

**Step 4:** Chạy `ponytail-review` cho toàn bộ P1 và xử lý các finding trước khi sang P2.

---

# P2: Tài khoản và cấu hình

Plan chi tiết viết khi bắt đầu P2. Các task:

| Task | Files | Test / Xong khi |
|---|---|---|
| 2.1 Cấu hình better-auth đầy đủ (design §4.4): Google tuỳ chọn, rate limit lưu DB, cookie cache, user đầu tiên thành admin, `ALLOW_SIGNUP`. Cài `zod` và `@hono/zod-validator`, thêm `BETTER_AUTH_*` vào env/secrets | `src/core/auth.ts` | User đầu tiên có `role=admin`; khi `ALLOW_SIGNUP=false` thì sign-up bị chặn |
| 2.2 Middleware: gắn `/api/auth/*`, `csrf()`, `requireUser` (cookie hoặc API key) | `src/api/app.ts`, `src/api/auth.ts` | Không có session thì 401; API key dùng như session; POST dùng cookie mà thiếu Origin thì 403 |
| 2.3 CRUD email config: POST trả token và `Code.gs` một lần (dùng `renderAppsScript` từ P1); PATCH validate URL; rotate token và secret; test webhook | `src/api/email-configs.ts` | Truy cập config của user khác trả 404; token cũ sau khi rotate trả 401 |
| 2.4 API giao dịch và delivery (phân trang keyset), retry/resend | `src/api/transactions.ts`, `src/api/deliveries.ts` | Phân trang ổn định; retry thủ công đúng như §3.5 |
| 2.5 SPA: Vite + React Router + TanStack Query + shadcn, better-auth client, `hc<AppType>` | `web/*`, `vite.config.ts`, cập nhật `wrangler.jsonc` (assets + `run_worker_first: ["/api/*"]`) | `bun run build` rồi truy cập `/`, SPA load được; F5 ở `/transactions` vẫn vào SPA |
| 2.6 Các trang: đăng nhập/đăng ký, danh sách config, onboarding Apps Script (copy script, trạng thái `last_ingest_at` và `ingest_error`), giao dịch, webhook log | `web/routes/*` | Test tay đầy đủ luồng từ tạo config tới khi nhận webhook |

# P2.5: Self-host

| Task | Files | Test / Xong khi |
|---|---|---|
| 2.7 IMAP listener (design §2.6): mở mailbox special-use `\All`, quét bằng `gmraw`, IDLE với `maxIdleTime` 25 phút, backoff khi reconnect, auth fail thì dừng | `src/imap.ts`, sửa `src/server.ts` | Test `scan()` với client giả; test tay với Gmail thật (rút mạng xong tự nối lại) |
| 2.8 UI cho source IMAP: nhập App Password (lưu mã hoá) | `web/routes/*`, `src/api/email-configs.ts` | Password không bao giờ bị trả về qua API |
| 2.9 Dockerfile (bun build, người dùng không phải root) và `docker-compose.yml` (app + postgres + chạy migrate khi khởi động) | `Dockerfile`, `docker-compose.yml` | `docker compose up` rồi mở `localhost:3000` là đăng ký được, trở thành admin |
| 2.10 README: hướng dẫn deploy Hosted (Neon, Hyperdrive, Queue, secrets) và Self-host | `README.md` | Người chưa biết gì làm theo được từ đầu tới cuối |

# P3: Dashboard hoàn chỉnh

| Task | Files | Test / Xong khi |
|---|---|---|
| 3.1 Giao dịch realtime: poll bằng `refetchInterval` 5 giây khi tab đang hiện, dừng khi tab ẩn (để Neon được ngủ) | `web/routes/transactions.tsx` | Giao dịch mới xuất hiện trong vòng ≤6 giây |
| 3.2 `GET /api/qr`: VietQR (`vietnam-qr-pay`) render SVG (`qrcode`), tham số `acc`, `bank`, `amount`, `des` | `src/api/qr.ts` | Payload QR decode lại đúng; app ngân hàng quét được (test tay) |
| 3.3 Trang tạo QR | `web/routes/qr.tsx` | |
| 3.4 Chia sẻ giao dịch: chốt phạm vi trước (một giao dịch hay danh sách), rồi thêm `share_token` bằng migration | migration, `src/api/share.ts`, `web/routes/share.tsx` | Link công khai không lộ `webhook_url` hay thông tin config |
| 3.5 Trang Guide (payload, verify chữ ký bằng `standardwebhooks` cho Node/PHP/Python, §3.6) và trang Privacy | `web/routes/guide.tsx`, `privacy.tsx` | |
| 3.6 E2E Playwright: đăng ký, tạo config, gửi email ký tổng hợp vào `/api/ingest`, thấy giao dịch và delivery `success` trên UI | `e2e/*` | CI chạy E2E |

# P4: Mở rộng

| Task | Files | Test / Xong khi |
|---|---|---|
| 4.1 Web Push (VAPID, học `saasmail/worker/src/lib/web-push.ts`): bảng `push_subscriptions`, gửi push khi có tiền vào | migration, `src/core/push.ts`, `public/sw.js` | Nhận được notification trên Chrome |
| 4.2 Admin UI dùng endpoint của admin plugin: danh sách user, phân quyền, khoá tài khoản, đặt lại mật khẩu | `web/routes/admin/*` | User không phải admin bị chặn |
| 4.3 MCP server `/mcp` (`@hono/mcp`, xác thực bằng API key, học từ saasmail): tools `list_transactions`, `get_payment_status(orderId)` | `src/api/mcp.ts` | MCP inspector gọi tool được; route đăng ký **trước** SPA fallback |
| 4.4 Gmail OAuth (tuỳ chọn): `gmail.readonly`, `users.watch` với Pub/Sub, gia hạn watch bằng cron, `history.list`, `messages.get(format=raw)` rồi đưa vào `ingestRawEmail`. Học `inbox-zero/apps/web/utils/gmail/watch.ts`. Thêm `source = gmail_oauth` bằng migration | `src/core/gmail-oauth.ts`, `src/api/google-webhook.ts` | Tới 100 user test; có cảnh báo "unsafe" cho tới khi qua CASA |
