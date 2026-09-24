import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import type { Secret } from '@/components/secret-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, parseResponse } from '@/lib/api';
import { describe, errorMessage } from '@/lib/errors';
import { timeAgo } from '@/lib/format';

export type EmailConfig = InferResponseType<(typeof api)['email-configs']['$get'], 200>[number];

const byId = api['email-configs'][':id'];

function Status({ config }: { config: EmailConfig }) {
  if (config.ingestError) return <Badge variant="destructive">{describe(config.ingestError)}</Badge>;
  if (!config.lastIngestAt) return <Badge variant="outline">Chưa nhận email nào</Badge>;
  return <Badge variant="secondary">Email gần nhất: {timeAgo(config.lastIngestAt)}</Badge>;
}

export function ConfigCard({ config, onSecrets }: { config: EmailConfig; onSecrets: (s: Secret[]) => void }) {
  const queryClient = useQueryClient();
  const param = { id: config.id };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['email-configs'] });
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const save = useMutation({
    mutationFn: (json: { webhookUrl: string | null; orderPrefix: string; imapPassword?: string }) =>
      parseResponse(byId.$patch({ param, json })),
    onSuccess: () => {
      toast.success('Đã lưu');
      refresh();
    },
    onError,
  });
  const test = useMutation({
    mutationFn: () => parseResponse(byId['test-webhook'].$post({ param })),
    onSuccess: (r) =>
      r.error
        ? toast.error(`Gửi thử thất bại: ${describe(r.error)}`)
        : toast.success(`Webhook trả về HTTP ${r.statusCode} sau ${r.durationMs} ms`),
    onError,
  });
  const rotateToken = useMutation({
    mutationFn: () => parseResponse(byId['rotate-token'].$post({ param })),
    onSuccess: (r) =>
      onSecrets([
        { label: 'Ingest token', value: r.ingestToken },
        { label: 'Apps Script (Code.gs)', value: r.appsScript, multiline: true },
      ]),
    onError,
  });
  const rotateSecret = useMutation({
    mutationFn: () => parseResponse(byId['rotate-secret'].$post({ param })),
    onSuccess: (r) => onSecrets([{ label: 'Webhook secret', value: r.webhookSecret }]),
    onError,
  });
  const remove = useMutation({
    mutationFn: () => byId.$delete({ param }),
    onSuccess: refresh,
    onError,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const webhookUrl = String(form.get('webhookUrl')).trim();
    const imapPassword = String(form.get('imapPassword') ?? '').trim();
    save.mutate({
      webhookUrl: webhookUrl || null,
      orderPrefix: String(form.get('orderPrefix')).trim(),
      ...(imapPassword && { imapPassword }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{config.gmail}</CardTitle>
        <CardDescription>
          <Status config={config} />
        </CardDescription>
        <CardAction className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!config.webhookUrl || test.isPending}
            onClick={() => test.mutate()}
          >
            Gửi thử
          </Button>
          <ConfirmButton
            title="Tạo token mới?"
            description="Token cũ ngừng hoạt động ngay. Bạn phải dán lại script mới vào Apps Script."
            onConfirm={() => rotateToken.mutate()}
          >
            Đổi token
          </ConfirmButton>
          <ConfirmButton
            title="Tạo webhook secret mới?"
            description="Secret cũ ngừng hoạt động ngay. Hệ thống nhận webhook phải cập nhật secret mới."
            onConfirm={() => rotateSecret.mutate()}
          >
            Đổi secret
          </ConfirmButton>
          <ConfirmButton
            destructive
            title="Xoá cấu hình này?"
            description="Toàn bộ giao dịch và lịch sử webhook của Gmail này cũng bị xoá."
            onConfirm={() => remove.mutate()}
          >
            Xoá
          </ConfirmButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`url-${config.id}`}>URL webhook</Label>
            <Input
              id={`url-${config.id}`}
              name="webhookUrl"
              placeholder="https://shop.example.com/webhooks/paymailhook"
              defaultValue={config.webhookUrl ?? ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`prefix-${config.id}`}>Tiền tố mã đơn</Label>
            <Input id={`prefix-${config.id}`} name="orderPrefix" required defaultValue={config.orderPrefix} />
          </div>
          <Button type="submit" disabled={save.isPending}>
            Lưu
          </Button>
          {config.source === 'imap' && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`imap-${config.id}`}>App Password mới (để trống nếu không đổi)</Label>
              <Input
                id={`imap-${config.id}`}
                name="imapPassword"
                autoComplete="off"
                placeholder="abcd efgh ijkl mnop"
              />
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
