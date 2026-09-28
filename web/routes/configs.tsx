import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mailbox } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { type BankCode, BankPicker, formBanks } from '@/components/bank-picker';
import { ConfigCard } from '@/components/config-card';
import { EmptyState } from '@/components/empty-state';
import { OrderCode } from '@/components/order-code';
import { PageHeader } from '@/components/page-header';
import { type Secret, SecretDialog } from '@/components/secret-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, parseResponse } from '@/lib/api';
import { linkGmail } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

const configs = api['email-configs'];

const external = { target: '_blank', rel: 'noreferrer', className: 'font-medium text-primary underline' };

/** App Passwords only exist once 2-Step Verification is on; say so before the user hits Google's error page. */
function ImapSteps() {
  return (
    <div className="space-y-1.5 text-muted-foreground text-xs">
      <ol className="list-decimal space-y-1 pl-4">
        <li>
          Bật{' '}
          <a href="https://myaccount.google.com/signinoptions/twosv" {...external}>
            Xác minh 2 bước
          </a>{' '}
          cho Gmail này (dùng số điện thoại hoặc lời nhắc Google).
        </li>
        <li>
          Tạo{' '}
          <a href="https://myaccount.google.com/apppasswords" {...external}>
            App Password
          </a>{' '}
          (tên tuỳ ý, ví dụ PayMailHook) và dán 16 chữ cái vào ô trên.
        </li>
      </ol>
      <p>
        Nếu Google báo "Cài đặt bạn đang tìm kiếm không khả dụng": xác minh 2 bước chưa bật, chỉ dùng khoá bảo mật, hoặc
        tài khoản công ty đã tắt App Password. Khi đó hãy dùng cách Chuyển tiếp email hoặc Gmail OAuth.
      </p>
      <p>Mật khẩu được mã hoá và không bao giờ hiển thị lại.</p>
    </div>
  );
}

type Source = 'imap' | 'gmail_oauth' | 'forwarding';

const SOURCES: { value: Source; label: string; help: string; unavailable: string }[] = [
  {
    value: 'imap',
    label: 'IMAP (App Password)',
    help: 'Nhanh nhất: máy chủ giữ kết nối tới Gmail và nhận email ngay khi tới. Cần App Password của Gmail.',
    unavailable: 'chỉ có ở bản tự cài',
  },
  {
    value: 'gmail_oauth',
    label: 'Đăng nhập Google (Gmail OAuth)',
    help: 'Cấp quyền đọc Gmail bằng tài khoản Google, không cần mật khẩu. Google đẩy email mới về ngay.',
    unavailable: 'máy chủ chưa bật',
  },
  {
    value: 'forwarding',
    label: 'Chuyển tiếp email',
    help: 'Gmail tự chuyển tiếp email ngân hàng tới một địa chỉ riêng của PayMailHook. Không cần mật khẩu.',
    unavailable: 'máy chủ chưa bật',
  },
];

