import { QrCode } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { BanksObject } from 'vietnam-qr-pay';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// The banks PayMailHook reads notification emails from; other banks' transfers would never be seen.
const BANKS = [BanksObject.cake, BanksObject.timo];

export function QrPage() {
  const [form, setForm] = useState({ bank: 'cake', acc: '', amount: '', des: '' });
  // The image is built only when the user asks, not on every keystroke.
  const [url, setUrl] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== ''));
    setUrl(`${location.origin}/api/qr?${params}`);
  }

  return (
    <div>
      <PageHeader
        title="Mã QR"
        description="Khách quét bằng app ngân hàng: tài khoản, số tiền và nội dung (mã đơn) được điền sẵn."
      />
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin nhận tiền</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={generate} className="space-y-3">
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
                <Input
                  id="acc"
                  required
                  inputMode="numeric"
                  value={form.acc}
                  onChange={(e) => set('acc')(e.target.value.trim())}
                />
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
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="submit">
                  <QrCode />
                  Tạo mã QR
                </Button>
                {url && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('Đã copy link ảnh QR'))}
                  >
                    Copy link ảnh
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
        <div className="flex size-72 items-center justify-center rounded-xl border bg-white">
          {url ? (
            <img src={url} alt="Mã VietQR" className="size-64" />
          ) : (
            <span className="px-6 text-center text-muted-foreground text-sm">Điền thông tin rồi bấm Tạo mã QR</span>
          )}
        </div>
      </div>
    </div>
  );
}
