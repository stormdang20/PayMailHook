# PayMailHook API

PayMailHook reads your bank's balance-notification emails (CAKE by VPBank, Timo) and tells your system when a customer has paid. There are three ways to integrate:

| Way | Direction | Use it to |
|---|---|---|
| [Webhooks](#webhooks) | PayMailHook → your server | Mark an order as paid the moment the money arrives. **Recommended.** |
| [REST API](#rest-api) | Your server → PayMailHook | Look up transactions, check an order, manage configs. |
| [MCP server](#mcp-server) | AI agent → PayMailHook | Let an assistant answer "has order 123 been paid?". |

All amounts are integers in VND. All times are ISO 8601 in UTC (`2026-09-20T11:28:07.000Z`).

## How payments are matched

1. You create an **email config**: the Gmail inbox that receives your bank's notifications, an **order prefix** (default `PMH`) and a **webhook URL**.
2. Your customer transfers money with a description containing `<prefix><order code>`, for example `PMH123456`.
3. PayMailHook receives the bank email, checks the bank's DKIM signature, reads the amount and description, and extracts the order code: the letters and digits right after the prefix (`MBVCB.123.PMH456.NGUYEN VAN A` gives `456`). Matching is case-insensitive; codes are returned in upper case.
4. For **incoming** money with an order code, PayMailHook sends a signed webhook to your URL and retries until you answer `2xx`.

Order codes may contain only `A-Z` and `0-9`. Banks often strip or rewrite punctuation, so don't use `-`, `_` or spaces inside the code.

## Authentication

| Caller | Credential |
|---|---|
| Your server (REST API) | API key in the `x-api-key` header |
| MCP clients | API key as `Authorization: Bearer <key>` (or `x-api-key`) |
| The dashboard | Session cookie (sign in) |
| Webhook receivers | Nothing to send; verify PayMailHook's signature instead |

Create API keys in the dashboard under **API key**. A key acts as its owner and sees only the owner's data. Each key is limited to **120 requests per minute**; over the limit the API answers `429`.

```bash
curl https://<your-paymailhook>/api/transactions?limit=5 \
  -H "x-api-key: <api key>"
```

## Errors

Errors use HTTP status codes and a JSON body:

```json
{ "error": { "code": "not_found" } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `validation` | The request body or query is invalid; `issues` lists the fields |
| 400 | `invalid_webhook_url` | The webhook URL is not allowed; `reason` says why (`https_required`, `ip_not_allowed`, `host_not_allowed`, `port_not_allowed`, `credentials_not_allowed`, `invalid_url`) |
| 401 | `unauthorized` | Missing or invalid API key, session or ingest token |
| 404 | `not_found` | The resource doesn't exist **or belongs to someone else** |
| 409 | `not_finished` | A webhook can only be resent after it succeeded or failed |
| 429 | `rate_limited` | Too many requests; wait the number of seconds in the `Retry-After` header |
| 500 | `internal` | Unexpected error; retry later |

## Pagination

List endpoints return newest first:

```json
{ "items": [ … ], "nextCursor": "eyJ0cyI6…" }
```

Pass `nextCursor` back as `?cursor=` to get the next page; it is `null` on the last page. `limit` is 1–100 (default 50). Cursors are stable: rows are never skipped or repeated while you page.

## REST API

Base URL: `https://<your-paymailhook>/api`. Every endpoint below needs an API key or a session.

### Transactions

#### `GET /transactions`

| Query | Type | Description |
|---|---|---|
| `orderId` | string | Only transactions with this order code |
| `direction` | `in` \| `out` | Money received or sent |
| `configId` | uuid | Only this email config |
| `cursor`, `limit` | | See [Pagination](#pagination) |

```bash
curl "https://<your-paymailhook>/api/transactions?orderId=123456&direction=in" \
  -H "x-api-key: <api key>"
```

```json
{
  "items": [
    {
      "id": "9b2f6c1e-0000-4000-8000-000000000001",
      "emailConfigId": "2c0e8223-4438-4a46-8831-3f3173949df6",
      "bank": "CAKE",
      "direction": "in",
      "amount": 149000,
      "balanceAfter": null,
      "bankTxnId": "500000001",
      "description": "PMH123456",
      "orderId": "123456",
      "counterpartyName": "NGUYEN VAN A",
      "counterpartyAccount": "123456***7890",
      "counterpartyBank": "TIMO",
      "occurredAt": "2026-09-20T11:28:07.000Z",
      "createdAt": "2026-09-20T11:28:15.412Z",
      "shareToken": null
    }
  ],
  "nextCursor": null
}
```

`balanceAfter` is only known for Timo, `bankTxnId` only for CAKE.

#### `GET /transactions/{id}`

One transaction, same fields as above.

#### `POST /transactions/{id}/share` · `DELETE /transactions/{id}/share`

Creates (or returns the existing) public link token for one transaction, or revokes it. The public page is `https://<your-paymailhook>/share/t/{token}`; it shows amount, time, description, order code and bank transaction id, never the payer's name or account.

```json
{ "token": "3kq9…" }
```

### Webhook deliveries

#### `GET /webhook-deliveries`

| Query | Type | Description |
|---|---|---|
| `status` | `pending` \| `retrying` \| `success` \| `failed` | Filter by status |
| `cursor`, `limit` | | See [Pagination](#pagination) |

Each item: `id` (also the `webhook-id` header), `transactionId`, `status`, `attemptCount`, `nextAttemptAt`, `lastStatusCode`, `createdAt`, `orderId`, `amount`.

#### `GET /webhook-deliveries/{id}`

The delivery, its `payload`, and `attempts[]` (`attemptNumber`, `trigger` = `scheduled` \| `manual`, `url`, `statusCode`, `error`, `responseBody` (first 1 KB), `durationMs`, `createdAt`).

#### `POST /webhook-deliveries/{id}/retry`

Sends the same payload again (same `webhook-id`) right away. Allowed when the delivery is `success` or `failed`; answers `202`, or `409 not_finished` while it is still scheduled.

### Email configs

A config is one Gmail inbox plus where its payments are sent.

| Field | Description |
|---|---|
| `gmail` | Inbox that receives the bank emails |
| `banks` | Which banks notify this inbox: `["CAKE"]`, `["TIMO"]` or both (default both). Emails from other banks reaching this inbox are ignored, so each bank can use a different Gmail |
| `source` | `imap` (self-host only), `gmail_oauth`, `forwarding` (each if enabled on the server) or `apps_script` |
| `forwardingAddress` | For `forwarding`: the address to forward bank mail to (Gmail → Settings → Forwarding) |
| `orderPrefix` | 1–16 letters or digits, stored upper case (default `PMH`) |
| `webhookUrl` | `https://` URL on port 443 with a public host name, or `null` |
| `lastIngestAt` | Last time a bank email was received |
| `ingestError` | Last problem, e.g. `dkim_failed`, `to_mismatch`, `parse_failed`, `imap_auth_failed` |

#### `GET /email-configs` · `GET /email-configs/{id}`

List or read configs. Secrets are never returned.

#### `POST /email-configs`

```json
{ "gmail": "shop@gmail.com", "banks": ["CAKE"], "webhookUrl": "https://shop.example.com/webhooks/paymailhook", "orderPrefix": "PMH" }
```

For `"source": "imap"` also send `"imapPassword"` (a 16-letter Google App Password). Answers `201` with the config and, **once only**, `ingestToken`, `webhookSecret` (`whsec_…`) and `appsScript` (the `Code.gs` to paste into Google Apps Script; `null` for other sources). Store the webhook secret right away.

#### `PATCH /email-configs/{id}`

Any of `webhookUrl` (or `null`), `orderPrefix`, `banks` (at least one), `imapPassword`. The Gmail address can't change; delete and recreate the config instead.

#### `DELETE /email-configs/{id}`

Deletes the config with its transactions and webhook history. Answers `204`.

#### `POST /email-configs/{id}/rotate-token` · `POST /email-configs/{id}/rotate-secret`

New ingest token (and a new `appsScript` to paste) or new webhook secret. The old value stops working immediately.

#### `POST /email-configs/{id}/test-webhook`

Sends a signed `payment.test` event to the webhook URL now and returns what your server answered:

```json
{ "statusCode": 200, "responseBody": "ok", "error": null, "durationMs": 184 }
```

#### `POST /email-configs/{id}/share` · `DELETE /email-configs/{id}/share`

Public link to this inbox's **incoming** transactions (a cashier screen), at `https://<your-paymailhook>/share/c/{token}`.

### Public endpoints

No credentials needed.

#### `GET /qr`

A VietQR image (SVG) customers can scan with any banking app.

| Query | Required | Description |
|---|---|---|
| `bank` | yes | `cake` or `timo` (or the bank's 6-digit BIN). Only banks whose emails PayMailHook reads; others answer `400 unknown_bank` |
| `acc` | yes | Account number |
| `amount` | no | Amount in VND |
| `des` | no | Transfer description, e.g. `PMH123456` (max 50 characters) |

```html
<img src="https://<your-paymailhook>/api/qr?bank=cake&acc=0123456789&amount=149000&des=PMH123456" alt="VietQR" />
```

#### `GET /share/t/{token}` · `GET /share/c/{token}`

JSON behind the public share pages (one transaction; a paginated list of incoming transactions).

#### `POST /ingest`

Used by the generated Apps Script, not by your application: `Authorization: Bearer <ingest token>`, body = the raw email (`message/rfc822`).

## Webhooks

### Request

```http
POST <your webhook URL>
content-type: application/json
user-agent: PayMailHook/1.0
webhook-id: <delivery id, the same on every retry>
webhook-timestamp: <unix seconds>
webhook-signature: v1,<base64 HMAC-SHA256>
```

<!-- sample-payload: test/docs-sample.test.ts keeps this block identical to what the server sends -->
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

Event types: `payment.received` (a real payment) and `payment.test` (the "Send test" button; same shape with sample data, don't fulfil anything).

### Verify the signature

Signatures follow [Standard Webhooks](https://www.standardwebhooks.com/): `HMAC-SHA256(secret, "{webhook-id}.{webhook-timestamp}.{raw body}")`, where the key is the base64 part of `whsec_…`. Use an official library and the **raw** request body (the exact bytes, before JSON parsing).

**Node.js** (`npm install standardwebhooks`)

```js
import express from 'express';
import { Webhook } from 'standardwebhooks';

const wh = new Webhook(process.env.PAYMAILHOOK_WEBHOOK_SECRET); // whsec_...
const app = express();

app.post('/webhooks/paymailhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = wh.verify(req.body, req.headers);
  } catch {
    return res.status(401).end();
  }
  if (event.type !== 'payment.received') return res.status(200).end();
  const id = req.headers['webhook-id'];
  if (await alreadyProcessed(id)) return res.status(200).end(); // still 2xx on duplicates
  const { orderId, transaction } = event.data;
  await markOrderPaid(orderId, transaction.amount, id); // match the order code and the amount
  res.status(200).end();
});
```

**PHP** (`composer require standard-webhooks/standard-webhooks`)

```php
<?php
$wh = new \StandardWebhooks\Webhook(getenv('PAYMAILHOOK_WEBHOOK_SECRET'));
$headers = array_change_key_case(getallheaders(), CASE_LOWER);
try {
    $event = $wh->verify(file_get_contents('php://input'), $headers);
} catch (\Exception $e) {
    http_response_code(401);
    exit;
}
// Dedupe by $headers['webhook-id'], then match orderId and amount.
http_response_code(200);
```

**Python** (`pip install standardwebhooks`)

```python
import os
from flask import Flask, request
from standardwebhooks.webhooks import Webhook

wh = Webhook(os.environ["PAYMAILHOOK_WEBHOOK_SECRET"])
app = Flask(__name__)

@app.post("/webhooks/paymailhook")
def paymailhook():
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        event = wh.verify(request.get_data(), headers)
    except Exception:
        return "", 401
    # Dedupe by headers["webhook-id"], then match orderId and amount.
    return "", 200
```

### Rules for your endpoint

1. **Verify** the signature; the library also rejects timestamps more than 5 minutes off.
2. **Dedupe** by `webhook-id` and still answer `2xx` for a duplicate, otherwise it keeps being retried.
3. **Match both** `data.orderId` **and** `data.transaction.amount` against the order, and only move orders that are still waiting for payment. Decide what to do with partial or excess payments.
4. **Answer `2xx` within 10 seconds.** Queue slow work and reply first.

### Retries

Only `2xx` counts as delivered; redirects (`3xx`) count as failures and are not followed. Failed deliveries are retried after 10 s, 10 s, 20 s, 30 s, 50 s, 1 h, 2 h, 4 h and 8 h (10 attempts over about 15 hours), then marked `failed`. You can resend any finished delivery from the dashboard or with [`POST /webhook-deliveries/{id}/retry`](#post-webhook-deliveriesidretry). Delivery logs are kept for 30 days.

## MCP server

Endpoint: `https://<your-paymailhook>/mcp` (Streamable HTTP, stateless). Authenticate with `Authorization: Bearer <api key>`.

| Tool | Arguments | Returns |
|---|---|---|
| `list_transactions` | `direction?` (`in`/`out`), `orderId?`, `limit?` (1–50, default 20) | Latest transactions, newest first |
| `get_payment_status` | `orderId`, `amount?` | `{ orderId, paid, totalAmount, payments[] }`: `paid` is true when incoming transfers with the code exist, or, with `amount`, when their sum covers it |

Try it with the MCP Inspector: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", your `/mcp` URL and the `Authorization` header.
