import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, parseResponse } from '@/lib/api';
import { describe, errorMessage } from '@/lib/errors';
import { formatTime, formatVnd } from '@/lib/format';

type Status = 'pending' | 'retrying' | 'success' | 'failed';
const STATUS: Record<Status, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Chờ gửi', variant: 'outline' },
  retrying: { label: 'Đang thử lại', variant: 'secondary' },
  success: { label: 'Thành công', variant: 'default' },
  failed: { label: 'Thất bại', variant: 'destructive' },
};
const deliveries = api['webhook-deliveries'];

function DeliveryDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['delivery', id],
    enabled: id !== null,
    queryFn: () => parseResponse(deliveries[':id'].$get({ param: { id: id ?? '' } })),
  });
  const retry = useMutation({
    mutationFn: () => parseResponse(deliveries[':id'].retry.$post({ param: { id: id ?? '' } })),
    onSuccess: () => {
      toast.success('Đã xếp lịch gửi lại');
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['delivery', id] }), 2000);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = detail.data;
  const finished = d?.status === 'success' || d?.status === 'failed';
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Webhook đơn {d?.orderId ?? ''}</DialogTitle>
        </DialogHeader>
        {d && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
              <span>{formatVnd(d.amount)}</span>
              {finished && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => retry.mutate()}
                  disabled={retry.isPending}
                >
                  Gửi lại
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Kết quả</TableHead>
                  <TableHead>Phản hồi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.attempts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {a.attemptNumber}
                      {a.trigger === 'manual' && ' (thủ công)'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatTime(a.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {a.statusCode ? `HTTP ${a.statusCode}` : describe(a.error ?? '')} · {a.durationMs} ms
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-xs" title={a.responseBody ?? ''}>
                      {a.responseBody}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(d.payload, null, 2)}</pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DeliveriesPage() {
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const pages = useInfiniteQuery({
    queryKey: ['deliveries', status],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      parseResponse(
        deliveries.$get({ query: { ...(pageParam && { cursor: pageParam }), ...(status !== 'all' && { status }) } }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-lg">Webhook</h1>
        <Select value={status} onValueChange={(v) => setStatus(v as Status | 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            {Object.entries(STATUS).map(([value, s]) => (
              <SelectItem key={value} value={value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {pages.error && <p className="text-destructive text-sm">{errorMessage(pages.error)}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thời gian</TableHead>
            <TableHead>Mã đơn</TableHead>
            <TableHead className="text-right">Số tiền</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Lần gửi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={d.id} className="cursor-pointer" onClick={() => setSelected(d.id)}>
              <TableCell className="whitespace-nowrap">{formatTime(d.createdAt)}</TableCell>
              <TableCell>{d.orderId}</TableCell>
              <TableCell className="text-right tabular-nums">{formatVnd(d.amount)}</TableCell>
              <TableCell>
                <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
              </TableCell>
              <TableCell>
                {d.attemptCount}
                {d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ''}
              </TableCell>
            </TableRow>
          ))}
          {pages.isSuccess && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Chưa có webhook nào.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pages.hasNextPage && (
        <Button variant="outline" onClick={() => pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
          Xem thêm
        </Button>
      )}
      <DeliveryDetail id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
