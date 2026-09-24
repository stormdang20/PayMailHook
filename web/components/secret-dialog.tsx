import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export type Secret = { label: string; value: string; multiline?: boolean };

const copy = (value: string) =>
  navigator.clipboard.writeText(value).then(
    () => toast.success('Đã copy'),
    () => toast.error('Không copy được, hãy chọn và copy thủ công'),
  );

const APPS_SCRIPT_STEPS = [
  'Mở script.google.com bằng chính tài khoản Gmail này, chọn "Dự án mới".',
  'Xoá code mẫu, dán toàn bộ script bên dưới rồi bấm Lưu.',
  'Chọn hàm setup, bấm Chạy, rồi cấp quyền (Nâng cao → Đi tới dự án (không an toàn) → Cho phép).',
  'Xong. Script kiểm tra hộp thư mỗi phút; mục "Email gần nhất" cập nhật khi có email ngân hàng mới.',
];

/** Shows values the server returns exactly once (token, webhook secret, Code.gs). */
export function SecretDialog({ secrets, onClose }: { secrets: Secret[] | null; onClose: () => void }) {
  const withScript = secrets?.some((s) => s.multiline);
  return (
    <Dialog open={secrets !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lưu lại ngay</DialogTitle>
          <DialogDescription>
            Các giá trị này chỉ hiển thị một lần. Đóng hộp thoại là không xem lại được.
          </DialogDescription>
        </DialogHeader>
        {withScript && (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {APPS_SCRIPT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        {secrets?.map((s) => (
          <div key={s.label} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{s.label}</span>
              <Button variant="outline" size="xs" onClick={() => copy(s.value)}>
                Copy
              </Button>
            </div>
            {s.multiline ? (
              <Textarea readOnly value={s.value} className="h-48 font-mono text-xs" />
            ) : (
              <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">{s.value}</code>
            )}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
