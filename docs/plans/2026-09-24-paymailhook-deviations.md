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

## Task 2.4: Transaction and delivery API

### 2.4-a: keyset cursor keeps Postgres' timestamp text

- **Cause:** `created_at` (`defaultNow()`) has microsecond precision; a JS `Date` has milliseconds. A cursor built from `Date` would round the boundary row and either repeat or skip rows created within the same millisecond.
- **Done:** each page selects `ts::text` as a hidden `cursorTs`, the cursor is base64url JSON `{ ts, id }`, and the filter is the row comparison `(ts, id) < (cursor.ts::timestamptz, cursor.id::uuid)` with `ORDER BY ts DESC, id DESC`, which matches the `(user_id, occurred_at desc)` index. A malformed cursor is a 400 (validated), not a Postgres cast error.
- **Test:** 8 rows (5 sharing one timestamp), page size 3: every row exactly once, newest first.

### 2.4-b: manual retry answers 409 for scheduled deliveries

- Follows 1.8-a: `POST /api/webhook-deliveries/:id/retry` returns `202` for `success`/`failed` and `409 { code: 'not_finished' }` for `pending`/`retrying` instead of a silent no-op.

### 2.4-c: delivery list joins the transaction

- List items carry `orderId` and `amount`, so the webhook log page (2.6) needs no second request per row.

## Task 2.5: SPA scaffold

### 2.5-a: no `@cloudflare/vite-plugin`; Vite builds `web/` into `dist/client`

- **Reference:** saasmail uses `@cloudflare/vite-plugin`, which runs `workerd` for dev.
- **Cause:** `workerd` cannot run on the dev machine (glibc 2.31, D14).
- **Done:** plain Vite with `root: 'web'`, `outDir: dist/client`. Dev runs `bun run dev` (API) and `bun run dev:web` (Vite, proxies `/api` to `API_URL`, default `http://localhost:3000`), so cookies stay same-origin. The Worker serves the build through `assets` with `not_found_handling: single-page-application` and `run_worker_first: ["/api/*"]`; the Bun server serves the same build with `hono/bun` `serveStatic` and an `index.html` fallback that never swallows `/api/*`.
- **Checked:** `/`, `/transactions`, `/deliveries` return the SPA; `/api/me` and unknown `/api/*` return JSON from the API.

### 2.5-b: `createApp()` chains its routes

- **Cause:** `hc<AppType>` only sees routes registered by chaining (`app.get(...).route(...)`); separate `app.get()` statements leave `AppType` with no routes.

### 2.5-c: shadcn `radix-nova` preset, `cn` package

