# PayPal plan deviations

Deviations from `2026-10-01-paypal.md`, with cause and rationale.

## Tasks 1–2: parser and storage

### 1-a: Tasks 1 and 2 share one commit

- **Plan:** parser (Task 1) and schema/ingest (Task 2) as separate commits.
- **Done:** one commit.
- **Cause:** adding `PAYPAL` to `Bank['code']` breaks the typecheck of the `transactions` insert and the web bank pickers until the DB enum has the value. A Task 1 commit alone could not pass `bun run check`.

### 1-b: bank enums derived from the schema; `BANK_NAMES.PAYPAL` moved earlier

- **Plan:** add `PAYPAL` to three zod literal lists (Task 3) and `BANK_NAMES` in Task 4.
- **Done:** the zod enums in `src/api/{transactions,email-configs,gmail}.ts` use `z.enum(bank.enumValues)`; `addGmailAccount` uses `Bank['code']`, `GmailDraft` uses `BankCode`. `BANK_NAMES.PAYPAL` is added now.
- **Cause:** the web typecheck fails as soon as the API accepts `PAYPAL` but the pickers can't name it. Deriving from the schema means a future bank only touches `banks.ts`, the schema and `BANK_NAMES`.

### 1-c: `parseBody` removed from ingest

- **Plan:** "pass `email.date`, `null` → ignored".
- **Done:** the try/catch is inline in `ingestRawEmail`. A `ParseError` still means `parse_failed`; `null` now means `ignored`.
- **Cause:** `parseBody` used `null` for "parse failed", which the new contract uses for "not a transaction". Inlining avoids a third sentinel.

### 1-d: IMAP query expectation updated

- **Done:** `test/imap.test.ts` now expects `service@intl.paypal.com` in the Gmail search. This is intended: IMAP and Gmail OAuth build their query from `BANKS`.

### 1-e: migration renamed

- **Done:** `drizzle-kit` named it `0010_young_lyja`; renamed to `0010_paypal` (file and `_journal.json` tag) to match `0008_drop_source_default` and `0009_drop_apps_script`.
