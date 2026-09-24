import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { type Secret, SecretDialog } from '@/components/secret-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { authCall, authClient } from '@/lib/auth';
import { formatTime } from '@/lib/format';

/** API keys for the REST API (`x-api-key`) and the MCP server (`Authorization: Bearer`). */
export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => authCall(authClient.apiKey.list()) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  const onError = (e: Error) => toast.error(e.message);
  const create = useMutation({
    mutationFn: (name: string) => authCall(authClient.apiKey.create({ name })),
    onSuccess: (k) => {
      refresh();
      if (k) setSecrets([{ label: `API key "${k.name}"`, value: k.key }]);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (keyId: string) => authCall(authClient.apiKey.delete({ keyId })),
    onSuccess: refresh,
    onError,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    create.mutate(String(new FormData(e.currentTarget).get('name')).trim());
    e.currentTarget.reset();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API key</CardTitle>
          <CardDescription>
            Dùng cho REST API (header <code>x-api-key</code>) và MCP server <code>/mcp</code> (header{' '}
            <code>Authorization: Bearer &lt;key&gt;</code>). Tối đa 120 request/phút mỗi key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex gap-2">
            <Input name="name" required maxLength={32} placeholder="Tên, ví dụ: shop-backend" />
            <Button type="submit" disabled={create.isPending}>
              Tạo key
            </Button>
          </form>
        </CardContent>
      </Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tên</TableHead>
            <TableHead>Bắt đầu bằng</TableHead>
            <TableHead>Tạo lúc</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.data?.apiKeys.map((k) => (
            <TableRow key={k.id}>
              <TableCell>{k.name}</TableCell>
              <TableCell className="font-mono text-xs">{k.start}…</TableCell>
              <TableCell>{formatTime(new Date(k.createdAt).toISOString())}</TableCell>
              <TableCell className="text-right">
                <ConfirmButton
                  destructive
                  title={`Xoá key "${k.name}"?`}
                  description="Mọi hệ thống đang dùng key này sẽ bị từ chối ngay."
                  onConfirm={() => remove.mutate(k.id)}
                >
                  Xoá
                </ConfirmButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <SecretDialog secrets={secrets} onClose={() => setSecrets(null)} />
    </div>
  );
}
