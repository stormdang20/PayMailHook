import { useState } from 'react';
import { toast } from 'sonner';
import { BanksObject } from 'vietnam-qr-pay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const BANKS = Object.values(BanksObject)
  .filter((b) => b.vietQRStatus === 1)
  .sort((a, b) => a.shortName.localeCompare(b.shortName));

export function QrPage() {
  const [form, setForm] = useState({ bank: 'cake', acc: '', amount: '', des: '' });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const params = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== ''));
  const url = form.acc ? `${location.origin}/api/qr?${params}` : null;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_auto]">
      <Card>
        <CardHeader>
          <CardTitle>Tạo mã VietQR</CardTitle>
          <CardDescription>Khách quét bằng app ngân hàng, số tiền và nội dung (mã đơn) được điền sẵn.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Ngân hàng nhận</Label>
            <Select value={form.bank} onValueChange={set('bank')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BANKS.map((b) => (
                  <SelectItem key={b.key} value={b.key}>
                    {b.shortName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc">Số tài khoản</Label>
            <Input id="acc" value={form.acc} onChange={(e) => set('acc')(e.target.value.trim())} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Số tiền (VND, không bắt buộc)</Label>
            <Input
              id="amount"
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => set('amount')(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="des">Nội dung chuyển khoản</Label>
            <Input
              id="des"
              maxLength={50}
              placeholder="PMH123456"
              value={form.des}
              onChange={(e) => set('des')(e.target.value)}
            />
          </div>
          {url && (
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('Đã copy link ảnh QR'))}
            >
              Copy link ảnh
            </Button>
          )}
        </CardContent>
      </Card>
      <div className="flex size-72 items-center justify-center rounded-xl border bg-white">
        {url ? (
          <img src={url} alt="Mã VietQR" className="size-64" />
        ) : (
          <span className="text-muted-foreground text-sm">Nhập số tài khoản</span>
        )}
      </div>
    </div>
  );
}
