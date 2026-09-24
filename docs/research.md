# Research notes

This document collects what we learned from payhook.codes, real sample emails, open-source repos and spikes. The resulting decisions are recorded in the [README](../README.md#decisions).

## 1. payhook.codes

Gathered from the JS bundle and the public guide pages.

- **Gmail connection:** Gmail OAuth with the `gmail.readonly` scope, calls `users.watch` and receives Pub/Sub push. The watch expires after 7 days, so they run a scheduler that renews it. The app is not verified by Google.
- **Order matching:** a webhook fires only when the transfer description contains `PAYHOOK{orderId}`.
- **Payload:** `event: "transaction.detected"`, `orderId`, `transaction{transactionId, bank, amountVND, description}`.
- **Signature:** `X-Payhook-Signature` (HMAC-SHA256) and `X-Payhook-Timestamp`. Each config has its own secret, shown only once.
- **Retry:** 5 attempts on a Fibonacci schedule (10s, 10s, 20s, 30s, 50s), then into a DLQ with retries after 1h, 2h, 4h, 8h. Logs are kept 30 days. The receiving endpoint must respond within 10s.
- **SSRF protection:** HTTPS and a domain are required; no IP/localhost/internal IPs; ports 80/443 only.
- **API:** `/api/auth/{login,register,refresh,google}`, `/api/email-configs` (CRUD, `send-test-email`), `/api/transactions`, `/api/webhook-logs`, `/api/users` (role, `me/api-key`), `/api/push/*`, `/api/qr/img`, `/api/share/transactions`, plus MCP/Xiaozhi pages.

## 2. Email format (from `mail-template/`, gitignored)

| | CAKE | Timo |
|---|---|---|
| Sender | `no-reply@cake.vn` (sent via Amazon SES) | `support@timo.vn` |
| DKIM | `d=cake.vn` and `d=amazonses.com`, `To` is signed | `d=timo.vn`, 1024-bit RSA key, `To` is signed, DMARC `p=QUARANTINE` |
| Body | HTML only, label/value table, **one template for both incoming and outgoing** | HTML only, prose sentences |
| Amount, direction | `Số tiền: +149.000 đ` / `-149.001 đ` | `vừa tăng/giảm 2.570.000 VND` |
| Transaction ID | `Mã giao dịch` | **None** |
| Account number | The row containing `- Tài khoản thanh toán` is our own account; the counterparty account is masked (`123456***7890`) | **None** |
| Time | `20/09/2026, 18:30:57` | `16/09/2026 09:49` |
| Transfer description | `Nội dung giao dịch` (e.g. `PAYHOOK123456`, kept as-is) | `Mô tả:` (the sending bank may insert a prefix, e.g. `MBVCB.<ref>.<description>…`) |
| Balance | None | `Số dư hiện tại` |

Order IDs should use only `[A-Z0-9]` and are found by regex anywhere in the description.

## 3. Spike: DKIM verification

- **Approach:** use `mailauth/lib/dkim/verify` (**not** the `mailauth` entry) with a DNS-over-HTTPS resolver (`cloudflare-dns.com/dns-query`). Bundling for Workers succeeds (`wrangler deploy --dry-run`), about 467KB gzipped.
- **The main `mailauth` entry does not bundle:** it pulls in `undici`, which imports `node:sqlite`.
- **CAKE result:** pass (`cake.vn` and `amazonses.com`).
- **Timo result:** fails on the downloaded file, and `dkimpy` gives the identical result. **Cause:** Timo sends email without a `Date` header, and Gmail adds `Date: … -0700 (PDT)` on receipt. Because DKIM `h=` signs `Date` in its empty state, the added header breaks the signature. With `Date` removed, all 4 samples pass.
  - **Handling:** if verification fails, retry once after removing the `Date` header. This is still safe because the system does not trust `Date`: the transaction time comes from the body, and the body is signed.
  - **Not yet verified:** whether email auto-forwarded to Cloudflare is identical to the downloaded file. Needs a spike on real Cloudflare.
- **Dev environment:** the dev machine has glibc 2.31 and cannot run `workerd` (needs ≥2.32), and wrangler needs Node ≥22. So local dev runs on Bun, and `wrangler deploy` only needs the bundle step.

## 4. Reference repos (`repo-ref/`, gitignored)

```bash
mkdir -p repo-ref && cd repo-ref
for r in dreamhunter2333/cloudflare_temp_email choyiny/saasmail cloudflare/agentic-inbox \
  kriasoft/react-starter-kit oiov/vmail elie222/inbox-zero byeokim/gmailpush \
  maingocanh1702/my-money-went-bot tomaj/bank-mails-parser nemorize/korean-banking-email-parser \
  svix/svix-webhooks frain-dev/convoy hookdeck/outpost xuannghia/vietnam-qr-pay \
  sepayvn/laravel-sepay nodemailer/mailparser postalsys/mailauth postalsys/postal-mime; do
  git clone --depth 1 "https://github.com/$r.git" &
done; wait
```

| Repo | ★ | What we learned | Caveats |
|---|---|---|---|
| **saasmail** | 253 | Closest stack: one Worker exporting `fetch`, `email`, `queue`, `scheduled`, using assets `run_worker_first`. Middleware chain injectDb → session or API key → role guard. MCP pattern uses `@hono/mcp` and wraps each tool in `guard(scope)`. `sk_` API keys stored as SHA-256. Web Push per the VAPID standard. Outbox-style retry using a conditional UPDATE | Single-tenant only, uses D1. Webhooks have no retry. No `onError`. DDL in tests is hand-copied, so it drifts from the real schema |
| **cloudflare_temp_email** | 11.8k | `email()` handler: parse once and cache; each side effect has its own try/catch; cron deletes old data in batches with `LIMIT`; tests use a fake `ForwardableEmailMessage` (`e2e/fixtures/mail-api.ts`) | Only reads `Authentication-Results`, which can be spoofed. Webhooks are called inline, no retry |
| **agentic-inbox** | 8k | `email()` handler caps at 25MB and **throws** on transient errors so Cloudflare retries (`setReject` bounces immediately) | Uses Durable Objects and R2, not a fit for Postgres |
| **react-starter-kit** | 23.7k | Separates a runtime-agnostic Hono app (`lib/app.ts`) from `worker.ts` and `dev.ts`. Uses Neon via Hyperdrive with `postgres(max:1)`. Driver-agnostic `Database` type. DB tests use PGlite running real migrations. `secrets.required` in wrangler | Split into 3 Workers, tRPC, Terraform: too heavy for us |
| vmail | 1.5k | One Worker with SPA fallback. Fixed-window API key rate limiting | A code comment says `setReject` will retry, which is wrong |
| svix-webhooks | 3.4k | Signing scheme `id.ts.body` → `v1,<b64>`, max 5-minute timestamp tolerance, SSRF blocklist `is_allowed()`, `Retry-After` handling | Written in Rust, read-only reference |
| outpost / convoy | | `ScheduledBackoff` (fixed retry schedule), delivery state machine, log deletion by retention | Written in Go |
| inbox-zero / gmailpush | | Gmail `watch`, Pub/Sub, `history.list`, if OAuth is needed later | |
| my-money-went-bot | 5 | CAKE parser (`handlers/email_parser.py`) | Also handles manual forwards, which this system does not support |
| mailauth / postal-mime / mailparser | | DKIM/ARC verification, MIME parsing (postal-mime runs on Workers) | See section 3 |
| vietnam-qr-pay | 173 | VietQR encoding per EMVCo with CRC16 | |
| laravel-sepay | 24 | Webhook contract familiar in the VN market, dedupe by `id` | Throws on duplicates. We should tell receivers to return 2xx on duplicates |

## 5. Takeaways

- `message.setReject()` bounces the email permanently. On transient errors (e.g. DB down) you must **throw** so Cloudflare retries.
- Reading only `Authentication-Results` is not safe enough, since the header can be spoofed. DKIM must be verified cryptographically, with `d=` pinned to the bank's domain.
- Workers give no control over DNS or sockets, so DNS rebinding cannot be blocked. What we can do: validate the URL on save and before each send, optionally look up via DoH to block private IPs, and use `redirect: 'manual'`.
- Webhook secrets must be stored **encrypted** (AES-GCM with a Worker secret), not hashed, because the original secret is needed for signing.
- No repo handles Gmail's forwarding confirmation email (`forwarding-noreply@google.com`), so we have to build this ourselves.
- `/.well-known/*` and `/mcp` routes must be registered before the SPA catch-all route.
