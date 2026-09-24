# PayMailHook

Accept bank transfers automatically by reading your bank's **balance-notification emails**, then fire a **webhook** to your system when the transfer description contains an order code. Feature parity with [payhook.codes](https://payhook.codes). Open source, with two ways to use it: **Hosted** (a shared free instance on Cloudflare) and **Self-host** (Docker on your own machine).

> **Status:** P1 (core pipeline), P2 (accounts, dashboard) and P2.5 (self-host) are implemented. Not yet verified end to end on a real Gmail + Cloudflare deployment. Research: [docs/research.md](docs/research.md). Design: [docs/design.md](docs/design.md).

Supported banks: **CAKE by VPBank** and **Timo**.

---

## How it works

```
Bank ──► user's Gmail
                 │
                 ├─ Hosted:    Apps Script (1-minute trigger) ── POST /api/ingest (Bearer token) ───┐
                 ├─ Self-host: container connects via IMAP IDLE (App Password) ─────────────────────┤ raw MIME
                 └─ (later)    Gmail OAuth + Pub/Sub, optional 1-click like payhook ────────────────┘
                                                                                                    ▼
  1. resolve the email config (via token / IMAP account)
  2. verify DKIM (d= matches the bank domain) + To header = the config's Gmail
  3. parse per bank → { amount, direction, description, bankTxnId?, occurredAt }
  4. store transaction (unique Message-ID)
  5. description contains <PREFIX><orderId>? ──► create delivery ──► scheduleDelivery()
                                                                                                    ▼
        sign with Standard Webhooks ──► POST to the user's webhook URL
        retry 10s,10s,20s,30s,50s,1h,2h,4h,8h ──► failed
```

| | Hosted | Self-host |
|---|---|---|
| Email intake | Apps Script in the user's Gmail | IMAP IDLE, the container connects outbound (no public URL needed) |
| Runtime | Cloudflare Workers + Queues + Cron, Neon Postgres | Docker compose: Bun server + Postgres |
| Cost | Free, no domain needed (`*.workers.dev`) | Free |

## Getting started

Both modes need two random secrets. Generate each with `openssl rand -base64 32`:

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | Signs session cookies |
| `ENCRYPTION_KEY` | AES-GCM key for webhook secrets, IMAP App Passwords and failed raw emails. **Changing it makes those unreadable.** |

Optional: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (both or neither) to enable "Continue with Google"; the OAuth redirect URI is `<BETTER_AUTH_URL>/api/auth/callback/google`. `ALLOW_SIGNUP=false` closes registration (sign up your own account first: the **first account becomes admin**).

### Self-host (Docker)

```bash
cp .env.example .env        # fill BETTER_AUTH_SECRET and ENCRYPTION_KEY
docker compose up -d        # Postgres + app; migrations run on startup
```

Open http://localhost:3000 and sign up. For a public host, set `BETTER_AUTH_URL` to its URL (for example `https://pay.example.com`) and put the app behind HTTPS.

Two ways to feed emails in:
- **IMAP (recommended for self-host):** turn on 2-step verification for the Gmail account, create an App Password at https://myaccount.google.com/apppasswords, then add the Gmail with the IMAP option. The container connects out to `imap.gmail.com`, so no public URL is needed.
- **Apps Script:** needs the app reachable from the internet, because Google's servers post to `/api/ingest`.

Self-host allows webhooks to private addresses (LAN, `http://`) by default: `ALLOW_PRIVATE_WEBHOOKS=true`.

### Hosted (Cloudflare Workers, free tier)

