import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type Secret = { label: string; value: string };

const copy = (value: string) =>
  navigator.clipboard.writeText(value).then(
    () => toast.success('Đã copy'),
    () => toast.error('Không copy được, hãy chọn và copy thủ công'),
  );

/** Shows values the server returns exactly once (the webhook secret). */
export function SecretDialog({ secrets, onClose }: { secrets: Secret[] | null; onClose: () => void }) {
  return (
    <Dialog open={secrets !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lưu lại ngay</DialogTitle>
          <DialogDescription>
            Các giá trị này chỉ hiển thị một lần. Đóng hộp thoại là không xem lại được.
          </DialogDescription>
        </DialogHeader>
        {secrets?.map((s) => (
          <div key={s.label} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{s.label}</span>
              <Button variant="outline" size="xs" onClick={() => copy(s.value)}>
                Copy
              </Button>
            </div>
            <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">{s.value}</code>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
