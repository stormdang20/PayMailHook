# Design

Tài liệu thiết kế chi tiết. Các quyết định cấp cao (D1…D17) nằm trong [README](../README.md#quyết-định-đã-chốt), còn nghiên cứu nền tảng nằm trong [research.md](research.md).

Trạng thái từng phần: ✅ đã duyệt · 📝 đang review

---

## 1. Schema DB ✅

Postgres, Drizzle `pg-core`. Tiền dùng `bigint` với đơn vị VND (không có số lẻ). Thời gian dùng `timestamptz`.

**Bảng auth** (`user`, `session`, `account`, `verification`, `apikey`) được CLI của better-auth **sinh tự động** (`auth generate`), không viết tay. Admin plugin thêm cột `user.role`. Các bảng nghiệp vụ tham chiếu tới `user.id`, kiểu `text`.

**Multi-tenant:** mọi bảng nghiệp vụ đều có `user_id`. Mọi query phía dashboard/API chỉ lọc qua **một** điều kiện `user_id = ?`. Không dùng RLS, vì chỉ có một role DB.

```
email_configs                        -- mỗi dòng ứng với 1 Gmail; webhook gắn theo config (giống payhook)
  id uuid pk default gen_random_uuid()
  user_id text → user.id on delete cascade
  gmail text                         -- lowercase; phải khớp header To đã được DKIM ký (D6)
                                     -- UNIQUE một phần: WHERE last_ingest_at IS NOT NULL (xem 4.4, chống chiếm chỗ Gmail)
  source enum(apps_script, imap)     -- gmail_oauth sẽ thêm ở P4 bằng migration
  ingest_token_hash text UNIQUE      -- sha256 của Bearer token mà Apps Script gửi lên
  imap_password_enc text null        -- App Password mã hoá AES-GCM, chỉ dùng khi source = imap
  last_ingest_at timestamptz null    -- dashboard hiện "script còn chạy không"
  ingest_error text null             -- lỗi gần nhất (IMAP auth fail, DKIM fail…), hiện trên dashboard
  order_prefix text default 'PMH'
  webhook_url text null
  webhook_secret_enc text null       -- whsec_… mã hoá AES-GCM (cần secret gốc để ký nên không hash được)
  created_at, updated_at

transactions
  id uuid pk
  user_id text → user.id             -- lặp lại từ email_configs để lọc bằng một điều kiện
  email_config_id uuid → email_configs on delete cascade
  message_id text UNIQUE             -- dedupe (D5); Apps Script và IMAP có quét trùng cũng không sao
  bank enum(CAKE, TIMO)
  direction enum(in, out)
  amount bigint                      -- luôn dương
  balance_after bigint null          -- chỉ Timo có
  bank_txn_id text null              -- chỉ CAKE có
  description text
  order_id text null                 -- mã đơn khớp được (đã bỏ prefix)
  counterparty_name text null
  counterparty_account text null
  counterparty_bank text null
  occurred_at timestamptz            -- lấy từ body, theo giờ Asia/Ho_Chi_Minh
  created_at
  index (user_id, occurred_at desc)

webhook_deliveries                   -- một delivery cho mỗi transaction có order_id
  id uuid pk                         -- dùng làm header webhook-id (idempotency)
  user_id text
  transaction_id uuid UNIQUE → transactions on delete cascade
  payload jsonb                      -- body cố định; retry và resend gửi lại y hệt
  status enum(pending, retrying, success, failed)
  attempt_count int default 0
  next_attempt_at timestamptz null
  last_status_code int null
  created_at, updated_at
  index (status, next_attempt_at)    -- cho cron quét delivery bị kẹt
  index (user_id, created_at desc)

webhook_attempts                     -- log trên dashboard; cron xoá bản ghi quá 30 ngày
  id uuid pk
  delivery_id uuid → webhook_deliveries on delete cascade
  attempt_number int
  trigger enum(scheduled, manual)
  url text
  status_code int null
  error text null
  response_body text null            -- cắt còn tối đa 1KB
  duration_ms int
  created_at
  index (delivery_id)

inbound_failures                     -- email của config đã biết nhưng DKIM hoặc parse fail (D15); xoá sau 7 ngày
  id uuid pk
  email_config_id uuid → email_configs on delete cascade
  message_id text null
  reason text                        -- dkim_failed | to_mismatch | unknown_sender | parse_failed
  raw_enc bytea                      -- raw MIME mã hoá AES-GCM, để viết thêm parser khi ngân hàng đổi template
  created_at
```

**Chưa làm, thêm khi cần:**
- `push_subscriptions` (P4).
- `transactions.share_token` (P3, khi đã chốt link chia sẻ là cho một giao dịch hay cả danh sách).
- Trạng thái IMAP (UID cuối cùng đã đọc): không cần, vì mỗi lần kết nối lại chỉ cần quét `SINCE` hôm nay, còn `message_id UNIQUE` lo phần dedupe.

**Không làm:**
- Bảng `endpoints` riêng, vì mỗi config chỉ có một URL.
- Bảng `events` tách khỏi `deliveries`, vì mỗi giao dịch chỉ có một đích nhận.
- RLS.

---

## 2. Luồng nhận và xử lý email ✅

Học từ: `my-money-went-bot/google_apps_script.js` (dedupe theo message, không theo thread; chỉ tính thành công khi có ack), `agentic-inbox` (lỗi tạm thời thì throw/5xx để bên gửi thử lại, lỗi vĩnh viễn thì ack), `cloudflare_temp_email` (parse một lần, mỗi side effect có try/catch riêng), `imapflow` (IDLE, `gmraw`).

### 2.1 Ba nguồn, một hàm core

```
Apps Script ── POST /api/ingest ──┐
IMAP IDLE (Self-host) ────────────┼──► ingestRawEmail(deps, config, raw: Uint8Array) → IngestResult
Gmail OAuth (P4) ─────────────────┘
```

Mỗi nguồn chỉ làm hai việc: **xác định `email_config`** và **lấy raw MIME**. Mọi xử lý còn lại nằm trong `src/core/ingest.ts`.

### 2.2 `ingestRawEmail`, từng bước

| # | Bước | Nếu lỗi |
|---|---|---|
| 1 | Kiểm tra kích thước ≤ 2MB (email ngân hàng khoảng 6–40KB) | `rejected: too_large` |
| 2 | `postal-mime` parse headers và HTML **một lần** | `rejected: malformed` |
| 3 | Tra `From` trong `BANKS` để biết ngân hàng | `ignored` (không lưu, vì query phía nguồn đã lọc theo người gửi) |
| 4 | `To` chứa `config.gmail`. So sánh sau khi chuẩn hoá Gmail: lowercase, bỏ dấu `.` và phần `+tag` ở local part, coi `googlemail.com` như `gmail.com` | `rejected: to_mismatch` |
| 5 | Verify DKIM (xem 2.3) | `rejected: dkim_failed` |
| 6 | `bank.parse(html)` → `ParsedTxn` | `rejected: parse_failed` |
| 7 | Trong **một DB transaction**: `INSERT transactions … ON CONFLICT (message_id) DO NOTHING`. Nếu có dòng mới, `direction = in`, khớp được mã đơn và config có `webhook_url`, thì `INSERT webhook_deliveries (status=pending, next_attempt_at=now)` | Không có dòng nào được chèn → `duplicate` |
| 8 | Sau khi commit: `scheduleDelivery(id)` | Lỗi thì cron mỗi giờ sẽ nhặt lại (vì delivery vẫn `pending`) |
| 9 | `UPDATE email_configs SET last_ingest_at = now(), ingest_error = null` | |

- **Các trường hợp `rejected`** ở bước 4, 5, 6: ghi vào `inbound_failures` (raw mã hoá, `reason`) và `ingest_error`. Đây là **lỗi vĩnh viễn**, nên vẫn trả ack để nguồn không gửi lại mãi.
- **Lỗi hạ tầng** (DB hoặc DNS lỗi) thì throw. `/api/ingest` trả **503**, và nguồn sẽ thử lại ở lần chạy sau.

### 2.3 Verify DKIM

```ts
const BANKS = {
  CAKE: { senders: ['no-reply@cake.vn'], dkimDomain: 'cake.vn', parse: parseCake },
  TIMO: { senders: ['support@timo.vn'], dkimDomain: 'timo.vn', parse: parseTimo, gmailAddsDate: true },
}
```

- Dùng `mailauth/lib/dkim/verify`. Resolver là **DNS-over-HTTPS** trên Workers và `node:dns` trên Bun. Resolver được truyền vào qua `deps`.
- **Điều kiện pass:** có ít nhất một chữ ký thoả cả ba:
  - `status = pass` và `signingDomain = bank.dkimDomain`
  - Danh sách header được ký chứa `from` và `to`
  - **Không có tag `l=`** (body length). Nếu có `l=`, kẻ gian có thể chèn thêm nội dung vào cuối body mà chữ ký vẫn hợp lệ
- **`gmailAddsDate`:** lần verify đầu fail thì bỏ header `Date` và verify lại một lần (xem research §3). Làm vậy vẫn an toàn vì hệ thống không dùng header `Date`; `occurred_at` lấy từ body, mà body đã được ký.

### 2.4 Parse và khớp mã đơn

- **HTML → text:** bỏ `<style>`/`<script>`, đổi thẻ thành `\n`, decode entity. Khoảng 10 dòng, không cần thêm thư viện.
- **CAKE:** đọc theo cặp label/giá trị: value là dòng không rỗng ngay sau các label `Số tiền`, `Mã giao dịch`, `Ngày giờ giao dịch`, `Nội dung giao dịch`, `Tài khoản/Tên/Ngân hàng chuyển|nhận`. Chiều giao dịch lấy từ dấu `+`/`-`.
- **Timo:** dùng regex trên câu văn: `vừa (tăng|giảm) ([\d.]+) VND vào (dd/mm/yyyy HH:mm)`, `Số dư hiện tại: ([\d.]+)`, `Mô tả: (.*)`.
- Số tiền `2.570.000` được đổi thành `2570000n`. Thời gian được gắn múi `+07:00`.
- **Khớp mã đơn:** `description.toUpperCase().match(/<PREFIX>([A-Z0-9]+)/)`, **không bỏ khoảng trắng hay dấu chấm**, để `MBVCB.123.PMH456.DANG…` cho ra `456` chứ không nuốt cả phần text phía sau. Chỉ khớp khi `direction = in`.

### 2.5 Nguồn Apps Script (Hosted)

**Endpoint:** `POST /api/ingest` với các header `Authorization: Bearer <token>` và `Content-Type: message/rfc822`, body là raw MIME.
- Token được tra qua `sha256` trong `ingest_token_hash`. Sai token thì trả 401.
- Rate limit theo token.
- Phản hồi thành công: `200 {"ok":true,"status":"stored|duplicate|ignored|rejected"}`.

Dashboard sinh sẵn file `apps-script/Code.gs`, có điền URL và token:

```
setup()            -- user bấm Run một lần: cấp quyền, tạo trigger everyMinutes(1)
poll()             -- LockService → GmailApp.search('from:(…) after:<cursor-300>') → từng message
                      (không theo thread) có date > cursor → UrlFetchApp.fetchAll(getRawContent())
                      → nếu mọi response đều ok:true thì cursor = max(date); nếu có 5xx thì giữ nguyên cursor
```

- **State chỉ gồm một số `cursor`** (epoch) trong Script Properties. Mẫu tham khảo lưu cả map message ID, và map đó có thể vượt giới hạn 9KB của mỗi property khi có nhiều giao dịch. Ở đây server đã dedupe bằng `message_id`, nên chồng lấn 5 phút giữa các lần quét là an toàn.
- **Quota:** trigger chạy tổng 90 phút/ngày chia cho 1440 lần, tức khoảng 3,7 giây mỗi lần là đủ. `UrlFetch` được 20k lần/ngày.

### 2.6 Nguồn IMAP (Self-host)

Mỗi config có `source = imap` ứng với một kết nối `ImapFlow` nằm lâu dài trong `server.ts`:

```
connect(imap.gmail.com:993, gmail + App Password)
open mailbox có special-use \All       -- "All Mail", vì user có thể có filter đưa email ra khỏi INBOX
scan(): search { gmraw: 'from:(…) newer_than:1d' } → uid chưa gặp trong phiên → fetch { source: true } → ingestRawEmail
chạy scan() khi vừa kết nối và mỗi lần có event 'exists' (IDLE)
maxIdleTime 25 phút                    -- Gmail cắt kết nối IDLE sau khoảng 29 phút
'close'/'error' → reconnect, backoff 1s → 5 phút
auth fail → ingest_error = 'imap_auth_failed', dừng reconnect cho tới khi user cập nhật password
```

### 2.7 Chưa làm

- Gmail OAuth (P4).
- Email Worker (chỉ khi có domain).
- Tự động phát hiện ngân hàng mới: khi đó thêm một dòng vào `BANKS` và viết một parser.

---

## 3. Gửi webhook ✅

Học từ:
- `svix-webhooks` (chuẩn ký, danh sách IP bị chặn)
- `outpost` (lịch retry cố định)
- `convoy` (các trạng thái của delivery)
- `saasmail` (claim delivery bằng một UPDATE có điều kiện)
- `laravel-sepay` (phía nhận nên trả 2xx khi gặp bản trùng)

### 3.1 Request

```http
POST <webhook_url>
content-type: application/json
user-agent: PayMailHook/1.0
webhook-id: <delivery.id>                  # giữ nguyên qua mọi lần retry/resend, dùng để idempotency
webhook-timestamp: <unix seconds>          # mới cho mỗi lần gửi
webhook-signature: v1,<base64(HMAC-SHA256(secret, "{id}.{timestamp}.{body}"))>
```

```json
{
  "type": "payment.received",
  "timestamp": "2026-09-20T11:28:07.000Z",
  "data": {
    "orderId": "123456",
    "transaction": {
      "id": "…uuid…", "bank": "CAKE", "direction": "in",
      "amount": 149000, "currency": "VND",
      "description": "PMH123456", "bankTxnId": "500000001", "balanceAfter": null,
      "counterparty": { "name": "NGUYEN VAN A", "account": "123456***7890", "bank": "TIMO" },
      "occurredAt": "2026-09-20T11:28:07.000Z"
    }
  }
}
```

- **Ký theo [Standard Webhooks](https://www.standardwebhooks.com/),** tự viết khoảng 10 dòng bằng `crypto.subtle` (chạy được trên cả Workers lẫn Bun). Test đối chiếu với thư viện `standardwebhooks` (chỉ là devDependency) để bảo đảm phía nhận verify được bằng thư viện chuẩn ở mọi ngôn ngữ.
- **Payload** được sinh một lần khi tạo delivery và lưu vào `webhook_deliveries.payload`. Mỗi lần gửi đều dùng lại đúng body đó, chỉ timestamp và chữ ký là mới.
- **Secret** có dạng `whsec_` + base64 của 24 byte ngẫu nhiên, chỉ hiện một lần. Lưu bằng AES-GCM với khoá `ENCRYPTION_KEY` trong env. Khi xoay vòng thì thay luôn secret cũ.

### 3.2 Gửi một lần (`deliver(id, trigger)`)

```
1. Claim:  UPDATE webhook_deliveries
             SET next_attempt_at = now() + interval '60 s'           -- lease > timeout 10s
           WHERE id = $1 AND status IN ('pending','retrying')        -- (manual: cho phép cả failed/success)
             AND next_attempt_at <= now() + interval '5 s'           -- chấp nhận message tới sớm vài giây
           RETURNING *
           → không có dòng nào thì bỏ qua (đã có tiến trình khác claim, hoặc chưa tới hạn)
2. validateWebhookUrl(config.webhook_url)                            -- kiểm tra lại mỗi lần gửi
3. fetch(url, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
4. INSERT webhook_attempts (status_code | error, response_body ≤1KB, duration_ms, trigger)
5. 2xx                       → status = success, next_attempt_at = null
   lỗi (3xx/4xx/5xx/timeout) → attempt_count+1; còn lịch → status = retrying, next_attempt_at = now + delay,
                               scheduleDelivery(id, delay); hết lịch → status = failed
   lỗi khi trigger = manual  → giữ nguyên status, không lên lịch tiếp (giống svix)
```

**Lịch retry:** `[10, 10, 20, 30, 50, 3600, 7200, 14400, 28800]` giây. Tổng cộng 1 lần gửi đầu và 9 lần retry, tức 10 lần gửi trong khoảng **15 giờ**.

### 3.3 `scheduleDelivery(id, delaySeconds)`: hai cách triển khai

| | Hosted (Workers) | Self-host (Bun) |
|---|---|---|
| Hẹn giờ | `QUEUE.send({ id }, { delaySeconds })`. Consumer gọi `deliver()` rồi **luôn `ack()`** | `setTimeout(() => deliver(id), delay * 1000)` |
| Khôi phục | Cron mỗi giờ: `status IN (pending, retrying) AND next_attempt_at < now() - 2 min` → `QUEUE.send` | Khi khởi động: nạp mọi delivery `pending/retrying` rồi `setTimeout` theo `next_attempt_at` |

- Queue **không dùng `msg.retry()`** mà gửi một message mới cho mỗi lần retry. Như vậy không phụ thuộc giới hạn giữ message 24h hay `max_retries`, và trạng thái thật chỉ nằm trong DB.
- **Queue là at-least-once**, có thể giao trùng. Cron và bộ hẹn giờ cũng có thể chạy trùng nhau. Bước claim ở 3.2 bảo đảm mỗi lần gửi chỉ xảy ra một lần.
- **Chi phí:** mỗi lần gửi tốn khoảng 3 thao tác queue (send, read, ack). Mức 10k thao tác/ngày của gói free tương đương khoảng 3.000 lần gửi mỗi ngày.

### 3.4 Chặn SSRF (`validateWebhookUrl`)

Kiểm tra khi lưu config và trước mỗi lần gửi:
- Chỉ nhận `https:`.
- Không có `user:pass@`.
- Port để trống hoặc là 443.
- Hostname không phải IP literal (v4, `[v6]`, dạng thập phân/hex).
- Không phải `localhost`, `*.local`, `*.internal`, `*.localhost`, và không phải hostname của chính app.
- Luôn dùng `redirect: 'manual'`, nên phản hồi 3xx được tính là lỗi. Ngăn việc chuyển hướng tới địa chỉ nội bộ.

**Self-host** mặc định bật `ALLOW_PRIVATE_WEBHOOKS=true`, vì webhook thường trỏ về app trong LAN hoặc localhost. Khi bật thì cho phép `http:`, IP private và localhost.

`ponytail:` chưa tra DNS để chặn tên miền trỏ về IP private, cũng như DNS rebinding. Workers không cho kiểm soát socket. Khi cần thì thêm bước tra DoH (A/AAAA) và chặn theo danh sách `is_allowed` của svix.

### 3.5 Thao tác thủ công và dọn dẹp

- **Retry/Resend từ dashboard:** `POST /api/webhook-deliveries/:id/retry` gọi `scheduleDelivery(id, 0)` với `trigger = manual`. Được phép gửi lại cả delivery đã `success`; vì `webhook-id` giữ nguyên nên phía nhận vẫn dedupe được.
- **Test webhook:** nút "Gửi thử" gửi ngay (đồng bộ) một event `payment.test` có payload mẫu, không lưu delivery và không retry. Phản hồi hiện thẳng trên màn hình.
- **Cron mỗi giờ** (cùng job với phần khôi phục):
  - Xoá `webhook_deliveries` ở trạng thái `success/failed` có `created_at` quá 30 ngày; `webhook_attempts` bị xoá theo cascade.
  - Xoá `inbound_failures` quá 7 ngày.
  - Xoá theo batch có `LIMIT` (học từ `cloudflare_temp_email`).

### 3.6 Hướng dẫn phía nhận (đưa vào trang Guide ở P3)

1. Verify chữ ký bằng thư viện `standardwebhooks`, chấp nhận sai lệch timestamp tối đa 5 phút.
2. Dedupe theo `webhook-id`. **Gặp bản trùng thì vẫn trả 2xx**, nếu không retry sẽ tiếp tục dồn tới.
3. Đối chiếu `orderId` **và** `amount` với đơn hàng. Chỉ chuyển trạng thái đơn khi đang ở `pending`.
4. Trả 2xx trong vòng 10 giây. Việc nặng thì đưa vào queue của bạn rồi phản hồi ngay.

### 3.7 Chưa làm

- Tôn trọng header `Retry-After` khi nhận 429/503.
- Tự tắt endpoint lỗi liên tục (svix có tính năng này).
- Ký song song secret cũ và mới trong lúc xoay vòng (`v1,a v1,b`).
- Một config gửi tới nhiều webhook URL.

---

## 4. API và auth ✅

Học từ:
- `saasmail`: chuỗi middleware, scope theo user, dạng API key. Thiếu `onError` và rate limit, nên mình bổ sung.
- `react-starter-kit`: tách Hono app khỏi entry của từng runtime, và **không** parse env ngay khi nạp module.
- Skill `better-auth-security-best-practices`.

### 4.1 Tách app khỏi runtime

```
src/api/app.ts     createApp(): Hono<{ Variables: { deps: Deps; user?: User } }>   -- không import gì của Cloudflare/Bun
src/worker.ts      fetch: gắn deps (db qua Hyperdrive, QUEUE, DoH resolver, waitUntil) → app.fetch; queue(); scheduled()
src/server.ts      Bun.serve: gắn deps (db qua DATABASE_URL, setTimeout scheduler, node:dns) → app.fetch; IMAP listeners; startup recovery
```

`Deps = { db, auth, env, scheduleDelivery, resolveTxt, waitUntil, now }`. Mọi thứ phụ thuộc runtime đều được truyền vào qua đây, nên core và API test được bằng `bun test` với PGlite.

### 4.2 Middleware (theo thứ tự)

1. `app.onError`:
   - Lỗi zod → `400 {error:{code:'validation',issues}}`
   - `HTTPException` → giữ nguyên status
   - Lỗi khác → log rồi trả `500 {error:{code:'internal'}}`
2. `/api/auth/*` → `auth.handler(c.req.raw)`.
3. `csrf()` của Hono (kiểm tra `Origin`) cho các request không phải GET dùng cookie session. Request có API key hoặc ingest token thì bỏ qua bước này.
4. `requireUser` trên `/api/*`, trừ các path public (`/api/ingest`, `/api/qr`, `/api/share/*`): gọi `auth.api.getSession({ headers })`, chấp nhận **cả cookie lẫn API key**, rồi `c.set('user')`.
5. **Scope theo user:** mọi hàm truy vấn nhận `userId` làm tham số đầu tiên. Truy cập theo id dùng `WHERE id = $1 AND user_id = $2`; không tìm thấy thì trả **404**, không trả 403, để không lộ việc id đó có tồn tại.

CORS: SPA chạy cùng origin nên không cần. Riêng `/api/qr` mở `*`.

### 4.3 Routes

| Route | Auth | Ghi chú |
|---|---|---|
| `/api/auth/*` | – | better-auth: đăng ký/đăng nhập email, Google, session, **admin** (`listUsers`, `setRole`, `banUser`…), **apiKey** (tạo/xoá key). Không phải tự viết route admin |
| `GET /api/me` | user | |
| `GET/POST /api/email-configs` | user | POST trả về **ingest token và `Code.gs` một lần duy nhất** |
| `GET/PATCH/DELETE /api/email-configs/:id` | user | PATCH `webhook_url` có validate SSRF |
| `POST /api/email-configs/:id/rotate-token` | user | Trả token mới và `Code.gs` mới |
| `POST /api/email-configs/:id/rotate-secret` | user | Trả `whsec_…` mới một lần |
| `POST /api/email-configs/:id/test-webhook` | user | Gửi `payment.test` (xem 3.5) |
| `GET /api/transactions` | user | Lọc theo `configId`, `orderId`, `direction`. Phân trang keyset `(occurred_at, id)` |
| `GET /api/transactions/:id` | user | |
| `GET /api/webhook-deliveries` | user | Lọc theo `status` |
| `GET /api/webhook-deliveries/:id` | user | Kèm danh sách attempts |
| `POST /api/webhook-deliveries/:id/retry` | user | Xem 3.5 |
| `POST /api/ingest` | ingest token | Xem 2.5 |
| `GET /api/qr` | public | P3: ảnh VietQR dạng SVG |
| `/api/share/*`, `/api/push/*`, `/mcp` | | Lần lượt ở P3, P4, P4 |

Validate request bằng `@hono/zod-validator`. Frontend gọi qua `hc<AppType>()` để dùng chung type.

### 4.4 Cấu hình better-auth

```ts
betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true, disableSignUp: !env.ALLOW_SIGNUP },
  socialProviders: env.GOOGLE_CLIENT_ID ? { google: { … } } : {},  // scope mặc định openid/email/profile: non-sensitive, không cần CASA
  plugins: [admin(), apiKey({ enableSessionForAPIKeys: true })],   // tên option cần kiểm tra lại theo version khi code
  rateLimit: { enabled: true, storage: 'database',
               customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 3 } } },
  session: { cookieCache: { enabled: true, maxAge: 300 } },        // giảm query, đỡ đánh thức Neon
  trustedOrigins: [env.BETTER_AUTH_URL],
  advanced: { backgroundTasks: { handler: deps.waitUntil } },
  databaseHooks: { user: { create: { before: firstUserBecomesAdmin } } },
})
```

- **Không có domain nên không gửi được email.** Vì vậy mặc định **tắt xác minh email và luồng quên mật khẩu**:
  - Hosted khuyên đăng nhập bằng Google.
  - Admin có thể đặt lại mật khẩu cho user qua admin plugin.
  - Nếu có `RESEND_API_KEY` (khi đã có domain) thì tự bật xác minh email và quên mật khẩu.
- **User đầu tiên tự thành admin.** Tiện cho Self-host: vừa `docker compose up` xong là đăng ký, có quyền admin ngay.
- **Chống chiếm chỗ Gmail:** vì không xác minh email, kẻ gian có thể tạo config với Gmail của người khác để chặn họ. Cách xử lý:
  - `gmail` chỉ UNIQUE trong số các config **đã nhận ít nhất một email hợp lệ**, tức `last_ingest_at IS NOT NULL`. Nhận được email hợp lệ chứng minh người đó thật sự sở hữu Gmail, vì phải chạy được script trong đó, hoặc email phải có DKIM với `To` đúng Gmail đó.
  - Cron xoá các config chưa từng nhận email sau 7 ngày.

### 4.5 Env

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `DATABASE_URL` / binding `HYPERDRIVE` | ✅ | |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | ✅ | Fail ngay khi khởi động nếu thiếu, giống saasmail |
| `ENCRYPTION_KEY` | ✅ | AES-GCM cho webhook secret, App Password và raw email bị lỗi |
| `GOOGLE_CLIENT_ID/SECRET` | | Bật đăng nhập Google |
| `RESEND_API_KEY` | | Bật xác minh email và quên mật khẩu |
| `ALLOW_SIGNUP` | | Mặc định `true`. Self-host riêng tư thì đặt `false` |
| `ALLOW_PRIVATE_WEBHOOKS` | | Mặc định `false` cho Hosted, `true` cho Self-host |

Env được validate bằng zod **khi xử lý request đầu tiên**, không phải lúc nạp module (Workers chỉ có `env` bên trong handler).

### 4.6 Chưa làm

- Rate limit cho `/api/ingest` theo token. Hosted dùng binding Rate Limiting của Workers khi bị lạm dụng. `ponytail:` hiện tại token sai chỉ tốn một lần tra index.
- Audit log qua `databaseHooks`.
- 2FA/passkey.
- OpenAPI/Swagger. Chỉ thêm khi có nhu cầu công khai API cho bên thứ ba.

---

## 5. Chiến lược test ✅

Học từ:
- `react-starter-kit`: PGlite chạy migration thật, không cần DB riêng để test.
- `saasmail`: inject `fetch` thay vì patch global. Bài học ngược: DDL chép tay trong test bị lệch với schema thật.
- `cloudflare_temp_email`: harness tạo email giả.

**Công cụ:** `bun test`, không cần framework khác (D14). Chạy được trên máy dev dù không có `workerd`.

### 5.1 Các lớp test

| Lớp | Test gì | Cách làm |
|---|---|---|
| **Parser** (TDD, viết test trước) | `parseCake`, `parseTimo`: tiền vào/ra, số tiền có dấu chấm, múi +07:00, trích mã đơn trong `MBVCB.x.PMH456.DANG…` | Fixture `test/fixtures/{cake,timo}/*.eml` **đã ẩn danh**. So sánh với một snapshot `ParsedTxn` |
| **DKIM** | Các trường hợp: pass; sai `d=`; `To` không được ký; body bị sửa; có tag `l=`; lỗi `Date` của Timo (ký khi không có `Date`, sau đó chèn `Date` thì lần đầu fail, bỏ `Date` rồi verify lại thì pass) | **Tự sinh cặp khoá RSA khi test**, ký email tổng hợp bằng `mailauth/lib/dkim/sign`, resolver giả trả về public key. Không cần DNS thật, không dùng dữ liệu thật |
| **DKIM với email thật** | Mọi file trong `mail-template/` verify pass | `test.skipIf(!exists('mail-template'))`, dùng DNS thật. Chỉ chạy trên máy dev, CI bỏ qua |
| **Ingest** | Các kết quả: `stored`, `duplicate` (gửi cùng email hai lần), `ignored`, `rejected` (có dòng `inbound_failures`), khớp mã đơn thì tạo delivery và `scheduleDelivery` được gọi, `to_mismatch` với các biến thể của Gmail | PGlite, resolver giả, `scheduleDelivery` giả chỉ ghi lại id được gọi |
| **Webhook** | Chữ ký verify được bằng thư viện `standardwebhooks`; chuyển trạng thái theo lịch retry; hết lịch thì `failed`; thử thủ công mà lỗi thì không lên lịch tiếp; **gọi `deliver()` hai lần song song chỉ tạo ra một lần fetch** | `fetch` và `now` được inject |
| **SSRF** | `validateWebhookUrl` với bảng input: IP literal, `[::1]`, `0x7f000001`, `user:pass@`, port 8443, `.local`, kèm cờ `allowPrivate` | Test theo bảng |
| **API** | Chặn truy cập chéo user (tài nguyên của user khác trả 404); API key dùng được như session; `/api/ingest` sai token trả 401, DB lỗi trả 503; POST dùng cookie mà thiếu `Origin` bị chặn | `app.request()` của Hono với deps là PGlite; better-auth dùng chung PGlite |
| **Apps Script** | Cursor: chỉ tiến lên khi mọi request đều trả `ok:true`, giữ nguyên khi có 5xx; dedupe theo từng message (không theo thread) | Nạp `Code.gs` vào Bun, giả lập `GmailApp`, `UrlFetchApp`, `PropertiesService`, `LockService` |

### 5.2 Fixture

- **Tạo fixture:** `bun scripts/anonymize-eml.ts mail-template/ test/fixtures/` thay họ tên, số tài khoản và Gmail thật bằng giá trị giả cố định, rồi mới commit. DKIM của fixture chắc chắn fail, nên fixture chỉ dùng để test parser. Test DKIM thì dùng email tổng hợp đã ký ở 5.1.
- **DB:** mỗi file test tạo một PGlite mới rồi chạy `migrations/` bằng `drizzle-orm/pglite/migrator`. Test chạy trên **đúng migration thật**, không chép DDL bằng tay.

### 5.3 CI (GitHub Actions)

```
bun install → biome check → tsc --noEmit → bun test → wrangler deploy --dry-run
```

Bước `--dry-run` bắt lỗi bundle cho Workers, ví dụ có dependency kéo theo `node:sqlite` như spike ở research §3.

### 5.4 Kiểm tra bằng tay và spike (không tự động hoá)

- Apps Script: `getRawContent()` trên Gmail thật verify DKIM pass (sau khi xử lý `Date` của Timo).
- Workers: đo CPU time của `ingestRawEmail` với email CAKE 40KB so với giới hạn 10ms của gói free.
- IMAP: kết nối Gmail thật bằng App Password, nhận email mới qua IDLE, tự reconnect sau khi rút mạng.

### 5.5 Chưa làm

- E2E bằng Playwright (thêm ở P3, khi có dashboard).
- Test IMAP tự động với một IMAP server giả. Hàm `scan()` nhận client qua tham số nên có thể thêm sau.
- Đo coverage.
