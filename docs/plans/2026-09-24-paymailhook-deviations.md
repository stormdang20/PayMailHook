# Plan deviations

Every place where the implementation differs from [the plan](2026-09-24-paymailhook.md): what changed, why, and why the current approach was chosen. One section per task, newest at the bottom.

---

## Task 1.0: Scaffold

### 1.0-a: `bun init -y` not used

- **Plan:** run `bun init -y`, then edit `package.json`.
- **Done:** wrote `package.json` by hand, then ran `bun add`.
- **Cause:** `bun init` also generates `index.ts`, may write its own `CLAUDE.md`/agent rule files, and edits `.gitignore`. The repo already has `CLAUDE.md`, `README.md` and a curated `.gitignore`.
- **Why this way:** the plan replaces `package.json` right after `bun init` anyway, so writing it directly gives the same result without side effects to undo.

### 1.0-b: Biome style changed from `biome init` defaults

- **Plan:** "`biome init`, ignore `repo-ref`, `migrations`, `dist`".
- **Done:** 2-space indent, single quotes, line width 120. Excludes `migrations` and `dist`; `repo-ref` is skipped through `vcs.useIgnoreFile` (it is in `.gitignore`).
- **Cause:** `biome init` defaults to tabs and double quotes, while every code sample in the plan uses 2 spaces and single quotes.
- **Why this way:** plan code can be pasted without Biome rewriting it, which keeps diffs small.

### 1.0-c: `skipLibCheck: true` in `tsconfig.json`

- **Plan:** strict tsconfig with `types: ["bun", "@cloudflare/workers-types"]`, no mention of `skipLibCheck`.
- **Cause:** `@types/bun` and `@cloudflare/workers-types` both declare globals such as `Request` and `Response`; checking both `.d.ts` sets together conflicts.
- **Why this way:** `react-starter-kit/apps/api` uses the same two type packages the same way. Our own code is still fully type-checked.

### 1.0-d: `repo-ref` excluded in `tsconfig.json`

- **Cause:** `tsc` does not read `.gitignore`; without `exclude` it would type-check every reference repo.

### 1.0-e: `node_modules/` and `dist/` added to `.gitignore`

- **Cause:** the plan did not list them; without them `git status` shows thousands of files.

### 1.0-f: TypeScript 7 installed

- **Cause:** the plan does not pin versions, so `bun add -d typescript` installed 7.0.2 (the native Go port).
- **Why kept:** `tsc --noEmit` passes. If a later task hits a removed compiler option, pin `typescript@5`.

---

## Task 1.1: DB schema and PGlite test helper

### 1.1-a: api-key plugin import path

- **Plan:** `import { apiKey } from 'better-auth/plugins/api-key'`.
- **Done:** `bun add @better-auth/api-key`, then `import { apiKey } from '@better-auth/api-key'`.
- **Cause:** since better-auth 1.5 the API key plugin lives in its own package (1.5 release notes, checked via context7). `better-auth@1.7.5` no longer exports `./plugins/api-key`.
- **Affects later work:** P2 auth configuration must use the same import.

### 1.1-b: auth CLI run with the Bun runtime

- **Plan:** `bunx auth@latest generate …`.
- **Done:** `bunx --bun auth@latest generate …`.
- **Cause:** `bunx` runs the CLI on the system Node (v20), and a dependency (chevrotain) calls `Object.groupBy`, which needs Node ≥ 21. It crashed with `Object.groupBy is not a function`.
- **Why this way:** same workaround as wrangler in the plan (run the tool on Bun instead of upgrading the system Node).

### 1.1-c: `seedConfig` sets `user.createdAt`

- **Plan:** inserts `user` with `{ id, name, email, emailVerified }`.
- **Done:** also passes `createdAt: new Date()`.
- **Cause:** the generated `user.created_at` is `NOT NULL` without a DB default; better-auth fills it in application code. The plan's seed failed with Postgres error `23502` (not-null violation). `updated_at` did not fail because Drizzle's `$onUpdate` also runs on insert.

### 1.1-d: `await` on the `rejects` assertion

- **Plan:** `expect(seedConfig(db, …)).rejects.toThrow();` without `await`.
- **Done:** `await expect(…).rejects.toThrow();`.
- **Cause:** without `await` the assertion is never awaited, so the test passes even if the unique index is missing, and `close()` can run before the third insert finishes.

