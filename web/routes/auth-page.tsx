import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, parseResponse } from '@/lib/api';
import { authClient } from '@/lib/auth';

type Mode = 'sign-in' | 'sign-up';

const TEXT = {
  'sign-in': {
    title: 'Đăng nhập',
    lead: 'Xem tiền vào và trạng thái webhook của cửa hàng.',
    submit: 'Đăng nhập',
    switch: 'Chưa có tài khoản? Đăng ký',
    to: '/sign-up',
  },
  'sign-up': {
    title: 'Tạo tài khoản',
    lead: 'Miễn phí. Kết nối Gmail nhận thông báo ngân hàng trong vài phút.',
    submit: 'Đăng ký',
    switch: 'Đã có tài khoản? Đăng nhập',
    to: '/sign-in',
  },
};

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: () => parseResponse(api.config.$get()) });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));
    setPending(true);
    const { error } =
      mode === 'sign-in'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get('name') || email) });
    setPending(false);
    if (error) return setError(error.message ?? 'Không thành công.');
    navigate('/');
  }

  const text = TEXT[mode];
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <Logo className="lg:hidden" />
            <h1 className="font-semibold text-2xl tracking-tight">{text.title}</h1>
            <p className="text-muted-foreground text-sm">{text.lead}</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === 'sign-up' && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Tên</Label>
                <Input id="name" name="name" autoComplete="name" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {text.submit}
            </Button>
          </form>
          {config?.socialProviders.includes('google') && (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}
            >
              Tiếp tục với Google
            </Button>
          )}
          <p className="text-center text-sm">
            <Link to={text.to} className="text-primary hover:underline">
              {text.switch}
            </Link>
          </p>
          <p className="flex justify-center gap-4 text-muted-foreground text-xs">
            <Link to="/docs" className="hover:underline">
              Tài liệu tích hợp
            </Link>
            <Link to="/privacy" className="hover:underline">
              Quyền riêng tư
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** What the product does, shown as the thing users wait for: a balance notification that became a paid order. */
function BrandPanel() {
  return (
    <section className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
      <Logo className="[&>span>span]:text-highlight" />
      <div className="max-w-md space-y-8">
        <h2 className="font-semibold text-3xl leading-tight tracking-tight">
          Khách chuyển khoản, đơn hàng tự xác nhận.
        </h2>
        <div className="space-y-3">
          <div className="rounded-xl bg-white/95 p-4 text-foreground shadow-lg shadow-black/10">
            <p className="text-muted-foreground text-xs">CAKE by VPBank, vừa xong</p>
            <p className="mt-1 font-semibold text-2xl text-primary tabular-nums">+149.000 đ</p>
            <p className="mt-1 text-sm">
              Nội dung: <mark className="rounded bg-highlight/40 px-1 text-foreground">PMH123456</mark>
            </p>
          </div>
          <div className="ml-8 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
            <span className="size-2 rounded-full bg-highlight" />
            Webhook gửi tới cửa hàng: đơn 123456 đã thanh toán
          </div>
        </div>
        <p className="text-primary-foreground/80 text-sm leading-relaxed">
          PayMailHook đọc email biến động số dư của CAKE và Timo, kiểm tra chữ ký ngân hàng rồi báo cho hệ thống của
          bạn. Không cần API ngân hàng, không phí giao dịch.
        </p>
      </div>
      <p className="text-primary-foreground/60 text-xs">
        Mã nguồn mở. Tự cài trên máy của bạn hoặc dùng bản miễn phí trên Cloudflare.
      </p>
    </section>
  );
}
