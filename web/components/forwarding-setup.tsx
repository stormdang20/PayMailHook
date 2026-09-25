import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const BANK_SENDERS = 'no-reply@cake.vn OR support@timo.vn';

const copy = (value: string) => navigator.clipboard.writeText(value).then(() => toast.success('Đã copy'));

type Props = { address: string; confirmation: { code: string | null; link: string | null } | null; connected: boolean };

/** Steps to make Gmail forward only bank mail to this config's address, with Gmail's confirmation code inline. */
export function ForwardingSetup({ address, confirmation, connected }: Props) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Địa chỉ nhận:</span>
        <code className="rounded bg-background px-2 py-1 text-xs">{address}</code>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy địa chỉ" onClick={() => copy(address)}>
          <Copy />
        </Button>
      </div>
      {!connected && (
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Trong Gmail: <b>Cài đặt → Chuyển tiếp và POP/IMAP → Thêm địa chỉ chuyển tiếp</b>, dán địa chỉ trên.
          </li>
          <li>
            Gmail gửi mã xác nhận tới địa chỉ đó.{' '}
            {confirmation?.code || confirmation?.link ? (
              <>
                Mã của bạn:{' '}
                {confirmation.code && (
                  <b className="rounded bg-highlight/35 px-1.5 tabular-nums">{confirmation.code}</b>
                )}{' '}
                {confirmation.link && (
                  <a
                    href={confirmation.link}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary underline"
                  >
                    bấm để xác nhận
                  </a>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Đang chờ Gmail gửi mã, mã sẽ hiện ở đây sau vài giây.</span>
            )}
          </li>
          <li>
            Tạo bộ lọc để chỉ chuyển tiếp email ngân hàng: <b>Tìm kiếm → Hiện tuỳ chọn tìm kiếm</b>, ô <b>Từ</b> điền{' '}
            <code className="rounded bg-background px-1 text-xs">{BANK_SENDERS}</code>, bấm <b>Tạo bộ lọc</b>, chọn{' '}
            <b>Chuyển tiếp tới</b> địa chỉ trên. Đừng chuyển tiếp toàn bộ hộp thư.
          </li>
        </ol>
      )}
    </div>
  );
}
