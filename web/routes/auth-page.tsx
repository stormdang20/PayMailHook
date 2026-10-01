import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { GoogleIcon } from '@/components/google-icon';
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
    question: 'Chưa có tài khoản?',
    switch: 'Đăng ký ngay',
    to: '/sign-up',
  },
  'sign-up': {
    title: 'Tạo tài khoản',
    lead: 'Tạo tài khoản để kết nối Gmail nhận thông báo ngân hàng.',
    submit: 'Đăng ký',
    question: 'Đã có tài khoản?',
    switch: 'Đăng nhập ngay',
    to: '/sign-in',
  },
};

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: () => parseResponse(api.config.$get()) });
  const [error, setError] = useState<string | null>(null);
  // Per-field problems shown under the field: a taken username (checked on blur) or email (checked on submit).
  const [taken, setTaken] = useState<{ username?: boolean; email?: boolean }>({});
  const [pending, setPending] = useState(false);
  if (session) return <Navigate to="/dashboard" replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    setPending(true);
    const { error } =
      mode === 'sign-in' ? await signIn(String(form.get('login')).trim(), password) : await signUp(form, password);
    setPending(false);
    if (error?.code?.startsWith('USER_ALREADY_EXISTS')) return setTaken((t) => ({ ...t, email: true }));
    if (error?.code === 'USERNAME_IS_ALREADY_TAKEN') return setTaken((t) => ({ ...t, username: true }));
    if (error) return setError(authError(error));
    navigate('/dashboard');
  }

  async function checkUsername(value: string) {
    if (!/^[A-Za-z0-9_.]{3,30}$/.test(value)) return;
    const { data } = await authClient.isUsernameAvailable({ username: value });
    setTaken((t) => ({ ...t, username: data?.available === false }));
  }

  function google() {
    if (!config?.socialProviders.includes('google')) {
      return setError(
        'Máy chủ này chưa bật đăng nhập Google. Quản trị viên cần cấu hình GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET.',
      );
    }
    authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' });
  }

  const text = TEXT[mode];
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <Link to="/" aria-label="Về trang chủ" className="inline-block lg:hidden">
              <Logo />
            </Link>
            <h1 className="font-semibold text-2xl tracking-tight">{text.title}</h1>
            <p className="text-muted-foreground text-sm">{text.lead}</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === 'sign-in' ? (
              <Field id="login" label="Tên đăng nhập hoặc email" autoComplete="username" />
            ) : (
              <>
                <Field
                  id="username"
                  label="Tên đăng nhập"
                  autoComplete="username"
                  pattern="[A-Za-z0-9_.]{3,30}"
                  title="3–30 ký tự: chữ, số, dấu gạch dưới hoặc dấu chấm"
                  aria-invalid={taken.username || undefined}
                  onChange={() => setTaken((t) => ({ ...t, username: false }))}
                  onBlur={(e) => checkUsername(e.currentTarget.value.trim())}
                  hint={
                    taken.username ? <span className="text-destructive">Tên đăng nhập đã có người dùng.</span> : null
                  }
                />
                <Field
                  id="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={taken.email || undefined}
                  onChange={() => setTaken((t) => ({ ...t, email: false }))}
                  hint={
                    taken.email ? (
                      <span className="text-destructive">
                        Email này đã có tài khoản.{' '}
                        <Link to="/sign-in" className="font-medium underline">
                          Đăng nhập ngay
                        </Link>
                      </span>
                    ) : null
                  }
                />
              </>
            )}
            <Field
              id="password"
              label="Mật khẩu"
              type="password"
              minLength={8}
              placeholder={mode === 'sign-up' ? 'Tối thiểu 8 ký tự' : undefined}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={pending || taken.username || taken.email}>
              {text.submit}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border" />
            hoặc
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="outline" size="lg" className="w-full" onClick={google}>
            <GoogleIcon />
            {mode === 'sign-in' ? 'Đăng nhập với Google' : 'Đăng ký với Google'}
          </Button>

          <p className="text-center text-muted-foreground text-sm">
            {text.question}{' '}
            <Link to={text.to} className="font-medium text-primary hover:underline">
              {text.switch}
            </Link>
          </p>
          <p className="text-center text-muted-foreground text-xs">
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
    <section className="hidden flex-col bg-primary p-12 text-primary-foreground lg:flex">
      <Link to="/" aria-label="Về trang chủ" className="self-start">
        <Logo className="[&>span>span]:text-highlight" />
      </Link>
      <div className="my-auto max-w-md space-y-8">
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
          PayMailHook đọc email biến động số dư của CAKE, Timo và email nhận tiền PayPal, kiểm tra chữ ký ngân hàng rồi
          báo cho hệ thống của bạn. Không cần API ngân hàng, không phí giao dịch.
        </p>
      </div>
    </section>
  );
}

const signIn = (login: string, password: string) =>
  login.includes('@')
    ? authClient.signIn.email({ email: login, password })
    : authClient.signIn.username({ username: login, password });

function signUp(form: FormData, password: string) {
  const username = String(form.get('username')).trim();
  return authClient.signUp.email({ email: String(form.get('email')).trim(), password, name: username, username });
}

const AUTH_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Sai email hoặc mật khẩu. Nếu bạn đăng ký bằng Google, hãy bấm Đăng nhập với Google.',
  INVALID_USERNAME_OR_PASSWORD: 'Sai tên đăng nhập hoặc mật khẩu.',
  USERNAME_IS_ALREADY_TAKEN: 'Tên đăng nhập đã có người dùng.',
  USER_ALREADY_EXISTS: 'Email này đã có tài khoản.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Email này đã có tài khoản.',
  INVALID_USERNAME: 'Tên đăng nhập chỉ gồm chữ, số, dấu gạch dưới hoặc dấu chấm.',
  USERNAME_TOO_SHORT: 'Tên đăng nhập cần ít nhất 3 ký tự.',
  PASSWORD_TOO_SHORT: 'Mật khẩu cần ít nhất 8 ký tự.',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'Máy chủ này đã tắt đăng ký.',
  BANNED_USER: 'Tài khoản đã bị khoá.',
};

const authError = (e: { code?: string; message?: string; status?: number }) =>
  (e.code && AUTH_ERRORS[e.code]) ||
  (e.status === 429 ? 'Thử quá nhiều lần, hãy đợi một phút.' : e.message) ||
  'Không thành công.';

type FieldProps = { id: string; label: string; hint?: React.ReactNode } & React.ComponentProps<typeof Input>;

function Field({ id, label, hint, ...input }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} required aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && (
        <p id={`${id}-hint`} className="text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
