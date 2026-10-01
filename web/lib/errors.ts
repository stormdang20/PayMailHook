import { DetailedError } from 'hono/client';

const MESSAGES: Record<string, string> = {
  // API error codes
  validation: 'Dữ liệu không hợp lệ.',
  not_found: 'Không tìm thấy.',
  not_finished: 'Webhook này vẫn đang được gửi theo lịch, chưa thể gửi lại.',
  webhook_not_configured: 'Chưa cấu hình URL webhook.',
  unauthorized: 'Phiên đăng nhập đã hết, hãy đăng nhập lại.',
  // validateWebhookUrl reasons
  invalid_url: 'URL không hợp lệ.',
  https_required: 'URL webhook phải dùng https://.',
  credentials_not_allowed: 'URL không được chứa user:password.',
  port_not_allowed: 'Chỉ cho phép cổng 443.',
  ip_not_allowed: 'Không dùng địa chỉ IP, hãy dùng tên miền.',
  host_not_allowed: 'Không dùng localhost, tên miền nội bộ hoặc tên miền của PayMailHook.',
  invalid_protocol: 'Chỉ hỗ trợ http:// hoặc https://.',
  // ingest_error values
  to_mismatch: 'Email không được gửi tới Gmail này (hoặc Gmail đã được tài khoản khác sử dụng).',
  dkim_failed: 'Chữ ký DKIM của ngân hàng không hợp lệ.',
  parse_failed: 'Không đọc được nội dung email (ngân hàng có thể đã đổi mẫu).',
  malformed: 'Email bị lỗi định dạng.',
  imap_auth_failed: 'Đăng nhập IMAP thất bại, hãy cập nhật App Password.',
  gmail_auth_failed: 'Quyền đọc Gmail đã hết hạn hoặc bị thu hồi, hãy bấm "Kết nối Gmail" lại.',
  gmail_account_mismatch: 'Tài khoản Google vừa cấp quyền không phải Gmail của cấu hình này.',
  gmail_oauth_not_available: 'Máy chủ chưa bật Gmail OAuth.',
  gmail_connection_expired: 'Phiên kết nối Gmail đã hết hạn. Hãy bấm Đăng nhập với Google để thử lại.',
  password_exists: 'Tài khoản đã có mật khẩu, hãy dùng Đổi mật khẩu.',
};

export const describe = (code: string) => MESSAGES[code] ?? code;

/** Human message for an API error thrown by parseResponse (body `{ error: { code, reason? } }`). */
export function errorMessage(e: unknown) {
  if (e instanceof DetailedError) {
    const body = e.detail?.data as { error?: { code?: string; reason?: string } } | undefined;
    const code = body?.error?.reason ?? body?.error?.code;
    if (code) return describe(code);
  }
  return e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
}
