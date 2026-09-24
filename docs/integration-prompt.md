# Integration prompt for coding agents

Copy everything below the line into your coding agent (Claude Code, Cursor, Codex, …) inside **your own application's repository**. It adds bank-transfer payments through PayMailHook. The agent will ask you for the values it can't find in the code.

---

You are integrating **PayMailHook** bank-transfer payments into this application. PayMailHook watches the merchant's bank notification emails (CAKE by VPBank, Timo) and, when a customer transfers money whose description contains `<PREFIX><ORDER CODE>`, sends a signed webhook to this application. Your job is to let customers pay an order by bank transfer and to mark the order as paid when that webhook arrives.

Full API reference: `https://<PAYMAILHOOK_URL>/docs` (the same content is in the PayMailHook repository at `docs/api.md`). Read it if anything below is unclear.

## 1. Understand this codebase first

Before writing code, find and summarize for the user:

- The language, framework, and how HTTP routes, config/env vars, database migrations and background jobs are done here.
- The order (or invoice/booking) model: its id, total amount and currency, status values, and where the "order placed" and "order paid" transitions happen today.
- Existing payment methods, if any, so the new one follows the same pattern.

Follow the project's existing conventions (naming, folder layout, ORM, validation, tests, lint). Don't add a framework or library when the project already has one for the job.

## 2. Ask the user for these values (don't guess them)

| Value | What it is | Where the user finds it |
|---|---|---|
| `PAYMAILHOOK_URL` | Base URL of their PayMailHook, e.g. `https://paymailhook.example.workers.dev` | Their deployment |
| `PAYMAILHOOK_WEBHOOK_SECRET` | `whsec_…` secret used to verify webhooks | Shown once when the email config is created; "Đổi secret" in the dashboard issues a new one |
| `PAYMAILHOOK_ORDER_PREFIX` | Letters/digits placed before the order code (default `PMH`) | "Tiền tố mã đơn" on the email config |
| `PAYMAILHOOK_API_KEY` | Only needed for the status-check fallback | "API key" page |
| Bank and account | Bank key (`cake` or `timo`), account number and account holder name the customer pays into | Their bank app |

Put every value in environment variables / the project's secret store. Never hard-code or commit them; add placeholders to `.env.example` (or the project's equivalent).

## 3. Implement

### 3.1 Order payment code

- Each order gets a **payment code**: `PREFIX + code`, letters and digits only (A–Z, 0–9), 6–12 characters after the prefix, unique, stored on the order. Banks strip punctuation, so no `-`, `_`, spaces or lower-case-only assumptions. Using the numeric order id is fine if it is unique; otherwise generate a random code and add a unique index.
- Store on the order: `payment_code`, `amount_due` (integer VND), `paid_amount` (integer, default 0), `paid_at` (nullable), and add a status such as `awaiting_payment` if the model has no equivalent.
- VND has no minor unit: keep amounts as integers, never floats.

### 3.2 Payment instructions for the customer

On the checkout / order page, when the customer chooses bank transfer, show:

- Bank, account number, account holder, the exact amount, and the transfer description = the payment code, each with a copy button.
- A VietQR image that fills all of that in the banking app:
  `https://<PAYMAILHOOK_URL>/api/qr?bank=<bank key>&acc=<account>&amount=<amount_due>&des=<payment code>` (public, returns SVG; use it directly in an `<img>`).
- A clear note that the description must be entered exactly as shown.
- A waiting state that polls **this application's own backend** (not PayMailHook) every few seconds for the order status and switches to a "paid" view when it changes. Stop polling after the page is hidden or after a reasonable timeout.

### 3.3 Webhook endpoint

Add `POST /webhooks/paymailhook` (adapt to the project's routing):

1. Read the **raw request body** (bytes, before any JSON parsing or body-parser middleware changes it).
2. Verify it with the official Standard Webhooks library for this language (`standardwebhooks` for Node/Python, `standard-webhooks/standard-webhooks` for PHP; others at https://www.standardwebhooks.com). Pass the headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (lower-case names). On failure answer `401` and stop.
3. Ignore events whose `type` is not `payment.received` with `200` (the dashboard's "Send test" sends `payment.test`; log it so the user can see the test arrived).
4. **Idempotency:** store processed `webhook-id` values (unique constraint). If the id was already processed, answer `200` and do nothing. Retries and manual resends reuse the same id.
5. Find the order by `data.orderId` (the code **without** the prefix, upper case) against the stored payment code. If no order matches, record the event for manual review and answer `200` (a retry won't fix it).
6. Add `data.transaction.amount` to `paid_amount` inside a transaction with a row lock on the order, so two webhooks can't race. Mark the order paid only when it is still awaiting payment and `paid_amount >= amount_due`. Keep underpaid orders waiting and flag overpaid ones for the merchant; ask the user which policy they want if the project has no convention.
7. Record `transaction.id`, `transaction.bankTxnId`, `transaction.occurredAt` and the counterparty on the payment record for support and reconciliation.
8. Answer `2xx` within 10 seconds. If fulfilment is slow (emails, stock, shipping), enqueue it with the project's job system and answer first.

Payload example and the retry schedule are in the API reference ("Webhooks"). PayMailHook retries non-2xx answers for about 15 hours, and 3xx redirects count as failures.

### 3.4 Status-check fallback (optional but recommended)

For orders still awaiting payment after a while (e.g. the webhook URL was down), add a job or an admin action that calls
`GET <PAYMAILHOOK_URL>/api/transactions?orderId=<code without prefix>&direction=in` with header `x-api-key: <PAYMAILHOOK_API_KEY>` and applies any payments through **the same function** the webhook uses (same idempotency, keyed by `transaction.id`). Respect `429` responses (`Retry-After` header).

### 3.5 Tests

Add tests in the project's framework for:

- A valid signed `payment.received` marks the order paid (sign the body with the library's `sign()` using a test `whsec_` secret).
- Invalid signature → 401, order unchanged.
- The same `webhook-id` twice → processed once, second answer still 2xx.
- Wrong amount / unknown order code → order not marked paid, event recorded.
- `payment.test` → 200, nothing changes.

## 4. Tell the user what to do after merging

End with a short checklist for the user, adapted to what you built:

1. Set the environment variables listed above in every environment.
2. Deploy, then in the PayMailHook dashboard set the email config's **URL webhook** to `https://<their-app>/webhooks/paymailhook` (must be public `https` on port 443 for the hosted PayMailHook).
3. Check that the config's order prefix equals `PAYMAILHOOK_ORDER_PREFIX`.
4. Click **"Gửi thử"** on the config and confirm the app logged a `payment.test` event.
5. Place a real small order, pay it by bank transfer with the shown description, and watch the order turn paid; the **Webhook** page in PayMailHook shows each attempt and your server's answer.

## 5. Report back

Finish with: the files you changed, the new env vars, the migration(s) to run, how to run the tests, and anything you could not decide and need the user to choose.
