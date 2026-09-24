import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, parseResponse } from '@/lib/api';
import { authClient } from '@/lib/auth';

type Mode = 'sign-in' | 'sign-up';

const TEXT = {
  'sign-in': { title: 'Đăng nhập', submit: 'Đăng nhập', switch: 'Chưa có tài khoản? Đăng ký', to: '/sign-up' },
  'sign-up': { title: 'Tạo tài khoản', submit: 'Đăng ký', switch: 'Đã có tài khoản? Đăng nhập', to: '/sign-in' },
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
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>PayMailHook: nhận chuyển khoản tự động qua email ngân hàng.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={submit} className="space-y-3">
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
            <Button type="submit" className="w-full" disabled={pending}>
              {text.submit}
            </Button>
          </form>
          {config?.socialProviders.includes('google') && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}
            >
              Tiếp tục với Google
            </Button>
          )}
          <Link to={text.to} className="block text-center text-muted-foreground text-sm hover:underline">
            {text.switch}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
