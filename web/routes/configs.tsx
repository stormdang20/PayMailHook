import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { ConfigCard } from '@/components/config-card';
import { type Secret, SecretDialog } from '@/components/secret-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, parseResponse } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const configs = api['email-configs'];

export function ConfigsPage() {
  const queryClient = useQueryClient();
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const list = useQuery({ queryKey: ['email-configs'], queryFn: () => parseResponse(configs.$get()) });
  const create = useMutation({
    mutationFn: (json: { gmail: string; webhookUrl: string | null }) => parseResponse(configs.$post({ json })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['email-configs'] });
      setSecrets([
        { label: 'Apps Script (Code.gs)', value: r.appsScript, multiline: true },
        { label: 'Webhook secret (để hệ thống của bạn xác thực chữ ký)', value: r.webhookSecret },
      ]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const webhookUrl = String(form.get('webhookUrl')).trim();
    create.mutate({ gmail: String(form.get('gmail')).trim(), webhookUrl: webhookUrl || null });
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
