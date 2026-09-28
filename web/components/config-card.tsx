import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { FormEvent } from 'react';
import { toast } from 'sonner';
import { BANK_NAMES, type BankCode, BankPicker, formBanks } from '@/components/bank-picker';
import { ConfirmButton } from '@/components/confirm-button';
import { ForwardingSetup } from '@/components/forwarding-setup';
import type { Secret } from '@/components/secret-dialog';
import { ShareButton } from '@/components/share-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, parseResponse } from '@/lib/api';
import { linkGmail } from '@/lib/auth';
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
    mutationFn: (json: { webhookUrl: string | null; orderPrefix: string; banks: BankCode[]; imapPassword?: string }) =>
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
    const banks = formBanks(form);
    save.mutate({
      banks,
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
          <span className="flex flex-wrap items-center gap-2">
            <Status config={config} />
            {config.banks.map((b) => (
              <Badge key={b} variant="outline">
                {BANK_NAMES[b]}
              </Badge>
            ))}
          </span>
        </CardDescription>
        <CardAction className="flex gap-2">
          {config.source === 'gmail_oauth' && !config.gmailConnected && (
            <Button size="sm" onClick={() => linkGmail(config.id)}>
              Kết nối Gmail
            </Button>
          )}
          <ShareButton
            label="Link thu ngân"
            description="Ai có link đều xem được danh sách tiền vào của Gmail này (tự cập nhật). Không lộ Gmail, webhook hay thông tin người chuyển."
            token={config.shareToken}
            pathFor={(token) => `/share/c/${token}`}
            share={() => parseResponse(byId.share.$post({ param }))}
            revoke={() => byId.share.$delete({ param })}
            onChange={refresh}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!config.webhookUrl || test.isPending}
            onClick={() => test.mutate()}
          >
            Gửi thử
          </Button>
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
      <CardContent className="space-y-4">
        {config.forwardingAddress && (
          <ForwardingSetup
            address={config.forwardingAddress}
            confirmation={config.forwardingConfirmation}
            connected={Boolean(config.lastIngestAt)}
          />
        )}
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[12rem_1fr_8rem_auto] sm:items-end">
          <BankPicker id={`banks-${config.id}`} defaultValue={config.banks} />
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
            <div className="space-y-1.5 sm:col-span-3">
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
