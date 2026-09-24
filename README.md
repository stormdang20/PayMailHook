# PayMailHook

Accept bank transfers automatically by reading your bank's **balance-notification emails**, then fire a **webhook** to your system when the transfer description contains an order code. Feature parity with [payhook.codes](https://payhook.codes). Open source, with two ways to use it: **Hosted** (a shared free instance on Cloudflare) and **Self-host** (Docker on your own machine).

> **Status:** in design, no code yet. Research details are in [docs/research.md](docs/research.md).

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

## Directory layout (planned)

```
src/
  core/          # plain TS, no Cloudflare imports: dkim, parsers/{cake,timo}, match, webhook-sign, services
    db/          # Drizzle schema (pg-core), driver-agnostic Database type
  api/           # Hono app (depends only on core)
  worker.ts      # Hosted entry: fetch, queue, scheduled
  server.ts      # Self-host/dev entry: Bun.serve + IMAP listener + retry timers
apps-script/     # Code.gs for users to paste into Gmail
web/             # React SPA
migrations/      # drizzle-kit
test/fixtures/   # anonymized .eml files (original mail-template/ is in .gitignore)
```

## Next steps

- [x] Detailed design: [docs/design.md](docs/design.md) (schema, email intake flow, webhooks, API/auth, testing)
- [ ] Implementation plan: [docs/plans/2026-09-24-paymailhook.md](docs/plans/2026-09-24-paymailhook.md)
- [ ] Spike: does Apps Script's `getRawContent()` return raw content identical to "Download original"; measure CPU time on Workers
