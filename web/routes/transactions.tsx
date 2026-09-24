import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ShareButton } from '@/components/share-button';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, parseResponse } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatTime, formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

type Direction = 'all' | 'in' | 'out';

export function TransactionsPage() {
  const [direction, setDirection] = useState<Direction>('all');
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['transactions'] });
  const pages = useInfiniteQuery({
    queryKey: ['transactions', direction],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      parseResponse(
        api.transactions.$get({
          query: { ...(pageParam && { cursor: pageParam }), ...(direction !== 'all' && { direction }) },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Near-realtime while the tab is visible; TanStack pauses interval refetches for hidden tabs,
    // so an idle dashboard lets Neon scale to zero.
    refetchInterval: 5000,
  });
  const rows = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-lg">Giao dịch</h1>
        <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="in">Tiền vào</SelectItem>
            <SelectItem value="out">Tiền ra</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {pages.error && <p className="text-destructive text-sm">{errorMessage(pages.error)}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thời gian</TableHead>
            <TableHead>Ngân hàng</TableHead>
            <TableHead className="text-right">Số tiền</TableHead>
            <TableHead>Nội dung</TableHead>
            <TableHead>Mã đơn</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="whitespace-nowrap">{formatTime(t.occurredAt)}</TableCell>
              <TableCell>{t.bank}</TableCell>
              <TableCell
                className={cn(
                  'whitespace-nowrap text-right tabular-nums',
                  t.direction === 'in' ? 'text-green-600' : 'text-red-600',
                )}
              >
                {t.direction === 'in' ? '+' : '−'}
                {formatVnd(t.amount)}
              </TableCell>
              <TableCell className="max-w-md truncate" title={t.description}>
                {t.description}
              </TableCell>
              <TableCell>{t.orderId ?? '—'}</TableCell>
              <TableCell className="text-right">
                <ShareButton
                  label="Chia sẻ"
                  description="Ai có link đều xem được số tiền, thời gian, nội dung và mã đơn của giao dịch này (không có thông tin người chuyển)."
                  token={t.shareToken}
                  pathFor={(token) => `/share/t/${token}`}
                  share={() => parseResponse(api.transactions[':id'].share.$post({ param: { id: t.id } }))}
                  revoke={() => api.transactions[':id'].share.$delete({ param: { id: t.id } })}
                  onChange={refresh}
                />
              </TableCell>
            </TableRow>
          ))}
          {pages.isSuccess && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                Chưa có giao dịch.
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
    </div>
  );
}
