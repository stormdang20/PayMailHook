import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { authClient } from '@/lib/auth';
import { formatTime } from '@/lib/format';

/** Throws better-auth client errors so TanStack Query reports them. */
async function run<T>(call: Promise<{ data: T; error: { message?: string } | null }>) {
  const { data, error } = await call;
  if (error) throw new Error(error.message ?? 'Không thành công');
  return data;
}

function PasswordDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const reset = useMutation({
    mutationFn: (newPassword: string) => run(authClient.admin.setUserPassword({ userId: userId ?? '', newPassword })),
    onSuccess: () => {
      toast.success('Đã đặt mật khẩu mới');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset.mutate(String(new FormData(e.currentTarget).get('password')));
  }
  return (
    <Dialog open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đặt mật khẩu mới</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex gap-2">
          <Input name="password" type="text" minLength={8} required autoComplete="off" />
          <Button type="submit" disabled={reset.isPending}>
            Lưu
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminPage() {
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const [resetFor, setResetFor] = useState<string | null>(null);
  const isAdmin = session?.user.role === 'admin';
  const users = useQuery({
    queryKey: ['admin-users'],
    enabled: isAdmin,
    queryFn: () =>
      run(authClient.admin.listUsers({ query: { limit: 100, sortBy: 'createdAt', sortDirection: 'desc' } })),
  });
  const act = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => toast.error(e.message),
  });
  if (session && !isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-lg">Người dùng</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Tạo lúc</TableHead>
            <TableHead>Vai trò</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.data?.users.map((u) => {
            const self = u.id === session?.user.id;
            return (
              <TableRow key={u.id}>
                <TableCell>{u.email}</TableCell>
                <TableCell className="whitespace-nowrap">{formatTime(new Date(u.createdAt).toISOString())}</TableCell>
                <TableCell>
                  <Select
                    value={u.role ?? 'user'}
                    disabled={self}
                    onValueChange={(role) =>
                      act.mutate(() => run(authClient.admin.setRole({ userId: u.id, role: role as 'user' | 'admin' })))
                    }
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">user</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {u.banned ? (
                    <Badge variant="destructive">Bị khoá</Badge>
                  ) : (
                    <Badge variant="secondary">Hoạt động</Badge>
                  )}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button variant="outline" size="sm" onClick={() => setResetFor(u.id)}>
                    Đặt mật khẩu
                  </Button>
                  {!self &&
                    (u.banned ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act.mutate(() => run(authClient.admin.unbanUser({ userId: u.id })))}
                      >
                        Mở khoá
                      </Button>
                    ) : (
                      <ConfirmButton
                        destructive
                        title={`Khoá ${u.email}?`}
                        description="Người dùng bị đăng xuất ngay; API key của họ cũng ngừng hoạt động. Webhook đang chạy vẫn tiếp tục."
                        onConfirm={() => act.mutate(() => run(authClient.admin.banUser({ userId: u.id })))}
                      >
                        Khoá
                      </ConfirmButton>
                    ))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <PasswordDialog userId={resetFor} onClose={() => setResetFor(null)} />
    </div>
  );
}
