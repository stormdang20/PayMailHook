import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, parseResponse } from '@/lib/api';
import { AuthError, authCall, authClient } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

type User = { email: string; username?: string | null };

const MESSAGES: Record<string, string> = {
  INVALID_PASSWORD: 'Mật khẩu hiện tại không đúng.',
  PASSWORD_TOO_SHORT: 'Mật khẩu mới cần ít nhất 8 ký tự.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Tài khoản này đăng nhập bằng Google nên chưa có mật khẩu để đổi.',
};

/** Account button in the sidebar: shows who is signed in and lets them change their password. */
export function AccountDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], enabled: open, queryFn: () => parseResponse(api.me.$get()) });
  // Google-only accounts have no password yet: they set one (no current password to confirm).
  const settingFirst = me.data?.hasPassword === false;
  const setFirst = useMutation({
    mutationFn: (newPassword: string) => parseResponse(api.me.password.$post({ json: { newPassword } })),
    onSuccess: () => {
      toast.success('Đã đặt mật khẩu. Giờ bạn đăng nhập được bằng email và mật khẩu.');
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setOpen(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const change = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }) =>
      authCall(authClient.changePassword(v)),
    onSuccess: () => {
      toast.success('Đã đổi mật khẩu');
      setOpen(false);
    },
    onError: (e) => setError((e instanceof AuthError && e.code && MESSAGES[e.code]) || e.message),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get('newPassword'));
    if (newPassword !== String(form.get('confirmPassword')))
      return setError('Hai lần nhập mật khẩu mới không giống nhau.');
    setError(null);
    if (settingFirst) return setFirst.mutate(newPassword);
    change.mutate({
      currentPassword: String(form.get('currentPassword')),
      newPassword,
      revokeOtherSessions: form.get('revokeOtherSessions') === 'on',
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left font-normal">
          <UserRound className="shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">{user.username ?? user.email}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tài khoản</DialogTitle>
          <DialogDescription>
            {user.username ? `${user.username}, ` : ''}
            {user.email}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <h3 className="font-medium text-sm">{settingFirst ? 'Đặt mật khẩu' : 'Đổi mật khẩu'}</h3>
          {settingFirst && (
            <p className="text-muted-foreground text-xs">
              Tài khoản đang đăng nhập bằng Google. Đặt mật khẩu để đăng nhập thêm bằng email và mật khẩu.
            </p>
          )}
          {[
            ...(settingFirst
              ? []
              : [{ name: 'currentPassword', label: 'Mật khẩu hiện tại', auto: 'current-password' }]),
            { name: 'newPassword', label: 'Mật khẩu mới', auto: 'new-password' },
            { name: 'confirmPassword', label: 'Nhập lại mật khẩu mới', auto: 'new-password' },
          ].map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label htmlFor={f.name}>{f.label}</Label>
              <Input
                id={f.name}
                name={f.name}
                type="password"
                required
                minLength={f.name === 'currentPassword' ? 1 : 8}
                autoComplete={f.auto}
              />
            </div>
          ))}
          {!settingFirst && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="revokeOtherSessions" defaultChecked className="size-4 accent-primary" />
              Đăng xuất khỏi các thiết bị khác
            </label>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={change.isPending || setFirst.isPending || me.isPending}>
            {settingFirst ? 'Đặt mật khẩu' : 'Đổi mật khẩu'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
