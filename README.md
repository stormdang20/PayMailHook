# PayMailHook

**Turn Vietnamese bank notification emails into signed payment webhooks.**

PayMailHook reads balance-change emails from **CAKE by VPBank** and **Timo**, plus **PayPal** "money received" emails, verifies the bank's DKIM signature, stores transactions, and notifies your application when an incoming transfer contains an order code. Run it on your own server with Docker or deploy it to Cloudflare Workers.

**English** · [Tiếng Việt](README.vi.md)

[![CI](https://github.com/stormdang20/PayMailHook/actions/workflows/ci.yml/badge.svg)](https://github.com/stormdang20/PayMailHook/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

[Quick start](#quick-start-with-docker) · [Cloudflare deployment](#deploy-to-cloudflare-workers) · [API reference](docs/api.md) · [Report a bug](https://github.com/stormdang20/PayMailHook/issues)

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Choose a deployment](#choose-a-deployment)
- [Quick start with Docker](#quick-start-with-docker)
- [Deploy to Cloudflare Workers](#deploy-to-cloudflare-workers)
- [Connect an email source](#connect-an-email-source)
- [Configuration](#configuration)
- [Integrate payments](#integrate-payments)
- [Data and security](#data-and-security)
- [Operations and troubleshooting](#operations-and-troubleshooting)
- [Local development](#local-development)
- [Architecture and project layout](#architecture-and-project-layout)
- [Current limitations](#current-limitations)
- [Contributing](#contributing)
- [Documentation and license](#documentation-and-license)

## Features

- **Three email sources:** Gmail IMAP IDLE with an App Password, Gmail OAuth with Pub/Sub notifications, or Gmail forwarding through Cloudflare Email Routing.
- **Payment matching:** configurable order prefixes, incoming/outgoing transaction records, integer amounts in minor units with a currency (VND, or the PayPal currency), and duplicate detection by email `Message-ID`.
- **Signed webhooks:** Standard Webhooks headers, automatic retries, delivery history, test events, manual resend, and secret rotation.
- **Dashboard:** transaction search and filters, automatic refresh every five seconds while the transaction page is visible, email connection status, and webhook logs. The current UI is in Vietnamese.
- **Payment tools:** VietQR SVG generation for supported banks, revocable transaction links, and a public incoming-transactions view for cashiers.
- **Accounts and integrations:** email/password or username sign-in, optional Google sign-in, API keys, admin user management, optional browser Web Push, and a read-only MCP server.
- **Two runtimes, one core:** Bun with PostgreSQL for self-hosting; Cloudflare Workers, Hyperdrive, PostgreSQL, and Queues for managed infrastructure.

| Bank | Accepted sender | DKIM domain | Additional parsed fields |
| --- | --- | --- | --- |
| CAKE by VPBank | `no-reply@cake.vn` | `cake.vn` | Bank transaction ID; counterparty fields when present |
| Timo | `support@timo.vn` | `timo.vn` | Balance after the transaction |
| PayPal (money received only) | `service@intl.paypal.com` | `intl.paypal.com` | PayPal transaction ID; payer name; payer note as description; currency (`USD`…) |

Both parsers extract amount, direction, description, and transaction time. PayMailHook observes notification emails: it does not initiate transfers, hold money, or connect to a bank's payment API. Your application owns order records and decides whether a transfer satisfies an order.

## How it works

```mermaid
flowchart TD
    Bank[CAKE / Timo / PayPal] --> Gmail[Your Gmail inbox]
    Gmail --> IMAP[IMAP IDLE: Bun only]
    Gmail --> OAuth[Gmail API + Pub/Sub]
    Gmail --> Forward[Gmail forwarding + Email Routing]
    IMAP --> Verify[Verify sender, signed recipient, and bank DKIM]
    OAuth --> Verify
    Forward --> Verify
    Verify --> Parse[Parse bank email]
    Parse --> DB[(PostgreSQL: transactions and delivery state)]
    DB --> UI[Dashboard / REST API / MCP]
    DB --> Match{Incoming transfer with order code and webhook URL?}
    Match -->|Yes| Delivery[Queue or timer: sign, send, retry]
    Delivery --> App[Your application]
```

For a description such as `PMH123456`, the default prefix is `PMH` and the extracted `orderId` is `123456`. Matching ignores case and returns uppercase letters and digits. Incoming transfers without a matching code, and outgoing transfers, are still recorded but do not create payment webhooks.

The transaction and its delivery record are written in one database transaction. Workers schedules delivery through Cloudflare Queues; Bun uses timers and restores unfinished deliveries from PostgreSQL on startup. Hourly maintenance recovers overdue deliveries, renews Gmail watches, and removes expired diagnostic records.

## Choose a deployment

| | Docker / Bun | Cloudflare Workers |
| --- | --- | --- |
| Application | Long-running Bun server | Worker serving API and built SPA |
| Database | PostgreSQL 17 included in Compose | PostgreSQL through Hyperdrive, for example Neon |
| Email sources | IMAP, Gmail OAuth, forwarding | Gmail OAuth, forwarding |
| Delivery scheduling | Timers with persisted state | Cloudflare Queues with persisted state |
| Maintenance | Hourly interval | Hourly Cron Trigger |
| Public application URL | Needed for OAuth push and forwarding relay; IMAP can run locally | Worker URL or custom domain |
| Additional domain | Only for forwarding | Only for forwarding; OAuth can use the Worker URL |

Docker with IMAP is the shortest path for a personal installation. Infrastructure, domains, and provider usage may incur charges; this repository does not guarantee an always-free hosted service or a particular free-tier capacity.

## Quick start with Docker

You need Git, Docker with Compose, OpenSSL for generating secrets, and a Gmail inbox receiving supported bank notifications.

### 1. Clone and configure

```bash
git clone https://github.com/stormdang20/PayMailHook.git
cd PayMailHook
cp .env.example .env
openssl rand -base64 32
openssl rand -base64 32
```

Put the two different generated values into `.env` as `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. Keep `BETTER_AUTH_URL=http://localhost:3010` for a local installation. Compose supplies the container's database URL; the `localhost:5435` URL in `.env.example` is for running Bun directly.

### 2. Start the application

```bash
docker compose up -d --build
docker compose logs -f app
```

Open **http://localhost:3010** and register your account. The **first registered account becomes an administrator**. PostgreSQL data persists in the `pgdata` volume, and the app applies pending migrations on startup.

For a private installation, register the owner first, set `ALLOW_SIGNUP=false`, and run `docker compose up -d` again. For a public installation, set `BETTER_AUTH_URL` to its public HTTPS origin and configure a reverse proxy with TLS.

### 3. Connect Gmail and verify the flow

Follow [IMAP setup](#imap-docker--bun), select your banks and optional webhook URL, and save the `whsec_…` secret shown when the config is created. Use **Send test** to check the webhook receiver, then verify ingestion with a new bank notification. A test webhook uses sample data and does not prove that email intake works. Configs with no successfully ingested bank email are automatically removed after seven days.

## Deploy to Cloudflare Workers

You need Git, Bun, Node.js **22.12+** for the checked-in Wrangler/Vite tooling, OpenSSL, a Cloudflare account, and PostgreSQL reachable by Hyperdrive. [Neon](https://neon.tech/) is one option. Run commands from the repository root after cloning it.

### 1. Install dependencies and migrate

```bash
bun install --frozen-lockfile
cp .env.example .env
```

Set `.env`'s `DATABASE_URL` to your deployment database connection string, including its required TLS options, then run:

```bash
bun run db:migrate
bunx wrangler login
```

Workers does **not** apply migrations on startup. Apply new migrations before deploying an update that needs them.

### 2. Create Hyperdrive and the queue

Replace the example connection string with your own:

```bash
bunx wrangler hyperdrive create paymailhook \
  --connection-string='postgres://USER:PASSWORD@HOST/DATABASE?sslmode=require' \
  --caching-disabled
bunx wrangler queues create paymailhook-deliveries
```

Query caching is disabled here so authentication and payment queries see current database state. See Cloudflare's [Hyperdrive setup](https://developers.cloudflare.com/hyperdrive/get-started/) and [query caching documentation](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

Edit [wrangler.jsonc](wrangler.jsonc):

- Replace `hyperdrive[0].id` with **your** Hyperdrive ID. The checked-in value belongs to the project's deployment.
- Set `vars.BETTER_AUTH_URL` to `https://paymailhook.<your-subdomain>.workers.dev` or your custom origin.
- Keep the `HYPERDRIVE` and `QUEUE` binding names. If you rename the queue, update both producer and consumer names.
- Keep `ALLOW_PRIVATE_WEBHOOKS` set to `"false"` for a shared public instance.

### 3. Set secrets and deploy

Generate two separate values with `openssl rand -base64 32`, then enter them when prompted:

```bash
bunx wrangler secret put ENCRYPTION_KEY
bunx wrangler secret put BETTER_AUTH_SECRET
bun run deploy
```

If Wrangler offers to create the Worker while storing its first secret, use the Worker name configured in `wrangler.jsonc`. Optional credentials are also stored with `wrangler secret put`; ordinary settings belong in `vars`. A local `.env` file does not replace deployed Worker secrets.

### 4. Enable email intake

Configure [Gmail OAuth](#gmail-oauth-and-google-sign-in) or [forwarding](#gmail-forwarding). Workers cannot use the IMAP listener. Open your deployed origin, register the owner, and connect an inbox. The checked-in hourly Cron Trigger handles maintenance.

## Connect an email source

### IMAP (Docker / Bun)

1. Enable Google 2-Step Verification and create an [App Password](https://support.google.com/accounts/answer/185833) for the Gmail receiving bank notifications. Account or organization policy may restrict availability.
2. Add an email config with **IMAP**, that Gmail address, its 16-letter App Password, and the banks to process. Spaces in a copied App Password are accepted.
3. Optionally set your webhook URL and order prefix, then save the displayed webhook secret.

The server connects outbound to `imap.gmail.com:993` using TLS. No public callback or Google Cloud project is needed for this source. New or updated listeners are picked up within about a minute. The listener uses Gmail's All Mail mailbox when available and reconnects with backoff.

IMAP scans bank mail from the last day and skips messages received before the config was created. It is not a historical mailbox importer.

### Gmail OAuth and Google sign-in

**Google sign-in and permission to read Gmail are separate.** Basic sign-in needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; the Gmail source additionally needs Gmail consent and Pub/Sub.

Create a Google OAuth client of type **Web application** with this authorized redirect URI:

```text
<BETTER_AUTH_URL>/api/auth/callback/google
```

For local sign-in, for example: `http://localhost:3010/api/auth/callback/google`. Set both Google credentials and restart or redeploy. Basic sign-in uses identity scopes; Gmail access is requested when connecting an inbox.

To enable the Gmail source:

1. In the OAuth client's Google Cloud project, enable Gmail API and Pub/Sub API. Add `https://www.googleapis.com/auth/gmail.readonly` to consent configuration.
2. Create a Pub/Sub topic in that project and grant `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on it. See [Google's push setup](https://developers.google.com/workspace/gmail/api/guides/push).
3. Generate a token with `openssl rand -hex 32`. Set `GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/<topic>` and `GOOGLE_PUBSUB_VERIFICATION_TOKEN` to that token.
4. Create a **push subscription** with the endpoint below, publicly reachable over HTTPS. Keep the standard JSON envelope (payload unwrapping disabled). This implementation checks the query token; it does not require Pub/Sub OIDC authentication.

   ```text
   https://<your-host>/api/gmail/pubsub?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>
   ```

5. Restart or redeploy. Choose **Gmail OAuth** in the dashboard, select banks and an optional webhook URL, then authorize the Google account receiving bank mail.

PayMailHook obtains the address from Google and creates the config after authorization succeeds. Cancelling authorization creates no config. Reconnecting the same Gmail OAuth config preserves its settings and webhook secret. The connected Gmail can differ from the PayMailHook sign-in address.

While the OAuth app is in **Testing**, add the Gmail being connected to **Google Auth Platform → Audience → Test users**. Basic sign-in working does not prove Gmail authorization is allowed. External Testing apps requesting Gmail scopes receive refresh tokens expiring after seven days. See [Google's verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) and [token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

`gmail.readonly` grants mailbox read access and is a **restricted scope**. The code filters sender metadata before downloading raw bank messages, but the permission itself is not limited to bank emails. Public deployments must account for applicable Google verification and security-assessment requirements; setting credentials does not mean the app is verified. See [Gmail scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes).

### Gmail forwarding

This source needs a domain with Cloudflare Email Routing. It does not need Gmail OAuth credentials or an App Password.

1. Enable Email Routing on your inbound domain and set `INBOUND_EMAIL_DOMAIN`, for example `in.example.com`.
2. For Workers, route catch-all mail to the main PayMailHook Worker. For Bun, deploy the [email relay](deploy/email-relay/README.md) with the same `INBOUND_WEBHOOK_SECRET` on relay and server; it sends signed requests to the server's public `/api/inbound`. See [Cloudflare's routing guide](https://developers.cloudflare.com/email-service/get-started/route-emails/).
3. Add a **Forwarding** config with the original Gmail address receiving bank notifications, selected banks, and optional webhook URL. Copy its generated `pmh-…@in.example.com` address into Gmail's forwarding settings. The configured Gmail must match the original signed recipient.
4. Complete Gmail's confirmation using the code or link shown in the dashboard.
5. Create a Gmail filter with **From** set to `no-reply@cake.vn OR support@timo.vn`, forwarding matching messages to that address. Keep forwarding restricted to bank notifications.

Use Gmail's automatic forwarding filter to preserve the original signed message; manually composing a forwarded email may not preserve the required headers.

## Configuration

[.env.example](.env.example) is the local template. Bun reads `.env`; Compose passes its listed variables to the app; Workers uses `vars`, secrets, and resource bindings.

| Variable | Required / default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required for Bun and migrations | PostgreSQL URL. Compose overrides it internally; Workers uses `HYPERDRIVE.connectionString`. |
| `ENCRYPTION_KEY` | Required | Exactly 32 random bytes encoded as base64; encrypts IMAP passwords, webhook secrets, and retained failed messages. |
| `BETTER_AUTH_SECRET` | Required, at least 32 characters | Authentication secret; generate separately from the encryption key. |
| `BETTER_AUTH_URL` | Required; example `http://localhost:3010` | Public application origin for auth and callbacks. |
| `PORT` | Bun / Compose: `3010` | Bun listening port; in Compose changes the host port while the container stays on `3010`. Update the URL to match. |
| `ALLOW_SIGNUP` | `true` | Allows new accounts; first registration receives admin access. |
| `ALLOW_PRIVATE_WEBHOOKS` | Bun / Compose: `true`; Workers: `false` | Permits HTTP and private targets when enabled. Set explicitly for your trust model. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional pair | Google sign-in. Set both or neither. |
| `GOOGLE_PUBSUB_TOPIC` | Optional | Gmail OAuth intake; requires Google credentials and the verification token. |
| `GOOGLE_PUBSUB_VERIFICATION_TOKEN` | Required with a topic | Shared token in the Pub/Sub push URL. |
| `INBOUND_EMAIL_DOMAIN` | Optional | Forwarding configs and generated receiving addresses. |
| `INBOUND_WEBHOOK_SECRET` | Required for Bun forwarding relay | Shared HMAC secret; the main Worker's native email handler does not need it. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional pair | Browser Web Push for incoming transfers. Generate with `bun scripts/generate-vapid.ts`. |
| `API_URL` | Development: `http://localhost:3010` | Vite's `/api` proxy target. |

Empty optional values mean “disabled.” Keep **`ENCRYPTION_KEY` with your database backups**: replacing it makes existing encrypted values unreadable. Per-config webhook-secret rotation is separate and invalidates the previous secret immediately.

For Web Push, configure both VAPID keys, use a browser-supported secure context, and enable notifications in the dashboard. Browser permission is required.

## Integrate payments

The full [API reference](docs/api.md) is also served at `/docs`. [The integration prompt](docs/integration-prompt.md) gives coding agents the contract for adding PayMailHook to another application.

### Order codes and VietQR

Use `<prefix><orderId>`, for example `PMH123456`. Prefixes are 1–16 alphanumeric characters; order codes use `A-Z` and `0-9`. Avoid separators inside a code: `PMHABC-123` matches `ABC`, not `ABC123`. The first matching sequence in the description is used.

The public VietQR endpoint returns SVG:

```text
https://<your-host>/api/qr?bank=cake&acc=0123456789&amount=149000&des=PMH123456
```

Replace the example account with your receiving bank account. Only `cake`, `timo`, or their supported BINs are accepted. Creating a QR does not register an order or pending payment in PayMailHook.

### Receive webhooks

An incoming transfer with a matching code and configured webhook URL produces this shape (example data):

```json
{
  "type": "payment.received",
  "timestamp": "2026-09-20T11:28:07.000Z",
  "data": {
    "orderId": "123456",
    "transaction": {
      "id": "9b2f6c1e-0000-4000-8000-000000000001",
      "bank": "CAKE",
      "direction": "in",
      "amount": 149000,
      "currency": "VND",
      "description": "PMH123456",
      "bankTxnId": "500000001",
      "balanceAfter": null,
      "counterparty": {
        "name": "NGUYEN VAN A",
        "account": "123456***7890",
        "bank": "TIMO"
      },
      "occurredAt": "2026-09-20T11:28:07.000Z"
    }
  }
}
```

Amounts are integers in the minor unit of `currency` (`149000` VND, `209` USD = 2,09 USD); timestamps are ISO 8601 UTC. Missing bank-specific fields are `null`. Headers follow [Standard Webhooks](https://www.standardwebhooks.com/): `webhook-id`, `webhook-timestamp`, and `webhook-signature`.

Your receiver should:

1. Verify the signature and timestamp against the **raw request body**, using the config's `whsec_…` secret. See [Node.js, PHP, and Python examples](docs/api.md#verify-the-signature).
2. Deduplicate by `webhook-id` and return `2xx` for already-processed deliveries. Retries keep the same ID and payload.
3. Handle `payment.test` without fulfilling an order. For `payment.received`, check order code, currency, expected amount, and order state. Define handling for partial and excess payments.
4. Persist acceptance durably, then return `2xx` within **10 seconds**; perform slower work asynchronously.

Failures retry after **10 s, 10 s, 20 s, 30 s, 50 s, 1 h, 2 h, 4 h, and 8 h**: up to 10 automatic attempts including the first. Redirects are not followed and count as failures. Finished deliveries can be resent from the dashboard or API; manual resend also preserves the same `webhook-id` and payload and does not start a new automatic retry cycle. An event represents one transfer, not a guarantee that an order is paid in full.

### REST API and MCP

Create an API key in the dashboard. Keep it on your server; each key acts as its owner and is limited to **120 requests per minute**.

```bash
curl 'https://<your-host>/api/transactions?orderId=123456&direction=in' \
  -H 'x-api-key: <your-api-key>'
```

| Interface | Authentication | Use |
| --- | --- | --- |
| `/api/transactions` | Session or `x-api-key` | Filter and paginate transactions |
| `/api/email-configs` | Session or `x-api-key` | Manage sources, banks, prefixes, and targets |
| `/api/webhook-deliveries` | Session or `x-api-key` | Inspect attempts and resend finished deliveries |
| `/api/qr` | Public | VietQR SVG |
| `/api/share/t/{token}`, `/api/share/c/{token}` | Public token | Explicitly shared transaction data |
| `/mcp` | `Authorization: Bearer <api-key>` or `x-api-key` | Stateless Streamable HTTP MCP |

MCP exposes **`list_transactions`** and **`get_payment_status`**. Pass `orderId` without its prefix. With `amount`, `get_payment_status` checks whether the sum of matching incoming transfers covers it; without `amount`, any matching incoming transfer counts as paid.

## Data and security

- Bank messages must match an allowed sender and selected bank, pass DKIM for the bank's domain with signed `From` and `To`, and name the configured Gmail as a recipient. Duplicate `From`/`To` headers and partial-body DKIM signatures are rejected. The core ingest function rejects raw messages above 2 MiB.
- Successfully parsed raw emails are not retained by the application. Parsed transactions remain in PostgreSQL. Messages recorded as `malformed`, `to_mismatch`, `dkim_failed`, or `parse_failed` are encrypted for diagnostics and become eligible for cleanup after **seven days**.
- Completed webhook deliveries and their attempts become eligible for cleanup after **30 days**. Transactions have no automatic age-based expiry. Deleting an email config cascades to its transactions and delivery history.
- Configs older than **seven days** with no successfully ingested bank message are removed by maintenance, even if OAuth or forwarding setup succeeded.
- IMAP passwords, webhook secrets, and retained failed messages use application-level AES-GCM encryption. Google tokens use Better Auth's account storage; the app's `ENCRYPTION_KEY` does not encrypt those token columns. Protect database access and backups accordingly.
- Public share links can be revoked. They omit structured counterparty-name/account fields but expose transfer descriptions, which may contain personal information.
- With `ALLOW_PRIVATE_WEBHOOKS=false`, validation requires HTTPS on port 443 and blocks literal IPs, localhost, selected internal suffixes, and the app's own host. **DNS resolution to private addresses is not checked**, so this is not complete SSRF isolation.

## Operations and troubleshooting

Use `docker compose logs -f app` for Bun or `bunx wrangler tail` for Workers. Public `GET /api/config` reports enabled capabilities; it is not a comprehensive database or email health check. The dashboard shows the last successfully ingested bank message and latest ingestion error.

Back up PostgreSQL and its matching encryption key. Before updates, review migrations and back up, then rebuild Docker with `docker compose up -d --build`; for Workers, apply migrations to the deployment database before `bun run deploy`. Cleanup runs hourly in bounded batches, so retention cutoffs are eligibility thresholds, not exact deletion deadlines.

| Symptom | Check |
| --- | --- |
| Startup rejects environment variables | Required secrets, valid URL, 32-byte base64 encryption key, complete optional credential pairs. |
| No IMAP option | Only the Bun server supports IMAP. |
| `imap_auth_failed` | Update the App Password in the config to clear the error and restart the listener. |
| Gmail `403 access_denied` | Add the **Gmail being connected** to the OAuth project's test users; check consent settings. |
| `redirect_uri_mismatch` | Match the registered callback exactly to `BETTER_AUTH_URL` plus `/api/auth/callback/google`. |
| `gmail_auth_failed` | Reauthorize Gmail; check expired Testing tokens, revoked access, and topic publisher permissions. |
| OAuth succeeds but no transactions arrive | Check subscription URL/token, JSON envelope, selected banks, and new bank mail after connection. |
| Forwarding confirmation missing | Check inbound domain, catch-all Worker, generated recipient, and Bun relay settings. |
| `dkim_failed`, `to_mismatch`, `parse_failed` | Check original recipient, intact email, sender, and bank template. A Gmail claimed by another config also yields `to_mismatch`. |
| Config disappears after a week | Maintenance deletes configs older than seven days that never successfully ingested bank mail. |
| Transaction exists but no webhook | Check incoming direction, prefix/code, and webhook URL **at ingestion time**. Adding a URL later does not create deliveries for old transactions. |
| Webhook fails or times out | Check signing secret, raw-body verification, target reachability, and `2xx` within 10 seconds; inspect attempts. |
| API returns `429` | Respect `Retry-After`; keys allow 120 requests/minute. |
| Login throttles behind a reverse proxy | Bun uses the proxy's socket IP; those clients share a rate-limit bucket. |
| Local API works but page is missing | Run `bun run build` for the SPA on port 3010, or `bun run dev:web` for Vite. |

## Local development

Use Bun **1.3+**, Node.js **22.12+** for tooling, OpenSSL to generate the two secrets, and local PostgreSQL. The Dockerfile uses Bun 1.3; Compose uses PostgreSQL 17.

```bash
bun install --frozen-lockfile
cp .env.example .env
```

Set both secrets and `DATABASE_URL` for local PostgreSQL. The example assumes port `5435`; the Compose database is **not published to the host**, so `docker compose up -d db` alone does not make that URL work. Use a separately accessible database or a local Compose override that publishes its port.

For a new, separate development database matching `.env.example`, you can run:

```bash
docker run -d --name paymailhook-dev-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=paymailhook \
  -p 127.0.0.1:5435:5432 \
  -v paymailhook-dev-pgdata:/var/lib/postgresql/data \
  postgres:17-alpine
docker exec paymailhook-dev-db pg_isready -U postgres -d paymailhook
```

Wait until the readiness command reports that connections are accepted. These example credentials are for the local development database. On later sessions, start the existing container with `docker start paymailhook-dev-db`.

```bash
bun run db:migrate
bun run build
bun run dev
```

Bun serves the API and built SPA at `http://localhost:3010` and also applies pending migrations on startup. For frontend hot reload, run `bun run dev:web` in a second terminal and open `http://localhost:5173`; Vite proxies `/api` to Bun. Use the backend origin for OAuth callback testing and `/mcp`, which is not proxied by Vite.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Backend watch mode and IMAP supervision |
| `bun run dev:web` | Vite hot reload |
| `bun run typecheck` | TypeScript checking |
| `bun run lint` | Biome lint and formatting checks |
| `bun run test` | Bun unit/integration tests with PGlite |
| `bun run check` | Biome, TypeScript, then tests |
| `bun run build` | SPA into `dist/client` |
| `bun run build:worker` | SPA build and Worker bundle dry run, no deployment |
| `bun run e2e` | Playwright with dedicated PGlite server |
| `bun run db:generate` | Generate Drizzle migrations after schema changes |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL` |

Unit/integration tests need no external PostgreSQL. Playwright builds the SPA and starts `e2e/server.ts` on port `4455`; local runs use installed Google Chrome. For CI-style Chromium:

```bash
bunx playwright install --with-deps chromium
CI=1 bun run e2e
```

[CI](.github/workflows/ci.yml) runs `check`, `build:worker`, and browser tests. These checks do not replace validation against real bank mail and deployed Google/Cloudflare infrastructure.

## Architecture and project layout

Backend: **TypeScript, Hono, Drizzle ORM, postgres.js, Better Auth**. Frontend: **React, Vite, React Router, TanStack Query, Tailwind CSS, shadcn/ui**. Email processing: `postal-mime`, `mailauth` with DNS-over-HTTPS, and `imapflow`.

```text
src/
  core/               Shared ingestion, parsers, DKIM, auth, delivery, maintenance
    db/               PostgreSQL schema, driver, Bun startup migrator
  api/                Hono routes, auth middleware, MCP endpoint
  imap.ts             Gmail IMAP IDLE and reconnection supervision
  server.ts           Bun HTTP, SPA, IMAP, timers, startup migrations
  worker.ts           Worker fetch, email, queue, scheduled handlers
web/                  Dashboard, public pages, service worker
deploy/email-relay/   Cloudflare forwarding relay for Bun
migrations/           Versioned Drizzle SQL migrations
scripts/              VAPID generation and fixture anonymization
test/                 Bun/PGlite tests and anonymized bank fixtures
e2e/                  Playwright scenarios and test server
docs/                 API, design, research, implementation history
```

## Current limitations

- Only CAKE, Timo and the Vietnamese PayPal "money received" templates are implemented; other PayPal mail (purchases, authorizations, notices) is ignored. Bank template or sender changes may require parser updates.
- Detection depends on bank email delivery and intake services. There is no guaranteed detection latency or direct bank reconciliation.
- IMAP and Gmail OAuth skip messages received before config creation. IMAP recovery and expired-Gmail-history fallback inspect recent mail, not unlimited history; the Gmail fallback currently fetches one page. Gmail intake has no periodic catch-up poll independent of Pub/Sub.
- Dashboard updates use five-second polling, which can keep a hosted database active while the page is open.
- Email verification and forgotten-password email recovery are not implemented; no outbound email provider is configured for these flows.
- Strict webhook validation lacks private-IP DNS checks; Bun lacks trusted-proxy IP handling. See [data and security](#data-and-security) and [troubleshooting](#operations-and-troubleshooting).
- Tests and a successful Worker bundle do not establish real-provider end-to-end reliability. Measure Worker CPU usage for DKIM/parsing and exercise reconnects, Pub/Sub, Web Push, and retries in your deployment.

## Contributing

Bug reports, documentation, translations, and additional bank templates are welcome through [GitHub Issues](https://github.com/stormdang20/PayMailHook/issues) and pull requests.

1. Describe the problem or proposed behavior, deployment mode, and reproduction steps.
2. Keep changes focused. Cover changed behavior and run `bun run check`; use `bun run build:worker` for runtime/bundling changes and `bun run e2e` for affected UI flows.
3. For bank parsers, provide **anonymized** fixtures and tests. `scripts/anonymize-fixtures.ts` handles the existing local bank samples; inspect its output before committing.
4. Update both READMEs when shared behavior or setup changes. Keep the API reference aligned with endpoint and payload changes.

Do not put real bank emails, account details, credentials, or private webhook URLs in public issues or commits. Local raw fixtures belong in ignored `mail-template/`; committed fixtures live in `test/fixtures/`.

## Documentation and license

| Document | Purpose |
| --- | --- |
| [API reference](docs/api.md) | Endpoints, webhook verification examples, MCP |
| [Integration prompt](docs/integration-prompt.md) | Coding-agent instructions for application integration |
| [Email relay](deploy/email-relay/README.md) | Forwarding setup for Bun |
| [Design](docs/design.md) | Architecture and original design decisions |
| [Research](docs/research.md) | Initial investigation and reference projects |
| [Implementation plan](docs/plans/2026-09-24-paymailhook.md) | Historical implementation phases |
| [Plan deviations](docs/plans/2026-09-24-paymailhook-deviations.md) | Changes from the original plan and removed intake methods |

Design/planning documents include historical proposals; this README and current code describe supported setup. Apps Script and the old `/api/ingest` path are no longer supported.

Licensed under the **[Apache License 2.0](LICENSE)**.