export function ConfigsPage() {
  const queryClient = useQueryClient();
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [chosen, setSource] = useState<Source | null>(null);
  const [params, setParams] = useSearchParams();
  const connectId = params.get('connect');
  const { data: server } = useQuery({ queryKey: ['config'], queryFn: () => parseResponse(api.config.$get()) });
  const available = (s: Source) =>
    (s === 'imap' && server?.imap) ||
    (s === 'gmail_oauth' && server?.gmailOAuth) ||
    (s === 'forwarding' && server?.forwarding);
  // The first source the server offers, in SOURCES order (IMAP first on self-host).
  const firstAvailable = SOURCES.find((s) => available(s.value))?.value;
  const source: Source = chosen ?? firstAvailable ?? 'imap';
  const list = useQuery({
    queryKey: ['email-configs'],
    queryFn: () => parseResponse(configs.$get()),
    // While a forwarding setup waits for Gmail's confirmation code or first email, check every 10 s.
    refetchInterval: (q) => (q.state.data?.some((c) => c.source === 'forwarding' && !c.lastIngestAt) ? 10_000 : false),
  });
  const create = useMutation({
    mutationFn: (json: {
      gmail: string;
      webhookUrl: string | null;
      source: typeof source;
      banks: BankCode[];
      imapPassword?: string;
    }) => parseResponse(configs.$post({ json })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['email-configs'] });
      if (r.config.source === 'gmail_oauth') {
        linkGmail(r.config.id); // leaves the page; the secret is shown again via "Đổi secret" if needed
        return;
      }
      setSecrets([{ label: 'Webhook secret (để hệ thống của bạn xác thực chữ ký)', value: r.webhookSecret }]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Back from Google's consent screen: finish connecting that config.
  const connect = useMutation({
    mutationFn: (id: string) => parseResponse(api.gmail.connect[':id'].$post({ param: { id } })),
    onSuccess: () => toast.success('Đã kết nối Gmail'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['email-configs'] }),
  });
  const { mutate: connectConfig } = connect;
  useEffect(() => {
    if (!connectId) return;
    setParams({}, { replace: true });
    connectConfig(connectId);
  }, [connectId, connectConfig, setParams]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const webhookUrl = String(form.get('webhookUrl')).trim();
    const imapPassword = source === 'imap' ? String(form.get('imapPassword')) : undefined;
    const banks = formBanks(form);
    create.mutate({
      gmail: String(form.get('gmail')).trim(),
      webhookUrl: webhookUrl || null,
      source,
      banks,
      imapPassword,
    });
    e.currentTarget.reset();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kết nối"
        description="Gmail nhận email thông báo của CAKE hoặc Timo, và nơi PayMailHook báo khi có đơn được thanh toán."
      />
      <Card>
        <CardHeader>
          <CardTitle>Thêm Gmail</CardTitle>
          <CardDescription>
            Khách chuyển khoản với nội dung như <OrderCode code="PMH123456" /> (tiền tố PMH đổi được sau khi thêm), hệ
            thống của bạn nhận webhook cho đơn 123456.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[12rem_1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5 sm:col-span-4 sm:grid-cols-[16rem_1fr] sm:items-center sm:gap-x-4">
              <Label htmlFor="source" className="sm:col-span-2">
                Cách nhận email
              </Label>
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger id="source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value} disabled={!available(s.value)}>
                      {s.label}
                      {!available(s.value) && <span className="text-muted-foreground text-xs"> ({s.unavailable})</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {server && !firstAvailable
                  ? 'Máy chủ chưa bật cách nhận email nào: quản trị viên cần cấu hình IMAP (bản tự cài), Gmail OAuth hoặc chuyển tiếp email.'
                  : SOURCES.find((s) => s.value === source)?.help}
              </p>
            </div>
            <BankPicker />
            <div className="space-y-1.5">
              <Label htmlFor="gmail">Gmail</Label>
              <Input id="gmail" name="gmail" type="email" required placeholder="shop@gmail.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhookUrl">URL webhook (không bắt buộc)</Label>
              <Input id="webhookUrl" name="webhookUrl" placeholder="https://shop.example.com/webhooks/paymailhook" />
            </div>
            <Button type="submit" disabled={create.isPending || !available(source)}>
              Thêm
            </Button>
            <p className="text-muted-foreground text-xs sm:col-span-4">
              URL webhook là địa chỉ trên website hoặc hệ thống của bạn, nơi PayMailHook gửi thông báo khi một đơn được
              thanh toán (bạn tự cung cấp, ví dụ https://shop.vn/webhooks/paymailhook). Chưa có hệ thống riêng thì để
              trống: bạn vẫn xem giao dịch và nhận thông báo trên dashboard.{' '}
              <Link to="/dashboard/docs" className="font-medium text-primary underline">
                Cách tích hợp
              </Link>
            </p>
            {source === 'imap' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="imapPassword">App Password của Gmail</Label>
                <Input
                  id="imapPassword"
                  name="imapPassword"
                  required
                  autoComplete="off"
                  placeholder="abcd efgh ijkl mnop"
                />
                <ImapSteps />
              </div>
            )}
          </form>
        </CardContent>
      </Card>
      {list.error && <p className="text-destructive text-sm">{errorMessage(list.error)}</p>}
      {list.isSuccess && list.data.length === 0 && (
        <EmptyState icon={Mailbox} title="Chưa kết nối Gmail nào">
          Thêm Gmail đang nhận email biến động số dư ở form phía trên để bắt đầu.
        </EmptyState>
      )}
      {list.data?.map((config) => (
        <ConfigCard key={config.id} config={config} onSecrets={setSecrets} />
      ))}
      <SecretDialog secrets={secrets} onClose={() => setSecrets(null)} />
    </div>
  );
}
