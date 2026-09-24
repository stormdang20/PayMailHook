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
