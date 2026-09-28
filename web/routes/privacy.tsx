import { PublicShell } from '@/components/public-shell';

const STORED = [
  ['Tài khoản', 'email, tên, mật khẩu đã băm (hoặc liên kết Google).'],
  [
    'Cấu hình',
    'địa chỉ Gmail, URL webhook, tiền tố mã đơn. Token nhận email chỉ lưu dạng băm; webhook secret và App Password IMAP được mã hoá AES-GCM.',
  ],
  [
    'Giao dịch',
    'các trường đọc từ email ngân hàng: số tiền, thời gian, nội dung, mã đơn, số dư (Timo), mã giao dịch (CAKE), tên/số tài khoản/ngân hàng người chuyển.',
  ],
  ['Lịch sử webhook', 'nội dung gửi đi và phản hồi (tối đa 1 KB), tự xoá sau 30 ngày.'],
  [
    'Email lỗi',
    'nguyên văn email chỉ được giữ khi không xác thực hoặc không đọc được, đã mã hoá, tự xoá sau 7 ngày, để sửa bộ đọc khi ngân hàng đổi mẫu.',
  ],
];

export function PrivacyPage() {
  return (
    <PublicShell>
      <article className="space-y-6 text-sm leading-relaxed">
        <h1 className="font-semibold text-2xl">Quyền riêng tư</h1>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">PayMailHook đọc gì</h2>
          <p>
            Chỉ email từ địa chỉ gửi thông báo của ngân hàng được hỗ trợ (<code>no-reply@cake.vn</code>,{' '}
            <code>support@timo.vn</code>). Với IMAP và Gmail OAuth, máy chủ chỉ tìm đúng các địa chỉ đó; với chuyển tiếp
            email, bộ lọc Gmail của bạn chỉ chuyển tiếp email của các địa chỉ đó. Mỗi email được kiểm tra chữ ký DKIM
            của ngân hàng trước khi dùng.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">Lưu những gì</h2>
          <dl className="space-y-2">
            {STORED.map(([title, text]) => (
              <div key={title}>
                <dt className="font-medium">{title}</dt>
                <dd className="text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
          <p>Nguyên văn email thành công không được lưu. Dữ liệu không được bán hay chia sẻ cho bên thứ ba.</p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">Link chia sẻ</h2>
          <p>
            Link chia sẻ do bạn tạo cho phép bất kỳ ai có link xem số tiền, thời gian, nội dung và mã đơn (không có
            thông tin người chuyển). Bạn có thể thu hồi bất cứ lúc nào.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">Xoá dữ liệu</h2>
          <p>
            Xoá một cấu hình Gmail sẽ xoá toàn bộ giao dịch và lịch sử webhook của nó. Để ngừng hẳn, hãy thu hồi App
            Password hoặc quyền truy cập của PayMailHook, hoặc tắt chuyển tiếp email trong tài khoản Google. Bản tự cài
            đặt (self-host) giữ mọi dữ liệu trên máy chủ của bạn.
          </p>
        </section>
      </article>
    </PublicShell>
  );
}
