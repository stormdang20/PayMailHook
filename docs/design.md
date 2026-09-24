# Design

Detailed design document. High-level decisions (D1…D17) live in the [README](../README.md#decisions); background research lives in [research.md](research.md).

Status of each section: ✅ approved · 📝 in review

---

## 1. DB schema ✅

Postgres, Drizzle `pg-core`. Money is `bigint` in VND (no fractional part). Times are `timestamptz`.

**Auth tables** (`user`, `session`, `account`, `verification`, `apikey`) are **generated** by the better-auth CLI (`auth generate`), not hand-written. The admin plugin adds the `user.role` column. Business tables reference `user.id`, type `text`.

**Multi-tenant:** every business table has `user_id`. Every dashboard/API query filters on **a single** condition, `user_id = ?`. No RLS, since there is only one DB role.

```
email_configs                        -- one row per Gmail; webhook is attached per config (like payhook)
  id uuid pk default gen_random_uuid()
  user_id text → user.id on delete cascade
  gmail text                         -- lowercase; must match the DKIM-signed To header (D6)
                                     -- partial UNIQUE: WHERE last_ingest_at IS NOT NULL (see 4.4, prevents Gmail squatting)
  source enum(apps_script, imap)     -- gmail_oauth added in P4 via migration
  ingest_token_hash text UNIQUE      -- sha256 of the Bearer token sent by Apps Script
  imap_password_enc text null        -- AES-GCM encrypted App Password, only used when source = imap
  last_ingest_at timestamptz null    -- dashboard shows "is the script still running"
  ingest_error text null             -- latest error (IMAP auth fail, DKIM fail…), shown on the dashboard
  order_prefix text default 'PMH'
  webhook_url text null
  webhook_secret_enc text null       -- whsec_… AES-GCM encrypted (signing needs the original secret, so it can't be hashed)
  created_at, updated_at

transactions
  id uuid pk
  user_id text → user.id             -- duplicated from email_configs so filtering needs one condition
  email_config_id uuid → email_configs on delete cascade
  message_id text UNIQUE             -- dedupe (D5); overlapping Apps Script and IMAP scans are harmless
  bank enum(CAKE, TIMO)
  direction enum(in, out)
  amount bigint                      -- always positive
  balance_after bigint null          -- Timo only
  bank_txn_id text null              -- CAKE only
  description text
  order_id text null                 -- matched order code (prefix stripped)
  counterparty_name text null
  counterparty_account text null
  counterparty_bank text null
  occurred_at timestamptz            -- taken from the body, in Asia/Ho_Chi_Minh time
  created_at
  index (user_id, occurred_at desc)

webhook_deliveries                   -- one delivery per transaction with an order_id
  id uuid pk                         -- used as the webhook-id header (idempotency)
  user_id text
  transaction_id uuid UNIQUE → transactions on delete cascade
  payload jsonb                      -- fixed body; retries and resends send it unchanged
  status enum(pending, retrying, success, failed)
  attempt_count int default 0
  next_attempt_at timestamptz null
  last_status_code int null
  created_at, updated_at
  index (status, next_attempt_at)    -- for the cron that scans stuck deliveries
  index (user_id, created_at desc)

webhook_attempts                     -- dashboard log; cron deletes records older than 30 days
  id uuid pk
  delivery_id uuid → webhook_deliveries on delete cascade
  attempt_number int
  trigger enum(scheduled, manual)
  url text
  status_code int null
  error text null
  response_body text null            -- truncated to at most 1KB
  duration_ms int
  created_at
  index (delivery_id)

inbound_failures                     -- emails for a known config that failed DKIM or parsing (D15); deleted after 7 days
  id uuid pk
  email_config_id uuid → email_configs on delete cascade
  message_id text null
  reason text                        -- dkim_failed | to_mismatch | unknown_sender | parse_failed
  raw_enc bytea                      -- AES-GCM encrypted raw MIME, for writing new parsers when a bank changes its template
  created_at
```

**Not yet, add when needed:**
- `push_subscriptions` (P4).
- `transactions.share_token` (P3, once it is decided whether a share link covers one transaction or the whole list).
- IMAP state (last UID read): not needed, since each reconnect only has to scan `SINCE` today, and `message_id UNIQUE` handles dedupe.

**Won't do:**
- A separate `endpoints` table, since each config has only one URL.
- An `events` table separate from `deliveries`, since each transaction has only one destination.
- RLS.

---

## 2. Email ingestion and processing flow ✅

Learned from: `my-money-went-bot/google_apps_script.js` (dedupe per message, not per thread; count as success only on ack), `agentic-inbox` (transient errors throw/5xx so the sender retries, permanent errors ack), `cloudflare_temp_email` (parse once, each side effect gets its own try/catch), `imapflow` (IDLE, `gmraw`).

### 2.1 Three sources, one core function

```
Apps Script ── POST /api/ingest ──┐
IMAP IDLE (Self-host) ────────────┼──► ingestRawEmail(deps, config, raw: Uint8Array) → IngestResult
Gmail OAuth (P4) ─────────────────┘
```

Each source does only two things: **identify the `email_config`** and **fetch the raw MIME**. All remaining processing lives in `src/core/ingest.ts`.

### 2.2 `ingestRawEmail`, step by step

| # | Step | On failure |
|---|---|---|
| 1 | Check size ≤ 2MB (bank emails are about 6–40KB) | `rejected: too_large` |
| 2 | `postal-mime` parses headers and HTML **once** | `rejected: malformed` |
| 3 | Look up `From` in `BANKS` to identify the bank | `ignored` (not stored, since the source-side query already filters by sender) |
| 4 | `To` contains `config.gmail`. Compare after Gmail normalization: lowercase, strip `.` and the `+tag` part of the local part, treat `googlemail.com` as `gmail.com` | `rejected: to_mismatch` |
| 5 | Verify DKIM (see 2.3) | `rejected: dkim_failed` |
| 6 | `bank.parse(html)` → `ParsedTxn` | `rejected: parse_failed` |
| 7 | In **one DB transaction**: `INSERT transactions … ON CONFLICT (message_id) DO NOTHING`. If a new row was inserted, `direction = in`, an order code matched, and the config has a `webhook_url`, then `INSERT webhook_deliveries (status=pending, next_attempt_at=now)` | No row inserted → `duplicate` |
| 8 | After commit: `scheduleDelivery(id)` | On failure the hourly cron picks it up again (the delivery is still `pending`) |
| 9 | `UPDATE email_configs SET last_ingest_at = now(), ingest_error = null` | |

- **`rejected` cases** in steps 4, 5, 6: write to `inbound_failures` (encrypted raw, `reason`) and `ingest_error`. These are **permanent errors**, so still ack so the source doesn't resend forever.
- **Infrastructure errors** (DB or DNS failure) throw. `/api/ingest` returns **503**, and the source retries on its next run.

### 2.3 Verify DKIM

```ts
const BANKS = {
  CAKE: { senders: ['no-reply@cake.vn'], dkimDomain: 'cake.vn', parse: parseCake },
  TIMO: { senders: ['support@timo.vn'], dkimDomain: 'timo.vn', parse: parseTimo, gmailAddsDate: true },
}
```

- Uses `mailauth/lib/dkim/verify`. The resolver is **DNS-over-HTTPS** on Workers and `node:dns` on Bun. The resolver is passed in via `deps`.
- **Pass condition:** at least one signature satisfies all three:
  - `status = pass` and `signingDomain = bank.dkimDomain`
  - The signed header list contains `from` and `to`
  - **No `l=` tag** (body length). With `l=`, an attacker can append content to the end of the body and the signature still validates
- **`gmailAddsDate`:** if the first verify fails, drop the `Date` header and verify once more (see research §3). This is still safe because the system doesn't use the `Date` header; `occurred_at` comes from the body, and the body is signed.

### 2.4 Parsing and order code matching

- **HTML → text:** strip `<style>`/`<script>`, turn tags into `\n`, decode entities. About 10 lines, no extra library needed.
- **CAKE:** read label/value pairs: the value is the first non-empty line right after the labels `Số tiền`, `Mã giao dịch`, `Ngày giờ giao dịch`, `Nội dung giao dịch`, `Tài khoản/Tên/Ngân hàng chuyển|nhận`. Direction comes from the `+`/`-` sign.
- **Timo:** regex over the sentence: `vừa (tăng|giảm) ([\d.]+) VND vào (dd/mm/yyyy HH:mm)`, `Số dư hiện tại: ([\d.]+)`, `Mô tả: (.*)`.
- Amount `2.570.000` becomes `2570000n`. Times get the `+07:00` offset.
- **Order code matching:** `description.toUpperCase().match(/<PREFIX>([A-Z0-9]+)/)`, **without stripping spaces or dots**, so `MBVCB.123.PMH456.DANG…` yields `456` instead of swallowing the trailing text. Only matched when `direction = in`.

### 2.5 Apps Script source (Hosted)

**Endpoint:** `POST /api/ingest` with headers `Authorization: Bearer <token>` and `Content-Type: message/rfc822`, body is the raw MIME.
- The token is looked up via `sha256` in `ingest_token_hash`. Wrong token returns 401.
- Rate limited per token.
- Success response: `200 {"ok":true,"status":"stored|duplicate|ignored|rejected"}`.

The dashboard generates `apps-script/Code.gs` with the URL and token filled in:

```
setup()            -- user clicks Run once: grants permissions, creates an everyMinutes(1) trigger
poll()             -- LockService → GmailApp.search('from:(…) after:<cursor-300>') → each message
                      (not per thread) with date > cursor → UrlFetchApp.fetchAll(getRawContent())
                      → if every response is ok:true then cursor = max(date); on any 5xx keep cursor unchanged
```

- **State is a single `cursor` number** (epoch) in Script Properties. The reference sample stores a map of message IDs, which can exceed the 9KB per-property limit with many transactions. Here the server already dedupes by `message_id`, so the 5-minute overlap between scans is safe.
- **Quota:** triggers get 90 minutes/day total divided over 1440 runs, i.e. about 3.7 seconds per run, which is enough. `UrlFetch` gets 20k calls/day.

### 2.6 IMAP source (Self-host)

Each config with `source = imap` maps to one long-lived `ImapFlow` connection in `server.ts`:

```
connect(imap.gmail.com:993, gmail + App Password)
open the mailbox with special-use \All -- "All Mail", since the user may have filters moving email out of INBOX
scan(): search { gmraw: 'from:(…) newer_than:1d' } → uids not yet seen this session → fetch { source: true } → ingestRawEmail
run scan() right after connecting and on every 'exists' event (IDLE)
maxIdleTime 25 minutes                 -- Gmail drops IDLE connections after about 29 minutes
'close'/'error' → reconnect, backoff 1s → 5 minutes
auth fail → ingest_error = 'imap_auth_failed', stop reconnecting until the user updates the password
```

### 2.7 Not yet

- Gmail OAuth (P4).
- Email Worker (only once there is a domain).
- Auto-detecting new banks: that means adding one row to `BANKS` and writing a parser.

---

## 3. Webhook delivery ✅

Learned from:
- `svix-webhooks` (signing standard, blocked IP list)
- `outpost` (fixed retry schedule)
- `convoy` (delivery states)
- `saasmail` (claiming a delivery with a conditional UPDATE)
- `laravel-sepay` (receivers should return 2xx on duplicates)

### 3.1 Request

```http
POST <webhook_url>
content-type: application/json
user-agent: PayMailHook/1.0
webhook-id: <delivery.id>                  # unchanged across all retries/resends, used for idempotency
webhook-timestamp: <unix seconds>          # fresh for each send
webhook-signature: v1,<base64(HMAC-SHA256(secret, "{id}.{timestamp}.{body}"))>
```

```json
{
  "type": "payment.received",
  "timestamp": "2026-09-20T11:28:07.000Z",
  "data": {
    "orderId": "123456",
    "transaction": {
      "id": "…uuid…", "bank": "CAKE", "direction": "in",
      "amount": 149000, "currency": "VND",
      "description": "PMH123456", "bankTxnId": "500000001", "balanceAfter": null,
      "counterparty": { "name": "NGUYEN VAN A", "account": "123456***7890", "bank": "TIMO" },
      "occurredAt": "2026-09-20T11:28:07.000Z"
    }
  }
}
```

- **Signed per [Standard Webhooks](https://www.standardwebhooks.com/),** hand-written in about 10 lines with `crypto.subtle` (runs on both Workers and Bun). Tested against the `standardwebhooks` library (devDependency only) to ensure receivers can verify with the standard library in any language.
- **Payload** is generated once when the delivery is created and stored in `webhook_deliveries.payload`. Every send reuses exactly that body; only the timestamp and signature are fresh.
- **Secret** is `whsec_` + base64 of 24 random bytes, shown only once. Stored with AES-GCM using the `ENCRYPTION_KEY` env key. Rotation replaces the old secret immediately.

### 3.2 Single send (`deliver(id, trigger)`)

```
1. Claim:  UPDATE webhook_deliveries
             SET next_attempt_at = now() + interval '60 s'           -- lease > 10s timeout
           WHERE id = $1 AND status IN ('pending','retrying')        -- (manual: also allows failed/success)
             AND next_attempt_at <= now() + interval '5 s'           -- tolerate messages arriving a few seconds early
           RETURNING *
           → no row means skip (another process already claimed it, or it isn't due yet)
2. validateWebhookUrl(config.webhook_url)                            -- re-checked on every send
3. fetch(url, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
4. INSERT webhook_attempts (status_code | error, response_body ≤1KB, duration_ms, trigger)
5. 2xx                       → status = success, next_attempt_at = null
   error (3xx/4xx/5xx/timeout) → attempt_count+1; schedule remaining → status = retrying, next_attempt_at = now + delay,
                               scheduleDelivery(id, delay); schedule exhausted → status = failed
   error with trigger = manual → keep status unchanged, don't schedule further (like svix)
```

**Retry schedule:** `[10, 10, 20, 30, 50, 3600, 7200, 14400, 28800]` seconds. In total 1 initial send plus 9 retries, i.e. 10 sends over about **15 hours**.

### 3.3 `scheduleDelivery(id, delaySeconds)`: two implementations

| | Hosted (Workers) | Self-host (Bun) |
|---|---|---|
| Scheduling | `QUEUE.send({ id }, { delaySeconds })`. The consumer calls `deliver()` then **always `ack()`s** | `setTimeout(() => deliver(id), delay * 1000)` |
| Recovery | Hourly cron: `status IN (pending, retrying) AND next_attempt_at < now() - 2 min` → `QUEUE.send` | On startup: load all `pending/retrying` deliveries and `setTimeout` by `next_attempt_at` |

- The queue **doesn't use `msg.retry()`**; it sends a new message for each retry. That avoids depending on the 24h message retention limit or `max_retries`, and the real state lives only in the DB.
- **The queue is at-least-once** and may deliver duplicates. The cron and the timer can also overlap. The claim step in 3.2 ensures each send happens only once.
- **Cost:** each send costs about 3 queue operations (send, read, ack). The free tier's 10k operations/day is about 3,000 sends per day.

### 3.4 SSRF protection (`validateWebhookUrl`)

Checked when saving the config and before every send:
- Only `https:` accepted.
- No `user:pass@`.
- Port empty or 443.
- Hostname is not an IP literal (v4, `[v6]`, decimal/hex forms).
- Not `localhost`, `*.local`, `*.internal`, `*.localhost`, and not the app's own hostname.
- Always uses `redirect: 'manual'`, so a 3xx response counts as an error. Prevents redirects to internal addresses.

**Self-host** enables `ALLOW_PRIVATE_WEBHOOKS=true` by default, since webhooks often point to an app on the LAN or localhost. When enabled, `http:`, private IPs and localhost are allowed.

`ponytail:` no DNS lookup yet to block domains resolving to private IPs, nor DNS rebinding. Workers gives no socket control. When needed, add a DoH lookup (A/AAAA) and block per svix's `is_allowed` list.

### 3.5 Manual actions and cleanup

- **Retry/Resend from the dashboard:** `POST /api/webhook-deliveries/:id/retry` calls `scheduleDelivery(id, 0)` with `trigger = manual`. Resending a `success` delivery is allowed; since `webhook-id` is unchanged, the receiver can still dedupe.
- **Test webhook:** the "Send test" button immediately (synchronously) sends a `payment.test` event with a sample payload, storing no delivery and doing no retries. The response is shown directly on screen.
- **Hourly cron** (same job as recovery):
  - Delete `webhook_deliveries` in `success/failed` status with `created_at` older than 30 days; `webhook_attempts` are deleted via cascade.
  - Delete `inbound_failures` older than 7 days.
  - Delete in batches with `LIMIT` (learned from `cloudflare_temp_email`).

### 3.6 Receiver guide (goes into the Guide page in P3)

1. Verify the signature with the `standardwebhooks` library, allowing at most 5 minutes of timestamp skew.
2. Dedupe by `webhook-id`. **Still return 2xx on duplicates**, otherwise retries keep piling up.
3. Match both `orderId` **and** `amount` against the order. Only transition the order when it is `pending`.
4. Return 2xx within 10 seconds. Push heavy work onto your own queue and respond immediately.

### 3.7 Not yet

- Honor the `Retry-After` header on 429/503.
- Auto-disable endpoints that keep failing (svix has this).
- Dual-sign with old and new secrets during rotation (`v1,a v1,b`).
- One config sending to multiple webhook URLs.

---

## 4. API and auth ✅

Learned from:
- `saasmail`: middleware chain, per-user scoping, API key format. It lacks `onError` and rate limiting, so we add them.
- `react-starter-kit`: separate the Hono app from each runtime's entry, and **don't** parse env at module load.
- Skill `better-auth-security-best-practices`.

### 4.1 Separating the app from the runtime

```
src/api/app.ts     createApp(): Hono<{ Variables: { deps: Deps; user?: User } }>   -- imports nothing from Cloudflare/Bun
src/worker.ts      fetch: wire deps (db via Hyperdrive, QUEUE, DoH resolver, waitUntil) → app.fetch; queue(); scheduled()
src/server.ts      Bun.serve: wire deps (db via DATABASE_URL, setTimeout scheduler, node:dns) → app.fetch; IMAP listeners; startup recovery
```

`Deps = { db, auth, env, scheduleDelivery, resolveTxt, waitUntil, now }`. Everything runtime-dependent is passed in here, so core and API are testable with `bun test` on PGlite.

### 4.2 Middleware (in order)

1. `app.onError`:
   - zod error → `400 {error:{code:'validation',issues}}`
   - `HTTPException` → keep its status
   - Other errors → log and return `500 {error:{code:'internal'}}`
2. `/api/auth/*` → `auth.handler(c.req.raw)`.
3. Hono's `csrf()` (checks `Origin`) for non-GET requests using a session cookie. Requests with an API key or ingest token skip this step.
4. `requireUser` on `/api/*`, except public paths (`/api/ingest`, `/api/qr`, `/api/share/*`): calls `auth.api.getSession({ headers })`, accepting **both cookie and API key**, then `c.set('user')`.
5. **Per-user scoping:** every query function takes `userId` as its first parameter. Access by id uses `WHERE id = $1 AND user_id = $2`; not found returns **404**, not 403, so as not to reveal whether the id exists.

CORS: the SPA runs on the same origin, so none is needed. Only `/api/qr` allows `*`.

### 4.3 Routes

| Route | Auth | Notes |
|---|---|---|
| `/api/auth/*` | – | better-auth: email sign-up/sign-in, Google, session, **admin** (`listUsers`, `setRole`, `banUser`…), **apiKey** (create/delete keys). No hand-written admin routes |
| `GET /api/me` | user | |
| `GET/POST /api/email-configs` | user | POST returns the **ingest token and `Code.gs` exactly once** |
| `GET/PATCH/DELETE /api/email-configs/:id` | user | PATCH `webhook_url` is SSRF-validated |
| `POST /api/email-configs/:id/rotate-token` | user | Returns a new token and a new `Code.gs` |
| `POST /api/email-configs/:id/rotate-secret` | user | Returns a new `whsec_…` once |
| `POST /api/email-configs/:id/test-webhook` | user | Sends `payment.test` (see 3.5) |
| `GET /api/transactions` | user | Filter by `configId`, `orderId`, `direction`. Keyset pagination on `(occurred_at, id)` |
| `GET /api/transactions/:id` | user | |
| `GET /api/webhook-deliveries` | user | Filter by `status` |
| `GET /api/webhook-deliveries/:id` | user | Includes the list of attempts |
| `POST /api/webhook-deliveries/:id/retry` | user | See 3.5 |
| `POST /api/ingest` | ingest token | See 2.5 |
| `GET /api/qr` | public | P3: VietQR image as SVG |
| `/api/share/*`, `/api/push/*`, `/mcp` | | In P3, P4, P4 respectively |

Requests are validated with `@hono/zod-validator`. The frontend calls through `hc<AppType>()` to share types.

### 4.4 better-auth configuration

```ts
betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true, disableSignUp: !env.ALLOW_SIGNUP },
  socialProviders: env.GOOGLE_CLIENT_ID ? { google: { … } } : {},  // default scopes openid/email/profile: non-sensitive, no CASA needed
  plugins: [admin(), apiKey({ enableSessionForAPIKeys: true })],   // re-check option name against the version when coding
  rateLimit: { enabled: true, storage: 'database',
               customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 3 } } },
  session: { cookieCache: { enabled: true, maxAge: 300 } },        // fewer queries, fewer Neon wake-ups
  trustedOrigins: [env.BETTER_AUTH_URL],
  advanced: { backgroundTasks: { handler: deps.waitUntil } },
  databaseHooks: { user: { create: { before: firstUserBecomesAdmin } } },
})
```

- **No domain, so no email sending.** Therefore **email verification and the forgot-password flow are off** by default:
  - Hosted recommends signing in with Google.
  - Admins can reset a user's password via the admin plugin.
  - If `RESEND_API_KEY` is set (once there is a domain), email verification and forgot-password are enabled automatically.
- **The first user automatically becomes admin.** Convenient for Self-host: right after `docker compose up`, sign up and you have admin rights.
- **Gmail squatting protection:** without email verification, an attacker could create a config with someone else's Gmail to block them. Handling:
  - `gmail` is UNIQUE only among configs that **have received at least one valid email**, i.e. `last_ingest_at IS NOT NULL`. Receiving a valid email proves the person actually owns the Gmail, since they had to run the script inside it, or the email must carry DKIM with `To` set to that Gmail.
  - Cron deletes configs that have never received an email after 7 days.

### 4.5 Env

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` / binding `HYPERDRIVE` | ✅ | |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | ✅ | Fail at startup if missing, like saasmail |
| `ENCRYPTION_KEY` | ✅ | AES-GCM for webhook secrets, App Passwords and failed raw emails |
| `GOOGLE_CLIENT_ID/SECRET` | | Enables Google sign-in |
| `RESEND_API_KEY` | | Enables email verification and forgot-password |
| `ALLOW_SIGNUP` | | Default `true`. Set `false` for a private Self-host |
| `ALLOW_PRIVATE_WEBHOOKS` | | Default `false` for Hosted, `true` for Self-host |

Env is validated with zod **when handling the first request**, not at module load (Workers only has `env` inside the handler).

### 4.6 Not yet

- Rate limiting `/api/ingest` per token. Hosted uses the Workers Rate Limiting binding if abused. `ponytail:` currently a wrong token costs only one index lookup.
- Audit log via `databaseHooks`.
- 2FA/passkey.
- OpenAPI/Swagger. Add only when there is a need to expose the API publicly to third parties.

---

## 5. Test strategy ✅

Learned from:
- `react-starter-kit`: PGlite runs the real migrations, no separate DB needed for tests.
- `saasmail`: inject `fetch` instead of patching the global. Counter-lesson: hand-copied DDL in tests drifted from the real schema.
- `cloudflare_temp_email`: fake email harness.

**Tooling:** `bun test`, no other framework needed (D14). Runs on dev machines even without `workerd`.

### 5.1 Test layers

| Layer | What is tested | How |
|---|---|---|
| **Parser** (TDD, tests first) | `parseCake`, `parseTimo`: incoming/outgoing, amounts with dots, +07:00 offset, order code extraction from `MBVCB.x.PMH456.DANG…` | **Anonymized** fixtures `test/fixtures/{cake,timo}/*.eml`. Compared against a `ParsedTxn` snapshot |
| **DKIM** | Cases: pass; wrong `d=`; `To` not signed; body modified; `l=` tag present; Timo's `Date` issue (signed without `Date`, then `Date` inserted, so the first verify fails, and verify after dropping `Date` passes) | **Generate an RSA key pair at test time**, sign synthetic emails with `mailauth/lib/dkim/sign`, fake resolver returns the public key. No real DNS, no real data |
| **DKIM with real emails** | Every file in `mail-template/` verifies as pass | `test.skipIf(!exists('mail-template'))`, uses real DNS. Runs only on dev machines, skipped in CI |
| **Ingest** | Outcomes: `stored`, `duplicate` (same email sent twice), `ignored`, `rejected` (with an `inbound_failures` row), order code match creates a delivery and calls `scheduleDelivery`, `to_mismatch` with Gmail variants | PGlite, fake resolver, fake `scheduleDelivery` that only records the ids it was called with |
| **Webhook** | Signature verifies with the `standardwebhooks` library; state transitions along the retry schedule; `failed` when the schedule is exhausted; a failed manual attempt schedules nothing further; **calling `deliver()` twice concurrently produces only one fetch** | `fetch` and `now` injected |
| **SSRF** | `validateWebhookUrl` with an input table: IP literal, `[::1]`, `0x7f000001`, `user:pass@`, port 8443, `.local`, plus the `allowPrivate` flag | Table-driven tests |
| **API** | Cross-user access blocked (another user's resource returns 404); API key works like a session; `/api/ingest` with a wrong token returns 401, DB failure returns 503; cookie POST without `Origin` is blocked | Hono's `app.request()` with PGlite deps; better-auth shares the PGlite |
| **Apps Script** | Cursor: advances only when every request returns `ok:true`, unchanged on any 5xx; dedupe per message (not per thread) | Load `Code.gs` into Bun, mock `GmailApp`, `UrlFetchApp`, `PropertiesService`, `LockService` |

### 5.2 Fixtures

- **Creating fixtures:** `bun scripts/anonymize-eml.ts mail-template/ test/fixtures/` replaces real names, account numbers and Gmail addresses with fixed fake values before committing. Fixture DKIM will certainly fail, so fixtures are only for parser tests. DKIM tests use the signed synthetic emails from 5.1.
- **DB:** each test file creates a fresh PGlite and runs `migrations/` with `drizzle-orm/pglite/migrator`. Tests run against **the real migrations**, no hand-copied DDL.

### 5.3 CI (GitHub Actions)

```
bun install → biome check → tsc --noEmit → bun test → wrangler deploy --dry-run
```

The `--dry-run` step catches Workers bundle errors, e.g. a dependency pulling in `node:sqlite` like the spike in research §3.

### 5.4 Manual checks and spikes (not automated)

- Apps Script: `getRawContent()` on real Gmail verifies DKIM pass (after handling Timo's `Date`).
- Workers: measure CPU time of `ingestRawEmail` on a 40KB CAKE email against the free tier's 10ms limit.
- IMAP: connect to real Gmail with an App Password, receive new email via IDLE, auto-reconnect after unplugging the network.

### 5.5 Not yet

- Playwright E2E (added in P3, once there is a dashboard).
- Automated IMAP tests against a fake IMAP server. `scan()` takes the client as a parameter, so this can be added later.
- Coverage measurement.