Requirements: a Cloudflare account and a [Neon](https://neon.tech) Postgres database. Commands use `npx wrangler` (Node ≥ 22); with an older Node, run `bun node_modules/wrangler/bin/wrangler.js` instead.

1. **Database.** Create a Neon project and copy its connection string. Apply the migrations:
   ```bash
   DATABASE_URL='postgres://…neon.tech/neondb?sslmode=require' bunx drizzle-kit migrate
   ```
2. **Log in:** `npx wrangler login`.
3. **Hyperdrive** (connection pooling in front of Neon):
   ```bash
   npx wrangler hyperdrive create paymailhook --connection-string='postgres://…neon.tech/neondb?sslmode=require'
   ```
   Put the returned id into `wrangler.jsonc` → `hyperdrive[0].id`.
4. **Queue** for webhook retries: `npx wrangler queues create paymailhook-deliveries`.
5. **URL.** In `wrangler.jsonc`, set `vars.BETTER_AUTH_URL` to `https://paymailhook.<your-subdomain>.workers.dev` (your subdomain is shown in the Cloudflare dashboard under Workers).
6. **Secrets:**
   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put ENCRYPTION_KEY
   # optional: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOW_SIGNUP (as a var)
   ```
7. **Deploy:** `bun install && bun run deploy`.
8. Open the Worker URL, sign up (you become admin), add your Gmail, and paste the generated Apps Script into https://script.google.com with that Gmail account, then run `setup()` once.

The hourly cron re-queues stuck deliveries and deletes old logs; nothing else needs scheduling.

### Development

```bash
bun install
cp .env.example .env                    # DATABASE_URL points at a local Postgres
bun run db:migrate
bun run dev                             # API on :3000 (PORT to change), with IMAP listeners
bun run dev:web                         # SPA on :5173, proxies /api to API_URL (default http://localhost:3000)
bun run check                           # Biome + tsc + bun test (PGlite, no database needed)
bun run build:worker                    # SPA build + Worker bundle dry run
```

`scripts/create-config.ts <gmail> <webhookUrl>` creates a config without the dashboard; `scripts/anonymize-fixtures.ts` rebuilds `test/fixtures/` from local real emails.

## Receiving webhooks

Each matched incoming transfer is POSTed to your URL as a [Standard Webhooks](https://www.standardwebhooks.com/) request (`webhook-id`, `webhook-timestamp`, `webhook-signature`), signed with the `whsec_…` secret shown when the config is created. Verify it with an official `standardwebhooks` library, dedupe by `webhook-id`, check both `orderId` and `amount`, and answer 2xx within 10 seconds. Payload and retry schedule: [design §3](docs/design.md#3-webhook-delivery-).

## Scope (full payhook feature set, split into phases)

| Phase | Features |
|---|---|
| **P1 Core** | `POST /api/ingest` and Apps Script, DKIM verification, CAKE and Timo parsers, transaction storage, order-code matching, webhook delivery (signing, retry, 30-day logs, SSRF protection) |
| **P2 Accounts** | Sign-up/sign-in (email+password, Google), email config CRUD, Apps Script generator page with the token pre-filled, "last email received" status, token and webhook secret rotation, API keys |
| **P2.5 Self-host** | Docker compose, email intake via IMAP IDLE, webhook retry via in-process timers |
| **P3 Dashboard** | Realtime transactions, webhook logs and manual retry, QR generation (VietQR), shareable transaction links, integration guide page, Privacy page |
| **P4 Extensions** | Web Push, admin (user management, roles), MCP server (Xiaozhi AI), **Gmail OAuth** (optional 1-click, shows the "unsafe" warning until CASA is passed) |

## Decisions

| # | Decision | Alternatives considered | Rationale |
|---|---|---|---|
| D1 | Roadmap: personal use first, SaaS later, but **full-featured and multi-tenant from day one** | Minimal MVP | The goal is parity with payhook. Retrofitting a multi-tenant schema later is very costly |
| D2 | Email intake: **Apps Script** (Hosted), **IMAP IDLE** (Self-host), **Gmail OAuth** as an option in P4. Every path feeds raw MIME into the same core function | Gmail auto-forward + Email Worker; OAuth only | Forwarding requires a domain and many setup steps. `forwardingAddresses.create` is Workspace-only. OAuth with `gmail.readonly`/`settings.basic` is a restricted scope ("unsafe" warning, max 100 users, CASA). Apps Script runs as the user, so Google does not require verification. IMAP works on localhost because it only connects outbound |
| D3 | Banks: CAKE and Timo | | Real sample emails are available for both |
| D4 | Hosted runs on Cloudflare Workers (free). Self-host runs Bun in Docker. The **core is plain TS**, shared by both | Vercel Hobby | Vercel Hobby forbids commercial use, cron runs only once a day, and there is no queue. Workers free tier has 100k requests/day, Queues and Cron |
| D5 | Dedup key is `Message-ID` (covered by the DKIM signature) | `transactionId` | Timo emails have no transaction ID |
| D6 | Anti-spoofing and anti-replay: DKIM pass with `d=cake.vn`/`timo.vn` **and** `To` must be the registered Gmail | Read `Authentication-Results`, match the account number | The `Authentication-Results` header can be forged. Timo has no account number. Both banks sign `To` |
| D7 | Postgres (Neon) via **Hyperdrive + postgres.js**, Drizzle ORM | Cloudflare D1 | The same driver runs on Workers and Bun, with transactions. Switching hosts needs no migration |
| D8 | One package, **one Worker** serving both API and SPA (assets + `run_worker_first`) | Monorepo, multiple Workers (react-starter-kit) | Fewer moving parts. Boundaries are enforced by directories, no need to split packages |
| D9 | Frontend: React + Vite SPA, React Router, TanStack Query, shadcn/ui, Tailwind | Next.js | Deployed in the same Worker, like payhook and saasmail. Next.js on Workers requires OpenNext |
| D10 | API: Hono + zod-validator, frontend uses `hono/client` for types | tRPC, zod-openapi | End-to-end types without an extra layer |
| D11 | Auth: **better-auth** (email+password, Google requesting only `openid email`, admin plugin, api-key plugin) | Hand-rolled JWT | Roles and API keys out of the box. Google Login does not require CASA |
| D12 | Webhooks follow **[Standard Webhooks](https://www.standardwebhooks.com/)**: `webhook-id`, `webhook-timestamp`, `webhook-signature`, secret `whsec_…` | Custom `X-Payhook-*` headers | Receivers get ready-made verification libraries in every language, with secret rotation support |
| D13 | Retry schedule 10s,10s,20s,30s,50s,1h,2h,4h,8h, state stored in the DB. `scheduleDelivery()` has 2 implementations: **Cloudflare Queues** (Hosted) and **in-process timers + rescan on startup** (Self-host). An **hourly** cron re-enqueues stuck deliveries. Only 2xx counts as success, `redirect: 'manual'` | Separate DLQ queue, Svix, 5-minute cron | One retry schedule for both deployments. A 5-minute cron would keep Neon awake 24/7 (about 180 CU-hours, over the free 100) |
| D14 | Tests with **`bun test`** plus **PGlite**. No `vitest-pool-workers`/`wrangler dev` | vitest-pool-workers (saasmail) | The dev machine has glibc 2.31 and cannot run `workerd`. The core is plain TS, so testing on Bun is enough |
| D15 | Do not store raw email. Store only parsed fields; raw MIME is kept only on **parse failure** (encrypted, 7 days) to help write new parsers | Store everything (saasmail) / store nothing | Privacy on par with payhook, while still debuggable when a bank changes its template |
| D16 | Lint/format: Biome | oxlint/Prettier | Team convention |
| D17 | Run **entirely on free tiers**: Workers, Queues (10k operations/day), Hyperdrive (100k queries/day), Neon (0.5GB, 100 CU-hours) | Paid plans | The goal is open source and free. Risk: the 10ms CPU limit per invocation during DKIM verification and parsing, needs measuring |

## Stack

TypeScript · Bun · Hono · Drizzle · Postgres (Neon + Hyperdrive) · better-auth · Cloudflare Workers / Queues / Cron · Google Apps Script · `imapflow` (Self-host) · React · Vite · TanStack Query · shadcn/ui · `mailauth` (DKIM verification over DNS-over-HTTPS) · `postal-mime` · `vietnam-qr-pay` · Biome

## Directory layout

```
src/
  core/          # plain TS, no Cloudflare imports: banks (parsers), dkim, ingest, webhook, maintenance, auth, env
    db/          # Drizzle schema (pg-core), driver-agnostic Database type, startup migrator
  api/           # Hono app (depends only on core)
  imap.ts        # Self-host IMAP IDLE listeners
  worker.ts      # Hosted entry: fetch, queue, scheduled
  server.ts      # Self-host/dev entry: Bun server + IMAP + retry timers + SPA
apps-script/     # Code.gs template users paste into Gmail
web/             # React SPA (Vite, shadcn/ui)
migrations/      # drizzle-kit
scripts/         # dev helpers (create-config, anonymize-fixtures)
test/            # bun test + PGlite; fixtures/ are anonymized bank emails (real ones stay in gitignored mail-template/)
```

## Next steps

- [x] Detailed design: [docs/design.md](docs/design.md) (schema, email intake flow, webhooks, API/auth, testing)
- [x] Implementation plan: [docs/plans/2026-09-24-paymailhook.md](docs/plans/2026-09-24-paymailhook.md); deviations and their reasons: [docs/plans/2026-09-24-paymailhook-deviations.md](docs/plans/2026-09-24-paymailhook-deviations.md)
- [x] P1 core pipeline, P2 accounts and dashboard, P2.5 self-host
- [ ] Spike on a real deployment: does Apps Script's `getRawContent()` pass DKIM; CPU time per ingest on Workers (10 ms free limit)
- [ ] P3 dashboard extras, P4 extensions