- `shadcn init -t vite -b radix -p nova` (the CLI's default preset). Current shadcn replaces `clsx` + `tailwind-merge` with the `cn` package from `github.com/shadcn-ui/cn` (checked its `package.json` before keeping it).
- Biome: CSS parser option `tailwindDirectives` enabled for `@theme`/`@custom-variant`.

### 2.5-d: `hono/client` `parseResponse` instead of a hand-written unwrap

- It returns the typed JSON body and throws `DetailedError` for non-2xx responses, which is what TanStack Query needs.

### 2.5-e: build scripts

- `bun run build` = `vite build`. `build:worker` now runs `vite build` first (wrangler needs the assets directory) and writes the Worker bundle to `dist/worker` so it can't clash with `dist/client`.
- **Result:** SPA JS 133 KiB gzip; Worker total 1057 KiB gzip.

## Task 2.6: Pages

### 2.6-a: UI text in Vietnamese

- The target users bank with CAKE/Timo and read Vietnamese (like payhook.codes). CLAUDE.md's English rule covers code, comments, commits and docs; UI copy is product content. Messages live next to their components; `web/lib/errors.ts` maps API error codes and `ingest_error` values to sentences. i18n can be added if non-Vietnamese users appear.

### 2.6-b: public `GET /api/config`

- Returns `{ socialProviders }` so the sign-in page shows "Continue with Google" only when it is configured (react-starter-kit's `configuredSocialProviders` idea).

### 2.6-c: one-time secrets dialog carries the Apps Script steps

- After "Add" (and after "Rotate token"), a dialog shows `Code.gs`, the webhook secret and the 4 setup steps (new project → paste → run `setup` → consent screen). Closing it loses the values, as the API returns them once.

### 2.6-d: manual check (2026-09-24)

- Bun server with the built SPA; sign-up, create config (`Code.gs` contains the token), ingest of the 2 real CAKE emails → 2 transactions, 1 delivery retrying (no receiver running). Headless Chrome screenshots (CDP, session cookie from the sign-up) of `/`, `/transactions`, `/deliveries` show the data correctly (VN time, signed amounts, order code, delivery status). The sign-in/Google flow and dialogs are covered again by the Playwright E2E in 3.6.

---

# P2.5: Self-host

## Task 2.7: IMAP listener

### 2.7-a: how the listener is structured

- `scan(client, seen, ingest)`: `SEARCH X-GM-RAW "from:(…) newer_than:1d"` (senders from `BANKS`, so a new bank needs no change here), fetches only UIDs not handled in this session, and adds a UID to `seen` **only after** ingest succeeded, so a DB outage retries that email on the next scan. Server-side `message_id` dedupe makes re-scans safe (design §2.6).
- `startImap()`: one connection loop per config. Scans are serialized through a promise queue (an `exists` event during a scan does not start a second one). The config row is **re-read for every message** so webhook URL / prefix edits apply without reconnecting.
- Authentication failure: writes `ingest_error = 'imap_auth_failed'` and stops (design §2.6). Retrying a wrong App Password risks Google locking the account.
- `superviseImap()`: every 60 s, diffs the running listeners against `source = imap` configs that have a password and no `imap_auth_failed`. The key includes the encrypted password, so saving a new password (2.8) restarts the listener; deleting or switching a config stops it.

### 2.7-b: not verified against real Gmail by the agent

- Needs a Gmail App Password; listed in the user setup checklist. Unit tests cover `scan()` (once per email, retry after a failed ingest, the Gmail query) and the auth-failure stop.
- `imapflow` is imported only by `src/server.ts`; the Worker bundle does not contain it (checked).

## Task 2.8: UI for the IMAP source

### 2.8-a: IMAP only where it can run

- `Deps.imapEnabled` is `true` on the Bun server and `false` on Workers (no long-lived TCP connections there). The API answers `400 imap_not_available` for `source: 'imap'` on Hosted, and `GET /api/config` returns `imap` so the SPA only offers the choice in Self-host.

### 2.8-b: App Password handling

- Accepted with or without the spaces Google shows (`abcd efgh ijkl mnop`), validated as 16 letters, stored with AES-GCM (`encryptText`). Responses only carry `hasImapPassword`; tests search every response body for the password and its ciphertext.
- A new password clears `ingest_error` (e.g. `imap_auth_failed`), so `superviseImap` restarts the listener within a minute (2.7-a).
- For IMAP configs, creation returns `appsScript: null`; the ingest token is still generated (the column is `NOT NULL`, and switching back to Apps Script later only needs a token rotation).

## Task 2.9: Dockerfile and docker-compose

### 2.9-a: bundled server, no `node_modules` in the runtime image

- `bun build src/server.ts --target=bun` produces one 5.7 MB file (including `Code.gs` as text). The runtime stage (`oven/bun:1.3-slim`) copies only that file, the built SPA and `migrations/`, and runs as the image's non-root `bun` user. Image size: 177 MB.

### 2.9-b: migrations run inside the server at startup

- **Plan:** "migrate on startup" in compose.
- **Done:** `src/core/db/migrate.ts` (`drizzle-orm/postgres-js/migrator`) runs before the server starts listening. drizzle-kit (a dev tool with many dependencies) is not shipped, and there is no separate migrate container to order. It lives in its own file because it reads the filesystem; only the Bun entry imports it. `bun run db:migrate` still works for dev.

### 2.9-c: compose reads secrets from `.env`, fails fast if missing

- `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` use `${VAR:?message}`, so `docker compose up` stops with a clear message instead of starting a broken server. `DATABASE_URL` is set by compose (points at the `db` service), overriding the dev value in `.env`. Host port via `PORT` (default 3000).

### 2.9-d: manual check (2026-09-24)

- `docker compose -p pmh-selftest up` on port 3011: migrations applied, first sign-up got `role: admin`, `/transactions` served the SPA, process runs as `uid=1000(bun)`. The test stack, its volume and image were removed afterwards.

## Task 2.10: README

### 2.10-a: `bun run deploy` script and scope of the guide

- Added `"deploy": "vite build && wrangler deploy"` so the Hosted guide's deploy step is one command that never ships a stale SPA.
- The guide recommends **IMAP for Self-host** (outbound connection, works on a LAN box) and explains that Apps Script needs a publicly reachable `/api/ingest`.
- Neon migrations are applied with `drizzle-kit migrate` against the direct connection string before creating Hyperdrive; the Worker itself never migrates (it has no filesystem).
- Not yet verified by following it on a real Cloudflare account (part of the user's Task 1.13 spike).

---

# P3: Complete dashboard

## Task 3.1: Realtime transactions

- As planned: `refetchInterval: 5000` on the transactions query. No extra visibility code: `@tanstack/query-core` only runs interval refetches when `refetchIntervalInBackground` is set or `focusManager.isFocused()` (document not hidden), checked in `queryObserver.ts`. New rows appear within ~5 s plus request time.
- Kept to the transactions page, as the plan says; the webhook log refreshes on open and after a manual retry.

## Task 3.2: `GET /api/qr`

- `bank` accepts a `vietnam-qr-pay` bank key (`cake`, `timo`, `vcb`…) or its 6-digit BIN, so callers don't need a BIN table; unknown banks answer `400 unknown_bank`.
- Response: `image/svg+xml`, `cache-control: public, max-age=86400` (same parameters always give the same image), `access-control-allow-origin: *` (design §4.2, embeddable in shop pages). Public (already in `PUBLIC_PATHS`).
- Validation: account 1–19 alphanumerics, amount a positive integer, description ≤ 50 chars.
- Test decodes the built payload with `new QRPay(content)` (bank BIN, account, amount, purpose). Scanning with a banking app is a manual check for the user.
- `qrcode` bundles for Workers (gzip total 1083 KiB).

## Task 3.3: QR generator page

- `/qr`: bank (VietQR-enabled banks from `vietnam-qr-pay`, CAKE preselected), account, optional amount and description; the preview is an `<img>` of `/api/qr`, with a "copy image link" button for embedding.
- Considered lazy-loading the route; measured the page chunk at 10.6 KB gzip, not worth the extra code. The SPA main chunk is 187 KB gzip (up from 133 KB at 2.5, mostly the Radix dialog/select components added in 2.6).

## Task 3.4: Transaction sharing

### 3.4-a: scope decided by the user: both a single transaction and a per-Gmail list

- The plan required settling the scope first; the user chose **both** (2026-09-24).
- `transactions.share_token` (proof of one payment) and `email_configs.share_token` (cashier screen), nullable + unique (migration `0002`). Tokens are 24 random bytes (base64url), stored in plain text so the owner can copy the link again; revoking sets the column to `null`.
- Owner endpoints: `POST/DELETE /api/transactions/:id/share` and `POST/DELETE /api/email-configs/:id/share`. `POST` is idempotent (`coalesce` keeps an existing token), returns 404 for someone else's row.
- Public endpoints (`/api/share/*`, already in `PUBLIC_PATHS`): `GET /api/share/t/:token` and `GET /api/share/c/:token` (keyset pagination).

### 3.4-b: what a public link shows

- Fields: bank, direction, amount, description, order code, bank transaction id, time (and the row id for list keys). **Not** the Gmail, webhook URL, config/user ids, or counterparty name/account: those are the payer's personal data. Tests search the public JSON for all of them (plan's done criterion: no `webhook_url` or config details).
- The list link shows **incoming money only**; outgoing transfers reveal what the shop spends and a cashier screen doesn't need them. It refreshes every 5 s like the dashboard.

### 3.4-c: manual check

- Public pages `/share/t/:token` and `/share/c/:token` rendered in headless Chrome without a session; an unknown token shows "link does not exist or was revoked".

## Task 3.5: Guide and Privacy pages

- Both pages are **public** (`/guide`, `/privacy`, linked from the sign-in page and the dashboard nav) so developers can read the integration contract before creating an account.
- The guide's example payload is a constant in `web/lib/webhook-sample.ts` rather than an import of `buildPayload()` (which would pull server code into the browser bundle); `test/guide-sample.test.ts` fails if the two ever differ.
- Verification snippets use the official Standard Webhooks libraries for Node (`standardwebhooks`), PHP (`standard-webhooks/standard-webhooks`) and Python (`standardwebhooks`), with header names lower-cased before `verify()`; the Node snippet reads the raw body (`express.raw`) because the signature covers the exact bytes. They follow design §3.6 (dedupe by `webhook-id` and still answer 2xx, match `orderId` and `amount`, answer within 10 s).
- The PHP/Python snippets were not executed here (no PHP/Python receiver in this repo); the Node flow is covered by tests that verify real signatures with the `standardwebhooks` package.
- Privacy page lists exactly what the schema stores and the retention the cron enforces (webhook logs 30 days, failed raw emails 7 days, encrypted).

## Task 3.6: Playwright E2E

### 3.6-a: a test-only server entry on PGlite

- **Cause:** the E2E test must post a DKIM-signed bank email. A real signature needs the private key of `cake.vn`; the unit tests sign with a key generated at test time and resolve it with `testResolver`. The server process must therefore use that same resolver and key, which the production entries rightly don't allow.
- **Done:** `e2e/server.ts` builds the real `createApp()` with in-memory PGlite (migrations applied), `testResolver`, real `deliver()` on timers, the built SPA, plus two test routes: `GET /__e2e/signed-email?to=` (a CAKE email signed with the server's test key) and `POST /__e2e/hook` (the webhook receiver). No Postgres is needed locally or in CI, and nothing test-only ships in `src/`.
- **Flow tested in a real browser:** sign up → add a Gmail with a webhook URL → read the token from the `Code.gs` shown in the dialog → post the signed email to `/api/ingest` (what Apps Script does) → the transaction appears on `/transactions` (`+149.000`, order `123456`) → the delivery reaches `Thành công` on `/deliveries`.
- Local runs use the system Chrome (`channel: 'chrome'`); CI installs Playwright's Chromium (`bunx playwright install --with-deps chromium`) and runs `bun run e2e` after the other checks.

### 3.6-b: found by the E2E run: rate limiting had no client IP (fixed in the next commit)

- better-auth logged "Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket". With the sign-in rule (5/min), five failed sign-ins by anyone would lock out every user. See 3.6-c.

### 3.6-c: client IP for better-auth rate limiting (fix for 3.6-b)

- **Cause:** better-auth reads only `x-forwarded-for` by default. Cloudflare Workers expose the client as `cf-connecting-ip`, and a Bun server hit directly has no such header at all, so all clients fell into one bucket.
- **Done:** `createAuth(…, ipHeader)`. The Worker passes `cf-connecting-ip` (set by Cloudflare, clients cannot forge it). The Bun server copies the socket address (`server.requestIP`) into `x-client-ip`, **overwriting** any value the client sent, and passes that header name.
- **Tests:** unit test: 6 failed sign-ins from one IP → 429 for it, another IP still allowed. Manual test on the Bun server: rotating a forged `x-client-ip` value does not escape the limit (401 ×5, then 429).
- **Known limit (`ponytail:` in `server.ts`):** a self-host behind a reverse proxy sees the proxy's address, i.e. one shared bucket again. Supporting `X-Forwarded-For` safely needs the proxy's address (better-auth `trustedProxies`); add an env option if someone needs it.

---

# P4: Extensions

## Task 4.1: Web Push

### 4.1-a: WebCrypto implementation ported from saasmail, no `web-push` package

- `web-push` (npm) relies on Node's `crypto`/`https` modules; saasmail (the plan's reference) implements RFC 8291 + RFC 8292 with WebCrypto only, which runs on both Workers and Bun. `src/core/push.ts` is a trimmed port (native base64url, one HKDF helper since every output is ≤ 32 bytes).
- Tests: the payload decrypts with a browser-side implementation of RFC 8291 (receiver ECDH key + auth secret); the VAPID JWT verifies as ES256 against the public key.

### 4.1-b: behaviour decisions

- **When:** after every **stored incoming** transaction (not only ones with an order code), to every browser the owner subscribed. Title `+149.000 đ`, body `Đơn <order>: <description>`, click opens `/transactions`.
- **Never breaks ingest:** each send is wrapped; failures are logged. A `404`/`410` from the push service deletes that subscription (the browser unsubscribed).
- **SSRF:** the endpoint URL comes from the browser, so `POST /api/push/subscriptions` validates it with the strict webhook rules (https, no IP/localhost/internal names) regardless of `ALLOW_PRIVATE_WEBHOOKS`. Tested with `https://10.0.0.5/x`.
- **Config:** optional `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (both or neither; `bun scripts/generate-vapid.ts` prints a pair). The VAPID subject is `BETTER_AUTH_URL` (RFC 8292 accepts an https URL), so no third variable. `GET /api/config` returns `vapidPublicKey`; the "Bật thông báo" button only appears when it is set and the browser supports Push.
- Table `push_subscriptions` (endpoint unique, re-subscribing the same browser updates its keys), migration `0003`.

### 4.1-c: not verified end to end

- A real notification needs a real browser profile and Google's/Mozilla's push service; listed in the user checklist. The E2E run still passes with the service worker in the build.

## Task 4.2: Admin UI

### 4.2-a: security fix found by the admin test: bans and sign-outs took up to 5 minutes

- **Cause:** design §4.4 enables better-auth's `session.cookieCache` (5 min). `getSession()` then trusts the signed cookie without reading the session table, so a banned user (or a revoked session) kept API access until the cached cookie expired. The test "ban → `/api/me` is 401" failed with 200.
- **Done:** `requireUser` calls `getSession({ query: { disableCookieCache: true } })`. Every protected API route queries the DB anyway, so the extra session lookup doesn't add a Neon wake-up; the cookie cache still serves the SPA's frequent `/api/auth/get-session` polls. Together with 2.2-a (banned users' API keys), a ban now cuts access immediately.

### 4.2-b: the page

- `/admin` (menu item only for `role = admin`; others are redirected to `/`) lists users (newest first, 100) with role switch, ban/unban and "set password". Everything goes through better-auth's admin plugin endpoints via `authClient.admin.*`; the server enforces the admin role (tested: a member gets 403 on `list-users` and `set-role`).
- An admin can't change their own role or ban themselves from the UI (the plugin would allow an admin to demote themselves and lock the instance out).
- No pagination/search yet: with the 100-user cap of Google OAuth test mode and self-host use, one page is enough.

## Task 4.3: MCP server `/mcp`

### 4.3-a: API key auth instead of saasmail's OAuth

- saasmail's `/mcp` uses the better-auth OAuth provider (discovery documents, JWT access tokens, scopes). The plan asks for API key auth, which Xiaozhi-style clients support by a static header; OAuth would add a provider plugin, JWKS and discovery routes for no requirement here.
- The key is accepted as `Authorization: Bearer <key>` (what MCP clients send) or `x-api-key`. The key check moved into `userFromApiKey()` in `src/api/auth.ts`, shared with `requireUser`, so bans (2.2-a) apply to MCP too.
- Same transport pattern as saasmail: stateless, a new `McpServer` + `StreamableHTTPTransport` per request.

### 4.3-b: tools

- `list_transactions({ direction?, orderId?, limit ≤ 50 })`: the owner's transactions, newest first (bank, direction, amount, description, order code, payer name, time).
- `get_payment_status({ orderId, amount? })`: sums **incoming** transfers with that order code; `paid` is true when any exist, or, with `amount`, when the sum covers it (a customer may pay in two transfers). Order codes are matched uppercase like ingest stores them.
- Both are read-only (`readOnlyHint`). Tests call them over JSON-RPC through `/mcp` and check another user's order is invisible.

### 4.3-c: routing

- The route is registered with the API routes, before the SPA fallback (plan's note). The Worker's `assets.run_worker_first` now lists `/mcp`, otherwise Cloudflare would serve `index.html` for it; the Bun server's SPA fallback skips `/mcp` too.
- Not tried with MCP Inspector or Xiaozhi by the agent (user checklist).

### 4.3-d: API keys page (gap from P2)

- README's P2 scope lists "API keys", but no P2 task built a UI for them; better-auth's endpoints existed but users had no way to create a key for the REST API or `/mcp`.
- Added `/api-keys`: list (name, first characters, created), create (key shown once in the same one-time dialog as secrets), delete. It calls the plugin's own endpoints through `authClient.apiKey.*`. The better-auth client helper `authCall()` moved to `web/lib/auth.ts` (used by admin and API keys pages).
- Manual check on the Bun server + Postgres: key created through `/api/auth/api-key/create`, `/mcp` `initialize` and `get_payment_status` answered (`paid: true, totalAmount: 149000` for a real ingested order), no key → 401.

## Task 4.4: Gmail OAuth (optional)

### 4.4-a: tokens through better-auth's `linkSocial`, Gmail REST API with plain `fetch`

- **Plan:** `gmail.readonly`, `users.watch` with Pub/Sub, renew by cron, `history.list`, `messages.get(format=raw)` → `ingestRawEmail` (learn from inbox-zero).
- **Done:** the OAuth dance is better-auth's `linkSocial({ provider: 'google', scopes: [gmail.readonly] })`; the token lives in its `account` table and `auth.api.getAccessToken({ accountId, userId })` refreshes it. No second OAuth implementation, no `googleapis` package (Node-only, huge); the few Gmail REST calls are `fetch` through `deps.fetch`, so it runs on Workers and is testable with a fake API.
- Google provider: `accessType: 'offline'` (refresh token) and `account.accountLinking.allowDifferentEmails: true` (the watched Gmail may differ from the sign-in email). Linking only happens from a signed-in session.

### 4.4-b: ownership and connection

- `POST /api/gmail/connect/:id` (after Google redirects to `/?connect=<id>`) tries each linked Google account, reads `users/me/profile`, and connects the one whose address equals the config's Gmail (Gmail normalization). That proves ownership like a DKIM-valid email does for the other sources. It stores `google_account_id` (better-auth `account.id`), Gmail's own spelling of the address (Pub/Sub notifications are looked up by it), starts `users.watch`, and stores `gmail_history_id` and `gmail_watch_expires_at`.
- `users.watch` is registered **without label filters** (inbox-zero watches INBOX+SENT): user filters may move bank mail out of INBOX (same reason IMAP opens "All Mail"). Extra notifications are cheap: `history.list` with `historyTypes=messageAdded`.

### 4.4-c: notifications

- `POST /api/gmail/pubsub?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>` (public; token check like inbox-zero). It decodes `{ emailAddress, historyId }`, then per connected config: `history.list` from the stored id → for each added message a `format=metadata` read of `From`; **only bank senders are downloaded** (`format=raw`) and ingested. Other mail is never fetched in full.
- A 404 on `history.list` (history id too old, e.g. after a long outage) falls back to `messages.list q=from:(banks) newer_than:1d`; `message_id` dedupe makes re-ingesting harmless.
- Processing happens inside the push request: errors return 5xx so Pub/Sub redelivers; unknown addresses and malformed data are acknowledged (204).
- A token that can't be refreshed marks `ingest_error = gmail_auth_failed` (the card offers "Kết nối Gmail" again, which clears it).

### 4.4-d: renewal

- `runMaintenance` (hourly cron) re-watches connected configs whose watch expires within 24 h. It keeps the stored history id (the new watch's id would skip anything between them).

### 4.4-e: config and limits

- Env `GOOGLE_PUBSUB_TOPIC` (`projects/<project>/topics/<topic>`) + `GOOGLE_PUBSUB_VERIFICATION_TOKEN`; requires Google sign-in to be configured. `/api/config` reports `gmailOAuth` so the SPA only offers it then. Migration `0004` adds the enum value and three columns.
- As the design says, `gmail.readonly` is a restricted scope: until Google verification/CASA, the consent screen shows the "unsafe" warning and only test users (max 100) can connect.
- Known rough edges (`ponytail`): after creating a Gmail OAuth config the page leaves for Google immediately, so the one-time webhook secret isn't shown (rotate it from the card); if Google doesn't return a refresh token (account consented offline access before), the token stops working after an hour and the card asks to reconnect.
- Tests: fake Gmail API: connect picks the owning account / mismatch error; push with wrong token → 403; only bank mail downloaded and stored; history id advanced; stale history → fallback; renewal keeps the history id. Not tried against real Google (user checklist).

---

# Wrap-up

## Final ponytail review (all phases)

- Removed the unused `GMAIL_SCOPE` constant (the SPA keeps its own copy of the scope string; it can't import server code).
- `GmailError`, `Outcome`, `SessionUser` no longer exported (used only in their own files).
- README: optional features table (Google sign-in, Web Push, Gmail OAuth with the Pub/Sub setup steps, API keys/MCP), `bun run e2e`; `.env.example` and `docker-compose.yml` pass the new optional variables.

## Left to the user (needs real accounts, devices or money)

Tracked in the reply to the user and README "Next steps": Cloudflare/Neon deployment and the Task 1.13 spike (Apps Script `getRawContent()` DKIM, Workers CPU time), pushing to GitHub for CI, a real transfer, IMAP with an App Password (including reconnect after a network drop), a Web Push notification in a real browser, an MCP client, VietQR scan with a banking app, and the Gmail OAuth + Pub/Sub flow.

---

# Post-plan changes (user requests, 2026-09-24)

## UI redesign, logo, docs page, integration prompt, 2-Step Verification link

### What was asked

Link to Google's 2-Step Verification in the IMAP form (App Passwords need it; the user hit "setting not available"), API docs in Markdown shown in the UI, a prompt that makes a coding agent integrate PayMailHook into another app, a logo, and a more professional UI.

### Decisions

- **Docs live in `docs/api.md` and `docs/integration-prompt.md`** (English, per CLAUDE.md's documentation rule; the UI chrome stays Vietnamese). The SPA imports them with `?raw` and renders them with `marked` + `@tailwindcss/typography` at `/docs` (tabs "Tài liệu API" / "Prompt tích hợp", copy button). One source for GitHub and the app. Placeholders like `https://<your-paymailhook>` are replaced with the instance's origin in the UI so copied snippets work. The old Vietnamese `/guide` page is replaced (`/guide` redirects). `test/docs-sample.test.ts` keeps the webhook payload in `api.md` identical to `buildPayload()` (replaces `web/lib/webhook-sample.ts`).
- **Found while writing the docs:** API keys over their rate limit answered `401`; now `429` with `Retry-After` (REST and `/mcp`), tested. Separate commit.
- **Integration prompt** makes the agent: study the codebase first; ask for the values it can't infer (URL, webhook secret, prefix, bank account, API key); implement payment codes (A–Z0–9 only), payment instructions with the `/api/qr` VietQR image, a raw-body Standard Webhooks receiver with `webhook-id` idempotency, row-locked amount matching (partial/over-payment policy asked, not guessed), an optional status-check fallback over the REST API honouring `429`, tests; then give the user a post-merge checklist ("Gửi thử", real small order) and a report.
- **Design** (frontend-design skill): subject-driven choices rather than template defaults:
  - Typeface **Be Vietnam Pro** (designed in Vietnam, full diacritics), self-hosted via `@fontsource` (no CDN for self-host), one family; `tabular-nums` for amounts.
  - Palette: jade `#0E6E5C` (brand and money in), ink `#10212B`, receipt-paper canvas `#F3F6F5`, highlighter `#F2B705` used only for order codes (`<OrderCode>`), rust `#C2410C` for errors/money out.
  - Layout: left sidebar with icons (scrolling tab bar on phones), `PageHeader` (title, one-line purpose, primary action), tables on white cards over the canvas, `EmptyState` that says what to do next. Public pages (docs, privacy, share links) share `PublicShell`.
  - The one bold element: the sign-in page's brand panel shows a balance notification (`+149.000 đ`, `PMH123456` highlighted) turning into "webhook sent: order paid", which is what the product does.
  - Avoided on purpose: all-caps eyebrows, middle-dot meta strings, gradient washes, identical shadowed cards.
- **Logo:** an envelope (the bank's notification email) stamped with a yellow tick badge (paid) on a jade tile; `web/public/logo.svg` (favicon, `theme-color`) and `<LogoMark>`/`<Logo>` components. A first draft read as a checkbox at large size and was redrawn with a visible envelope flap and a badge.
- **Accessibility:** delivery rows keep click-to-open but gained a "Chi tiết" button so the detail opens from the keyboard; the SVG logo has a `<title>`.
- Checked with headless-Chrome screenshots (sign-in, Kết nối, Giao dịch, Tài liệu) on the E2E server with demo data; E2E selector updated for the renamed page title.

## Sign-in like payhook.codes, icon-only sign-out, docs inside the dashboard (2026-09-24)

- **Reference:** payhook.codes' `/login` and `/register` (viewed with headless Chrome; no browser MCP was connected): sign in with a username and password, an "or" divider and "Sign in with Google"; register with username, email, password.
- **Done:** better-auth's `username` plugin (migration `0005`: `user.username` unique, `display_username`). The sign-in field accepts **a username or an email** (an `@` routes to `signIn.email`, otherwise `signIn.username`), so accounts created before the change keep working with their email. Sign-up asks for username (3–30 of `A-Z a-z 0-9 _ .`), email and password; the username is also the display name. Google button with Google's "G" mark on both pages when Google sign-in is configured; better-auth error codes are translated.
- **Kept stricter than payhook:** minimum password length stays 8 (better-auth's default), not payhook's 6.
- **Security:** `/sign-in/username` gets the same rate-limit rule as `/sign-in/email` (5/min per client IP); otherwise it would be an unthrottled password-guessing path.
- The brand panel's "open source / self-host" footnote was removed (user request); the panel content is centred with `my-auto`.
- Sign-out is an icon button with `aria-label`/`title` ("Đăng xuất") on desktop and mobile.
- `/docs` moved into the signed-in layout (sidebar item like the other sections) instead of a separate public page; public pages (privacy, share links) no longer link to it. The Markdown source stays in `docs/` for GitHub readers.
- Tests: HTTP sign-up with a username, sign-in with username and with email, wrong password 401, duplicate username 400; E2E fills the new field.

## Landing page, /dashboard, motion, password change, QR banks (2026-09-25)

- **Landing page at `/`**, modelled on payhook.codes' information architecture (viewed with headless Chrome): header with section links and **Đăng nhập / Tạo tài khoản**, hero with **Tạo tài khoản / Xem tài liệu tích hợp**, features, how it works (a real 4-step sequence, so numbered) with use cases, FAQ accordion, final call to action, footer (docs, privacy, GitHub issues for support, since there is no support mailbox). Own visual language (features as an icon list, not six identical cards). No "open source" line, per the earlier request.
- **Routes:** the dashboard moved to `/dashboard/*` (as on payhook). Updated every internal target: sign-in redirect, Google `callbackURL`, Gmail OAuth `callbackURL`, push notification URL (`/dashboard/transactions`), admin/API-key links. `/docs` is public again for the landing page's button (wrapped in `PublicShell`); `/dashboard/docs` is the same content inside the dashboard.
- **Motion** (skill `ui-motion`, principles only: it targets framer-motion, which isn't worth a dependency here). CSS keyframes in `@theme`, one easing curve (`--ease-silk`), all disabled with `motion-reduce:animate-none`:
  - `animate-arrive`: the landing hero plays the product once: bank email → DKIM valid → webhook `200 OK`.
  - `animate-live`: a slow pulse next to "Đang cập nhật" on transactions (the page really polls every 5 s).
  - `animate-fresh`: a transaction that arrived while the page was open fades from highlight yellow; the first load and filter switches don't flash (ids seen are tracked per filter).
  - Not added: button press (shadcn's `active:translate-y-px` already exists), dialog/toast (already animated), anything on amounts in the dashboard (data must read instantly).
- **Password change:** account dialog (sidebar/mobile bar) using better-auth `changePassword` with "sign out other devices" on by default; a Google-only account gets a clear message instead of an error code (`AuthError` now keeps better-auth's `code`). Test: new password works, old one fails, the other device's session is revoked.
- **QR:** `/api/qr` and the page accept only CAKE and Timo (derived from `BANKS`): a QR for another bank would send money PayMailHook never sees. The test uses a real bank key (`vietcombank`) to prove the restriction.
- **Push toggle** is an icon button (`Bell`/`BellOff`, `aria-pressed`, tooltip).
- **Google sign-in button** still only shows when `GOOGLE_CLIENT_ID/SECRET` are configured; the running instance has none.

## Auth links, selects, QR button, webhook URL help (2026-09-25)

- Sign-in/sign-up: only "Đăng ký ngay" / "Đăng nhập ngay" is a link; "Chưa có tài khoản?" is plain text. The logo on both pages links back to the landing page, and signing out returns to the landing page (`/`) instead of the sign-in form.
- `Select` defaults to Radix `position="popper"`: lists always drop down below the trigger. The previous `item-aligned` default centred the list on the selected item, so it opened both up and down.
- QR page: a "Tạo mã QR" submit button builds the image; typing no longer requests a new QR on every keystroke.
- Webhook URL: the user supplies it (an endpoint on their own system that PayMailHook calls); PayMailHook only issues the `whsec_` secret. The add-Gmail form now says so and that it can stay empty (dashboard, push notifications and share links still work), with a link to the integration docs.

## IMAP push latency fix (2026-09-25)

- **Symptom:** real CAKE transfers took 1 to 6.5 minutes to appear, although Gmail's INTERNALDATE showed each email arrived 1–4 s after the bank's time.
- **Cause:** `session()` took `getMailboxLock()` at connect and held it for the whole connection. imapflow treats a held lock as "busy" (`connectionBusy()` in `imap-flow.js`) and never starts auto-IDLE, so Gmail never pushed `EXISTS`; new mail only surfaced with imapflow's periodic keepalive NOOP (about every 5 minutes) or a restart. The earlier transfers were processed exactly 5 minutes apart.
- **Fix:** select the mailbox with `mailboxOpen()` and take the lock only around each scan. After 15 s of inactivity imapflow starts IDLE and Gmail pushes new mail immediately.
- **Checked:** unit test (the lock count is 0 between scans; failed before the fix) and against real Gmail: lock held for the session → `idling: false` after 18 s; lock only during the scan → `idling: true`.

## Banks per Gmail (2026-09-25)

- **Request:** let users say which bank notifies each Gmail (CAKE to one inbox, Timo to another).
- **Done:** `email_configs.banks bank[] NOT NULL DEFAULT '{CAKE,TIMO}'` (migration `0006`; existing configs keep both). API `POST`/`PATCH` accept `banks` (at least one of `CAKE`/`TIMO`, deduplicated); responses include it. Ingest answers `ignored` for a bank the config isn't set up for, so another config can own that bank's mail. UI: a bank checkbox group at the top of the add form and on each card, plus bank badges on the card.
- **Filtering stays server-side:** Apps Script, IMAP and Gmail OAuth still look for every supported sender. Baking the selection into `Code.gs` would silently miss a bank added later until the user re-pasted the script; with server-side filtering a change applies immediately.
- Tests: ingest ignores an unselected bank; API defaults to both, stores a choice, edits it, rejects `[]` and unknown banks. E2E ticks CAKE.
