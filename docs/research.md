# Research notes

Tài liệu này tổng hợp những gì học được từ payhook.codes, từ email mẫu thật, từ các repo open-source và từ các spike. Các quyết định rút ra được ghi trong [README](../README.md#quyết-định-đã-chốt).

## 1. payhook.codes

Thông tin lấy từ bundle JS và trang hướng dẫn công khai.

- **Kết nối Gmail:** Gmail OAuth với scope `gmail.readonly`, gọi `users.watch` rồi nhận Pub/Sub push. Watch hết hạn sau 7 ngày nên họ có scheduler tự gia hạn. App chưa được Google verify.
- **Khớp đơn hàng:** chỉ bắn webhook khi nội dung chuyển khoản chứa `PAYHOOK{orderId}`.
- **Payload:** `event: "transaction.detected"`, `orderId`, `transaction{transactionId, bank, amountVND, description}`.
- **Chữ ký:** `X-Payhook-Signature` (HMAC-SHA256) và `X-Payhook-Timestamp`. Mỗi cấu hình có một secret riêng, chỉ hiện một lần.
- **Retry:** 5 lần theo Fibonacci (10s, 10s, 20s, 30s, 50s), sau đó vào DLQ và retry sau 1h, 2h, 4h, 8h. Log giữ 30 ngày. Endpoint nhận phải trả lời trong 10s.
- **Chống SSRF:** bắt buộc HTTPS và domain, không dùng IP/localhost/IP nội bộ, chỉ port 80/443.
- **API:** `/api/auth/{login,register,refresh,google}`, `/api/email-configs` (CRUD, `send-test-email`), `/api/transactions`, `/api/webhook-logs`, `/api/users` (role, `me/api-key`), `/api/push/*`, `/api/qr/img`, `/api/share/transactions`, cùng các trang MCP/Xiaozhi.

## 2. Định dạng email (từ `mail-template/`, đã gitignore)

| | CAKE | Timo |
|---|---|---|
| Người gửi | `no-reply@cake.vn` (gửi qua Amazon SES) | `support@timo.vn` |
| DKIM | `d=cake.vn` và `d=amazonses.com`, ký cả `To` | `d=timo.vn`, key RSA 1024-bit, ký cả `To`, DMARC `p=QUARANTINE` |
| Body | Chỉ có HTML, dạng bảng label/value, **một template cho cả tiền vào lẫn tiền ra** | Chỉ có HTML, dạng câu văn |
| Số tiền, chiều | `Số tiền: +149.000 đ` / `-149.001 đ` | `vừa tăng/giảm 2.570.000 VND` |
| Mã giao dịch | `Mã giao dịch` | **Không có** |
| Số tài khoản | Dòng có `- Tài khoản thanh toán` là TK của mình; TK bên kia bị che (`123456***7890`) | **Không có** |
| Thời gian | `20/09/2026, 18:30:57` | `16/09/2026 09:49` |
| Nội dung chuyển khoản | `Nội dung giao dịch` (ví dụ `PAYHOOK123456`, giữ nguyên) | `Mô tả:` (ngân hàng bên chuyển có thể chèn tiền tố, ví dụ `MBVCB.<ref>.<nội dung>…`) |
| Số dư | Không có | `Số dư hiện tại` |

Mã đơn hàng chỉ nên dùng `[A-Z0-9]` và được tìm bằng regex ở bất kỳ vị trí nào trong nội dung.

## 3. Spike: verify DKIM

- **Cách chạy:** dùng `mailauth/lib/dkim/verify` (**không** dùng entry `mailauth`) với resolver DNS-over-HTTPS (`cloudflare-dns.com/dns-query`). Bundle cho Workers thành công (`wrangler deploy --dry-run`), khoảng 467KB sau gzip.
- **Entry chính của `mailauth` không bundle được:** nó kéo theo `undici`, mà `undici` import `node:sqlite`.
- **Kết quả với CAKE:** pass (`cake.vn` và `amazonses.com`).
- **Kết quả với Timo:** fail với file tải về, và `dkimpy` cũng cho kết quả giống hệt. **Nguyên nhân:** Timo gửi email không có header `Date`, Gmail tự thêm `Date: … -0700 (PDT)` khi nhận. Vì `h=` của DKIM có ký `Date` ở trạng thái rỗng, header thêm vào làm chữ ký hỏng. Bỏ `Date` đi thì cả 4 mẫu đều pass.
  - **Cách xử lý:** nếu verify thất bại, thử lại một lần sau khi bỏ header `Date`. Làm vậy vẫn an toàn vì hệ thống không tin `Date`: thời điểm giao dịch lấy từ body, mà body đã được ký.
  - **Chưa kiểm tra được:** email auto-forward sang Cloudflare có y hệt file tải về hay không. Cần spike trên Cloudflare thật.
- **Môi trường dev:** máy dev dùng glibc 2.31, không chạy được `workerd` (nó cần ≥2.32), và wrangler cần Node ≥22. Vì vậy local dev chạy trên Bun, còn `wrangler deploy` chỉ cần bước bundle.

## 4. Repo tham khảo (`repo-ref/`, đã gitignore)

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

| Repo | ★ | Học được gì | Cẩn thận |
|---|---|---|---|
| **saasmail** | 253 | Stack gần giống nhất: một Worker export `fetch`, `email`, `queue`, `scheduled`, dùng assets `run_worker_first`. Chuỗi middleware injectDb → session hoặc API key → role guard. Mẫu MCP dùng `@hono/mcp` và bọc mỗi tool bằng `guard(scope)`. API key `sk_` lưu dạng SHA-256. Web Push theo chuẩn VAPID. Retry kiểu outbox dùng UPDATE có điều kiện | Chỉ single-tenant, dùng D1. Webhook không có retry. Không có `onError`. DDL trong test chép tay nên lệch với schema thật |
| **cloudflare_temp_email** | 11.8k | Handler `email()`: parse một lần và cache lại; mỗi side effect có try/catch riêng; xoá dữ liệu cũ theo batch có `LIMIT` bằng cron; test bằng một `ForwardableEmailMessage` giả (`e2e/fixtures/mail-api.ts`) | Chỉ đọc `Authentication-Results`, có thể bị giả. Webhook gọi inline, không retry |
| **agentic-inbox** | 8k | Handler `email()` giới hạn 25MB và **throw** khi có lỗi tạm thời để Cloudflare retry (`setReject` thì bounce luôn) | Dùng Durable Object và R2, không hợp với Postgres |
| **react-starter-kit** | 23.7k | Tách Hono app không phụ thuộc runtime (`lib/app.ts`) khỏi `worker.ts` và `dev.ts`. Dùng Neon qua Hyperdrive với `postgres(max:1)`. Kiểu `Database` không phụ thuộc driver. Test DB bằng PGlite chạy migration thật. `secrets.required` trong wrangler | Chia 3 Worker, tRPC, Terraform: quá nặng cho mình |
| vmail | 1.5k | Một Worker với fallback SPA. Rate limit API key theo cửa sổ cố định | Comment trong code nói `setReject` sẽ retry, điều đó sai |
| svix-webhooks | 3.4k | Chuẩn ký `id.ts.body` → `v1,<b64>`, sai lệch timestamp tối đa 5 phút, danh sách chặn SSRF `is_allowed()`, xử lý `Retry-After` | Viết bằng Rust, chỉ đọc để học |
| outpost / convoy | | `ScheduledBackoff` (lịch retry cố định), state machine của delivery, xoá log theo retention | Viết bằng Go |
| inbox-zero / gmailpush | | Gmail `watch`, Pub/Sub, `history.list`, nếu sau này cần thêm OAuth | |
| my-money-went-bot | 5 | Parser CAKE (`handlers/email_parser.py`) | Xử lý cả forward tay, việc mà hệ thống này không hỗ trợ |
| mailauth / postal-mime / mailparser | | Verify DKIM/ARC, parse MIME (postal-mime chạy được trên Workers) | Xem mục 3 |
| vietnam-qr-pay | 173 | Encode VietQR theo EMVCo và CRC16 | |
| laravel-sepay | 24 | Contract webhook quen thuộc ở thị trường VN, dedupe theo `id` | Throw lỗi khi gặp bản trùng. Mình nên dặn phía nhận trả 2xx khi trùng |

## 5. Những lưu ý rút ra

- `message.setReject()` bounce email vĩnh viễn. Khi gặp lỗi tạm thời (ví dụ DB sập) thì phải **throw** để Cloudflare retry.
- Chỉ đọc `Authentication-Results` thì không đủ an toàn, vì header này có thể bị giả. Phải tự verify DKIM bằng mật mã, và cố định `d=` là domain của ngân hàng.
- Workers không cho kiểm soát DNS hay socket, nên không chặn được DNS rebinding. Chỉ làm được: kiểm tra URL khi lưu và trước mỗi lần gửi, tuỳ chọn tra DoH để chặn IP private, và dùng `redirect: 'manual'`.
- Secret webhook phải lưu **dạng mã hoá** (AES-GCM với một secret của Worker), không lưu dạng hash, vì cần secret gốc để ký.
- Không repo nào xử lý email xác nhận forwarding của Gmail (`forwarding-noreply@google.com`), nên phải tự làm phần này.
- Route `/.well-known/*` và `/mcp` phải đăng ký trước route catch-all của SPA.