### 1.1-e: `bunfig.toml` added with `[test] root = "test"`

- **Plan:** listed `bunfig.toml` in Task 1.0 without content; it was skipped then as there was nothing to configure.
- **Cause:** `bun test` without a path does not read `.gitignore` and ran the test suites inside `repo-ref/`; it hung for over 2 minutes.
- **Why this way:** one line, and `bun run check` stays a plain `bun test`.

### 1.1-f: generated `auth-schema.ts` excluded from Biome

- **Cause:** the better-auth CLI writes double quotes. Formatting it would create a noisy diff on every regeneration.

### 1.1-g: open item for P2

`export const auth = createAuth({} as Database)` runs whenever `auth.ts` is imported. Once runtime code imports it (Task 1.9+), each cold start builds a throwaway instance and logs "Base URL is not set". Move the CLI-only export to its own file when the full auth config is written in P2.

---

## Task 1.2: Crypto helper

### 1.2-a: native `Uint8Array` base64/hex instead of hand-written helpers

- **Plan:** exports `toBase64`, `fromBase64`, `toBase64Url` built on `btoa(String.fromCharCode(...bytes))`, and `sha256Hex` formats bytes with `padStart`.
- **Done:** uses ES2026 `Uint8Array.prototype.toBase64()`, `Uint8Array.fromBase64()` and `.toHex()`. The three base64 helpers are removed; `randomToken` uses `toBase64({ alphabet: 'base64url', omitPadding: true })`.
- **Cause:**
  - Both runtimes ship these methods: verified on Bun 1.3.14, and the Workers changelog lists them as supported.
  - `String.fromCharCode(...bytes)` spreads every byte as a function argument and throws `RangeError: Maximum call stack size exceeded` for large arrays (around 100k+ bytes). Nothing large goes through it today, but the helper was exported for general use.
- **Why this way:** fewer lines, no edge case, standard API.
- **Affects later work:** Task 1.6 (`webhook-sign.ts`) imports `toBase64`/`fromBase64` from `./crypto`; it will call `.toBase64()` / `Uint8Array.fromBase64()` directly instead.
- **Types:** `bun-types` declares these methods; `@cloudflare/workers-types` does not, but both type sets are loaded together, so `tsc` accepts them.

### 1.2-b: `encrypt()` takes `Uint8Array<ArrayBuffer>`

- **Plan:** `encrypt(keyB64: string, data: Uint8Array)`.
- **Cause:** since TypeScript 5.7, `Uint8Array` is generic over its buffer (`ArrayBufferLike` by default, which includes `SharedArrayBuffer`). WebCrypto's `BufferSource` only accepts `ArrayBuffer`-backed views, so the plan code fails `tsc` with TS2345.
- **Why this way:** narrowing the parameter type is a type-only change. Every real caller already passes an `ArrayBuffer`-backed array (`TextEncoder.encode`, `Request.arrayBuffer()`), so no cast is needed.
- **Affects later work:** any new function that hands bytes to `crypto.subtle` needs the same `Uint8Array<ArrayBuffer>` type (e.g. HMAC in Task 1.6).

### 1.2-c: extra test for a tampered ciphertext

- **Plan:** tests only round-trip and fresh IV.
- **Done:** one more test flips a byte and expects `decrypt` to reject.
- **Cause:** authenticity (the GCM tag) is the reason AES-GCM was chosen for webhook secrets, App Passwords and failed raw emails; round-trip tests alone would still pass with an unauthenticated mode.

---

## Task 1.3: Anonymized fixtures

### 1.3-a: files sorted before numbering

- **Plan:** `readdir(...)` output used as-is to name `1.html`, `2.html`, …
- **Done:** `.sort()` before numbering.
- **Cause:** `readdir` returns directory order, which is filesystem-dependent (ext4 uses hash order) and not guaranteed stable. Task 1.4 tests hard-code `cake/2.html` as the incoming sample and `timo/2.html` as the 2.570.000 increase.
- **Result:** after sorting, `cake/2.html` is the `+149.000` sample and `timo/2.html` is the `+2.570.000` sample, which matches the plan's Task 1.4 tests.

### 1.3-b: NFC normalization and a built-in leak check

