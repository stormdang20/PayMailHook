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
