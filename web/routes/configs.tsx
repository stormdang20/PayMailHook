import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { ConfigCard } from '@/components/config-card';
import { type Secret, SecretDialog } from '@/components/secret-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, parseResponse } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const configs = api['email-configs'];

export function ConfigsPage() {
  const queryClient = useQueryClient();
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [source, setSource] = useState<'apps_script' | 'imap'>('apps_script');
  const { data: server } = useQuery({ queryKey: ['config'], queryFn: () => parseResponse(api.config.$get()) });
  const list = useQuery({ queryKey: ['email-configs'], queryFn: () => parseResponse(configs.$get()) });
  const create = useMutation({
    mutationFn: (json: { gmail: string; webhookUrl: string | null; source: typeof source; imapPassword?: string }) =>
      parseResponse(configs.$post({ json })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['email-configs'] });
      const secret = { label: 'Webhook secret (để hệ thống của bạn xác thực chữ ký)', value: r.webhookSecret };
      setSecrets(
        r.appsScript ? [{ label: 'Apps Script (Code.gs)', value: r.appsScript, multiline: true }, secret] : [secret],
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const webhookUrl = String(form.get('webhookUrl')).trim();
    const imapPassword = source === 'imap' ? String(form.get('imapPassword')) : undefined;
    create.mutate({ gmail: String(form.get('gmail')).trim(), webhookUrl: webhookUrl || null, source, imapPassword });
    e.currentTarget.reset();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Thêm Gmail nhận biến động số dư</CardTitle>
          <CardDescription>
            Gmail đang nhận email thông báo giao dịch của CAKE hoặc Timo. Nội dung chuyển khoản có dạng &nbsp;
            <code>PMH&lt;mã đơn&gt;</code> sẽ được gửi tới URL webhook.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="gmail">Gmail</Label>
              <Input id="gmail" name="gmail" type="email" required placeholder="shop@gmail.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhookUrl">URL webhook (không bắt buộc)</Label>
              <Input id="webhookUrl" name="webhookUrl" placeholder="https://shop.example.com/webhooks/paymailhook" />
            </div>
            <Button type="submit" disabled={create.isPending}>
              Thêm
            </Button>
            {server?.imap && (
              <div className="space-y-1.5">
                <Label>Cách nhận email</Label>
                <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apps_script">Apps Script (dán script vào Gmail)</SelectItem>
                    <SelectItem value="imap">IMAP (App Password)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
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
                <p className="text-muted-foreground text-xs">
                  Cần bật xác minh 2 bước, rồi tạo tại{' '}
                  <a
                    className="underline"
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                  >
                    myaccount.google.com/apppasswords
                  </a>
                  . Mật khẩu được mã hoá và không bao giờ hiển thị lại.
                </p>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
      {list.error && <p className="text-destructive text-sm">{errorMessage(list.error)}</p>}
      {list.data?.map((config) => (
        <ConfigCard key={config.id} config={config} onSecrets={setSecrets} />
      ))}
      <SecretDialog secrets={secrets} onClose={() => setSecrets(null)} />
    </div>
  );
}