- **Plan:** plain `replaceAll`, then a manual `rg -f <(jq -r 'keys[]' …)` check.
- **Done:** HTML and PII keys are normalized to NFC before replacing; the script then throws if any PII value is still present, compared case-insensitively in both NFC and NFD form. It never prints the leaked value, only its length.
- **Cause:** Vietnamese names can be stored precomposed (NFC) or decomposed (NFD). A mismatch makes `replaceAll` miss the name, and the byte-exact `rg` check misses it too, so the leak would be committed silently. Fixtures go into a public repo, so this is a trust boundary.
- **Why this way:** about 8 lines, and the script cannot write a leaking fixture. The plan's `rg` check was still run and found nothing.

### 1.3-c: CAKE transaction IDs added to `mail-template/pii.json`

- **Plan:** `pii.json` (17 entries) was considered complete.
- **Done:** added 2 entries, so it has 19: the real CAKE `Mã giao dịch` values map to `500000001` (incoming, `cake/2.html`, same value as the payload example in design §3.1) and `500000002` (outgoing).
- **Cause:** the manual review (Step 4) found real CAKE transaction IDs in the visible text. `pii.json` already covered Timo reference codes but not CAKE's.
- **Kept on purpose:** amounts, dates and times (Task 1.4 tests assert `149000`, `2570000`, `18:28:07`); the CAKE hotline and `chat@cake.vn` (public bank contacts); 6-digit numbers such as `394860`, which are CSS colors.
- **Note:** `mail-template/` is gitignored, so this change lives only on the dev machine. A backup of the original file is in the session scratchpad.

### 1.3-d: `test/fixtures` excluded from Biome

- **Cause:** Biome 2 lints HTML and flagged the banks' CSS (`!important`). Fixtures must stay byte-for-byte what the bank sent (after anonymization); `biome check --write` would reformat them.

---

## Task 1.4: Text extraction and CAKE/Timo parsers

### 1.4-a: malformed numeric entities no longer throw

- **Plan:** `decodeEntity` calls `String.fromCodePoint(Number.parseInt(...))` directly.
- **Done:** returns the entity unchanged when the code point is `NaN` or above U+10FFFF.
- **Cause:** the entity regex `#x?[0-9a-f]+` also matches `&#abc;` (decimal parse gives `NaN`), and `&#99999999;` is out of range. `String.fromCodePoint` throws `RangeError` for both. That error is not a `ParseError`, so `ingestRawEmail` would rethrow it, `/api/ingest` would answer 5xx, and Apps Script would resend the same email forever.
- **Why this way:** one comparison (`NaN <= x` is `false`, so it covers both cases). A test covers it.

### 1.4-b: tests assert exact values from the fixtures

