# PayMailHook

**Chuyển email thông báo ngân hàng Việt Nam thành webhook thanh toán có chữ ký.**

PayMailHook đọc email biến động số dư từ **CAKE by VPBank** và **Timo**, cùng email nhận tiền **PayPal**, xác minh chữ ký DKIM của ngân hàng, lưu giao dịch và thông báo cho ứng dụng của bạn khi giao dịch tiền vào chứa mã đơn hàng. Bạn có thể tự triển khai bằng Docker hoặc chạy trên Cloudflare Workers.

[English](README.md) · **Tiếng Việt**

[![CI](https://github.com/stormdang20/PayMailHook/actions/workflows/ci.yml/badge.svg)](https://github.com/stormdang20/PayMailHook/actions/workflows/ci.yml)
[![Giấy phép: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

[Bắt đầu nhanh](#bắt-đầu-nhanh-với-docker) · [Triển khai Cloudflare](#triển-khai-lên-cloudflare-workers) · [Tài liệu API](docs/api.md) · [Báo lỗi](https://github.com/stormdang20/PayMailHook/issues)

## Mục lục

- [Tính năng](#tính-năng)
- [Ảnh chụp màn hình](#ảnh-chụp-màn-hình)
- [Cách hoạt động](#cách-hoạt-động)
- [Chọn cách triển khai](#chọn-cách-triển-khai)
- [Bắt đầu nhanh với Docker](#bắt-đầu-nhanh-với-docker)
- [Triển khai lên Cloudflare Workers](#triển-khai-lên-cloudflare-workers)
- [Kết nối nguồn email](#kết-nối-nguồn-email)
- [Cấu hình](#cấu-hình)
- [Tích hợp thanh toán](#tích-hợp-thanh-toán)
- [Dữ liệu và bảo mật](#dữ-liệu-và-bảo-mật)
- [Vận hành và xử lý lỗi](#vận-hành-và-xử-lý-lỗi)
- [Phát triển tại máy cá nhân](#phát-triển-tại-máy-cá-nhân)
- [Kiến trúc và cấu trúc thư mục](#kiến-trúc-và-cấu-trúc-thư-mục)
- [Giới hạn hiện tại](#giới-hạn-hiện-tại)
- [Đóng góp](#đóng-góp)
- [Ủng hộ dự án](#ủng-hộ-dự-án)
- [Tài liệu và giấy phép](#tài-liệu-và-giấy-phép)

## Tính năng

- **Ba nguồn email:** Gmail IMAP IDLE bằng App Password, Gmail OAuth với thông báo Pub/Sub, hoặc Gmail chuyển tiếp thư qua Cloudflare Email Routing.
- **Nhận diện thanh toán:** tùy chỉnh tiền tố mã đơn, lưu giao dịch tiền vào/ra, biểu diễn số tiền bằng số nguyên theo đơn vị nhỏ nhất kèm loại tiền (VND, hoặc loại tiền PayPal nhận) và chống trùng theo `Message-ID` của email.
- **Webhook có chữ ký:** theo Standard Webhooks, tự gửi lại khi lỗi, lưu lịch sử gửi, gửi sự kiện thử, gửi lại thủ công và đổi secret.
- **Dashboard:** tìm kiếm và lọc giao dịch, tự cập nhật mỗi năm giây khi trang giao dịch đang hiển thị, xem trạng thái kết nối email và nhật ký webhook. Giao diện hiện dùng tiếng Việt.
- **Công cụ thanh toán:** tạo VietQR dạng SVG cho ngân hàng được hỗ trợ, chia sẻ giao dịch bằng liên kết có thể thu hồi, và trang giao dịch tiền vào công khai dành cho thu ngân.
- **Tài khoản và tích hợp:** đăng nhập bằng email/mật khẩu hoặc tên đăng nhập, Google sign-in tùy chọn, API key, quản trị người dùng, Web Push trên trình duyệt và MCP server chỉ đọc.
- **Hai môi trường chạy, chung phần xử lý:** Bun và PostgreSQL khi tự vận hành; Cloudflare Workers, Hyperdrive, PostgreSQL và Queues khi dùng hạ tầng được quản lý.

| Ngân hàng | Địa chỉ gửi được chấp nhận | Tên miền DKIM | Trường dữ liệu bổ sung |
| --- | --- | --- | --- |
| CAKE by VPBank | `no-reply@cake.vn` | `cake.vn` | Mã giao dịch ngân hàng; thông tin đối tác giao dịch nếu có |
| Timo | `support@timo.vn` | `timo.vn` | Số dư sau giao dịch |
| PayPal (chỉ email nhận tiền) | `service@intl.paypal.com` | `intl.paypal.com` | Mã giao dịch PayPal; tên người gửi; ghi chú của người gửi làm nội dung; loại tiền (`USD`…) |

Mọi bộ phân tích đều đọc số tiền, chiều giao dịch, nội dung và thời gian giao dịch. PayMailHook theo dõi email thông báo: hệ thống không thực hiện chuyển tiền, giữ tiền hay kết nối API thanh toán của ngân hàng. Ứng dụng của bạn quản lý đơn hàng và quyết định giao dịch có đáp ứng yêu cầu thanh toán hay không.

## Ảnh chụp màn hình

Dữ liệu demo.

| | |
| --- | --- |
| <img src="docs/images/screenshots/landing.png" alt="Trang giới thiệu" /> | <img src="docs/images/screenshots/transactions.png" alt="Giao dịch từ CAKE, Timo và PayPal (USD)" /> |
| Trang giới thiệu | Giao dịch từ CAKE, Timo và PayPal (USD) |
| <img src="docs/images/screenshots/deliveries.png" alt="Lịch sử gửi webhook và lần thử lại" /> | <img src="docs/images/screenshots/qr.png" alt="Tạo mã VietQR có sẵn mã đơn" /> |
| Lịch sử gửi webhook và lần thử lại | Tạo mã VietQR có sẵn mã đơn |

## Cách hoạt động

```mermaid
flowchart TD
    Bank[CAKE / Timo / PayPal] --> Gmail[Hộp thư Gmail của bạn]
    Gmail --> IMAP[IMAP IDLE: chỉ trên Bun]
    Gmail --> OAuth[Gmail API + Pub/Sub]
    Gmail --> Forward[Gmail chuyển tiếp + Email Routing]
    IMAP --> Verify[Xác minh người gửi, người nhận được ký và DKIM ngân hàng]
    OAuth --> Verify
    Forward --> Verify
    Verify --> Parse[Phân tích email ngân hàng]
    Parse --> DB[(PostgreSQL: giao dịch và trạng thái gửi)]
    DB --> UI[Dashboard / REST API / MCP]
    DB --> Match{Tiền vào có mã đơn và URL webhook?}
    Match -->|Có| Delivery[Queue hoặc timer: ký, gửi, thử lại]
    Delivery --> App[Ứng dụng của bạn]
```

Với nội dung `PMH123456`, tiền tố mặc định là `PMH` và `orderId` trích xuất được là `123456`. Việc so khớp không phân biệt hoa/thường; mã trả về gồm chữ cái in hoa và chữ số. Tiền vào không có mã khớp và giao dịch tiền ra vẫn được lưu, nhưng không tạo webhook thanh toán.

Giao dịch và bản ghi gửi webhook được ghi trong cùng một transaction của cơ sở dữ liệu. Workers lên lịch gửi bằng Cloudflare Queues; Bun dùng timer và khôi phục các lần gửi chưa hoàn tất từ PostgreSQL khi khởi động. Tác vụ bảo trì chạy mỗi giờ để khôi phục lượt gửi quá hạn, gia hạn Gmail watch và xóa dữ liệu chẩn đoán hết hạn.

## Chọn cách triển khai

| | Docker / Bun | Cloudflare Workers |
| --- | --- | --- |
| Ứng dụng | Bun server chạy liên tục | Worker phục vụ API và SPA đã build |
| Cơ sở dữ liệu | PostgreSQL 17 có sẵn trong Compose | PostgreSQL qua Hyperdrive, ví dụ Neon |
| Nguồn email | IMAP, Gmail OAuth, chuyển tiếp | Gmail OAuth, chuyển tiếp |
| Lên lịch webhook | Timer với trạng thái lưu trong database | Cloudflare Queues với trạng thái lưu trong database |
| Bảo trì | Chu kỳ mỗi giờ | Cron Trigger mỗi giờ |
| URL ứng dụng công khai | Cần cho OAuth push và relay chuyển tiếp; IMAP chạy được ở máy cá nhân | URL Worker hoặc tên miền riêng |
| Tên miền bổ sung | Chỉ cần khi dùng chuyển tiếp | Chỉ cần khi dùng chuyển tiếp; OAuth dùng được URL Worker |

Docker với IMAP là cách thiết lập ngắn nhất cho nhu cầu cá nhân. Hạ tầng, tên miền và mức sử dụng dịch vụ có thể phát sinh chi phí; repository này không cam kết có dịch vụ hosted luôn miễn phí hoặc khả năng xử lý cố định trong gói miễn phí.

## Bắt đầu nhanh với Docker

Cần Git, Docker có Compose, OpenSSL để tạo secret và một Gmail nhận email thông báo từ ngân hàng được hỗ trợ.

### 1. Clone và cấu hình

```bash
git clone https://github.com/stormdang20/PayMailHook.git
cd PayMailHook
cp .env.example .env
openssl rand -base64 32
openssl rand -base64 32
```

Điền hai giá trị vừa tạo, khác nhau, vào `ENCRYPTION_KEY` và `BETTER_AUTH_SECRET` trong `.env`. Giữ `BETTER_AUTH_URL=http://localhost:3010` khi chạy tại máy cá nhân. Compose tự cung cấp URL database bên trong container; URL `localhost:5435` trong `.env.example` dành cho trường hợp chạy Bun trực tiếp.

### 2. Khởi động ứng dụng

```bash
docker compose up -d --build
docker compose logs -f app
```

Mở **http://localhost:3010** và đăng ký tài khoản. **Tài khoản đăng ký đầu tiên trở thành quản trị viên.** Dữ liệu PostgreSQL được lưu bền vững trong volume `pgdata`; ứng dụng tự áp dụng migration còn thiếu khi khởi động.

Nếu chỉ dùng riêng, đăng ký chủ sở hữu trước, đặt `ALLOW_SIGNUP=false` rồi chạy lại `docker compose up -d`. Khi công khai ứng dụng, đặt `BETTER_AUTH_URL` thành origin HTTPS công khai và cấu hình reverse proxy có TLS.

### 3. Kết nối Gmail và kiểm tra luồng xử lý

Làm theo [hướng dẫn IMAP](#imap-docker--bun), chọn ngân hàng và URL webhook nếu cần, rồi lưu secret `whsec_…` được hiển thị khi tạo cấu hình. Dùng chức năng **Gửi thử** để kiểm tra bên nhận webhook, sau đó xác minh việc nhận email bằng một thông báo ngân hàng mới. Webhook thử dùng dữ liệu mẫu, không chứng minh luồng nhận email đã hoạt động. Cấu hình chưa ingest thành công thư ngân hàng sẽ tự bị xóa sau bảy ngày.

## Triển khai lên Cloudflare Workers

Cần Git, Bun, Node.js **22.12+** cho Wrangler/Vite đang dùng trong dự án, OpenSSL, tài khoản Cloudflare và PostgreSQL mà Hyperdrive có thể kết nối. [Neon](https://neon.tech/) là một lựa chọn. Sau khi clone, chạy các lệnh từ thư mục gốc repository.

### 1. Cài dependency và chạy migration

```bash
bun install --frozen-lockfile
cp .env.example .env
```

Đặt `DATABASE_URL` trong `.env` thành chuỗi kết nối database triển khai, bao gồm tùy chọn TLS cần thiết, rồi chạy:

```bash
bun run db:migrate
bunx wrangler login
```

Workers **không** tự chạy migration khi khởi động. Áp dụng migration mới trước khi triển khai phiên bản cần thay đổi schema đó.

### 2. Tạo Hyperdrive và queue

Thay chuỗi kết nối mẫu bằng thông tin của bạn:

```bash
bunx wrangler hyperdrive create paymailhook \
  --connection-string='postgres://USER:PASSWORD@HOST/DATABASE?sslmode=require' \
  --caching-disabled
bunx wrangler queues create paymailhook-deliveries
```

Hướng dẫn này tắt cache kết quả truy vấn để các truy vấn xác thực và thanh toán đọc trạng thái database hiện tại. Xem tài liệu Cloudflare về [thiết lập Hyperdrive](https://developers.cloudflare.com/hyperdrive/get-started/) và [query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

Sửa [wrangler.jsonc](wrangler.jsonc):

- Thay `hyperdrive[0].id` bằng ID Hyperdrive **của bạn**. Giá trị có sẵn thuộc bản triển khai của dự án.
- Đặt `vars.BETTER_AUTH_URL` thành `https://paymailhook.<your-subdomain>.workers.dev` hoặc origin tên miền riêng.
- Giữ tên binding `HYPERDRIVE` và `QUEUE`. Nếu đổi tên queue, cập nhật cả producer lẫn consumer.
- Giữ `ALLOW_PRIVATE_WEBHOOKS` là `"false"` khi vận hành instance công khai cho nhiều người dùng.

### 3. Đặt secret và triển khai

Tạo hai giá trị riêng bằng `openssl rand -base64 32`, sau đó nhập khi được hỏi:

```bash
bunx wrangler secret put ENCRYPTION_KEY
bunx wrangler secret put BETTER_AUTH_SECRET
bun run deploy
```

Nếu Wrangler đề nghị tạo Worker khi lưu secret đầu tiên, dùng tên Worker trong `wrangler.jsonc`. Thông tin xác thực tùy chọn cũng được lưu bằng `wrangler secret put`; các thiết lập thông thường đặt trong `vars`. File `.env` tại máy cá nhân không thay thế secret trên Worker đã triển khai.

### 4. Bật nguồn nhận email

Cấu hình [Gmail OAuth](#gmail-oauth-và-đăng-nhập-google) hoặc [chuyển tiếp](#chuyển-tiếp-gmail). Workers không chạy listener IMAP. Mở origin vừa triển khai, đăng ký tài khoản chủ sở hữu và kết nối hộp thư. Cron Trigger mỗi giờ đã có sẵn trong cấu hình để thực hiện bảo trì.

## Kết nối nguồn email

### IMAP (Docker / Bun)

1. Bật Google 2-Step Verification và tạo [App Password](https://support.google.com/accounts/answer/185833) cho Gmail nhận thông báo ngân hàng. Chính sách tài khoản hoặc tổ chức có thể giới hạn tính năng này.
2. Thêm cấu hình email với **IMAP**, địa chỉ Gmail đó, App Password gồm 16 chữ cái và các ngân hàng cần xử lý. Có thể dán App Password có khoảng trắng.
3. Tùy chọn URL webhook và tiền tố mã đơn, rồi lưu secret webhook được hiển thị.

Server kết nối ra ngoài tới `imap.gmail.com:993` bằng TLS. Nguồn này không cần callback công khai hay dự án Google Cloud. Listener mới hoặc được cập nhật sẽ được nhận diện trong khoảng một phút. Hệ thống dùng hộp thư All Mail nếu có và tự kết nối lại với thời gian chờ tăng dần.

IMAP quét email ngân hàng trong một ngày gần nhất và bỏ qua thư nhận trước lúc tạo cấu hình. Đây không phải công cụ nhập lịch sử toàn bộ hộp thư.

### Gmail OAuth và đăng nhập Google

**Đăng nhập Google và cấp quyền đọc Gmail là hai việc riêng.** Đăng nhập cơ bản cần `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET`; nguồn Gmail cần thêm quyền Gmail và Pub/Sub.

Tạo Google OAuth client loại **Web application** với authorized redirect URI:

```text
<BETTER_AUTH_URL>/api/auth/callback/google
```

Ví dụ đăng nhập tại máy cá nhân: `http://localhost:3010/api/auth/callback/google`. Đặt đủ hai thông tin Google rồi khởi động lại hoặc triển khai lại. Đăng nhập cơ bản dùng quyền nhận diện tài khoản; quyền đọc Gmail chỉ được yêu cầu khi kết nối hộp thư.

Để bật nguồn Gmail:

1. Trong dự án Google Cloud chứa OAuth client, bật Gmail API và Pub/Sub API. Thêm `https://www.googleapis.com/auth/gmail.readonly` vào cấu hình consent.
2. Tạo Pub/Sub topic trong cùng dự án và cấp vai trò **Pub/Sub Publisher** trên topic cho `gmail-api-push@system.gserviceaccount.com`. Xem [hướng dẫn push của Google](https://developers.google.com/workspace/gmail/api/guides/push).
3. Tạo token bằng `openssl rand -hex 32`. Đặt `GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/<topic>` và `GOOGLE_PUBSUB_VERIFICATION_TOKEN` bằng token đó.
4. Tạo **push subscription** trỏ đến endpoint bên dưới, truy cập công khai qua HTTPS. Giữ JSON envelope mặc định, không bật payload unwrapping. Code hiện kiểm tra token trên query; không yêu cầu xác thực Pub/Sub bằng OIDC.

   ```text
   https://<your-host>/api/gmail/pubsub?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>
   ```

5. Khởi động lại hoặc triển khai lại. Chọn **Gmail OAuth** trong dashboard, chọn ngân hàng và URL webhook nếu cần, rồi cấp quyền bằng tài khoản Google nhận email ngân hàng.

PayMailHook lấy địa chỉ từ Google và chỉ tạo cấu hình sau khi cấp quyền thành công. Hủy cấp quyền không tạo cấu hình. Kết nối lại cùng cấu hình Gmail OAuth giữ nguyên thiết lập và secret webhook. Gmail được kết nối có thể khác địa chỉ dùng để đăng nhập PayMailHook.

Khi OAuth app ở chế độ **Testing**, thêm Gmail cần kết nối vào **Google Auth Platform → Audience → Test users**. Đăng nhập cơ bản thành công không đồng nghĩa đã được phép cấp quyền Gmail. External app ở chế độ Testing và yêu cầu quyền Gmail nhận refresh token hết hạn sau bảy ngày. Xem [hướng dẫn xác minh của Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) và [quy tắc hết hạn token](https://developers.google.com/identity/protocols/oauth2#expiration).

`gmail.readonly` cho phép đọc hộp thư và là **restricted scope**. Code lọc metadata người gửi trước khi tải nội dung gốc của thư ngân hàng, nhưng quyền được cấp không chỉ giới hạn ở email ngân hàng. Khi triển khai công khai, cần đáp ứng các yêu cầu xác minh và đánh giá bảo mật áp dụng của Google; đặt credential không có nghĩa ứng dụng đã được xác minh. Xem [yêu cầu về Gmail scope](https://developers.google.com/workspace/gmail/api/auth/scopes).

### Chuyển tiếp Gmail

Nguồn này cần tên miền có Cloudflare Email Routing, không cần credential Gmail OAuth hoặc App Password.

1. Bật Email Routing cho tên miền nhận thư và đặt `INBOUND_EMAIL_DOMAIN`, ví dụ `in.example.com`.
2. Với Workers, chuyển thư catch-all tới Worker PayMailHook chính. Với Bun, triển khai [email relay](deploy/email-relay/README.md), đặt cùng `INBOUND_WEBHOOK_SECRET` trên relay và server; relay gửi request có chữ ký tới `/api/inbound` công khai của server. Xem [hướng dẫn định tuyến Cloudflare](https://developers.cloudflare.com/email-service/get-started/route-emails/).
3. Thêm cấu hình **Chuyển tiếp email** với địa chỉ Gmail gốc nhận thông báo ngân hàng, ngân hàng đã chọn và URL webhook nếu cần. Sao chép địa chỉ `pmh-…@in.example.com` được tạo vào phần chuyển tiếp của Gmail. Gmail trong cấu hình phải khớp người nhận gốc được ký.
4. Hoàn tất xác nhận Gmail bằng mã hoặc liên kết hiển thị trên dashboard.
5. Tạo bộ lọc Gmail với ô **Từ** là `no-reply@cake.vn OR support@timo.vn`, chuyển các thư khớp tới địa chỉ đó. Chỉ chuyển tiếp email ngân hàng.

Dùng bộ lọc chuyển tiếp tự động của Gmail để giữ thông điệp gốc có chữ ký; soạn một email chuyển tiếp thủ công có thể làm mất những header cần thiết.

## Cấu hình

[.env.example](.env.example) là file mẫu tại máy cá nhân. Bun đọc `.env`; Compose truyền các biến được khai báo vào app; Workers dùng `vars`, secret và resource binding.

| Biến | Bắt buộc / mặc định | Mục đích |
| --- | --- | --- |
| `DATABASE_URL` | Bắt buộc cho Bun và migration | URL PostgreSQL. Compose ghi đè bằng URL nội bộ; Workers dùng `HYPERDRIVE.connectionString`. |
| `ENCRYPTION_KEY` | Bắt buộc | Đúng 32 byte ngẫu nhiên mã hóa base64; mã hóa mật khẩu IMAP, secret webhook và thư lỗi được lưu. |
| `BETTER_AUTH_SECRET` | Bắt buộc, ít nhất 32 ký tự | Secret xác thực; tạo riêng với khóa mã hóa. |
| `BETTER_AUTH_URL` | Bắt buộc; ví dụ `http://localhost:3010` | Origin công khai của ứng dụng cho xác thực và callback. |
| `PORT` | Bun / Compose: `3010` | Cổng Bun; với Compose chỉ đổi cổng host, container vẫn là `3010`. Cập nhật URL tương ứng. |
| `ALLOW_SIGNUP` | `true` | Cho phép tài khoản mới; tài khoản đầu tiên có quyền admin. |
| `ALLOW_PRIVATE_WEBHOOKS` | Bun / Compose: `true`; Workers: `false` | Cho phép HTTP và đích nội bộ khi bật. Đặt rõ theo phạm vi người dùng bạn tin cậy. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Cặp tùy chọn | Đăng nhập Google. Đặt cả hai hoặc không đặt. |
| `GOOGLE_PUBSUB_TOPIC` | Tùy chọn | Nhận email qua Gmail OAuth; cần credential Google và verification token. |
| `GOOGLE_PUBSUB_VERIFICATION_TOKEN` | Bắt buộc khi có topic | Token dùng chung trong URL Pub/Sub push. |
| `INBOUND_EMAIL_DOMAIN` | Tùy chọn | Cấu hình chuyển tiếp và tạo địa chỉ nhận thư. |
| `INBOUND_WEBHOOK_SECRET` | Bắt buộc cho relay chuyển tiếp tới Bun | Secret HMAC dùng chung; handler email trực tiếp của Worker chính không cần biến này. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Cặp tùy chọn | Web Push khi có tiền vào. Tạo bằng `bun scripts/generate-vapid.ts`. |
| `API_URL` | Phát triển: `http://localhost:3010` | Đích proxy `/api` của Vite. |

Biến tùy chọn để trống nghĩa là tắt. Giữ **`ENCRYPTION_KEY` cùng bản sao lưu database**: thay khóa khiến các giá trị đã mã hóa không đọc được. Đổi secret webhook riêng từng cấu hình là thao tác khác và vô hiệu secret cũ ngay lập tức.

Để dùng Web Push, cấu hình đủ hai khóa VAPID, truy cập trong secure context được trình duyệt hỗ trợ và bật thông báo trên dashboard. Trình duyệt phải được cấp quyền thông báo.

## Tích hợp thanh toán

[Tài liệu API đầy đủ](docs/api.md) cũng được phục vụ tại `/docs`. [Prompt tích hợp](docs/integration-prompt.md) cung cấp hợp đồng tích hợp cho coding agent thêm PayMailHook vào ứng dụng khác.

### Mã đơn và VietQR

Dùng `<prefix><orderId>`, ví dụ `PMH123456`. Tiền tố có 1–16 ký tự chữ hoặc số; mã đơn dùng `A-Z` và `0-9`. Tránh dấu phân cách trong mã: `PMHABC-123` khớp `ABC`, không phải `ABC123`. Hệ thống lấy chuỗi khớp đầu tiên trong nội dung.

Endpoint VietQR công khai trả về SVG:

```text
https://<your-host>/api/qr?bank=cake&acc=0123456789&amount=149000&des=PMH123456
```

Thay tài khoản mẫu bằng tài khoản nhận tiền của bạn. Chỉ chấp nhận `cake`, `timo` hoặc BIN tương ứng được hỗ trợ. Tạo QR không đăng ký đơn hàng hoặc khoản thanh toán đang chờ trong PayMailHook.

### Nhận webhook

Giao dịch tiền vào có mã khớp và URL webhook đã cấu hình tạo sự kiện theo cấu trúc sau (dữ liệu ví dụ):

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

Số tiền là số nguyên theo đơn vị nhỏ nhất của `currency` (`149000` VND, `209` USD = 2,09 USD); thời gian theo ISO 8601 UTC. Trường đặc thù ngân hàng không có dữ liệu sẽ là `null`. Header theo [Standard Webhooks](https://www.standardwebhooks.com/): `webhook-id`, `webhook-timestamp` và `webhook-signature`.

Bên nhận cần:

1. Xác minh chữ ký và timestamp trên **raw request body** bằng secret `whsec_…` của cấu hình. Xem [ví dụ Node.js, PHP và Python](docs/api.md#verify-the-signature).
2. Chống xử lý trùng theo `webhook-id`, trả `2xx` cho lần gửi đã xử lý. Các lần thử lại giữ nguyên ID và payload.
3. Xử lý `payment.test` mà không hoàn tất đơn. Với `payment.received`, kiểm tra mã đơn, đơn vị tiền tệ, số tiền cần trả và trạng thái đơn. Quy định cách xử lý trả thiếu hoặc thừa.
4. Ghi nhận bền vững việc tiếp nhận rồi trả `2xx` trong **10 giây**; xử lý tác vụ chậm theo cơ chế bất đồng bộ.

Lần gửi lỗi được thử lại sau **10 giây, 10 giây, 20 giây, 30 giây, 50 giây, 1 giờ, 2 giờ, 4 giờ và 8 giờ**: tối đa 10 lần tự động tính cả lần đầu. Hệ thống không đi theo redirect và coi redirect là lỗi. Lượt gửi đã hoàn tất có thể được gửi lại qua dashboard hoặc API; gửi lại thủ công cũng giữ nguyên `webhook-id` và payload, không bắt đầu chu kỳ thử lại tự động mới. Mỗi sự kiện đại diện cho một giao dịch chuyển tiền, không đảm bảo đơn đã được thanh toán đủ.

### REST API và MCP

Tạo API key trong dashboard. Giữ key ở phía server; mỗi key hoạt động với quyền của chủ sở hữu và có giới hạn **120 request mỗi phút**.

```bash
curl 'https://<your-host>/api/transactions?orderId=123456&direction=in' \
  -H 'x-api-key: <your-api-key>'
```

| Giao diện | Xác thực | Công dụng |
| --- | --- | --- |
| `/api/transactions` | Session hoặc `x-api-key` | Lọc và phân trang giao dịch |
| `/api/email-configs` | Session hoặc `x-api-key` | Quản lý nguồn, ngân hàng, tiền tố và đích webhook |
| `/api/webhook-deliveries` | Session hoặc `x-api-key` | Xem các lần gửi, gửi lại lượt đã hoàn tất |
| `/api/qr` | Công khai | VietQR SVG |
| `/api/share/t/{token}`, `/api/share/c/{token}` | Token công khai | Dữ liệu giao dịch được chủ động chia sẻ |
| `/mcp` | `Authorization: Bearer <api-key>` hoặc `x-api-key` | MCP Streamable HTTP không lưu session |

MCP cung cấp **`list_transactions`** và **`get_payment_status`**. Truyền `orderId` không gồm tiền tố. Khi có `amount`, `get_payment_status` kiểm tra tổng tiền vào khớp mã có đủ số tiền đó không; nếu không truyền `amount`, chỉ cần có một giao dịch tiền vào khớp là được coi đã thanh toán.

## Dữ liệu và bảo mật

- Thư ngân hàng phải khớp người gửi được chấp nhận và ngân hàng đã chọn, có DKIM hợp lệ theo tên miền ngân hàng với `From` và `To` được ký, đồng thời Gmail đã cấu hình phải nằm trong người nhận. Header `From`/`To` trùng và chữ ký DKIM chỉ bao phủ một phần body bị từ chối. Hàm ingest lõi từ chối thư gốc lớn hơn 2 MiB.
- Ứng dụng không giữ email gốc đã phân tích thành công. Giao dịch đã trích xuất được lưu trong PostgreSQL. Thư được ghi nhận với lỗi `malformed`, `to_mismatch`, `dkim_failed` hoặc `parse_failed` được mã hóa để chẩn đoán và đủ điều kiện dọn dẹp sau **bảy ngày**.
- Lượt gửi webhook đã hoàn tất và các lần thử đủ điều kiện dọn dẹp sau **30 ngày**. Giao dịch không tự hết hạn theo tuổi dữ liệu. Xóa cấu hình email sẽ xóa theo các giao dịch và lịch sử gửi liên quan.
- Bảo trì xóa cấu hình quá **bảy ngày** chưa từng ingest thành công thư ngân hàng, kể cả khi đã thiết lập OAuth hoặc chuyển tiếp thành công.
- Mật khẩu IMAP, secret webhook và thư lỗi được lưu dùng AES-GCM ở tầng ứng dụng. Token Google nằm trong kho tài khoản của Better Auth; `ENCRYPTION_KEY` của ứng dụng không mã hóa những cột token đó. Cần bảo vệ quyền truy cập database và bản sao lưu tương ứng.
- Có thể thu hồi liên kết chia sẻ công khai. Liên kết không trả các trường riêng về tên/số tài khoản đối tác, nhưng vẫn hiển thị nội dung chuyển khoản, có thể chứa thông tin cá nhân.
- Với `ALLOW_PRIVATE_WEBHOOKS=false`, URL phải dùng HTTPS cổng 443; chặn IP trực tiếp, localhost, một số hậu tố nội bộ và host của ứng dụng. **Chưa kiểm tra DNS có phân giải về IP nội bộ không**, nên đây chưa phải cơ chế cách ly SSRF hoàn chỉnh.

## Vận hành và xử lý lỗi

Dùng `docker compose logs -f app` với Bun hoặc `bunx wrangler tail` với Workers. `GET /api/config` công khai trả về các tính năng đã bật, không phải kiểm tra sức khỏe toàn diện cho database hay email. Dashboard hiển thị lần ingest thư ngân hàng thành công gần nhất và lỗi ingest mới nhất.

Sao lưu PostgreSQL cùng khóa mã hóa tương ứng. Trước khi cập nhật, đọc migration và sao lưu, sau đó build lại Docker bằng `docker compose up -d --build`; với Workers, áp dụng migration vào database triển khai trước `bun run deploy`. Dọn dẹp chạy mỗi giờ theo lô giới hạn, nên mốc lưu trữ là lúc đủ điều kiện xóa, không phải thời điểm xóa chính xác.

| Hiện tượng | Cần kiểm tra |
| --- | --- |
| Khởi động báo biến môi trường không hợp lệ | Secret bắt buộc, URL hợp lệ, khóa base64 giải mã thành 32 byte và đủ các cặp credential tùy chọn. |
| Không có lựa chọn IMAP | Chỉ Bun server hỗ trợ IMAP. |
| `imap_auth_failed` | Cập nhật App Password trong cấu hình để xóa lỗi và khởi động lại listener. |
| Gmail báo `403 access_denied` | Thêm **Gmail cần kết nối** vào test users của dự án OAuth; kiểm tra consent. |
| `redirect_uri_mismatch` | Callback đã đăng ký phải trùng chính xác `BETTER_AUTH_URL` cộng `/api/auth/callback/google`. |
| `gmail_auth_failed` | Cấp quyền lại Gmail; kiểm tra token Testing hết hạn, quyền bị thu hồi và quyền publish topic. |
| OAuth thành công nhưng không có giao dịch | Kiểm tra URL/token subscription, JSON envelope, ngân hàng đã chọn và email mới sau khi kết nối. |
| Không thấy xác nhận chuyển tiếp | Kiểm tra tên miền nhận thư, catch-all Worker, địa chỉ được tạo và cấu hình relay cho Bun. |
| `dkim_failed`, `to_mismatch`, `parse_failed` | Kiểm tra người nhận gốc, thư nguyên vẹn, người gửi và mẫu ngân hàng. Gmail đã được cấu hình khác xác nhận quyền sử dụng cũng trả `to_mismatch`. |
| Cấu hình biến mất sau một tuần | Bảo trì xóa cấu hình quá bảy ngày chưa từng ingest thành công email ngân hàng. |
| Có giao dịch nhưng không có webhook | Kiểm tra chiều tiền vào, tiền tố/mã đơn và URL webhook **tại lúc ingest**. Thêm URL sau đó không tạo lượt gửi cho giao dịch cũ. |
| Webhook lỗi hoặc hết thời gian | Kiểm tra secret, xác minh raw body, kết nối tới đích và phản hồi `2xx` trong 10 giây; xem lịch sử các lần gửi. |
| API trả `429` | Chờ theo `Retry-After`; key cho phép 120 request/phút. |
| Đăng nhập bị giới hạn sau reverse proxy | Bun dùng IP socket của proxy; các client đó dùng chung bộ đếm giới hạn. |
| API local hoạt động nhưng thiếu giao diện | Chạy `bun run build` để có SPA trên cổng 3010, hoặc `bun run dev:web` để dùng Vite. |

## Phát triển tại máy cá nhân

Dùng Bun **1.3+**, Node.js **22.12+** cho tooling, OpenSSL để tạo hai secret và PostgreSQL local. Dockerfile dùng Bun 1.3; Compose dùng PostgreSQL 17.

```bash
bun install --frozen-lockfile
cp .env.example .env
```

Đặt hai secret và `DATABASE_URL` cho PostgreSQL local. File mẫu giả định cổng `5435`; database trong Compose **không được publish ra host**, nên chỉ chạy `docker compose up -d db` chưa làm URL đó hoạt động. Dùng database có thể truy cập riêng hoặc Compose override local để mở cổng database.

Để tạo database phát triển mới, riêng biệt và khớp `.env.example`, có thể chạy:

```bash
docker run -d --name paymailhook-dev-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=paymailhook \
  -p 127.0.0.1:5435:5432 \
  -v paymailhook-dev-pgdata:/var/lib/postgresql/data \
  postgres:17-alpine
docker exec paymailhook-dev-db pg_isready -U postgres -d paymailhook
```

Chờ lệnh kiểm tra báo database đã nhận kết nối. Credential ví dụ này dành cho database phát triển local. Trong các lần làm việc sau, khởi động container đã có bằng `docker start paymailhook-dev-db`.

```bash
bun run db:migrate
bun run build
bun run dev
```

Bun phục vụ API và SPA đã build tại `http://localhost:3010`, đồng thời áp dụng migration còn thiếu khi khởi động. Để hot reload frontend, chạy `bun run dev:web` trong terminal thứ hai và mở `http://localhost:5173`; Vite proxy `/api` tới Bun. Dùng origin backend để thử OAuth callback và truy cập `/mcp`, vì Vite không proxy đường dẫn MCP.

| Lệnh | Mục đích |
| --- | --- |
| `bun run dev` | Backend watch mode và quản lý listener IMAP |
| `bun run dev:web` | Vite hot reload |
| `bun run typecheck` | Kiểm tra TypeScript |
| `bun run lint` | Kiểm tra lint và định dạng bằng Biome |
| `bun run test` | Unit/integration test với Bun và PGlite |
| `bun run check` | Biome, TypeScript rồi test |
| `bun run build` | Build SPA vào `dist/client` |
| `bun run build:worker` | Build SPA và bundle Worker dạng dry run, không triển khai |
| `bun run e2e` | Playwright với PGlite server riêng |
| `bun run db:generate` | Tạo Drizzle migration sau khi đổi schema |
| `bun run db:migrate` | Áp dụng migration vào `DATABASE_URL` |

Unit/integration test không cần PostgreSQL bên ngoài. Playwright build SPA và khởi động `e2e/server.ts` trên cổng `4455`; chạy local dùng Google Chrome đã cài. Để chạy Chromium giống CI:

```bash
bunx playwright install --with-deps chromium
CI=1 bun run e2e
```

[CI](.github/workflows/ci.yml) chạy `check`, `build:worker` và test trình duyệt. Các bước này không thay thế kiểm thử với email ngân hàng thật và hạ tầng Google/Cloudflare đã triển khai.

## Kiến trúc và cấu trúc thư mục

Backend: **TypeScript, Hono, Drizzle ORM, postgres.js, Better Auth**. Frontend: **React, Vite, React Router, TanStack Query, Tailwind CSS, shadcn/ui**. Xử lý email: `postal-mime`, `mailauth` với DNS-over-HTTPS và `imapflow`.

```text
src/
  core/               Ingest, parser, DKIM, auth, gửi webhook, bảo trì dùng chung
    db/               Schema PostgreSQL, driver, migration lúc khởi động Bun
  api/                Hono route, middleware xác thực, endpoint MCP
  imap.ts             Gmail IMAP IDLE và quản lý kết nối lại
  server.ts           Bun HTTP, SPA, IMAP, timer, migration lúc khởi động
  worker.ts           Worker handler: fetch, email, queue, scheduled
web/                  Dashboard, trang công khai, service worker
deploy/email-relay/   Relay chuyển tiếp Cloudflare cho Bun
migrations/           Drizzle SQL migration được quản lý phiên bản
scripts/              Tạo VAPID và ẩn danh fixture
test/                 Test Bun/PGlite và fixture ngân hàng đã ẩn danh
e2e/                  Kịch bản Playwright và test server
docs/                 API, thiết kế, nghiên cứu, lịch sử triển khai
```

## Giới hạn hiện tại

- Chỉ có bộ phân tích mẫu CAKE, Timo và email nhận tiền PayPal tiếng Việt; email PayPal khác (mua hàng, ủy quyền, thông báo) bị bỏ qua. Ngân hàng đổi mẫu hoặc địa chỉ gửi có thể cần cập nhật parser.
- Khả năng nhận diện phụ thuộc email của ngân hàng và dịch vụ nhận thư. Không có cam kết độ trễ nhận diện hay đối soát trực tiếp với ngân hàng.
- IMAP và Gmail OAuth bỏ qua thư nhận trước lúc tạo cấu hình. Khôi phục IMAP và fallback khi Gmail history hết hạn chỉ xem thư gần đây, không đọc toàn bộ lịch sử; fallback Gmail hiện lấy một trang kết quả. Nguồn Gmail chưa có polling bù dữ liệu định kỳ độc lập với Pub/Sub.
- Dashboard polling mỗi năm giây, có thể khiến database hosted tiếp tục hoạt động khi trang đang mở.
- Chưa có xác minh email hoặc khôi phục quên mật khẩu qua email; chưa cấu hình dịch vụ gửi thư cho các luồng này.
- Kiểm tra URL webhook chưa kiểm tra DNS trả IP nội bộ; Bun chưa hỗ trợ nhận diện IP qua trusted proxy. Xem [dữ liệu và bảo mật](#dữ-liệu-và-bảo-mật) và [xử lý lỗi](#vận-hành-và-xử-lý-lỗi).
- Test và bundle Worker thành công chưa chứng minh độ tin cậy đầu cuối với dịch vụ thật. Cần đo CPU Worker cho DKIM/parser và kiểm thử kết nối lại, Pub/Sub, Web Push, gửi lại webhook trên bản triển khai của bạn.

## Đóng góp

Dự án đón nhận báo lỗi, cải thiện tài liệu, bản dịch và mẫu ngân hàng bổ sung qua [GitHub Issues](https://github.com/stormdang20/PayMailHook/issues) và pull request.

1. Mô tả vấn đề hoặc hành vi đề xuất, cách triển khai và các bước tái hiện.
2. Giữ thay đổi đúng phạm vi. Kiểm thử hành vi thay đổi và chạy `bun run check`; dùng `bun run build:worker` khi đổi runtime/bundle và `bun run e2e` cho luồng UI bị ảnh hưởng.
3. Với parser ngân hàng, cung cấp fixture **đã ẩn danh** và test. `scripts/anonymize-fixtures.ts` xử lý các mẫu local hiện có; kiểm tra kết quả trước khi commit.
4. Cập nhật cả hai README khi đổi cách cài đặt hoặc hành vi chung. Đồng bộ tài liệu API khi đổi endpoint hoặc payload.

Không đưa email ngân hàng thật, thông tin tài khoản, credential hoặc URL webhook riêng vào issue công khai hay commit. Fixture gốc local đặt trong `mail-template/` đã được ignore; fixture được commit nằm ở `test/fixtures/`.

## Ủng hộ dự án

Nếu PayMailHook giúp ích cho bạn, bạn có thể mời mình ly cà phê bằng cách quét mã VietQR dưới đây với bất kỳ app ngân hàng nào ([mở mã QR](https://paymailhook.stormdang20.workers.dev/api/qr?bank=timo&acc=9007041226179&des=PMH-donate)):

<a href="https://paymailhook.stormdang20.workers.dev/api/qr?bank=timo&acc=9007041226179&des=PMH-donate"><img src="docs/images/donate-qr.svg" alt="Mã VietQR ủng hộ PayMailHook qua Timo" width="200" /></a>

Ngân hàng **Timo**, số tài khoản `9007041226179`, nội dung `PMH-donate`. Cảm ơn bạn!

## Tài liệu và giấy phép

| Tài liệu | Mục đích |
| --- | --- |
| [Tài liệu API](docs/api.md) | Endpoint, ví dụ xác minh webhook, MCP |
| [Prompt tích hợp](docs/integration-prompt.md) | Hướng dẫn coding agent tích hợp ứng dụng |
| [Email relay](deploy/email-relay/README.md) | Cấu hình chuyển tiếp cho Bun |
| [Thiết kế](docs/design.md) | Kiến trúc và quyết định thiết kế ban đầu |
| [Nghiên cứu](docs/research.md) | Khảo sát ban đầu và dự án tham khảo |
| [Kế hoạch triển khai](docs/plans/2026-09-24-paymailhook.md) | Các giai đoạn triển khai trước đây |
| [Thay đổi so với kế hoạch](docs/plans/2026-09-24-paymailhook-deviations.md) | Điều chỉnh thiết kế và nguồn nhận email đã bỏ |

Tài liệu thiết kế/kế hoạch có các đề xuất trong quá khứ; README này và code hiện tại mô tả cách thiết lập được hỗ trợ. Apps Script và đường dẫn `/api/ingest` cũ không còn được hỗ trợ.

Dự án sử dụng **[giấy phép Apache License 2.0](LICENSE)**.
