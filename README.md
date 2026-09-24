# PayMailHook

Nhận tiền chuyển khoản tự động bằng cách đọc **email biến động số dư** của ngân hàng, rồi bắn **webhook** về hệ thống của bạn khi nội dung chuyển khoản chứa mã đơn hàng. Tính năng tương đương [payhook.codes](https://payhook.codes). Mã nguồn mở, có hai cách dùng: **Hosted** (dùng chung bản chạy miễn phí trên Cloudflare) và **Self-host** (chạy Docker trên máy của bạn).

> **Trạng thái:** đang thiết kế, chưa có code. Chi tiết nghiên cứu nằm ở [docs/research.md](docs/research.md).

Ngân hàng hỗ trợ: **CAKE by VPBank** và **Timo**.

---

## Cách hoạt động

```
Ngân hàng ──► Gmail của user
                 │
                 ├─ Hosted:    Apps Script (trigger mỗi 1 phút) ── POST /api/ingest (Bearer token) ─┐
                 ├─ Self-host: container kết nối IMAP IDLE (App Password) ──────────────────────────┤ raw MIME
                 └─ (sau này)  Gmail OAuth + Pub/Sub, tuỳ chọn 1-click như payhook ─────────────────┘
                                                                                                    ▼
  1. xác định email config (qua token / tài khoản IMAP)
  2. verify DKIM (d= đúng domain ngân hàng) + header To = Gmail của config
  3. parse theo ngân hàng → { amount, direction, description, bankTxnId?, occurredAt }
  4. lưu transaction (unique Message-ID)
  5. description chứa <PREFIX><orderId>? ──► tạo delivery ──► scheduleDelivery()
                                                                                                    ▼
        ký Standard Webhooks ──► POST webhook URL của user
        retry 10s,10s,20s,30s,50s,1h,2h,4h,8h ──► failed
```

| | Hosted | Self-host |
|---|---|---|
| Nhận email | Apps Script trong Gmail của user | IMAP IDLE, container tự kết nối ra ngoài (không cần URL public) |
| Runtime | Cloudflare Workers + Queues + Cron, Neon Postgres | Docker compose: Bun server + Postgres |
| Chi phí | 0 đồng, không cần domain (`*.workers.dev`) | 0 đồng |

## Phạm vi (đủ tính năng như payhook, chia pha)

| Pha | Tính năng |
|---|---|
| **P1 Core** | `POST /api/ingest` và Apps Script, verify DKIM, parser CAKE và Timo, lưu giao dịch, khớp mã đơn, gửi webhook (ký, retry, log 30 ngày, chặn SSRF) |
| **P2 Tài khoản** | Đăng ký/đăng nhập (email+password, Google), email config CRUD, trang tạo Apps Script có sẵn token, trạng thái "lần nhận email gần nhất", xoay vòng token và webhook secret, API key |
| **P2.5 Self-host** | Docker compose, nhận email bằng IMAP IDLE, retry webhook bằng bộ hẹn giờ trong process |
| **P3 Dashboard** | Giao dịch realtime, webhook logs và retry thủ công, tạo QR (VietQR), link chia sẻ giao dịch, trang hướng dẫn tích hợp, trang Privacy |
| **P4 Mở rộng** | Web Push, admin (quản lý user, phân quyền), MCP server (Xiaozhi AI), **Gmail OAuth** (tuỳ chọn 1-click, có cảnh báo "unsafe" cho tới khi qua CASA) |

## Quyết định đã chốt

| # | Quyết định | Phương án đã cân nhắc | Lý do |
|---|---|---|---|
| D1 | Lộ trình: tự dùng trước, lên SaaS sau, nhưng **đủ tính năng và multi-tenant ngay từ đầu** | Làm MVP tối giản | Mục tiêu là tương đương payhook. Sửa schema thành multi-tenant về sau thì rất tốn công |
| D2 | Nhận email: **Apps Script** (Hosted), **IMAP IDLE** (Self-host), **Gmail OAuth** là tuỳ chọn ở P4. Mọi đường đều đưa raw MIME vào cùng một hàm core | Gmail auto-forward + Email Worker; chỉ dùng OAuth | Forwarding cần domain và nhiều bước cài đặt. `forwardingAddresses.create` chỉ dành cho Workspace. OAuth với `gmail.readonly`/`settings.basic` là restricted scope (cảnh báo "unsafe", tối đa 100 user, CASA). Apps Script chạy dưới quyền chính user nên không bị Google bắt verify. IMAP chạy được trên localhost vì chỉ kết nối ra ngoài |
| D3 | Ngân hàng: CAKE và Timo | | Có email mẫu thật của cả hai |
| D4 | Hosted chạy trên Cloudflare Workers (free). Self-host chạy Bun trong Docker. Phần **core là TS thuần**, dùng chung cho cả hai | Vercel Hobby | Gói Hobby của Vercel cấm dùng thương mại, cron chỉ chạy mỗi ngày một lần và không có queue. Workers free có 100k request/ngày, Queues và Cron |
| D5 | Khoá chống trùng là `Message-ID` (nằm trong phần được DKIM ký) | `transactionId` | Email Timo không có mã giao dịch |
| D6 | Chống giả mạo và replay: DKIM pass với `d=cake.vn`/`timo.vn` **và** `To` phải là Gmail đã đăng ký | Đọc `Authentication-Results`, đối chiếu số TK | Header `Authentication-Results` có thể bị giả. Timo không có số TK. Cả hai ngân hàng đều ký `To` |
| D7 | Postgres (Neon) qua **Hyperdrive + postgres.js**, ORM Drizzle | Cloudflare D1 | Cùng driver chạy được trên Workers và Bun, có transaction. Chuyển host không phải migrate |
| D8 | Một package, **một Worker** phục vụ cả API lẫn SPA (assets + `run_worker_first`) | Monorepo, nhiều Worker (react-starter-kit) | Ít thành phần hơn. Đặt ranh giới bằng thư mục, không cần tách package |
| D9 | Frontend: React + Vite SPA, React Router, TanStack Query, shadcn/ui, Tailwind | Next.js | Deploy chung Worker, giống payhook và saasmail. Next.js trên Workers phải qua OpenNext |
| D10 | API: Hono + zod-validator, frontend dùng `hono/client` để có type | tRPC, zod-openapi | Có type end-to-end mà không cần thêm một lớp |
| D11 | Auth: **better-auth** (email+password, Google chỉ xin `openid email`, admin plugin, api-key plugin) | Tự viết JWT | Có sẵn roles và API key. Google Login không phải qua CASA |
| D12 | Webhook theo **[Standard Webhooks](https://www.standardwebhooks.com/)**: `webhook-id`, `webhook-timestamp`, `webhook-signature`, secret `whsec_…` | Header tự đặt `X-Payhook-*` | Phía nhận có thư viện verify sẵn cho mọi ngôn ngữ, hỗ trợ xoay vòng secret |
| D13 | Retry theo lịch 10s,10s,20s,30s,50s,1h,2h,4h,8h, trạng thái lưu trong DB. `scheduleDelivery()` có 2 cách triển khai: **Cloudflare Queues** (Hosted) và **bộ hẹn giờ trong process + quét lại khi khởi động** (Self-host). Cron **mỗi giờ** đẩy lại các delivery bị kẹt. Chỉ 2xx mới tính là thành công, `redirect: 'manual'` | Queue DLQ riêng, Svix, cron 5 phút | Một lịch retry dùng cho cả hai giai đoạn. Cron 5 phút sẽ giữ Neon thức 24/7 (khoảng 180 CU-giờ, vượt mức free 100) |
| D14 | Test bằng **`bun test`** cộng **PGlite**. Không dùng `vitest-pool-workers`/`wrangler dev` | vitest-pool-workers (saasmail) | Máy dev dùng glibc 2.31, không chạy được `workerd`. Core là TS thuần nên test trên Bun là đủ |
| D15 | Không lưu raw email. Chỉ lưu các trường đã parse; raw MIME chỉ giữ khi **parse lỗi** (mã hoá, 7 ngày) để viết thêm parser | Lưu toàn bộ (saasmail) / không lưu | Đảm bảo quyền riêng tư như payhook, mà vẫn debug được khi ngân hàng đổi template |
| D16 | Lint/format: Biome | oxlint/Prettier | Theo quy ước của team |
| D17 | Chạy **hoàn toàn trên gói free**: Workers, Queues (10k thao tác/ngày), Hyperdrive (100k query/ngày), Neon (0.5GB, 100 CU-giờ) | Gói trả phí | Mục tiêu là mã nguồn mở và miễn phí. Rủi ro: giới hạn 10ms CPU mỗi lần chạy khi verify DKIM và parse, cần đo |

## Stack

TypeScript · Bun · Hono · Drizzle · Postgres (Neon + Hyperdrive) · better-auth · Cloudflare Workers / Queues / Cron · Google Apps Script · `imapflow` (Self-host) · React · Vite · TanStack Query · shadcn/ui · `mailauth` (verify DKIM qua DNS-over-HTTPS) · `postal-mime` · `vietnam-qr-pay` · Biome

## Cấu trúc thư mục (dự kiến)

```
src/
  core/          # TS thuần, không import Cloudflare: dkim, parsers/{cake,timo}, match, webhook-sign, services
    db/          # schema Drizzle (pg-core), kiểu Database không phụ thuộc driver
  api/           # Hono app (chỉ phụ thuộc core)
  worker.ts      # entry Hosted: fetch, queue, scheduled
  server.ts      # entry Self-host/dev: Bun.serve + IMAP listener + bộ hẹn giờ retry
apps-script/     # Code.gs cho user dán vào Gmail
web/             # React SPA
migrations/      # drizzle-kit
test/fixtures/   # .eml đã ẩn danh (mail-template/ gốc nằm trong .gitignore)
```

## Việc tiếp theo

- [x] Design chi tiết: [docs/design.md](docs/design.md) (schema, luồng nhận email, webhook, API/auth, test)
- [ ] Kế hoạch triển khai: [docs/plans/2026-09-24-paymailhook.md](docs/plans/2026-09-24-paymailhook.md)
- [ ] Spike: `getRawContent()` của Apps Script có trả về raw giống hệt "Download original" không; đo CPU time trên Workers