- **Plan:** `bankTxnId: expect.any(String)`, `balanceAfter: expect.any(Number)`, and the Timo test name says "increase and decrease" but only checks an increase.
- **Done:** exact values (`500000001`, `3000000`, counterparty object, Timo time in UTC), plus an assertion on the `timo/1.html` decrease, a `ParseError` test for unknown templates (ingest relies on that error type), and an `htmlToLines` entity test.
- **Cause:** the plan said to fill expected values from the fixtures once they exist; `expect.any` would pass even if the wrong line were picked (e.g. own account instead of the counterparty's).

### 1.4-c: zero-width non-joiner written as `‌`

- **Plan:** the regex contains an invisible literal U+200C character.
- **Why:** an invisible character in source is easy to delete by accident and impossible to review.

### 1.4-d: open item for P2

`extractOrderId` with an empty prefix matches any alphanumeric run. `order_prefix` defaults to `PMH`, but P2's config PATCH must reject an empty prefix (or one that becomes empty after stripping non-alphanumerics).

---

## Task 1.5: DKIM verification

### 1.5-a: reject messages with more than one `From` or `To` header (security)

- **Plan:** a signature passes if it is valid, from the bank domain, covers `from` and `to`, and has no `l=`.
- **Done:** additionally, the message must contain **exactly one** `From` and one `To` header.
- **Cause:** a DKIM verifier checks only the bottom-most instance of each signed header (RFC 6376 §5.4.2, confirmed in `mailauth/lib/tools.js` `getSigningHeaderLines`), while `postal-mime` (used by ingest for the `To` check) reads the top-most one. An attacker can take a genuine bank email sent to their own Gmail, prepend `To: victim@gmail.com`, and the signature still passes. Ingest would then accept it as the victim's mail, which defeats D6 and lets the attacker claim the victim's Gmail through the partial unique index (design §4.4, squatting protection).
- **Why this way:** the standard fix is either "oversigning" (which we don't control, the bank signs) or refusing duplicate headers. It is 2 lines and uses the header list mailauth already parsed. A test prepends a `To` and a `From` to a validly signed email; a mutation check (guard disabled) confirmed the test fails without it.

### 1.5-b: hand-rolled test signer for exact `h=` lists

- **Plan:** `signedEmail({ headerList })` for "To not signed", and `signedEmail({ withDate: false })` + `insertDate` for the Timo case.
- **Done:** a ~15-line relaxed/relaxed signer in `test/email.ts` (`signedEmailWithH`) for these two cases; the other cases still use mailauth's signer.
- **Cause:** both plan tests passed for the wrong reason / failed:
  - mailauth's signer only accepts `headerList` as a colon-separated string; an array (which its `.d.ts` declares) is silently replaced by the default list, which includes `to`. So "To not signed" still signed To.
  - mailauth's signer puts only **existing** headers in `h=`. Timo's real signature lists `date` while no `Date` exists (research §3), which is exactly why Gmail's added `Date` breaks it. With mailauth's signer, `h=` has no `date`, so an inserted `Date` is simply unsigned and CAKE passed too, so the test could not show that the Date retry is limited to `gmailAddsDate` banks.
- **Why this way:** the hand signer reproduces the real Timo signature shape. A control assertion checks that a hand-signed email with `h=from:to:subject` passes, so the helper itself is verified.

### 1.5-c: test key exported as PEM

- **Plan:** `publicKeyEncoding: { format: 'der' }` then `publicKey.toString('base64')`.
- **Cause:** with the installed Node typings, the `generateKeyPairSync` overload infers `publicKey` as `string`, so `toString('base64')` fails `tsc` (TS2554).
- **Done:** export PEM and strip the armor and whitespace, which gives the same base64 DER, with no cast.

### 1.5-d: local type for mailauth's missing fields

- As the plan allowed: `VerifiedSignature = DKIMResult & { signingHeaders?, canonBodyLengthLimited? }`, both confirmed in `lib/dkim/dkim-verifier.js`. No `any`.

### Result

All 6 real sample emails in `mail-template/` verify with live DNS (the real-sample test runs on the dev machine).

---

## Task 1.6: Webhook signing and URL validation

### 1.6-a: trailing-dot hostnames normalized (security)

- **Plan:** compares `url.hostname` directly.
- **Done:** strips one trailing `.` before the checks; tests for `localhost.`, `printer.local.` and `127.0.0.1.`.
- **Cause:** `localhost.` is the fully-qualified form of `localhost` and resolves to the same place, but it contains a dot, is not equal to `'localhost'` and does not end with `.localhost`, so the plan code accepted it. Same for `*.local.` and for the app's own host with a trailing dot. That is an SSRF bypass of design §3.4.
- **Why this way:** one `replace`, applied before every host rule.

### 1.6-b: native base64 (follows 1.2-a)

- `newWebhookSecret` and `signWebhook` use `.toBase64()` / `Uint8Array.fromBase64()` instead of importing `toBase64`/`fromBase64` from `./crypto`, which no longer exist.

### 1.6-c: a few more table cases

- `:443` explicit (allowed), a dotless host (`intranet`), and `ftp:` in self-host mode (`invalid_protocol`), so every branch of `validateWebhookUrl` is exercised.

### Reference check

`svix-webhooks` (`webhook_http_client.rs`, `is_allowed`) filters **resolved IPs**, which requires DNS control that Workers does not give; this matches the `ponytail:` note already in design §3.4.

---

## Task 1.7: `ingestRawEmail`

### 1.7-a: unique violation detected through `DrizzleQueryError.cause`, outside the transaction

- **Plan:** "catch Postgres error code `23505`" in step 2 of `store()`.
- **Done:** `isUniqueViolation(e)` checks `e instanceof DrizzleQueryError && e.cause.code === '23505'`; the catch wraps the whole `store()` call, not the UPDATE inside it.
- **Cause:**
  - drizzle-orm 0.45 wraps every driver error in `DrizzleQueryError`; the SQLSTATE is on `.cause.code` (same field for postgres.js and PGlite). Checking `e.code` would never match.
  - In Postgres a failed statement aborts the transaction, so the error cannot be handled inside `db.transaction()`. Letting it escape rolls back the whole unit, then `reject()` writes the failure row outside it.
- **Test:** "a Gmail already claimed by another config is rejected as to_mismatch": no transaction stored, `last_ingest_at` stays null.

### 1.7-b: `raw` typed `Uint8Array<ArrayBuffer>`

- Follows 1.2-b: `reject()` passes `raw` to `encrypt()`. `Request.arrayBuffer()` and `Bun.file().arrayBuffer()` both yield this type.

### 1.7-c: extra test cases

- `parse_failed` (unknown template) and the claimed-Gmail case above, on top of the plan's list.

### 1.7-d: shared test deps in `test/deps.ts`

- **Plan:** `makeDeps` defined inside `test/ingest.test.ts`.
- **Cause:** Task 1.8 needs it too; importing a `*.test.ts` file from another test file makes `bun test` register its tests a second time.

---

## Task 1.8: `deliver()` and periodic maintenance

### 1.8-a: manual trigger claims only finished deliveries (plan over design)

- **Design §3.2:** "manual: also allows failed/success", i.e. manual may claim any of the four statuses.
- **Plan / Done:** manual claims only `success` and `failed`; a manual call on a `pending`/`retrying` delivery is a no-op (tested).
- **Cause:** on a failed manual attempt the plan sets `next_attempt_at = null` and keeps the status. For a `retrying` delivery that would leave it `retrying` with no due time: the queued message fails its claim (`null <= now()` is not true) and the hourly cron skips it (`null < now() - 2 min` is not true either), so it would be stuck forever. Restricting manual to terminal statuses avoids that and also avoids racing an in-flight scheduled send.
- **Affects later work:** P2's `POST /api/webhook-deliveries/:id/retry` should answer something like `409 not_finished` (or just 202 and no-op) for `pending`/`retrying`.

### 1.8-b: retry time computed by the database clock

- **Plan:** `nextAttemptAt: now + delay` (JS clock).
- **Done:** `sql\`now() + make_interval(secs => ${delay})\``.
- **Cause:** the claim compares `next_attempt_at` with the DB's `now()`. Mixing the Worker/Bun clock with the DB clock adds skew to the 5-second tolerance; using `now()` on both sides removes it.

### 1.8-c: tests in `test/deliver.test.ts` instead of appending to `test/webhook.test.ts`

- **Cause:** `webhook.test.ts` is pure (no DB) and runs in milliseconds; delivery tests each boot PGlite. Keeping them apart keeps the fast file fast and each file focused.
- Two extra cases: manual retry on a scheduled delivery is a no-op (1.8-a), and a `301` carrying `Location: http://10.0.0.1` is not followed.

### 1.8-d: no injected `now`

- **Plan (design §5.1):** "`fetch` and `now` injected".
- **Done:** only `fetch` is injected. All scheduling times come from the DB's `now()` (see 1.8-b), and tests move `next_attempt_at`/`created_at` with SQL instead. A `now` dependency would have no reader.

### 1.8-e: `transition()` uses Drizzle's `PgUpdateSetSource` type

- Lets the helper accept `sql\`…\`` values without a loose `Record<string, unknown>`.

---

## Task 1.9: Hono app and `POST /api/ingest`

### 1.9-a: infrastructure errors answer 500 (plan), not 503 (design)

- **Design §2.2 / §5.1:** `/api/ingest` returns **503** on DB/DNS failure.
- **Plan / Done:** the global `onError` returns **500** `{error:{code:'internal'}}`.
- **Why:** Apps Script and IMAP only treat `200 {ok:true}` as an ack, so any 5xx keeps the cursor and the email is resent; 500 vs 503 changes nothing for the sender. Following the plan avoids an ingest-specific error branch. Switch to 503 only if a client ever needs to tell "retry later" apart from bugs.

### 1.9-b: note, no body size limit before reading

- The token is checked **before** the body is read, so unauthenticated clients can't make the server buffer a large body. An authenticated sender can still post up to the platform limit (Workers: 100MB) before `ingestRawEmail` rejects it as `too_large`. `hono/body-limit` fixes this with one line if it is ever abused. Not added now (no request for it, design §4.6 already defers ingest rate limiting).

---

## Task 1.12: Apps Script (done before 1.10)

### 1.12-a: task order changed, 1.12 before 1.10

- **Cause:** Task 1.10 Step 2 (`renderAppsScript` in `src/core/apps-script.ts`) reads `apps-script/Code.gs`, which Task 1.12 creates. Doing 1.10 first would mean a placeholder `Code.gs` rewritten two tasks later.

### 1.12-b: page through search results (data loss fix)

- **Plan:** `GmailApp.search(query, 0, 50)`, one page, then `cursor = newest`.
- **Done:** `findMessages()` reads pages of 50 until a short page.
- **Cause:** Gmail returns threads **newest first**. With more than 50 matching threads since the cursor (e.g. after the server returned 5xx for a while, so the cursor did not move), the plan code sends only the 50 newest, then moves the cursor past all of them. Older threads beyond the first page are never sent. That is lost payments with no error anywhere.
- **Test:** 120 threads, all 120 sent. The plan code sends 50.
- **Quota:** each extra page is one `GmailApp.search` call; only happens with a backlog.

### 1.12-c: extra tests

- A message older than `cursor - 300` in the same thread as a new one is not resent.
- The `Authorization` header carries the token placeholder (so `renderAppsScript` in 1.10 has a real target).

---

## Task 1.10: Bun entry (Self-host/dev) and config creation script

### 1.10-a: `Code.gs` imported with `with { type: 'text' }` plus a `*.gs` module declaration

- **Plan:** "read `apps-script/Code.gs` (imported as text)", no mechanism given.
- **Done:** `import template from '../../apps-script/Code.gs' with { type: 'text' }` and `src/types.d.ts` declaring `*.gs` modules as `string`.
- **Why:** Bun needs the import attribute for an unknown extension; the Workers bundle (Task 1.11) must accept the same import. Placeholders are replaced with replacer functions, so a value containing `$&` is inserted literally (tested).

### 1.10-b: `required()` written as a plain function

- **Plan:** `env[name] ?? (() => { throw … })()`.
- **Done:** a 4-line function with an `if`; also treats an empty string (e.g. `ENCRYPTION_KEY=` copied from `.env.example`) as missing, which `??` did not.

### 1.10-c: `create-config.ts` details

- Third optional argument `ingestUrl` (default `http://localhost:3000/api/ingest`), because Task 1.13 runs the same script against Neon with the Worker's URL.
- Validates the webhook URL with `validateWebhookUrl` using the same env as the server, so a typo fails at creation instead of at the first delivery.
- Stores `gmail` trimmed and lowercased (design §1).

### 1.10-d: manual check results (2026-09-24)

Run against the dev Postgres container (`bun run db:migrate` works as-is because `bun run` passes `.env` to drizzle-kit).

- Port 3000 is taken by another project on the dev machine; the server was run with `PORT=3010`.
- The real CAKE incoming email carries the real order code prefix `PAYHOOK`, so the dev config's `order_prefix` was set to `PAYHOOK` by SQL for this check only.
- Results with the 6 real emails from `mail-template/`:
  - CAKE outgoing → `stored`; CAKE incoming → `stored` + delivery; the webhook reached a local receiver and **verified with the `standardwebhooks` library**. Sending it again → `duplicate`.
  - Timo emails to the CAKE config's Gmail → `to_mismatch` (expected: different mailbox). With a second config for the Timo Gmail, all 4 → `stored` (DKIM with the Gmail `Date` retry, live DNS), amounts, direction and Vietnam time correct.

---

## Task 1.11: Workers entry

### 1.11-a: no `withDeps` / `close()`; one app instance

- **Plan:** `withDeps()` creates deps per invocation and closes the postgres.js client with `ctx.waitUntil(close())`; `createApp()` is called per request. The plan asked to check this against the latest Hyperdrive docs.
- **Done:** `makeDeps(env)` builds a fresh client per invocation and nothing is closed; `const app = createApp((c) => makeDeps(c.env))` is created once at module scope (the deps factory still runs per request).
- **Cause:** Cloudflare's Hyperdrive docs (via context7, "connection lifecycle" and the postgres.js example) say a new client per request is recommended and that connections from Workers to Hyperdrive are cleaned up automatically when the invocation ends; `client.end()` is not needed. The `try/finally` wrapper and the `close` plumbing have no effect, so they were deleted.
- **Kept from the plan:** `max: 5, fetch_types: false` in `createDb` match the docs' recommended settings.

### 1.11-b: `Code.gs` bundled through a wrangler `Text` rule

- **Added:** `"rules": [{ "type": "Text", "globs": ["**/*.gs"], "fallthrough": true }]`.
- **Why:** needed for `src/core/apps-script.ts` (1.10-a). The P1 Worker doesn't call `renderAppsScript` yet (tree-shaken), so it was checked with a throwaway entry that imports it: wrangler uploads `Code.gs` as a text module and the `with { type: 'text' }` import works.

### 1.11-c: queue consumer retries on infrastructure errors (plan over design)

- **Design §3.3:** the consumer "always `ack()`s".
- **Plan / Done:** `ack()` after `deliver()`, `retry({ delaySeconds: 60 })` if `deliver()` throws.
- **Why:** `deliver()` itself never throws for HTTP failures (those are recorded and rescheduled); it throws only when the DB is unreachable. Retrying the message then recovers within a minute instead of waiting for the hourly cron. The claim makes a redelivered message harmless.

### Result

`bun run build:worker`: total 2130 KiB, **gzip 571 KiB** (limit 3 MB), no `node:sqlite`.

---

## Task 1.13: Real Gmail spike and CI

### 1.13-a: CI without `actions/setup-node`, `actions/checkout@v5`

- **Plan:** installs Node 22 because wrangler needs Node ≥ 22.
- **Done:** no Node step; `build:worker` already runs wrangler on Bun (verified locally with the system Node at v20, see plan "Starting a new session"). `checkout@v5` is the current major.

### 1.13-b: manual spike and push not done by the agent

- Deploying to Cloudflare/Neon, pasting `Code.gs` into a real Gmail and making a real transfer need the user's accounts and money; pushing to GitHub is outward-facing. These steps are left to the user (status tracked in the plan's Task 1.13).

### 1.13-c: P1 ponytail review findings (applied)

- `test/email.ts`: unused `messageId` option removed.
- `src/core/webhook.ts`: `RETRY_SCHEDULE` no longer exported (only used inside the file).
- Everything else kept: schema/auth exports are required by drizzle and better-auth; `AppType`, `AppEnv`, `createAuth` are for P2.

---

# P2: Accounts and configuration

P2 was only described at task level in the plan. Each P2 entry below records what was decided while implementing it.

## Task 2.1: Full better-auth configuration

### 2.1-a: API keys are not turned into sessions (`enableSessionForAPIKeys` off)

- **Design §4.4:** `apiKey({ enableSessionForAPIKeys: true })` so `getSession()` accepts API keys.
- **Done:** the option is off. Task 2.2's `requireUser` tries the session first, then verifies the `x-api-key` header with `auth.api.verifyApiKey` (same shape as saasmail's "session → API key" middleware chain).
- **Cause:** the installed plugin documents this option as "⚠︎ not recommended for production use, as it can lead to security issues" (`@better-auth/api-key` types). A mocked session also lets a key call every better-auth endpoint that accepts a session (change password, create more keys…), which is more power than an integration key needs.

### 2.1-b: API key rate limit set to 120 requests/minute

- **Cause:** the plugin's default is **10 requests per key per day** (`rateLimitMax 10`, window 86 400 000 ms), which would break any integration that polls order status. 120/min per key is generous for polling and still bounds abuse. The generated schema defaults changed accordingly.

### 2.1-c: `rate_limit` table added (migration `0001`)

- `rateLimit.storage: 'database'` (design §4.4) needs better-auth's `rate_limit` table; the auth schema was regenerated with the CLI and the migration generated with drizzle-kit.

### 2.1-d: CLI-only auth instance moved to `src/core/auth-cli.ts` (closes 1.1-g)

- `src/core/auth.ts` no longer builds an instance at import time. `auth-cli.ts` passes placeholder env with Google enabled so the generated schema covers every table.

### 2.1-e: env validated with zod in `src/core/env.ts`; `APP_HOST` removed

- `parseEnv()` runs per Worker invocation and once at Bun startup (design §4.5: not at module load).
- Empty values (`FOO=` from `.env.example`) count as unset; `ENCRYPTION_KEY` must decode to 32 bytes; one Google credential without the other fails (react-starter-kit does the same check).
- `APP_HOST` is now derived from `BETTER_AUTH_URL`: both describe the app's public origin, and two variables could drift (e.g. the SSRF self-host check using a stale host).
- **Affects the user's setup:** `.env` and the Worker need `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`; `APP_HOST` is no longer read.

### 2.1-f: signup switch also covers Google

- `ALLOW_SIGNUP=false` sets `emailAndPassword.disableSignUp` **and** the Google provider's `disableSignUp`; otherwise a new Google account would still create a user.
- Known limit: with `ALLOW_SIGNUP=false` from the start nobody can create the first (admin) account. Self-host docs (2.10) say: sign up first, then set it to `false`.

### 2.1-g: `RESEND_API_KEY` (email verification / password reset) deferred

- Design §4.4 enables them when `RESEND_API_KEY` is set. Not in the plan's task list, and untestable without a sending domain. Admins reset passwords through the admin plugin meanwhile.

## Task 2.2: Middleware

### 2.2-a: API keys of banned users are rejected

- **Cause:** `auth.api.getSession()` refuses banned users (admin plugin), but `verifyApiKey()` does not look at bans. Without an extra check, a banned user keeps full API access through keys created before the ban.
- **Done:** after a valid key, `requireUser` reads the owner's `banned`/`banExpires` (one indexed lookup, only on API-key requests). Tested.

### 2.2-b: CSRF scoped to authenticated paths, origin compared with the public host

- **Plan:** `csrf()` on the API.
- **Done:** Hono's `csrf()` runs only on paths `requireUser` protects, and its origin check compares against `appHost` (from `BETTER_AUTH_URL`).
- **Cause:**
  - Hono's `csrf()` (read in `node_modules/hono/dist/middleware/csrf`) only checks form-like content types (`x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, or none). That is the right scope: a cross-site JSON request needs a CORS preflight, which this app never grants.
  - Applied to `/api/ingest` it blocked Apps Script-style requests without a content type and `curl --data-binary` (which defaults to form encoding). Ingest authenticates with its token, and `/api/auth/*` has better-auth's own origin check.
  - The default compares with `c.req.url`'s origin, which is wrong behind a reverse proxy (Docker self-host) where the internal URL differs from the public one.

### 2.2-c: `c.var.user` holds `{ id, role }`

- API-key requests get `role: null`: admin actions go through better-auth's admin endpoints, which require a real session.
- `GET /api/me` added (design §4.3 route list) to exercise the middleware.

## Task 2.3: Email config CRUD

### 2.3-a: decisions not spelled out in the design

- **POST also returns a webhook secret** (once), generated even without a URL, so adding the URL later needs no extra "rotate" step. Only the encrypted secret is stored.
- **`gmail` cannot be changed by PATCH.** It is what DKIM `To` is checked against and what the partial unique index claims; changing it would silently re-point ingest. Delete and recreate instead.
- **`orderPrefix` must be 1–16 letters/digits**, stored uppercase. Closes open item 1.4-d (an empty prefix would match every description).
- **Response bodies select explicit public columns**, so `ingest_token_hash`, `webhook_secret_enc` and `imap_password_enc` can never leak through a `select *` (tested by searching the JSON).
- **Invalid `:id` (not a uuid) is 400**, not a 500 from Postgres' `invalid input syntax for type uuid`.
- **`test-webhook`** validates the URL (SSRF) before sending, signs with the current secret, and returns the outcome (`statusCode`, `responseBody`, `error`, `durationMs`) directly; nothing stored.

### 2.3-b: `Deps.appHost` replaced by `Deps.appUrl`

- The Apps Script needs the full ingest URL (`${appUrl}/api/ingest`); the host for SSRF and CSRF checks is derived from it (`urlPolicy(deps)`). One field instead of two that could disagree.

### 2.3-c: `postWebhook()` extracted from `deliver()`

- The "Send test" button and scheduled deliveries share one signed-POST implementation (same headers, timeout, `redirect: 'manual'`).

### 2.3-d: test helpers `test/http.ts`

- `signUp`, `call` and `json` shared by API tests. `json()` returns `any` (with a Biome ignore comment) because `Response.json()` resolves to a conflicting type when Bun and Workers typings are both loaded (see 1.0-c).
